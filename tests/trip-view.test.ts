import { strict as assert } from "node:assert";
import { test } from "node:test";
import { samplePlan } from "../lib/trip-sample.ts";
import { planStrings } from "../lib/trip-strings.ts";
import { ISLAND_PATH, MAP_H, MAP_W, cardView, contactLinks, dayLabel, dayPins, daySummary, imageUrl, seaLine } from "../lib/trip-view.ts";
import { EXPERIENCES, experience } from "../lib/trip.ts";

const plan = samplePlan("en");
const s = planStrings.en;

test("sample trip keeps the sea outing off the rough day", () => {
  assert.equal(plan.days[1].sea?.status, "rough");
  const seaDays = plan.days.map((d) => d.items.some((i) => i.kind === "experience" && cardView(i, "en", s)?.seaDependent));
  // The only full day is rough and arrival/departure days take no tour, so there is no sea outing; the guest is told.
  assert.deepEqual(seaDays, [false, false, false]);
  assert.ok(plan.unmet.some((u) => /sea outing/.test(u)));
});

test("every card in the sample renders from fixture data, with no price anywhere", () => {
  for (const day of plan.days) for (const item of day.items) {
    const v = cardView(item, "en", s);
    assert.ok(v, item.refId);
    assert.ok(v.title.length > 0);
    assert.doesNotMatch(JSON.stringify(v), /€|CVE|price|pay on/i);
  }
  assert.doesNotMatch(JSON.stringify(plan), /price|request/i);
  assert.doesNotMatch(JSON.stringify(s), /€|price|pay on the island|request booking/i);
});

test("fixture has no prices and operator contact comes only from Visit Maio data", () => {
  for (const e of EXPERIENCES) {
    assert.equal("priceEur" in e.example, false, e.id);
    assert.ok(e.operator, e.id);
  }
});

test("contact rule: booking site → nothing; no site + phone/WhatsApp → links; nothing known → nothing", () => {
  assert.equal(contactLinks(null), null);
  assert.equal(contactLinks({ name: "A", bookingUrl: "https://example.com", whatsapp: "2389000000", phone: "+2389000000" }), null);
  assert.equal(contactLinks({ name: "A", bookingUrl: "", whatsapp: "", phone: "" }), null);
  assert.deepEqual(contactLinks({ name: "A", bookingUrl: "", whatsapp: "", phone: "+238 970 88 09" }), { whatsapp: null, call: "tel:+2389708809" });
  assert.deepEqual(contactLinks({ name: "A", bookingUrl: "", whatsapp: "+238 970 88 09", phone: "" }), { whatsapp: "https://wa.me/2389708809", call: null });
  const offroad = experience("blue-maio-offroad")!;
  assert.equal(contactLinks(offroad.operator), null, "has its own site");
  const fishing = EXPERIENCES.find((e) => e.id === "blue-sport-fishing-big-game")!;
  assert.equal(contactLinks(fishing.operator), null, "no contact in data");
});

test("day summary counts stops and estimates travel", () => {
  assert.match(daySummary(plan.days[2], s, false), /^4 stops · \d+ min (driving|walking)$/);
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

test("every stop image resolves to an absolute http(s) URL or null", () => {
  assert.equal(imageUrl("/experiences/blue-sports/maio-offroad.jpg"), "https://www.visitmaio.com/experiences/blue-sports/maio-offroad.jpg");
  assert.equal(imageUrl(""), null);
  assert.equal(imageUrl("javascript:x"), null);
  for (const e of EXPERIENCES) { const u = imageUrl(e.image); assert.ok(u === null || /^https?:\/\//.test(u), e.id); }
});
