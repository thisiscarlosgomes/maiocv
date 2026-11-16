import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { emptyTask, refreshTask, type Task } from "../lib/awareness/task.ts";
import { runPlanAgent } from "../lib/plan-agent.ts";
import { answerTravelQuestion, attachPublishedTravel, loadTimetable } from "../lib/timetable.ts";
import { buildPlan } from "../lib/trip-planner.ts";
import { scriptedModel } from "./plan/mock-model.ts";

const TODAY = new Date("2026-11-15T12:00:00Z");
const SEA = /checking sea forecast|previsão do mar|prévision de la mer/i;
const FERRY = /checking ferry times|horários do barco|horaires du ferry/i;
const FLIGHT = /checking flight times|horários do voo|horaires du vol/i;

const boats = {
  retrievedAt: "2026-11-15T12:00:00.000Z",
  schedules: [
    { date: "2026-11-16", from: "Santiago", to: "Maio", departure: "08:00" },
    { date: "2026-11-16", from: "Maio", to: "Santiago", departure: "11:00" },
    { date: "2026-11-18", from: "Santiago", to: "Maio", departure: "07:00" },
    { date: "2026-11-18", from: "Maio", to: "Santiago", departure: "10:00" },
  ],
};
const flights = {
  retrievedAt: "2026-11-15T12:00:00.000Z",
  routes: {
    rai_mmo: [{ date: "2026-11-18", from: "RAI", to: "MMO", departure: "11:50", flight: "7B-170" }],
    mmo_rai: [
      { date: "2026-11-18", from: "MMO", to: "RAI", departure: "14:35", flight: "7B-171" },
      { date: "2026-11-19", from: "MMO", to: "RAI", departure: "16:55", flight: "7B-171" },
    ],
  },
  upcoming: { mmo_rai: [{ date: "2026-11-18", from: "MMO", to: "RAI", departure: "14:35", flight: "7B-171" }] },
};

function timetableFetch(opts: { fail?: boolean; boats?: unknown; flights?: unknown } = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    if (opts.fail) throw new Error("down");
    const url = String(input);
    if (url.includes("marine-api") || url.includes("api.open-meteo.com")) return Response.json({ daily: { time: [], wave_height_max: [], wind_speed_10m_max: [], temperature_2m_max: [] } });
    if (url.includes("/boats")) return Response.json(opts.boats ?? boats);
    if (url.includes("/flights")) return Response.json(opts.flights ?? flights);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function bomb(): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => { throw new Error("model should not be called"); },
  }) as unknown as LanguageModel;
}

function taskFor(locale: "en" | "pt" | "fr"): Task {
  return refreshTask({
    ...emptyTask(locale),
    objective: "3 days on Maio",
    constraints: { dates: { start: "2026-11-16", days: 3 }, party: { adults: 2 }, car: true },
    completed: ["itinerary"],
  });
}

test("published travel fills arrival and departure clocks and does not invent one", async () => {
  let boatCalls = 0;
  const fetchImpl = timetableFetch();
  const counted = (async (input: RequestInfo | URL) => {
    if (String(input).includes("/boats")) boatCalls += 1;
    return fetchImpl(input);
  }) as typeof fetch;
  const table = await loadTimetable(counted, TODAY);
  assert.equal(table.ok, true);
  assert.equal(table.sailings.length, 4);
  const again = await loadTimetable(counted, new Date(TODAY.getTime() + 1000));
  assert.equal(again.sailings.length, 4);
  assert.equal(boatCalls, 1, "a success stays cached");
  const request = attachPublishedTravel({ startDate: "2026-11-16", days: 3, locale: "en", adults: 2, hasCar: true }, table);
  const arrival = request.arrival as { time?: string; mode?: string };
  const departure = request.departure as { time?: string; mode?: string };
  assert.equal(arrival.time, "08:00");
  assert.equal(arrival.mode, "ferry");
  assert.equal(departure.time, "10:00");
  assert.equal(departure.mode, "ferry");
  const plan = buildPlan({ request: request as never, forecast: [], sailings: table.sailings });
  const inbound = plan.days[0].items.find((item) => item.kind === "transport");
  assert.equal(inbound?.start, "08:00");
  assert.match(inbound?.note ?? "", /Santiago/);
  const outbound = plan.days[2].items.find((item) => item.slot === "departure");
  assert.equal(outbound?.refId, "depart-port");
  assert.equal(outbound?.start, "10:00");
  assert.match(outbound?.note ?? "", /Short day/);
  assert.equal(plan.days[2].items.some((item) => item.start === "09:00"), false);
});

test("a down timetable does not invent a clock", async () => {
  const table = await loadTimetable(timetableFetch({ fail: true }), new Date("2026-11-15T18:00:00Z"));
  assert.equal(table.ok, false);
  const request = attachPublishedTravel({ startDate: "2026-11-16", days: 3, locale: "en", departure: { mode: "ferry" } }, table);
  assert.equal((request.departure as { time?: string }).time, undefined);
  const plan = buildPlan({ request: { startDate: "2026-11-16", days: 2, locale: "en", adults: 2, departure: { mode: "ferry" } }, forecast: [], sailings: [] });
  assert.equal(plan.days[1].items.some((item) => item.start === "16:00"), false);
});

for (const locale of ["en", "pt", "fr"] as const) {
  const ferry = locale === "pt" ? "Quando é o próximo barco para a Praia?" : locale === "fr" ? "Quand est le prochain ferry vers Praia ?" : "When is the next ferry to Praia?";
  const flight = locale === "pt" ? "Voos do Maio na quarta" : locale === "fr" ? "Vols depuis Maio mercredi" : "Flights from Maio on Wednesday";

  test(`${locale} ferry and flight questions stay on the timetable`, async () => {
    const task = taskFor(locale);
    const ferryResult = await runPlanAgent(
      [{ role: "user", content: ferry }],
      null,
      { model: bomb(), fetchImpl: timetableFetch(), now: TODAY },
      task,
    );
    assert.equal(ferryResult.intent, "side_question");
    assert.equal(ferryResult.plan, null);
    assert.equal(ferryResult.task.objective, task.objective);
    assert.equal(ferryResult.task.constraints.dates?.start, "2026-11-16");
    assert.match(ferryResult.reply, /11:00|10:00|08:00/);
    assert.match(ferryResult.reply, /Santiago|Maio/);
    assert.doesNotMatch(ferryResult.reply, /Tap the card|Toque no cartão|Touchez la carte/);
    assert.match(ferryResult.status, FERRY);
    assert.equal(ferryResult.steps.length, 1);
    assert.doesNotMatch(ferryResult.status, SEA);
    assert.equal(ferryResult.toolEvents.some((event) => event.name === "propose_itinerary"), false);

    const flightResult = await runPlanAgent(
      [{ role: "user", content: flight }],
      null,
      { model: bomb(), fetchImpl: timetableFetch(), now: TODAY },
      task,
    );
    assert.equal(flightResult.intent, "side_question");
    assert.equal(flightResult.task.constraints.dates?.days, 3);
    assert.match(flightResult.reply, /14:35/);
    assert.match(flightResult.status, FLIGHT);
    assert.equal(flightResult.steps.length, 1);
    assert.doesNotMatch(flightResult.status, SEA);
  });
}

test("a plan with dates uses the published ferry, and a failure does not invent one", async () => {
  const task = taskFor("en");
  const live = await runPlanAgent(
    [{ role: "user", content: "3 days from Monday, with a car" }],
    null,
    {
      model: scriptedModel([[{ tool: "propose_itinerary", input: { startDate: "2026-11-16", days: 3, locale: "en", adults: 2, hasCar: true, boatTrips: 0 } }]], "Here is the plan."),
      fetchImpl: timetableFetch(),
      now: TODAY,
    },
    task,
  );
  const inbound = live.plan?.days[0].items.find((item) => item.kind === "transport");
  assert.equal(inbound?.start, "08:00");
  assert.equal(live.plan?.days[2].items.find((item) => item.slot === "departure")?.start, "10:00");
  assert.match(live.reply, /Short day/);
  assert.equal(live.plan?.days[2].items.some((item) => item.start === "09:00"), false);
  assert.doesNotMatch(JSON.stringify(live.plan), /16:00/);

  const down = await runPlanAgent(
    [{ role: "user", content: "We arrive by ferry on Monday and stay 3 days, with a car." }],
    null,
    {
      model: scriptedModel([[{ tool: "propose_itinerary", input: { startDate: "2026-11-16", days: 3, locale: "en", adults: 2, hasCar: true, boatTrips: 0, arrival: { mode: "ferry", dayIndex: 0 } } }]], "No published time."),
      fetchImpl: timetableFetch({ fail: true }),
      now: new Date("2026-11-15T19:00:00Z"),
    },
    emptyTask("en"),
  );
  const missing = down.plan?.days[0].items.find((item) => item.kind === "transport");
  assert.equal(missing?.start, undefined);
  assert.match(missing?.note ?? "", /not published/i);
  assert.equal(down.plan?.days.some((day) => day.items.some((item) => item.start === "16:00" || item.start === "14:00")), false);
});

test("a stale Maio API snapshot still supplies published times and does not invent an arrival", async () => {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/boats")) return Response.json({
      stale: true,
      retrievedAt: "2026-11-02T14:32:44.512Z",
      schedules: [{ date: "2026-11-18", from: "Santiago", to: "Maio", departure: "07:00", arrival: null, operator: "CV Interilhas", line: "LS", vessel: null }],
    });
    if (url.includes("/flights")) return Response.json({
      stale: true,
      source: "CVSky",
      routes: { rai_mmo: [], mmo_rai: [] },
      upcoming: { rai_mmo: [{ date: "2026-11-18", from: "RAI", to: "MMO", departure: "11:50", arrival: "12:10", flight: "7B-170" }] },
    });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  const table = await loadTimetable(fetchImpl, new Date("2026-11-16T12:00:00Z"));
  assert.ok(urls.every((url) => url.startsWith("https://api.maio.cv/api/v1/")));
  assert.equal(urls.some((url) => url.includes("portal.maio.cv")), false);
  assert.equal(table.stale, true);
  assert.equal(table.sailings[0]?.departure, "07:00");
  assert.equal(table.sailings[0]?.arrival, undefined);
  assert.equal(table.flights[0]?.flight, "7B-170");
  const noted = answerTravelQuestion("next ferry to Maio", "en", table, "2026-11-16", { time: "12:00" });
  assert.match(noted, /07:00/);
  assert.match(noted, /48 hours/);
});

test("an empty day names the nearest published ferry", async () => {
  const table = await loadTimetable(timetableFetch(), new Date("2026-11-15T20:00:00Z"));
  const request = attachPublishedTravel({
    startDate: "2026-11-17",
    days: 2,
    locale: "en",
    adults: 2,
    arrival: { mode: "ferry", dayIndex: 0 },
  }, table);
  assert.equal((request.arrival as { time?: string }).time, undefined);
  const plan = buildPlan({ request: request as never, forecast: [], sailings: table.sailings });
  const { annotateMissingTravel } = await import("../lib/timetable.ts");
  const noted = annotateMissingTravel(plan, table);
  const row = noted.days[0].items.find((item) => item.kind === "transport");
  assert.equal(row?.start, undefined);
  assert.match(row?.note ?? "", /not published/i);
  assert.match(row?.note ?? "", /07:00|08:00/);
});
