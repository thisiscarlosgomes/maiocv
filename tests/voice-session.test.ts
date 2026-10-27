import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createVoiceSessionHandler } from "../lib/voice-session.ts";

const origin = "https://www.maio.cv";
const credentials = { apiKey: "test-server-secret", agentId: "agent_test", trustVercelHeaders: true };

function request(body: unknown = { locale: "pt" }, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/voice/session`, {
    method: "POST",
    headers: { "origin": origin, "content-type": "application/json", "x-vercel-forwarded-for": "203.0.113.4", ...headers },
    body: JSON.stringify(body),
  });
}

test("missing server configuration makes no vendor request", async () => {
  for (const config of [{}, { apiKey: credentials.apiKey }, { agentId: credentials.agentId }]) {
    const handler = createVoiceSessionHandler({
      getConfig: () => config,
      fetcher: async () => { assert.fail("Vendor must not be called without configuration"); },
    });
    const response = await handler(request());
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "unavailable" });
  }
});

test("token issuance rejects cross-origin, missing-origin and non-JSON requests", async () => {
  const handler = createVoiceSessionHandler({
    getConfig: () => credentials,
    fetcher: async () => { assert.fail("Invalid requests must not reach the vendor"); },
  });
  for (const [headers, expected] of [
    [{ origin: "https://other.example" }, 403],
    [{ origin: "null" }, 403],
    [{ "sec-fetch-site": "cross-site" }, 403],
    [{ "content-type": "text/plain" }, 415],
  ] as const) {
    const response = await handler(request({ locale: "en" }, headers));
    assert.equal(response.status, expected);
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  const noOrigin = request();
  noOrigin.headers.delete("origin");
  assert.equal((await handler(noOrigin)).status, 403);
});

test("invalid locale, extra properties, malformed and oversized JSON are rejected", async () => {
  const handler = createVoiceSessionHandler({
    getConfig: () => credentials,
    fetcher: async () => { assert.fail("Invalid requests must not reach the vendor"); },
  });
  for (const body of [null, [], {}, { locale: "es" }, { locale: ["pt"] }, { locale: "pt", agentId: "other" }, { locale: "x".repeat(2000) }]) {
    assert.equal((await handler(request(body))).status, 400);
  }
  const malformed = new Request(`${origin}/api/voice/session`, {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: "{",
  });
  assert.equal((await handler(malformed)).status, 400);
  assert.equal((await handler(request({ locale: "pt" }, { "content-length": "5000" }))).status, 400);
});

test("valid locales use the fixed vendor endpoint and expose only the conversation token", async () => {
  for (const locale of ["pt", "en", "fr"]) {
    let calls = 0;
    const handler = createVoiceSessionHandler({
      getConfig: () => credentials,
      fetcher: async (input, init) => {
        calls++;
        assert.equal(String(input), "https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=agent_test");
        assert.equal(init?.method, "GET");
        assert.equal(new Headers(init?.headers).get("xi-api-key"), credentials.apiKey);
        assert.equal(init?.cache, "no-store");
        assert.equal(init?.redirect, "error");
        assert.ok(init?.signal);
        return Response.json({ token: "short-lived-token", conversation_id: "private-conversation-id", extra: credentials.apiKey });
      },
    });
    const response = await handler(request({ locale }));
    assert.equal(calls, 1);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { token: "short-lived-token", maxDurationSeconds: 60 });
  }
});

test("cooldown blocks concurrent issuance and expires after thirty seconds", async () => {
  let time = 1000;
  let calls = 0;
  let finish: ((response: Response) => void) | undefined;
  const handler = createVoiceSessionHandler({
    getConfig: () => credentials,
    now: () => time,
    fetcher: async () => {
      calls++;
      return calls === 1 ? new Promise<Response>(resolve => { finish = resolve; }) : Response.json({ token: "next-token" });
    },
  });
  const first = handler(request());
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  const blocked = await handler(request());
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "30");
  assert.deepEqual(await blocked.json(), { error: "rate_limited" });
  assert.equal(calls, 1);
  finish(Response.json({ token: "first-token" }));
  assert.equal((await first).status, 200);
  time += 30_000;
  assert.equal((await handler(request())).status, 200);
  assert.equal(calls, 2);
});

test("IP buckets distinguish trusted clients but ignore forwarding spoofing locally", async () => {
  for (const trustVercelHeaders of [true, false]) {
    const handler = createVoiceSessionHandler({
      getConfig: () => ({ ...credentials, trustVercelHeaders }),
      fetcher: async () => Response.json({ token: "test-token" }),
    });
    assert.equal((await handler(request())).status, 200);
    const second = await handler(request({ locale: "fr" }, { "x-vercel-forwarded-for": "203.0.113.5" }));
    assert.equal(second.status, trustVercelHeaders ? 200 : 429);
  }
});

test("vendor errors and malformed responses never disclose upstream details", async () => {
  for (const vendorResponse of [
    new Response(`private ${credentials.apiKey}`, { status: 401 }),
    new Response(`private ${credentials.apiKey}`, { status: 500 }),
    new Response("not json", { status: 200 }),
    Response.json({ token: "" }),
    Response.json({ token: "contains whitespace" }),
    Response.json({ conversation_id: "no-token" }),
    Response.json({ token: "x".repeat(40_000) }),
  ]) {
    const handler = createVoiceSessionHandler({ getConfig: () => credentials, fetcher: async () => vendorResponse });
    const response = await handler(request());
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "upstream" });
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("vendor throttling returns a bounded retry hint without its error body", async () => {
  const handler = createVoiceSessionHandler({
    getConfig: () => credentials,
    fetcher: async () => new Response("private vendor diagnostics", { status: 429, headers: { "retry-after": "100000" } }),
  });
  const response = await handler(request());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "30");
  assert.deepEqual(await response.json(), { error: "rate_limited" });
});

test("network failures and the vendor timeout return generic upstream errors", async () => {
  const failed = createVoiceSessionHandler({
    getConfig: () => credentials,
    fetcher: async () => { throw new Error(`private ${credentials.apiKey}`); },
  });
  const failedResponse = await failed(request());
  assert.equal(failedResponse.status, 502);
  assert.deepEqual(await failedResponse.json(), { error: "upstream" });

  const timedOut = createVoiceSessionHandler({
    getConfig: () => credentials,
    upstreamTimeoutMs: 5,
    fetcher: async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("vendor aborted")), { once: true });
    }),
  });
  const timeoutResponse = await timedOut(request());
  assert.equal(timeoutResponse.status, 504);
  assert.deepEqual(await timeoutResponse.json(), { error: "upstream" });
});
