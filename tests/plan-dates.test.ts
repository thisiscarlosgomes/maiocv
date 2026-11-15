import { strict as assert } from "node:assert";
import { test } from "node:test";
import { signTask } from "../lib/awareness/sign.ts";
import { emptyTask, refreshTask, type Task } from "../lib/awareness/task.ts";
import { runPlanAgent } from "../lib/plan-agent.ts";
import { buildPlan } from "../lib/trip-planner.ts";
import type { TripPlan } from "../lib/trip.ts";
import { scriptedModel } from "./plan/mock-model.ts";
import { LIVE_BOATS, LIVE_FLIGHTS } from "./plan/live-window.ts";

const dev = { NODE_ENV: "development" };

function liveFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("marine-api") || url.includes("api.open-meteo.com")) {
      return Response.json({ daily: { time: [], wave_height_max: [], wind_speed_10m_max: [], temperature_2m_max: [] } });
    }
    if (url.includes("schedules/boats")) return Response.json(LIVE_BOATS);
    if (url.includes("schedules/flights")) return Response.json(LIVE_FLIGHTS);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function portion(task: Task): Task {
  return { ...task, lastToolFacts: [] };
}

test("default start is tomorrow in Atlantic/Cape_Verde for every locale", async () => {
  const now = new Date("2026-11-16T00:30:00Z");
  const prompts = {
    en: "3 days with a car",
    pt: "3 dias com carro",
    fr: "3 jours avec une voiture",
  } as const;
  const invented = { en: "2026-11-17", pt: "2026-11-16", fr: "2026-11-15" } as const;
  for (const locale of ["en", "pt", "fr"] as const) {
    const result = await runPlanAgent(
      [{ role: "user", content: prompts[locale] }],
      null,
      {
        model: scriptedModel([[{ tool: "propose_itinerary", input: {
          startDate: invented[locale],
          days: 3,
          locale,
          adults: 2,
          hasCar: true,
          boatTrips: 0,
          arrival: { mode: "ferry", dayIndex: 0, time: "09:00" },
          departure: { mode: "ferry", time: "09:00" },
        } }]], "Here is the plan."),
        fetchImpl: liveFetch(),
        now,
      },
      emptyTask(locale),
    );
    assert.equal(result.plan?.days[0].date, "2026-11-16", locale);
    assert.equal(result.plan?.days[2].date, "2026-11-18", locale);
    const depart = result.plan?.days[2].items.find((item) => item.slot === "departure");
    assert.equal(depart?.start, "10:00", locale);
    assert.match(depart?.note ?? "", /Short day|Dia curto|Journée courte/);
    assert.equal(result.plan?.days[2].items.some((item) => item.start === "09:00"), false, locale);
    assert.match(result.reply, /Short day|Dia curto|Journée courte/);
    const inbound = result.plan?.days[0].items.find((item) => item.kind === "transport");
    assert.equal(inbound, undefined, locale);
    assert.ok(result.plan?.days[0].items.some((item) => item.kind === "place"), locale);
  }
});

test("a guest date is kept, and day 1 uses the published arrival", async () => {
  const now = new Date("2026-11-15T15:00:00Z");
  const result = await runPlanAgent(
    [{ role: "user", content: "3 days from today, with a car" }],
    null,
    {
      model: scriptedModel([[{ tool: "propose_itinerary", input: {
        startDate: "2026-11-16",
        days: 3,
        locale: "en",
        adults: 2,
        hasCar: true,
        boatTrips: 0,
        arrival: { mode: "ferry", dayIndex: 0, time: "09:00" },
        departure: { mode: "ferry", time: "09:00" },
      } }]], "Arriving today."),
      fetchImpl: liveFetch(),
      now,
    },
    emptyTask("en"),
  );
  assert.equal(result.plan?.days[0].date, "2026-11-15");
  const inbound = result.plan?.days[0].items.find((item) => item.kind === "transport");
  assert.equal(inbound?.start, "17:00");
  for (const item of result.plan?.days[0].items ?? []) {
    if (item.kind === "transport" || !item.start) continue;
    assert.ok(item.start >= "17:00", item.start);
  }
  const depart = result.plan?.days[2].items.find((item) => item.slot === "departure");
  assert.equal(depart?.start, "12:45");
  assert.equal(result.plan?.days[2].items.some((item) => item.start === "09:00"), false);
});

test("an evening departure keeps a morning place and lunch", async () => {
  const task = refreshTask({
    ...emptyTask("pt"),
    objective: "3 dias com carro",
    constraints: { dates: { start: "2026-11-18", days: 3 }, party: { adults: 2 }, car: true },
  });
  const result = await runPlanAgent(
    [{ role: "user", content: "3 dias com carro" }],
    null,
    {
      model: scriptedModel([[{ tool: "propose_itinerary", input: {
        startDate: "2026-11-15",
        days: 3,
        locale: "pt",
        adults: 2,
        hasCar: true,
        boatTrips: 0,
        departure: { mode: "ferry", time: "09:00" },
      } }]], "Plano."),
      fetchImpl: liveFetch(),
      now: new Date("2026-11-15T15:00:00Z"),
    },
    task,
  );
  assert.equal(result.plan?.days[0].date, "2026-11-18");
  assert.equal(result.plan?.days[2].date, "2026-11-20");
  const last = result.plan!.days[2];
  const depart = last.items.find((item) => item.slot === "departure");
  assert.equal(depart?.start, "20:00");
  assert.doesNotMatch(depart?.note ?? "", /Dia curto/);
  assert.ok(last.items.some((item) => item.kind === "place" && item.slot === "morning"));
  assert.ok(last.items.some((item) => item.slot === "lunch"));
  assert.doesNotMatch(result.reply, /Dia curto|09:00/);
});

test("an unpublished departure is a relaxed last day and does not invent 09:00", async () => {
  const task = refreshTask({
    ...emptyTask("fr"),
    objective: "3 jours avec une voiture",
    constraints: { dates: { start: "2026-11-14", days: 3 }, party: { adults: 2 }, car: true },
  });
  const result = await runPlanAgent(
    [{ role: "user", content: "avec une voiture" }],
    null,
    {
      model: scriptedModel([[{ tool: "propose_itinerary", input: {
        startDate: "2026-11-15",
        days: 3,
        locale: "fr",
        adults: 2,
        hasCar: true,
        boatTrips: 0,
        departure: { mode: "ferry", time: "09:00" },
      } }]], "Voici le plan."),
      fetchImpl: liveFetch(),
      now: new Date("2026-11-15T15:00:00Z"),
    },
    task,
  );
  assert.equal(result.plan?.days[0].date, "2026-11-14");
  const last = result.plan!.days[2];
  assert.equal(last.date, "2026-11-16");
  const depart = last.items.find((item) => item.slot === "departure");
  assert.equal(depart?.start, undefined);
  assert.match(depart?.note ?? "", /pas encore publiée|non publiée/i);
  assert.ok(last.items.some((item) => item.kind === "place" && item.slot === "morning"));
  assert.ok(last.items.some((item) => item.slot === "lunch"));
  assert.equal(last.items.some((item) => item.start === "09:00"), false);
  assert.doesNotMatch(result.reply, /09:00|Journée courte/);
});

test("ferry and flight side questions leave the plan portion identical", async () => {
  const forecast = ["2026-11-16", "2026-11-17", "2026-11-18"].map((date) => ({ date, waveHeightM: 0.8, windKmh: 16, tempMaxC: 28, sunset: "18:10" }));
  for (const locale of ["en", "pt", "fr"] as const) {
    const plan: TripPlan = buildPlan({
      request: { startDate: "2026-11-16", days: 3, locale, adults: 2, hasCar: true, boatTrips: 0 },
      forecast,
      sailings: [],
    });
    const task = refreshTask({
      ...emptyTask(locale),
      objective: plan.title,
      constraints: { dates: { start: "2026-11-16", days: 3 }, party: plan.party, car: true },
      completed: ["itinerary"],
      lastToolFacts: [{ name: "get_sea_forecast", retrievedAt: "2026-11-15T12:00:00.000Z", value: "calm" }],
    });
    const ferry = locale === "pt" ? "Quando é o próximo barco para a Praia?" : locale === "fr" ? "Quand est le prochain ferry vers Praia ?" : "When is the next ferry to Praia?";
    const flight = locale === "pt" ? "Voos do Maio na quarta" : locale === "fr" ? "Vols depuis Maio mercredi" : "Flights from Maio on Wednesday";
    const ask = (content: string) => runPlanAgent(
      [{ role: "user", content }],
      plan,
      { model: scriptedModel([], "should not be used"), fetchImpl: liveFetch(), now: new Date("2026-11-15T15:00:00Z") },
      task,
    );
    const ferryResult = await ask(ferry);
    const flightResult = await ask(flight);
    assert.deepEqual(ferryResult.plan, plan, locale);
    assert.deepEqual(flightResult.plan, plan, locale);
    assert.deepEqual(portion(ferryResult.task), portion(task), locale);
    assert.deepEqual(portion(flightResult.task), portion(task), locale);
    assert.equal(signTask(portion(ferryResult.task), dev), signTask(portion(task), dev), locale);
    assert.equal(signTask(portion(flightResult.task), dev), signTask(portion(task), dev), locale);
    assert.equal(ferryResult.task.lastToolFacts.some((fact) => fact.name === "get_transport"), true, locale);
    assert.equal(flightResult.task.lastToolFacts.some((fact) => fact.name === "get_transport"), true, locale);
    assert.notEqual(signTask(ferryResult.task, dev), signTask(task, dev));
  }
});
