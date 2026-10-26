import { strict as assert } from "node:assert";
import { test } from "node:test";
import { describeChanges } from "../lib/trip-changes.ts";
import { applyEdits } from "../lib/trip-edit.ts";
import { samplePlan } from "../lib/trip-sample.ts";
import { planStrings } from "../lib/trip-strings.ts";

const plan = samplePlan("en");
const s = planStrings.en;

test("no change → no note", () => {
  assert.equal(describeChanges(plan, structuredClone(plan), "en", s), null);
});

test("lazier Saturday: change note names the day, lists each change, tags the changed cards", () => {
  const { plan: next } = applyEdits(plan, [
    { op: "retime", itemId: "d2-exp", start: "09:30" },
    { op: "swap", itemId: "d2-place", refId: "praia-ponta-preta" },
  ]);
  const c = describeChanges(plan, next, "en", s)!;
  assert.deepEqual(c.ids.sort(), ["d2-exp", "d2-place"]);
  assert.equal(c.firstDay, 2);
  assert.equal(c.summary, "2 changes on Saturday 31");
  assert.match(c.details.join(" | "), /moved to 09:30/);
  assert.match(c.details.join(" | "), /swapped for/);
});
