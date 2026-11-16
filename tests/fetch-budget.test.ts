import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { runPlanAgent } from "../lib/plan-agent.ts";

const TODAY = new Date("2026-11-15T12:00:00Z");

function bomb(): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => { throw new Error("model should not be called"); },
  }) as unknown as LanguageModel;
}

function hang(): typeof fetch {
  return (() => new Promise<Response>(() => {})) as typeof fetch;
}

test("a hanging API cannot hold a French plan build", async () => {
  const started = Date.now();
  const result = await runPlanAgent(
    [{ role: "user", content: "rythme lent, avec voiture, du 16 au 18 novembre" }],
    null,
    { model: bomb(), fetchImpl: hang(), now: TODAY },
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 4_000, `elapsed ${elapsed}ms`);
  assert.equal(result.plan?.hasCar, true, result.reply);
  assert.deepEqual(result.plan?.days.map((day) => day.date), ["2026-11-16", "2026-11-17", "2026-11-18"]);
});

test("who do I contact stays fast when every fetch hangs", async () => {
  const started = Date.now();
  const result = await runPlanAgent(
    [{ role: "user", content: "who do I contact" }],
    null,
    { model: bomb(), fetchImpl: hang(), now: TODAY },
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1_000, `elapsed ${elapsed}ms`);
  assert.equal(result.plan, null);
  assert.match(result.reply, /255 11 30/);
});
