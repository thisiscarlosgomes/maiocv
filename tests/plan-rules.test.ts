import { strict as assert } from "node:assert";
import { test } from "node:test";
import { enforcePlanRules, planRuleViolations, venueType } from "../lib/plan-rules.ts";
import { samplePlan } from "../lib/trip-sample.ts";
import { FOOD, type TripPlan } from "../lib/trip.ts";

const sea = (status: "calm" | "rough") => ({ status, waveHeightM: status === "calm" ? 0.7 : 2.5, windKmh: 15, tempMaxC: 28, source: "fixture" });
// Fixture: what Carlos got — a guided tour on day 1 AND day 2, and Bar Bons Amigos as lunch at 13:00.
const fixture: TripPlan = {
  version: 1, locale: "en", title: "3 days on Maio", party: { adults: 2, kids: 0 }, hasCar: false, unmet: [],
  days: [
    { date: "2026-11-01", sea: sea("calm"), items: [
      { id: "d0-exp", kind: "experience", refId: "guia-002", start: "09:00", durationMin: 180 },
      { id: "d0-food", kind: "food", refId: "food-004", start: "13:00", durationMin: 75 },
    ] },
    { date: "2026-11-02", sea: sea("rough"), items: [
      { id: "d1-exp", kind: "experience", refId: "trek-001", start: "09:00", durationMin: 240 },
      { id: "d1-food", kind: "food", refId: "food-001", start: "13:30", durationMin: 75 },
    ] },
    { date: "2026-11-03", sea: sea("calm"), items: [
      { id: "d2-exp", kind: "experience", refId: "blue-sport-fishing-big-game", start: "08:00", durationMin: 240 },
      { id: "d2-food", kind: "food", refId: "food-004", start: "12:30", durationMin: 75 },
    ] },
  ],
};

test("venue type: Bar Bons Amigos is a bar; restaurants and bar-restaurants are restaurants", () => {
  const t = Object.fromEntries(FOOD.map((f) => [f.title, venueType(f)]));
  assert.equal(t["Bar Bons Amigos"], "bar");
  assert.equal(t["Bar restaurante Vasuza"], "restaurant");
  assert.equal(t["Sete Sois Sete Luas"], "restaurant");
});

test("fixture violates both rules before enforcement", () => {
  assert.equal(planRuleViolations(fixture).length, 3);
});

test("rule 1: at most one tour/experience per trip; the best (safe sea outing) is kept, others become beach visits", () => {
  const out = enforcePlanRules(fixture);
  const exps = out.days.flatMap((d) => d.items).filter((i) => i.kind === "experience");
  assert.equal(exps.length, 1);
  assert.equal(exps[0].refId, "blue-sport-fishing-big-game");
  assert.equal(out.days[0].items.find((i) => i.start === "09:00")?.kind, "place");
});

test("rule 1: an experience the guest asked for wins", () => {
  const out = enforcePlanRules(fixture, { requested: ["trek-001"] });
  assert.deepEqual(out.days.flatMap((d) => d.items).filter((i) => i.kind === "experience").map((i) => i.refId), ["trek-001"]);
});

test("rule 2: no bar before 19:00; lunch goes to a restaurant and the bar moves to an evening slot", () => {
  const out = enforcePlanRules(fixture);
  assert.deepEqual(planRuleViolations(out), []);
  for (const d of [out.days[0], out.days[2]]) {
    const lunch = d.items.find((i) => i.kind === "food" && i.start < "19:00")!;
    assert.equal(venueType(FOOD.find((f) => f.id === lunch.refId)!), "restaurant");
    const bar = d.items.find((i) => i.refId === "food-004")!;
    assert.ok(bar.start >= "19:00", `bar at ${bar.start}`);
  }
  for (const d of out.days) assert.equal(new Set(d.items.map((i) => i.id)).size, d.items.length);
  // input isn't mutated
  assert.equal(fixture.days[0].items[1].refId, "food-004");
});

test("generated plans (buildPlan) satisfy both rules", () => {
  for (const loc of ["en", "pt", "fr"] as const) assert.deepEqual(planRuleViolations(samplePlan(loc)), []);
});

test("rule 1 replacements stay walkable when the party has no car", async () => {
  const { place, distanceKm } = await import("../lib/trip.ts");
  const town = place("cidade-porto-ingles")!;
  const out = enforcePlanRules(fixture);
  for (const i of out.days.flatMap((d) => d.items).filter((i) => i.kind === "place")) assert.ok(distanceKm(place(i.refId)!, town) <= 3, i.refId);
});
