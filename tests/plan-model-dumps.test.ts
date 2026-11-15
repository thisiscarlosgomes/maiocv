import { strict as assert } from "node:assert";
import { test } from "node:test";
import { runPlanAgent } from "../lib/plan-agent.ts";
import { cardView } from "../lib/trip-view.ts";
import { planStrings } from "../lib/trip-strings.ts";
import { place } from "../lib/trip.ts";
import { toMin } from "../lib/full-day.ts";
import { anchoredCount } from "../lib/full-day.ts";
import { FOOD, PLACES, distanceKm } from "../lib/trip.ts";
import { venueType } from "../lib/plan-rules.ts";
import { scriptedModel } from "./plan/mock-model.ts";
import { LONG_EN_CAR, LONG_FR_NO_CAR, LONG_PT_CORRECTION } from "./plan/model-dumps.ts";

const TODAY = new Date("2026-11-15T12:00:00Z");
const town = place("cidade-porto-ingles")!;

function quietFetch(): typeof fetch {
  return (async () => new Response("not found", { status: 404 })) as typeof fetch;
}

function lines(text: string) {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

function noPrematureRepeat(hasCar: boolean) {
  const reach = (point: { lat: number; lon: number }) => hasCar || distanceKm(point, town) <= 3;
  const beaches = PLACES.filter((item) => item.category === "beach" && reach(item));
  const restaurants = FOOD.filter((item) => venueType(item) === "restaurant" && reach(place(item.placeId)!));
  return { beaches, restaurants };
}

test("a long gpt-5-mini itinerary becomes at most two lines from the plan", async () => {
  const fr = await runPlanAgent(
    [{ role: "user", content: "3 jours, sans voiture" }],
    null,
    {
      model: scriptedModel([[{ tool: "propose_itinerary", input: { startDate: "2026-11-16", days: 3, locale: "fr", adults: 2, hasCar: false, boatTrips: 0 } }]], LONG_FR_NO_CAR),
      fetchImpl: quietFetch(),
      now: TODAY,
    },
  );
  assert.ok(lines(fr.reply).length <= 2, fr.reply);
  assert.match(fr.reply, /sans voiture/);
  assert.doesNotMatch(fr.reply, /Bitche Rotcha Beach|Cadjetinha Beach|08:10|quad/i);
  assert.equal(fr.plan!.hasCar, false);
  assert.equal(fr.plan!.pace, "slow");
  assert.equal(fr.plan!.days.some((day) => day.items.some((item) => /quad|jetski|jet-ski/.test(item.refId))), false);
  for (const day of fr.plan!.days) {
    assert.ok(anchoredCount(day.items) <= 4, day.date);
    const breakfast = day.items.find((item) => item.slot === "breakfast");
    if (breakfast?.start) assert.ok(toMin(breakfast.start) >= toMin("08:30"), breakfast.start);
    for (const item of day.items) {
      if (item.kind !== "place") continue;
      const record = place(item.refId);
      if (!record || record.name.pt === record.name.en) continue;
      const card = cardView(item, "fr", planStrings.fr);
      assert.equal(card?.title, record.name.pt);
      assert.notEqual(card?.title, record.name.en);
    }
  }

  const en = await runPlanAgent(
    [
      { role: "user", content: "3 days, with a car" },
      { role: "assistant", content: "Will you have a car?" },
      { role: "user", content: "yes, renting a car" },
    ],
    null,
    {
      model: scriptedModel([[{ tool: "propose_itinerary", input: { startDate: "2026-11-16", days: 3, locale: "en", adults: 2, hasCar: true, boatTrips: 0, pace: "slow" } }]], LONG_EN_CAR),
      fetchImpl: quietFetch(),
      now: TODAY,
    },
  );
  assert.ok(lines(en.reply).length <= 2, en.reply);
  assert.match(en.reply, /Slow 3 days with a car/);
  assert.doesNotMatch(en.reply, /Monday|08:30|Sete Sois/);

  const pt = await runPlanAgent(
    [
      { role: "user", content: "3 dias de carro" },
      { role: "assistant", content: "Vão de carro?" },
      { role: "user", content: "na verdade sem carro" },
    ],
    en.plan,
    {
      model: scriptedModel([[{ tool: "propose_itinerary", input: { startDate: "2026-11-16", days: 3, locale: "pt", adults: 2, hasCar: true, boatTrips: 0 } }]], LONG_PT_CORRECTION),
      fetchImpl: quietFetch(),
      now: TODAY,
    },
    en.task,
  );
  assert.ok(lines(pt.reply).length <= 2, pt.reply);
  assert.match(pt.reply, /sem carro/);
  assert.doesNotMatch(pt.reply, /quad|08:10|blue-rental/);
  assert.equal(pt.plan!.hasCar, false);
});

test("beaches and restaurants repeat only after the in-range pool is used", async () => {
  for (const hasCar of [false, true]) {
    const built = await runPlanAgent(
      [{ role: "user", content: hasCar ? "3 jours avec une voiture" : "3 jours, sans voiture" }],
      null,
      {
        model: scriptedModel([[{ tool: "propose_itinerary", input: { startDate: "2026-11-16", days: 3, locale: "fr", adults: 2, hasCar, boatTrips: 0 } }]], LONG_FR_NO_CAR),
        fetchImpl: quietFetch(),
        now: TODAY,
      },
    );
    const { beaches, restaurants } = noPrematureRepeat(hasCar);
    const usedBeach = new Set<string>();
    const usedMeal = new Set<string>();
    for (const day of built.plan!.days) {
      const today = new Set<string>();
      for (const item of day.items) {
        if (item.kind === "place" && place(item.refId)?.category === "beach") {
          if (usedBeach.has(item.refId)) {
            assert.equal(beaches.some((beach) => !usedBeach.has(beach.id) && !today.has(beach.id)), false, item.refId);
          }
          usedBeach.add(item.refId);
          today.add(item.refId);
        }
        if (item.kind === "food" && venueType(FOOD.find((food) => food.id === item.refId)!) === "restaurant") {
          if (usedMeal.has(item.refId)) {
            assert.equal(restaurants.some((spot) => !usedMeal.has(spot.id) && !today.has(spot.id)), false, item.refId);
          }
          usedMeal.add(item.refId);
          today.add(item.refId);
        }
      }
    }
  }
});
