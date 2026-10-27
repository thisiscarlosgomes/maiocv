import { strict as assert } from "node:assert";
import { test } from "node:test";
import { EXPERIENCES, FOOD, PLACES, parseTripPlan, unknownRefs, addDays, distanceKm, place, type TripPlan } from "../lib/trip.ts";
import { planEnabled } from "../lib/plan-flag.ts";

const sample: TripPlan = {
  version: 1, locale: "en", title: "3 days on Maio", party: { adults: 2, kids: 0 }, hasCar: false, unmet: [],
  days: [{ date: "2026-10-29", sea: { status: "calm", waveHeightM: 0.8, windKmh: 14, tempMaxC: 28, source: "Open-Meteo" },
    items: [
      { id: "a", kind: "experience", refId: "blue-sport-fishing-big-game", start: "08:00", durationMin: 240 },
      { id: "b", kind: "food", refId: "food-001", start: "13:00", durationMin: 75 },
      { id: "c", kind: "place", refId: "praia-bitche-rotcha", start: "15:30", durationMin: 120 },
    ] }],
};

test("fixture keeps Visit Maio ids and marks invented values as example", () => {
  assert.ok(EXPERIENCES.length >= 9 && FOOD.length >= 6 && PLACES.length > 50);
  for (const item of EXPERIENCES) {
    assert.equal(item.example.isExample, true);
    assert.ok(place(item.placeId), `${item.id} anchors to a known place`);
  }
});

test("a valid plan parses and has no unknown ids", () => {
  assert.deepEqual(unknownRefs(sample), []);
  assert.ok(parseTripPlan(sample));
});

test("plans with made-up ids or bad times are rejected", () => {
  const invented = structuredClone(sample);
  invented.days[0].items[0].refId = "dolphin-cruise";
  assert.deepEqual(unknownRefs(invented), ["dolphin-cruise"]);
  assert.equal(parseTripPlan(invented), null);
  const badTime = structuredClone(sample);
  badTime.days[0].items[0].start = "25:00";
  assert.equal(parseTripPlan(badTime), null);
});

test("date and distance helpers", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  const km = distanceKm(place("cidade-porto-ingles")!, place("praia-do-morro")!);
  assert.ok(km > 3 && km < 10, String(km));
});

test("plan is off unless MAIO_PLAN=1", () => {
  assert.equal(planEnabled({}), false);
  assert.equal(planEnabled({ MAIO_PLAN: "1" }), true);
});
