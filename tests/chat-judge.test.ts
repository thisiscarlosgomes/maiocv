import assert from "node:assert/strict";
import { test } from "node:test";
import { judgeCap, judgeEnabled, judgePrompt, judgeRate, memoryJudgeBudget, reviewWithJudge, scheduleTurnReview, type JudgeVerdict } from "../lib/chat-judge.ts";
import { memoryFlagStore } from "../lib/chat-flags-store.ts";
import { handleMaioChat } from "../lib/maio-chat-proxy.ts";
import type { TurnForFlags } from "../lib/chat-flags.ts";

function clean(): TurnForFlags {
  return {
    surface: "plan",
    locale: "en",
    userMessage: "what's the hospital number?",
    previousTurns: [{ role: "user", content: "hi" }, { role: "assistant", content: "Hello." }],
    botReply: "Hospital do Maio: +238 255 11 30.",
    planBefore: null,
    planAfter: null,
    chips: [],
    planTurn: false,
    toolFacts: "Hospital do Maio +238 255 11 30",
  };
}

const env = { MAIO_JUDGE: "1", NODE_ENV: "test", MAIO_JUDGE_RATE: "1", MAIO_JUDGE_DAILY_CAP: "2000" };

test("a failing judge is stored and a passing or broken judge stores nothing", async () => {
  const failing = memoryFlagStore();
  const budget = memoryJudgeBudget();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let pending = Promise.resolve();
  scheduleTurnReview(clean(), {
    env,
    store: failing,
    budget,
    random: () => 0,
    after: (task) => { pending = task(); },
    judge: async () => {
      await gate;
      return { ok: false, reasons: ["ignored the date"], severity: "high" };
    },
  });
  assert.equal(failing.rows.length, 0);
  release();
  await pending;
  assert.equal(failing.rows.length, 1);
  assert.equal(failing.rows[0].source, "judge");
  assert.equal(failing.rows[0].severity, "high");
  assert.deepEqual(failing.rows[0].reasons, ["ignored the date"]);
  const json = JSON.stringify(failing.rows[0]);
  assert.equal(json.includes("userAgent"), false);
  assert.equal(json.includes("userId"), false);

  const passing = memoryFlagStore();
  await reviewWithJudge(clean(), { env, store: passing, budget: memoryJudgeBudget(), judge: async () => ({ ok: true, reasons: ["fine"], severity: "low" }) });
  assert.equal(passing.rows.length, 0);

  const broken = memoryFlagStore();
  await reviewWithJudge(clean(), { env, store: broken, budget: memoryJudgeBudget(), judge: async () => { throw new Error("gateway down"); } });
  assert.equal(broken.rows.length, 0);
});

test("the judge is sampled and capped before the model is called", async () => {
  let calls = 0;
  const judge = async (): Promise<JudgeVerdict> => {
    calls += 1;
    return { ok: false, reasons: ["too long"], severity: "low" };
  };
  const skipped = memoryFlagStore();
  await reviewWithJudge(clean(), { env: { ...env, MAIO_JUDGE_RATE: "0" }, store: skipped, budget: memoryJudgeBudget(), judge });
  assert.equal(calls, 0);
  assert.equal(skipped.rows.length, 0);

  calls = 0;
  const budget = memoryJudgeBudget();
  const capped = { ...env, MAIO_JUDGE_DAILY_CAP: "1" };
  await reviewWithJudge(clean(), { env: capped, store: memoryFlagStore(), budget, judge, now: new Date("2026-11-15T12:00:00Z") });
  await reviewWithJudge(clean(), { env: capped, store: memoryFlagStore(), budget, judge, now: new Date("2026-11-15T13:00:00Z") });
  assert.equal(calls, 1);
  assert.equal(budget.counts.get("2026-11-15"), 1);
});

test("the judge is on in production by default and off in development", () => {
  assert.equal(judgeEnabled({ NODE_ENV: "production" }), true);
  assert.equal(judgeEnabled({ NODE_ENV: "development" }), false);
  assert.equal(judgeEnabled({ NODE_ENV: "production", MAIO_JUDGE: "0" }), false);
  assert.equal(judgeEnabled({ NODE_ENV: "development", MAIO_JUDGE: "1" }), true);
  assert.equal(judgeRate({}), 1);
  assert.equal(judgeRate({ MAIO_JUDGE_RATE: "0.25" }), 0.25);
  assert.equal(judgeCap({}), 2000);
  assert.equal(judgeCap({ MAIO_JUDGE_DAILY_CAP: "10" }), 10);
});

test("the judge prompt uses the turn and not request identifiers", () => {
  const prompt = judgePrompt({ ...clean(), ip: "203.0.113.9", userAgent: "SpyBrowser", cookie: "sid", userId: "user-7" } as TurnForFlags);
  assert.match(prompt, /hospital number/);
  assert.match(prompt, /Hospital do Maio/);
  assert.equal(prompt.includes("203.0.113.9"), false);
  assert.equal(prompt.includes("SpyBrowser"), false);
  assert.equal(prompt.includes("user-7"), false);
  assert.equal(prompt.includes("sid"), false);
});

test("Ask Maio returns the reply before a slow judge finishes", async () => {
  const store = memoryFlagStore();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let pending = Promise.resolve();
  const response = await handleMaioChat(new Request("http://localhost/api/maio-chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "where is the hospital?" }], context: { lang: "en" } }),
  }), {
    env,
    store,
    budget: memoryJudgeBudget(),
    after: (task) => { pending = task(); },
    judge: async () => {
      await gate;
      return { ok: false, reasons: ["did not answer"], severity: "med" };
    },
    fetchImpl: async () => new Response(JSON.stringify({ message: "The hospital is on the main street." }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(store.rows.length, 0);
  assert.equal((await response.json()).message, "The hospital is on the main street.");
  release();
  await pending;
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].source, "judge");
  assert.equal(store.rows[0].surface, "ask");
  assert.equal(store.rows[0].severity, "med");

  const quiet = memoryFlagStore();
  let ran = false;
  await handleMaioChat(new Request("http://localhost/api/maio-chat", {
    method: "POST",
    body: JSON.stringify({ messages: [{ role: "user", content: "where is the hospital?" }], context: { lang: "fr" } }),
  }), {
    env,
    store: quiet,
    budget: memoryJudgeBudget(),
    after: (task) => { void task(); },
    judge: async () => { ran = true; return { ok: true, reasons: [], severity: "low" }; },
    fetchImpl: async () => new Response(JSON.stringify({ message: "L'hôpital est dans la rue principale." }), { status: 200 }),
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(ran, true);
  assert.equal(quiet.rows.length, 0);
});
