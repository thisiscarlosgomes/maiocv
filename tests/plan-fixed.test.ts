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

test("a quieter Saturday rebuilds the plan and keeps the dates and party", async () => {
  const model = scriptedModel([[{ tool: "propose_itinerary", input: { startDate: plan.days[0].date, days: plan.days.length, locale: "en", adults: 2, kids: 0, hasCar: false, drinks: false, boatTrips: 1 } }]], "Saturday is quieter. I rebuilt the days.");
  const r = await runPlanAgent([{ role: "user", content: "Make Saturday lazier" }], plan, { model, fetchImpl: fakeFetch({}), now: NOW });
  assert.ok(r.toolEvents.some((e) => e.name === "propose_itinerary" && e.ok));
  assert.equal(r.plan!.days[0].date, plan.days[0].date);
  assert.equal(r.plan!.party.adults, plan.party.adults);
  assert.equal(r.plan!.hasCar, false);
  assert.equal(r.task.constraints.quietEvenings, true);
  assert.ok(!r.plan!.days.some((d) => d.items.some((i) => i.slot === "drinks")));
  assert.notDeepEqual(r.plan, plan);
});

test("plan is fixed: questions are answered, plan unchanged", async () => {
  const model = scriptedModel([[{ tool: "search_experiences", input: { kind: "any", query: "Bitche Rotcha" } }]], "Yes. The water is shallow near the shore.");
  const r = await runPlanAgent([{ role: "user", content: "Is Bitche Rotcha OK for kids?" }], plan, { model, fetchImpl: fakeFetch({}), now: NOW });
  assert.deepEqual(r.plan, plan);
  assert.match(r.reply, /shallow/);
});

test("PLAN_MOCK: edit requests rebuild the plan", () => {
  for (const ask of ["Make Saturday lazier", "Add a sunset", "Swap the beach"]) {
    const s = mockScript([{ role: "user", content: ask }], plan, "2026-10-27");
    assert.ok(s.calls.some((step) => step.some((call) => call.tool === "propose_itinerary")));
    assert.doesNotMatch(s.reply, /fixed/);
  }
  const q = mockScript([{ role: "user", content: "Is Bitche Rotcha OK for kids?" }], plan, "2026-10-27");
  assert.deepEqual(q.calls, []);
  assert.match(q.reply, /shallow/);
});
