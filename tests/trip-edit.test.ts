import { strict as assert } from "node:assert";
import { test } from "node:test";
import { runPlanAgent } from "../lib/plan-agent.ts";
import { applyEdits, changedItems, decodeTrip, encodeTrip } from "../lib/trip-edit.ts";
import { parseTripPlan, unknownRefs } from "../lib/trip.ts";
import { samplePlan } from "../lib/trip-sample.ts";
import { NOW, fakeFetch } from "./plan/fixtures.ts";
import { scriptedModel } from "./plan/mock-model.ts";

const plan = samplePlan("en");
const ids = (d: number) => plan.days[d].items.map((i) => i.id);

test("sample ids used below", () => {
  assert.deepEqual(ids(2), ["d2-exp", "d2-food", "d2-place"]);
});

test("swap changes exactly one item and keeps its id and day", () => {
  const { plan: next, errors } = applyEdits(plan, [{ op: "swap", itemId: "d2-place", refId: "praia-ponta-preta" }]);
  assert.deepEqual(errors, []);
  assert.deepEqual(changedItems(plan, next), ["d2-place"]);
  assert.equal(next.days[2].items.find((i) => i.id === "d2-place")!.refId, "praia-ponta-preta");
});

test("move changes exactly one item and re-sorts the target day", () => {
  const { plan: next, errors } = applyEdits(plan, [{ op: "move", itemId: "d2-exp", toDay: 0 }]);
  assert.deepEqual(errors, []);
  assert.deepEqual(changedItems(plan, next), ["d2-exp"]);
  const starts = next.days[0].items.map((i) => i.start);
  assert.deepEqual(starts, [...starts].sort());
});

test("sea outing cannot move onto the rough day; plan unchanged", () => {
  const { plan: next, errors } = applyEdits(plan, [{ op: "move", itemId: "d2-exp", toDay: 1 }]);
  assert.equal(errors.length, 1);
  assert.deepEqual(changedItems(plan, next), []);
});

test("swap to an invented id is refused", () => {
  const { plan: next, errors } = applyEdits(plan, [{ op: "swap", itemId: "d2-exp", refId: "dolphin-cruise" }]);
  assert.match(errors[0], /not a known experience/);
  assert.deepEqual(unknownRefs(next), []);
});

test("remove drops one item; input is not mutated", () => {
  const before = JSON.stringify(plan);
  const { plan: next } = applyEdits(plan, [{ op: "remove", itemId: "d2-food" }]);
  assert.deepEqual(changedItems(plan, next), ["d2-food"]);
  assert.equal(JSON.stringify(plan), before);
});

test("retime changes one item's start and keeps the day sorted", () => {
  const { plan: next, errors } = applyEdits(plan, [{ op: "retime", itemId: "d2-exp", start: "09:30" }]);
  assert.deepEqual(errors, []);
  assert.deepEqual(changedItems(plan, next), ["d2-exp"]);
  const starts = next.days[2].items.map((i) => i.start);
  assert.deepEqual(starts, [...starts].sort());
});

test("share link round-trips the plan, including non-ASCII text", () => {
  const pt = samplePlan("pt");
  const code = encodeTrip(pt);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(parseTripPlan(decodeTrip(code)), pt);
  assert.ok(code.length < 6000, `link length ${code.length}`);
  assert.equal(parseTripPlan(decodeTrip("not-a-trip")), null);
});

// Natural-language edits through the agent (mocked model replays the expected tool call).
const edits = [
  { prompt: "Swap Saturday's beach for Ponta Preta", ops: [{ op: "swap", itemId: "d2-place", refId: "praia-ponta-preta" }], changed: ["d2-place"] },
  { prompt: "Move the fishing trip to Thursday", ops: [{ op: "move", itemId: "d2-exp", toDay: 0 }], changed: ["d2-exp"] },
  { prompt: "Skip lunch on Saturday", ops: [{ op: "remove", itemId: "d2-food" }], changed: ["d2-food"] },
  { prompt: "Put the fishing trip on Friday", ops: [{ op: "move", itemId: "d2-exp", toDay: 1 }], changed: [] },
];
for (const e of edits) {
  test(`NL edit "${e.prompt}": minimal diff ${JSON.stringify(e.changed)}`, async () => {
    const result = await runPlanAgent([{ role: "user", content: e.prompt }], plan, {
      model: scriptedModel([[{ tool: "edit_itinerary", input: { ops: e.ops } }]], "Done."), fetchImpl: fakeFetch({}), now: NOW,
    });
    assert.ok(result.plan);
    assert.deepEqual(changedItems(plan, result.plan), e.changed);
    assert.ok(!result.toolEvents.some((t) => t.name === "propose_itinerary"), "edits never rebuild the plan");
    assert.equal(result.toolEvents.find((t) => t.name === "edit_itinerary")?.ok, e.changed.length > 0);
  });
}
