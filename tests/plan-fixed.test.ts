import { strict as assert } from "node:assert";
import { test } from "node:test";
import { runPlanAgent } from "../lib/plan-agent.ts";
import { mockScript } from "../lib/plan-mock.ts";
import { decodeTrip, encodeTrip } from "../lib/trip-share.ts";
import { parseTripPlan } from "../lib/trip.ts";
import { samplePlan } from "../lib/trip-sample.ts";
import { NOW, fakeFetch } from "./plan/fixtures.ts";
import { scriptedModel } from "./plan/mock-model.ts";

const plan = samplePlan("en");

test("share link round-trips the plan, including non-ASCII text", () => {
  const pt = samplePlan("pt");
  const code = encodeTrip(pt);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(parseTripPlan(decodeTrip(code)), pt);
  assert.ok(code.length < 6000, `link length ${code.length}`);
  assert.equal(parseTripPlan(decodeTrip("not-a-trip")), null);
});

test("plan is fixed: with a current plan, propose_itinerary is not offered and the plan comes back unchanged", async () => {
  // The model tries to rebuild the plan; the tool isn't available, so the call fails and the plan stays as it was.
  const model = scriptedModel([[{ tool: "propose_itinerary", input: { startDate: "2026-11-01", days: 1, locale: "en" } }]], "This plan is fixed.");
  const r = await runPlanAgent([{ role: "user", content: "Make Saturday lazier" }], plan, { model, fetchImpl: fakeFetch({}), now: NOW });
  {
    assert.deepEqual(r.plan, plan);
    assert.ok(!r.toolEvents.some((e) => e.name === "propose_itinerary"));
  }
});

test("plan is fixed: questions are answered, plan unchanged", async () => {
  const model = scriptedModel([[{ tool: "search_experiences", input: { kind: "any", query: "Bitche Rotcha" } }]], "Yes. The water is shallow near the shore.");
  const r = await runPlanAgent([{ role: "user", content: "Is Bitche Rotcha OK for kids?" }], plan, { model, fetchImpl: fakeFetch({}), now: NOW });
  assert.deepEqual(r.plan, plan);
  assert.match(r.reply, /shallow/);
});

test("PLAN_MOCK: edit requests make no tool calls and say the plan is fixed", () => {
  for (const ask of ["Make Saturday lazier", "Add a sunset", "Swap the beach"]) {
    const s = mockScript([{ role: "user", content: ask }], plan, "2026-10-27");
    assert.deepEqual(s.calls, []);
    assert.match(s.reply, /fixed/);
  }
  const q = mockScript([{ role: "user", content: "Is Bitche Rotcha OK for kids?" }], plan, "2026-10-27");
  assert.deepEqual(q.calls, []);
  assert.match(q.reply, /shallow/);
});
