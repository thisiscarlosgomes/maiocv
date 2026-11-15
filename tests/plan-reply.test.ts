import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildPlan } from "../lib/trip-planner.ts";
import { toMin } from "../lib/full-day.ts";
import { formatItinerary, humanPlanDate, localizeGuestLabels, planBlurb, publicPlanReply, stripPlanLeaks } from "../lib/plan-reply.ts";
import type { TripPlan } from "../lib/trip.ts";

const DUMP = "Overview - Length: 3 days - Pace: slow Day 1 — 2026-11-16 - 08:10 — Breakfast: Enzo (food listing) - 09:00 — Experience: Rental Quad (id blue-rental-quad-big-game) we list that by id: blue-rental-quad-big-game 2026-11-16 → 2026-11-18";

function plan(locale: "en" | "pt" | "fr"): TripPlan {
  return buildPlan({
    request: { startDate: "2026-11-16", days: 3, locale, pace: "slow", boatTrips: 0, hasCar: true, adults: 2 },
    forecast: [
      { date: "2026-11-16", waveHeightM: 0.8, windKmh: 16, tempMaxC: 28, sunset: "18:10" },
      { date: "2026-11-17", waveHeightM: 0.7, windKmh: 14, tempMaxC: 28, sunset: "18:10" },
      { date: "2026-11-18", waveHeightM: 0.9, windKmh: 18, tempMaxC: 27, sunset: "18:09" },
    ],
    sailings: [],
  });
}

test("human dates follow the locale", () => {
  assert.equal(humanPlanDate("2026-11-16", "en"), "Mon 16 Nov");
  assert.match(humanPlanDate("2026-11-16", "pt"), /^seg\.? 16 nov\.?$/i);
  assert.match(humanPlanDate("2026-11-16", "fr"), /^lun\.? 16 nov\.?$/i);
  assert.doesNotMatch(humanPlanDate("2026-11-16", "en"), /\d{4}-\d{2}-\d{2}/);
});

test("a dumped itinerary becomes a two-line blurb, not the day list", () => {
  assert.equal(stripPlanLeaks("Enzo (food listing)"), "Enzo");
  assert.doesNotMatch(stripPlanLeaks("Rental Quad (id blue-rental-quad-big-game)"), /blue-rental|food listing|\(id/);
  for (const locale of ["en", "pt", "fr"] as const) {
    const built = plan(locale);
    const reply = publicPlanReply(DUMP, locale, built);
    assert.equal(reply, planBlurb(built));
    const sentences = reply.split(/[.!?]+/).filter((part) => part.trim());
    assert.ok(sentences.length <= 2, reply);
    assert.ok(reply.length < 180, reply);
    assert.doesNotMatch(reply, /\d{4}-\d{2}-\d{2}|food listing|## |08:10|Free time|Tempo livre/);
  }
});

test("a short acknowledgement is not rewritten into an itinerary", () => {
  const reply = publicPlanReply("Saturday it is. I rebuilt the days.", "en", plan("en"));
  assert.equal(reply, "Saturday it is. I rebuilt the days.");
});

test("formatItinerary reads as intro, days, then notes", () => {
  const text = formatItinerary(plan("en"));
  const notesAt = text.indexOf("## Notes");
  const dayAt = text.indexOf("## Day 1");
  assert.ok(dayAt > 0 && notesAt > dayAt);
  assert.match(text.split("\n")[0], /3-day plan/);
});

test("Portuguese and French replies use local labels and Portuguese place names", () => {
  const pt = formatItinerary(plan("pt"));
  assert.doesNotMatch(pt, /\bFree time\b|Breakfast at your stay|Head to the airport|Bitche Rotcha Beach|Morro Beach/);
  assert.match(pt, /Praia |Pequeno-almoço|Tempo livre/);
  const swapped = localizeGuestLabels("De manhã há Free time em Morro Beach.", "pt");
  assert.match(swapped, /Tempo livre/);
  assert.match(swapped, /Praia do Morro/);
  assert.doesNotMatch(swapped, /Free time|Morro Beach/);
  const fr = publicPlanReply("Ensuite, Free time.", "fr", null);
  assert.match(fr, /Temps libre/);
  assert.doesNotMatch(fr, /Free time/);
});

test("slow pace does not pack breakfast against the next stop or repeat a restaurant across days", () => {
  const built = plan("en");
  const seen = new Set<string>();
  for (const day of built.days) {
    const rows = [...day.items].filter((item) => item.start).sort((a, b) => toMin(a.start) - toMin(b.start));
    for (let i = 0; i < rows.length - 1; i += 1) {
      if (rows[i].slot === "breakfast") {
        const gap = toMin(rows[i + 1].start) - toMin(rows[i].start);
        assert.ok(gap >= 60, `${rows[i].start} then ${rows[i + 1].start}`);
        assert.notEqual(rows[i].start, "08:10");
      }
    }
    for (const item of day.items) {
      if (item.kind !== "food") continue;
      assert.ok(!seen.has(item.refId), `repeated ${item.refId}`);
      seen.add(item.refId);
    }
  }
});
