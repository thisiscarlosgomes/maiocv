import { strict as assert } from "node:assert";
import { test } from "node:test";
import { samplePlan } from "../lib/trip-sample.ts";
import { planStrings } from "../lib/trip-strings.ts";
import { ISLAND_PATH, MAP_H, MAP_W, cardView, cve, dayLabel, dayPins, seaLine } from "../lib/trip-view.ts";

const plan = samplePlan("en");
const s = planStrings.en;

test("sample trip keeps the sea outing off the rough day", () => {
  assert.equal(plan.days[1].sea?.status, "rough");
  const seaDays = plan.days.map((d) => d.items.some((i) => i.kind === "experience" && cardView(i, "en", s)?.seaDependent));
  assert.deepEqual(seaDays, [false, false, true]);
});

test("every card in the sample renders from fixture data", () => {
  for (const day of plan.days) for (const item of day.items) {
    const v = cardView(item, "en", s);
    assert.ok(v, item.refId);
    assert.ok(v.title.length > 0);
    if (v.kind === "experience") {
      assert.ok(v.slots.length > 0);
      assert.match(v.price!, /^from €\d+ · [\d ]+ CVE · pay on the island$/);
    }
  }
});

test("experience card shows CVE at the fixed 110.265 rate", () => {
  assert.equal(cve(45), "4 962 CVE");
});

test("unknown ids render nothing", () => {
  assert.equal(cardView({ id: "x", kind: "experience", refId: "nope", start: "09:00", durationMin: 60 }, "en", s), null);
});

test("sea line and day labels are localized", () => {
  assert.equal(seaLine(plan.days[1].sea, s), "Rough sea · 2.4 m waves · 37 km/h wind");
  assert.match(seaLine(samplePlan("pt").days[1].sea, planStrings.pt), /^Mar agitado/);
  assert.equal(dayLabel("2026-10-29", "en"), "Thu 29");
});

test("map pins land inside the map frame", () => {
  assert.ok(ISLAND_PATH.startsWith("M") && ISLAND_PATH.endsWith("Z"));
  for (const day of plan.days) for (const pin of dayPins(day, "en", s)) {
    assert.ok(pin.x >= 0 && pin.x <= MAP_W && pin.y >= 0 && pin.y <= MAP_H, JSON.stringify(pin));
  }
});
