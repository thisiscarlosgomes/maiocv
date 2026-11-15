import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { handleFlagGet, handleFlagPatch, handleFlagPost, resetFlagPostLimit, setFlagPostLimit } from "../lib/chat-flags-http.ts";
import { memoryFlagStore, setFlagStore } from "../lib/chat-flags-store.ts";

const secret = "f".repeat(32);
const store = memoryFlagStore();

function post(body: unknown, headers: Record<string, string> = {}) {
  return handleFlagPost(new Request("http://localhost/api/flags", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

describe("flag endpoints", { concurrency: 1 }, () => {
  const previous = process.env.FLAGS_ADMIN_KEY;
  before(() => {
    process.env.FLAGS_ADMIN_KEY = secret;
    setFlagStore(store);
  });
  after(() => {
    process.env.FLAGS_ADMIN_KEY = previous;
    setFlagStore(null);
    resetFlagPostLimit();
    store.rows.length = 0;
  });

  test("GET and PATCH require the bearer key and otherwise return 401", async () => {
    delete process.env.FLAGS_ADMIN_KEY;
    assert.equal((await handleFlagGet(new Request("http://localhost/api/flags"))).status, 401);
    process.env.FLAGS_ADMIN_KEY = secret;
    assert.equal((await handleFlagGet(new Request("http://localhost/api/flags"))).status, 401);
    assert.equal((await handleFlagGet(new Request("http://localhost/api/flags", { headers: { authorization: "Bearer wrong-key-value" } }))).status, 401);
    assert.equal((await handleFlagGet(new Request("http://localhost/api/flags", { headers: { authorization: "Basic " + secret } }))).status, 401);
    process.env.FLAGS_ADMIN_KEY = "short";
    assert.equal((await handleFlagGet(new Request("http://localhost/api/flags", { headers: { authorization: "Bearer short" } }))).status, 401);
    process.env.FLAGS_ADMIN_KEY = secret;
    const missing = await handleFlagPatch(new Request("http://localhost/api/flags/1", { method: "PATCH", body: "{}" }), "1");
    assert.equal(missing.status, 401);
  });

  test("POST stores a thumbs-down without IP, user agent, cookie, or user id", async () => {
    store.rows.length = 0;
    resetFlagPostLimit();
    const response = await post({
      surface: "ask",
      locale: "pt",
      userMessage: "onde fica a praia?",
      previousTurns: [{ role: "assistant", content: "Olá." }, { role: "user", content: "olá" }],
      botReply: "A praia principal fica em Porto Inglês.",
      planBefore: null,
      planAfter: null,
      chips: [],
      note: "data errada",
      ip: "203.0.113.8",
      userAgent: "Mozilla/5.0",
      cookie: "sid=abc",
      userId: "user-42",
      source: "auto",
    }, { "user-agent": "Mozilla/5.0", cookie: "sid=abc", "x-forwarded-for": "203.0.113.8" });
    assert.equal(response.status, 204);
    assert.equal(store.rows.length, 1);
    const row = store.rows[0];
    assert.equal(row.source, "thumbs_down");
    assert.deepEqual(row.reasons, ["thumbs_down"]);
    assert.equal(row.note, "data errada");
    assert.equal(row.locale, "pt");
    assert.match(row.context, /Olá/);
    const json = JSON.stringify(row);
    assert.equal(json.includes("203.0.113.8"), false);
    assert.equal(json.includes("Mozilla"), false);
    assert.equal(json.includes("sid=abc"), false);
    assert.equal(json.includes("user-42"), false);
    assert.equal(json.includes("userAgent"), false);
    assert.equal("userId" in row, false);
  });

  test("POST rejects a foreign origin, a huge body, a bad body, and a burst", async () => {
    const foreign = await handleFlagPost(new Request("http://localhost/api/flags", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ surface: "ask", locale: "en", userMessage: "hi", botReply: "hello there" }),
    }));
    assert.equal(foreign.status, 403);
    const huge = await post("x".repeat(12_001));
    assert.equal(huge.status, 413);
    const bad = await post({ surface: "ask", locale: "en" });
    assert.equal(bad.status, 400);
    setFlagPostLimit(2, 2);
    const body = { surface: "plan", locale: "en", userMessage: "hi", botReply: "hello there friend" };
    assert.equal((await post(body)).status, 204);
    assert.equal((await post(body)).status, 204);
    assert.equal((await post(body)).status, 429);
    resetFlagPostLimit();
  });

  test("a long note is cut to 300 characters", async () => {
    store.rows.length = 0;
    const response = await post({
      surface: "ask",
      locale: "en",
      userMessage: "where is the beach?",
      botReply: "Porto Inglês has the town beach.",
      note: "n".repeat(400),
    });
    assert.equal(response.status, 204);
    assert.equal(store.rows.at(-1)?.note?.length, 300);
  });

  test("GET filters by since and PATCH updates status and prUrl", async () => {
    store.rows.length = 0;
    store.rows.push({
      id: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-11-01T00:00:00.000Z",
      surface: "plan",
      locale: "en",
      reasons: ["thumbs_down"],
      userMessage: "hi",
      context: "",
      botReply: "Hello from Maio.",
      planBefore: null,
      planAfter: null,
      chips: [],
      deploySha: null,
      source: "thumbs_down",
      status: "new",
    });
    const auth = { authorization: `Bearer ${secret}` };
    const listed = await handleFlagGet(new Request("http://localhost/api/flags?since=2026-11-01T00:00:00.000Z&limit=10", { headers: auth }));
    assert.equal(listed.status, 200);
    const payload = await listed.json() as { flags: { id: string }[] };
    assert.equal(payload.flags.length, 1);
    const empty = await handleFlagGet(new Request("http://localhost/api/flags?since=2026-12-01T00:00:00.000Z", { headers: auth }));
    assert.deepEqual((await empty.json()).flags, []);
    const badSince = await handleFlagGet(new Request("http://localhost/api/flags?since=not-a-date", { headers: auth }));
    assert.equal(badSince.status, 400);
    const patched = await handleFlagPatch(new Request("http://localhost/api/flags/11111111-1111-4111-8111-111111111111", {
      method: "PATCH",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ status: "fixed", prUrl: "https://github.com/example/maio/pull/12", userId: "user-42", botReply: "rewritten" }),
    }), "11111111-1111-4111-8111-111111111111");
    assert.equal(patched.status, 200);
    assert.equal(store.rows[0].status, "fixed");
    assert.equal(store.rows[0].prUrl, "https://github.com/example/maio/pull/12");
    assert.equal(store.rows[0].botReply, "Hello from Maio.");
    assert.equal(store.rows[0].userMessage, "hi");
    const missing = await handleFlagPatch(new Request("http://localhost/api/flags/22222222-2222-4222-8222-222222222222", {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ status: "wontfix" }),
    }), "22222222-2222-4222-8222-222222222222");
    assert.equal(missing.status, 404);
    const badStatus = await handleFlagPatch(new Request("http://localhost/api/flags/11111111-1111-4111-8111-111111111111", {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ status: "shipped" }),
    }), "11111111-1111-4111-8111-111111111111");
    assert.equal(badStatus.status, 400);
  });
});
