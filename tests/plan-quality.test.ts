// Confirmed planner failures: next flight, short follow-ups, end dates, car wording, sunset, 4x4.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { classify, resolveCarStance } from "../lib/awareness/classify.ts";
import { emptyTask, refreshTask, type Task } from "../lib/awareness/task.ts";
import { lengthDiffReply } from "../lib/plan-edits.ts";
import { runPlanAgent } from "../lib/plan-agent.ts";
import { humanPlanDate } from "../lib/plan-reply.ts";
import { parseDateShift } from "../lib/plan-router.ts";
import { buildPlan } from "../lib/trip-planner.ts";
import { place, type TripPlan } from "../lib/trip.ts";

const TODAY = new Date("2026-11-15T12:00:00Z");
const EVENING = new Date("2026-11-15T22:25:00Z");
const today = "2026-11-15";
const forecastDates = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"];
const forecast = forecastDates.map((date) => ({ date, waveHeightM: 0.8, windKmh: 16, tempMaxC: 28, sunset: "18:10" }));

const boats = {
  retrievedAt: "2026-11-15T12:00:00.000Z",
  schedules: [
    { date: "2026-11-15", from: "Maio", to: "Santiago", departure: "08:00" },
    { date: "2026-11-16", from: "Maio", to: "Santiago", departure: "11:00" },
    { date: "2026-11-18", from: "Maio", to: "Santiago", departure: "10:00" },
    { date: "2026-11-22", from: "Maio", to: "Santiago", departure: "09:40" },
  ],
};
const flights = {
  retrievedAt: "2026-11-15T12:00:00.000Z",
  routes: {
    mmo_rai: [
      { date: "2026-11-15", from: "MMO", to: "RAI", departure: "16:55", flight: "7B-171" },
      { date: "2026-11-15", from: "MMO", to: "RAI", departure: "12:45", flight: "7B-171" },
      { date: "2026-11-15", from: "MMO", to: "RAI", departure: "15:30", flight: "7B-171" },
      { date: "2026-11-16", from: "MMO", to: "RAI", departure: "14:20", flight: "7B-171" },
      { date: "2026-11-16", from: "MMO", to: "RAI", departure: "09:10", flight: "7B-171" },
      { date: "2026-11-20", from: "MMO", to: "RAI", departure: "16:55", flight: "7B-171" },
      { date: "2026-11-22", from: "MMO", to: "RAI", departure: "11:15", flight: "7B-171" },
    ],
  },
};

function bomb(): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => { throw new Error("model should not be called"); },
  }) as unknown as LanguageModel;
}

function worldFetch(sunset = "2026-11-18T19:42:00.000Z"): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("astronomy/sky")) return Response.json({ solarEvents: { sunset } });
    if (url.includes("schedules/boats")) return Response.json(boats);
    if (url.includes("schedules/flights")) return Response.json(flights);
    if (url.includes("marine-api")) return Response.json({ daily: { time: forecastDates, wave_height_max: forecastDates.map(() => 0.8) } });
    if (url.includes("api.open-meteo.com")) {
      return Response.json({ daily: { time: forecastDates, wind_speed_10m_max: forecastDates.map(() => 16), temperature_2m_max: forecastDates.map(() => 28), sunset: forecastDates.map((date) => `${date}T18:10`) } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function planned(locale: "en" | "pt" | "fr" = "en", start = "2026-11-16", days = 3): { plan: TripPlan; task: Task } {
  const plan = buildPlan({
    request: { startDate: start, days, locale, adults: 2, kids: 0, hasCar: true, boatTrips: 0, pace: "slow" },
    forecast,
    sailings: [],
  });
  const task = refreshTask({
    ...emptyTask(locale),
    objective: plan.title,
    constraints: { dates: { start, days }, party: { adults: 2, kids: 0 }, car: true, pace: "slow" },
    completed: ["itinerary"],
  });
  return { plan, task };
}

function beachId(plan: TripPlan, day: number): string | undefined {
  return plan.days[day]?.items.find((item) => item.kind === "place" && place(item.refId)?.category === "beach")?.refId;
}

test("next flight skips times that already left and stays sorted", async () => {
  const { plan, task } = planned("en", "2026-11-18", 3);
  const started = Date.now();
  const result = await runPlanAgent(
    [{ role: "user", content: "whens the next flight" }],
    plan,
    { model: bomb(), fetchImpl: worldFetch(), now: EVENING },
    task,
  );
  assert.ok(Date.now() - started < 4_000, result.reply);
  assert.equal(result.intent, "side_question");
  assert.deepEqual(result.plan?.days.map((day) => day.date), plan.days.map((day) => day.date));
  assert.match(result.reply, /09:10/);
  assert.match(result.reply, /14:20/);
  assert.ok(result.reply.indexOf("09:10") < result.reply.indexOf("14:20"), result.reply);
  assert.doesNotMatch(result.reply, /12:45|15:30/);
  assert.match(result.reply, /16:55/);
  assert.match(result.reply, /last day/i);
  assert.doesNotMatch(result.reply, /Tap the card|Toque no cartão|Touchez la carte|can't reach the model|n'atteins pas/);
});

test("next ferry rolls past a departure that already left", async () => {
  const { plan, task } = planned("en");
  const result = await runPlanAgent(
    [{ role: "user", content: "whens the next ferry" }],
    plan,
    { model: bomb(), fetchImpl: worldFetch(), now: EVENING },
    task,
  );
  assert.match(result.reply, /11:00/);
  assert.doesNotMatch(result.reply, /08:00/);
  assert.deepEqual(result.plan?.days.map((day) => day.date), ["2026-11-16", "2026-11-17", "2026-11-18"]);
});

test("leaving on the 22nd extends the end and keeps the start", async () => {
  const phrases = [
    ["en", "actually am leaving on the 22nd"],
    ["pt", "saio no dia 22"],
    ["fr", "je pars le 22"],
  ] as const;
  for (const [locale, phrase] of phrases) {
    const shift = parseDateShift(phrase, today, "2026-11-16");
    assert.equal(typeof shift === "object" && shift?.end, "2026-11-22", phrase);
    assert.equal(typeof shift === "object" && shift?.start, undefined, phrase);
    const { plan, task } = planned(locale);
    const started = Date.now();
    const result = await runPlanAgent(
      [{ role: "user", content: phrase }],
      plan,
      { model: bomb(), fetchImpl: worldFetch(), now: TODAY },
      task,
    );
    assert.ok(Date.now() - started < 4_000, result.reply);
    assert.equal(result.plan?.days[0]?.date, "2026-11-16", result.reply);
    assert.equal(result.plan?.days.at(-1)?.date, "2026-11-22", result.reply);
    assert.equal(result.plan?.days.length, 7, result.reply);
    assert.equal(result.plan?.days.at(-1)?.items.find((item) => item.slot === "departure")?.start, "09:40", result.reply);
    assert.match(result.reply, /22/);
    assert.equal(result.task.locale, locale, result.reply);
    assert.doesNotMatch(result.reply, /Which day should the trip start|Para que dia mudo|Quel jour pour le début/);
    if (locale === "en") assert.doesNotMatch(result.reply, /Para que|viaje|vôo|voo/);
  }
});

test("a start-only move still keeps the length", () => {
  assert.deepEqual(parseDateShift("we're arriving on the 18th", today, "2026-11-16"), { start: "2026-11-18" });
  assert.deepEqual(parseDateShift("actually the 18th", today, "2026-11-16"), { start: "2026-11-18" });
});

test("an end before the start or past 7 days asks and does not change the plan", async () => {
  const { plan, task } = planned("en");
  for (const phrase of ["actually am leaving on the 10th", "actually am leaving on the 30th"]) {
    const result = await runPlanAgent(
      [{ role: "user", content: phrase }],
      plan,
      { model: bomb(), fetchImpl: worldFetch(), now: TODAY },
      task,
    );
    assert.equal(result.plan, plan, result.reply);
    assert.match(result.reply, /leaving/i);
    assert.doesNotMatch(result.reply, /runs \d+ days|Moved your/);
  }
});

test("a bare day after the start question moves the start", async () => {
  const { plan, task } = planned("en");
  task.pendingQuestion = "Which day should the trip start?";
  const result = await runPlanAgent(
    [{ role: "user", content: "22" }],
    plan,
    { model: bomb(), fetchImpl: worldFetch(), now: TODAY },
    task,
  );
  assert.equal(result.plan?.days[0]?.date, "2026-11-22", result.reply);
  assert.equal(result.plan?.days.length, 3, result.reply);
  assert.doesNotMatch(result.reply, /can't reach the model/);
});

test("replace alone, and yes after want-changes, ask what to change", async () => {
  const { plan, task } = planned("en");
  const replace = await runPlanAgent(
    [{ role: "user", content: "replace" }],
    plan,
    { model: bomb(), fetchImpl: worldFetch(), now: TODAY },
    task,
  );
  assert.equal(replace.plan, plan);
  assert.match(replace.reply, /What should I replace/);
  assert.doesNotMatch(replace.reply, /can't reach the model/);

  const fr = planned("fr");
  fr.task.pendingQuestion = "Vous voulez changer quelque chose ?";
  const yes = await runPlanAgent(
    [{ role: "user", content: "oui" }],
    fr.plan,
    { model: bomb(), fetchImpl: worldFetch(), now: TODAY },
    fr.task,
  );
  assert.equal(yes.plan, fr.plan);
  assert.match(yes.reply, /changer/i);
  assert.equal(yes.task.locale, "fr");
  assert.doesNotMatch(yes.reply, /n'atteins pas le modèle/);
});

test("a plan edit with no trip asks, instead of the model-unavailable line", async () => {
  for (const [locale, phrase] of [
    ["fr", "laisse le dernier après-midi libre"],
    ["fr", "remplis un peu plus le deuxième jour"],
  ] as const) {
    const result = await runPlanAgent(
      [{ role: "user", content: phrase }],
      null,
      { model: bomb(), fetchImpl: worldFetch(), now: TODAY },
      emptyTask(locale),
    );
    assert.equal(result.plan, null);
    assert.match(result.reply, /voyage|jours|voiture/i);
    assert.doesNotMatch(result.reply, /n'atteins pas le modèle/);
  }
});

test("replace the beach on day 1 swaps that beach", async () => {
  const phrases = [
    ["en", "replace the beach on day 1"],
    ["pt", "troca a praia do dia 1"],
    ["fr", "remplace la plage du jour 1"],
  ] as const;
  for (const [locale, phrase] of phrases) {
    const { plan, task } = planned(locale);
    const before = beachId(plan, 0);
    assert.ok(before, "day 1 should start with a beach");
    const started = Date.now();
    const result = await runPlanAgent(
      [{ role: "user", content: phrase }],
      plan,
      { model: bomb(), fetchImpl: worldFetch(), now: TODAY },
      task,
    );
    assert.ok(Date.now() - started < 1_000, result.reply);
    const after = beachId(result.plan!, 0);
    assert.ok(after && after !== before, result.reply);
    assert.equal(beachId(result.plan!, 1), beachId(plan, 1));
    assert.match(result.reply, locale === "fr" ? /Jour 1/ : locale === "pt" ? /Dia 1/ : /Day 1/);
    assert.doesNotMatch(result.reply, /Tap the card|Toque no cartão|Touchez la carte|Slow 3 days|Calmo, 3/);
    assert.equal(result.reply.includes("\n"), false);
  }
});

test("the first message can already say there is no car, or that there is one", async () => {
  const none = await runPlanAgent(
    [{ role: "user", content: "I'd like a 3-day trip starting tomorrow, no rental car, first visit." }],
    null,
    { model: bomb(), fetchImpl: worldFetch(), now: TODAY },
  );
  assert.equal(none.plan?.hasCar, false, none.reply);
  assert.equal(none.plan?.days[0]?.date, "2026-11-16");
  assert.equal(none.plan?.days.length, 3);
  assert.doesNotMatch(none.reply, /Will you have a car/);

  for (const phrase of ["without a rental car", "won't rent a car"]) {
    assert.equal(resolveCarStance(`3 days tomorrow, ${phrase}`, null), "no", phrase);
  }
  assert.equal(resolveCarStance("3 dias, sem carro alugado", null), "no");
  assert.equal(resolveCarStance("3 dias, com carro", null), "yes");
  assert.equal(resolveCarStance("3 jours, avec voiture", null), "yes");
  assert.equal(resolveCarStance("3 jours, en voiture", null), "yes");
  assert.equal(resolveCarStance("3 jours, sans voiture", null), "no");

  const french = await runPlanAgent(
    [{ role: "user", content: "3 jours du 18 au 20 novembre, rythme lent, avec voiture, 2 adultes" }],
    null,
    { model: bomb(), fetchImpl: worldFetch(), now: TODAY },
    emptyTask("fr"),
  );
  assert.equal(french.plan?.hasCar, true, french.reply);
  assert.equal(french.plan?.days[0]?.date, "2026-11-18", french.reply);
  assert.equal(french.plan?.days.length, 3);
  assert.equal(french.task.locale, "fr");
  assert.doesNotMatch(french.reply, /Aurez-vous une voiture/);
  assert.equal(classify("3 jours du 18 au 20 novembre, rythme lent, avec voiture, 2 adultes", emptyTask("fr"), { today }).patch.car, true);
});

test("sunset answers with the calculated Cape Verde time", async () => {
  const { plan, task } = planned("en", "2026-11-18", 3);
  const withPlan = await runPlanAgent(
    [{ role: "user", content: "What time is sunset?" }],
    plan,
    { model: bomb(), fetchImpl: worldFetch(), now: TODAY },
    task,
  );
  assert.match(withPlan.reply, /18:42/);
  assert.match(withPlan.reply, /calculated/i);
  assert.match(withPlan.reply, /18/);
  assert.match(withPlan.reply, /20/);
  assert.doesNotMatch(withPlan.reply, /look up|west coast/);
  assert.deepEqual(withPlan.plan?.days.map((day) => day.date), plan.days.map((day) => day.date));

  const todayOnly = await runPlanAgent(
    [{ role: "user", content: "What time is sunset?" }],
    null,
    { model: bomb(), fetchImpl: worldFetch("2026-11-15T19:41:00.000Z"), now: TODAY },
  );
  assert.match(todayOnly.reply, /18:41/);
  assert.match(todayOnly.reply, /calculated/i);

  const pt = await runPlanAgent(
    [{ role: "user", content: "A que horas é o pôr do sol?" }],
    null,
    { model: bomb(), fetchImpl: worldFetch("2026-11-15T19:41:00.000Z"), now: TODAY },
    emptyTask("pt"),
  );
  assert.match(pt.reply, /18:41/);
  assert.match(pt.reply, /calculado/i);
  const fr = await runPlanAgent(
    [{ role: "user", content: "À quelle heure est le coucher du soleil ?" }],
    null,
    { model: bomb(), fetchImpl: worldFetch("2026-11-15T19:41:00.000Z"), now: TODAY },
    emptyTask("fr"),
  );
  assert.match(fr.reply, /18:41/);
  assert.match(fr.reply, /calculé/i);
});

test("restating the same party keeps the edited plan", async () => {
  const phrases = [
    ["en", "we're just a couple, no kids", /already for two adults/i],
    ["pt", "somos um casal, sem crianças", /já é para dois adultos/i],
    ["fr", "nous sommes un couple, sans enfants", /déjà pour deux adultes/i],
  ] as const;
  for (const [locale, phrase, pattern] of phrases) {
    const { plan, task } = planned(locale, "2026-11-18", 3);
    const relaxed = await runPlanAgent(
      [{ role: "user", content: locale === "pt" ? "deixa o dia 2 mais calmo" : locale === "fr" ? "rends le jour 2 plus calme" : "Make day 2 more relaxed" }],
      plan,
      { model: bomb(), fetchImpl: worldFetch(), now: TODAY },
      task,
    );
    const day2 = JSON.stringify(relaxed.plan?.days[1].items);
    assert.notEqual(day2, JSON.stringify(plan.days[1].items));
    const again = await runPlanAgent(
      [{ role: "user", content: phrase }],
      relaxed.plan,
      { model: bomb(), fetchImpl: worldFetch(), now: TODAY },
      relaxed.task,
    );
    assert.equal(again.plan, relaxed.plan, again.reply);
    assert.match(again.reply, pattern);
    assert.equal(JSON.stringify(again.plan?.days[1].items), day2);
  }
});

test("plan around the ferry just named keeps that date", async () => {
  const boatsOnly = {
    retrievedAt: "2026-11-15T21:00:00.000Z",
    schedules: [
      { date: "2026-11-15", from: "Santiago", to: "Maio", departure: "08:00" },
      { date: "2026-11-18", from: "Santiago", to: "Maio", departure: "07:00" },
    ],
  };
  const fetchImpl: typeof fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("schedules/boats")) return Response.json(boatsOnly);
    if (url.includes("schedules/flights")) return Response.json({ routes: {} });
    return worldFetch()(input);
  }) as typeof fetch;
  const listed = await runPlanAgent(
    [{ role: "user", content: "next ferry" }],
    null,
    { model: bomb(), fetchImpl, now: EVENING },
  );
  assert.match(listed.reply, /18/);
  assert.match(listed.reply, /07:00/);
  assert.doesNotMatch(listed.reply, /08:00/);
  const held = await runPlanAgent(
    [{ role: "user", content: "plan around that ferry" }],
    null,
    { model: bomb(), fetchImpl, now: EVENING },
    listed.task,
  );
  assert.equal(held.plan, null);
  assert.equal(held.task.constraints.dates?.start, "2026-11-18");
  const built = await runPlanAgent(
    [{ role: "user", content: "yes, renting a car" }],
    null,
    { model: bomb(), fetchImpl, now: EVENING },
    held.task,
  );
  assert.equal(built.plan?.days[0]?.date, "2026-11-18", built.reply);
  assert.notEqual(built.plan?.days[0]?.date, "2026-11-15");
  for (const phrase of ["a partir dessa data", "à partir de cette date", "from that date"]) {
    const pointed = await runPlanAgent(
      [{ role: "user", content: phrase }],
      null,
      { model: bomb(), fetchImpl, now: EVENING },
      listed.task,
    );
    assert.equal(pointed.task.constraints.dates?.start, "2026-11-18", phrase);
  }
});

test("a bare date after the leaving question is the end date", async () => {
  const { plan, task } = planned("en", "2026-11-16", 3);
  const asked = await runPlanAgent(
    [{ role: "user", content: "actually am leaving on the 10th" }],
    plan,
    { model: bomb(), fetchImpl: worldFetch(), now: TODAY },
    task,
  );
  assert.match(asked.reply, /leaving/i);
  assert.equal(asked.plan, plan);
  const moved = await runPlanAgent(
    [{ role: "user", content: "the 20th" }],
    plan,
    { model: bomb(), fetchImpl: worldFetch(), now: TODAY },
    asked.task,
  );
  assert.equal(moved.plan?.days[0]?.date, "2026-11-16", moved.reply);
  assert.equal(moved.plan?.days.at(-1)?.date, "2026-11-20", moved.reply);
  assert.equal(moved.plan?.days.length, 5);
  assert.doesNotMatch(moved.reply, /Which day should the trip start/);
});

test("a named day is answered before the next sailing", async () => {
  const boatsOnly = {
    retrievedAt: "2026-11-15T12:00:00.000Z",
    schedules: [
      { date: "2026-11-15", from: "Santiago", to: "Maio", departure: "08:00" },
      { date: "2026-11-18", from: "Santiago", to: "Maio", departure: "07:00" },
    ],
  };
  const flightsOnly = {
    routes: { mmo_rai: [{ date: "2026-11-18", from: "MMO", to: "RAI", departure: "14:35", flight: "7B-171" }] },
  };
  const fetchImpl: typeof fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("schedules/boats")) return Response.json(boatsOnly);
    if (url.includes("schedules/flights")) return Response.json(flightsOnly);
    return worldFetch()(input);
  }) as typeof fetch;
  const asks = [
    ["en", "any ferry tmrw", /16/, /18/, /07:00/],
    ["pt", "algum barco amanhã", /16/, /18/, /07:00/],
    ["fr", "un ferry demain", /16/, /18/, /07:00/],
    ["en", "any flight tomorrow", /16/, /18/, /14:35/],
  ] as const;
  for (const [locale, phrase, askedDay, nextDay, clock] of asks) {
    const result = await runPlanAgent(
      [{ role: "user", content: phrase }],
      null,
      { model: bomb(), fetchImpl, now: TODAY },
      emptyTask(locale),
    );
    assert.match(result.reply, askedDay, result.reply);
    assert.match(result.reply, nextDay, result.reply);
    assert.match(result.reply, clock, result.reply);
    assert.match(result.reply, /no |não há|aucun/i, result.reply);
  }
});

test("a French date at the end of a sentence does not gain a second period", () => {
  assert.equal(humanPlanDate("2026-11-22", "fr").endsWith("."), false);
  const before = buildPlan({
    request: { startDate: "2026-11-18", days: 3, locale: "fr", adults: 2, hasCar: true, pace: "slow" },
    forecast, sailings: [],
  });
  const after = buildPlan({
    request: { startDate: "2026-11-18", days: 5, locale: "fr", adults: 2, hasCar: true, pace: "slow" },
    forecast, sailings: [],
  });
  const reply = lengthDiffReply(before, after, "fr");
  assert.ok(reply);
  assert.doesNotMatch(reply!, /\.\./);
  assert.match(reply!, /nov\.$/);
});

test("a 4x4 question does not add a car-rental sentence unless they ask where", async () => {
  const { plan, task } = planned("en");
  const result = await runPlanAgent(
    [{ role: "user", content: "Do I need a 4x4?" }],
    plan,
    { model: bomb(), fetchImpl: worldFetch(), now: TODAY },
    task,
  );
  assert.match(result.reply, /won't say a 4x4 is required/);
  assert.match(result.reply, /Praia Real/);
  assert.doesNotMatch(result.reply, /won't invent a company|no car-rental name|business list has no/);
  assert.equal(result.plan, plan);
});
