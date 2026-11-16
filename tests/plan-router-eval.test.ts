// Visitor turns the planner must route: info, dates that survive a car question,
// referential follow-ups, and length edits whose reply matches the plan diff.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { classify } from "../lib/awareness/classify.ts";
import { emptyTask, refreshTask, type Task } from "../lib/awareness/task.ts";
import { runPlanAgent } from "../lib/plan-agent.ts";
import { decodeTransportFact, spokenDates } from "../lib/plan-router.ts";
import { buildPlan } from "../lib/trip-planner.ts";
import type { TripPlan } from "../lib/trip.ts";
import { scriptedModel } from "./plan/mock-model.ts";
import { LIVE_BOATS, LIVE_FLIGHTS } from "./plan/live-window.ts";

const TODAY = new Date("2026-11-15T12:00:00Z");
const today = "2026-11-15";
const forecast = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"].map((date) => ({ date, waveHeightM: 0.8, windKmh: 16, tempMaxC: 28, sunset: "18:10" }));

function bomb(): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => { throw new Error("model should not be called"); },
  }) as unknown as LanguageModel;
}

function quietFetch(): typeof fetch {
  return (async () => new Response("not found", { status: 404 })) as typeof fetch;
}

function liveFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("schedules/boats")) return Response.json(LIVE_BOATS);
    if (url.includes("schedules/flights")) return Response.json(LIVE_FLIGHTS);
    if (url.includes("marine-api") || url.includes("api.open-meteo.com")) {
      return Response.json({ daily: { time: [], wave_height_max: [], wind_speed_10m_max: [], temperature_2m_max: [] } });
    }
    if (url.includes("businesses")) return Response.json({ features: [] });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function planned(locale: "en" | "pt" | "fr", start = "2026-11-18", days = 2): { plan: TripPlan; task: Task } {
  const plan = buildPlan({
    request: { startDate: start, days, locale, adults: 2, hasCar: true, boatTrips: 0, pace: "slow" },
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

const BLURB = /Tap the card|Toque no cartão|Touchez la carte|Slow \d+ days|Calmo,|Tranquille,/;

test("wed 18 and 18-20 Nov parse to November 2026, not tomorrow", () => {
  assert.equal(spokenDates("ok make me a plan from wed 18 2 days", today).start, "2026-11-18");
  assert.equal(spokenDates("a partir de quarta 18", today).start, "2026-11-18");
  assert.equal(spokenDates("à partir du mercredi 18", today).start, "2026-11-18");
  const span = spokenDates("18-20 Nov", today);
  assert.equal(span.start, "2026-11-18");
  assert.equal(span.end, "2026-11-20");
  assert.equal(span.days, 3);
  const arriving = spokenDates("Arriving 18 November, departing 20 November", today);
  assert.equal(arriving.start, "2026-11-18");
  assert.equal(arriving.days, 3);
});

const INFO: { locale: "en" | "pt" | "fr"; q: string; match: RegExp }[] = [
  { locale: "en", q: "whens the next flight", match: /flight|vol|voo|timetable|horaire|horário/i },
  { locale: "en", q: "any ferry tmrw", match: /ferry|barco|bateau|timetable|horaire|horário|published|publicad/i },
  { locale: "pt", q: "qual é o próximo voo", match: /voo|horário|publicado/i },
  { locale: "pt", q: "algum barco amanhã", match: /barco|horário|publicado/i },
  { locale: "fr", q: "prochain vol", match: /vol|horaire|publié/i },
  { locale: "fr", q: "un ferry demain", match: /ferry|horaire|publié/i },
  { locale: "en", q: "Where can I rent a car?", match: /guesthouse|won't invent|business list/i },
  { locale: "pt", q: "onde alugar carro", match: /pousada|não invento|lista de negócios/i },
  { locale: "fr", q: "où louer une voiture ?", match: /hébergement|n'invente|liste des commerces/i },
  { locale: "en", q: "car rental?", match: /guesthouse|won't invent/i },
  { locale: "en", q: "how much is a rental?", match: /guesthouse|won't invent|price|número|numéro/i },
  { locale: "pt", q: "quanto custa um aluguer?", match: /pousada|não invento/i },
  { locale: "fr", q: "combien coûte une location ?", match: /hébergement|n'invente/i },
  { locale: "en", q: "where eat tonight", match: /eat|Visit Maio|list/i },
  { locale: "pt", q: "onde comer hoje", match: /comer|Visit Maio|lista/i },
  { locale: "fr", q: "où manger ce soir", match: /manger|Visit Maio|liste/i },
  { locale: "en", q: "best beaches?", match: /beach/i },
  { locale: "pt", q: "melhores praias", match: /praia/i },
  { locale: "fr", q: "meilleures plages", match: /plage/i },
  { locale: "en", q: "what's the hospital number", match: /255 11 30/ },
  { locale: "pt", q: "qual é o número do hospital", match: /255 11 30/ },
  { locale: "fr", q: "quel est le numéro de l'hôpital", match: /255 11 30/ },
  { locale: "en", q: "how do we get around without a car", match: /aluguer|walk|Porto Inglês/i },
  { locale: "pt", q: "como me deslocar sem carro", match: /aluguer|pé|Porto Inglês/i },
  { locale: "fr", q: "comment se déplacer sans voiture", match: /aluguer|pied|Porto Inglês/i },
];

for (const item of INFO) {
  test(`${item.locale} info: ${item.q}`, async () => {
    const { plan, task } = planned(item.locale);
    const result = await runPlanAgent(
      [{ role: "user", content: item.q }],
      plan,
      { model: bomb(), fetchImpl: item.q.includes("flight") || item.q.includes("ferry") || item.q.includes("voo") || item.q.includes("barco") || item.q.includes("vol") || item.q.includes("bateau") ? liveFetch() : quietFetch(), now: TODAY },
      task,
    );
    assert.equal(result.plan, plan, result.reply);
    assert.equal(result.task.constraints.dates?.start, task.constraints.dates?.start);
    assert.equal(result.task.constraints.car, true);
    assert.match(result.reply, item.match, result.reply);
    assert.doesNotMatch(result.reply, BLURB, result.reply);
    assert.ok(result.reply.split(/[.!?]/).filter((part) => part.trim()).length <= 4, result.reply);
    assert.ok(result.chips.length <= 3);
  });
}

test("a rental question does not flip hasCar, and a car statement still does", () => {
  const task = planned("en").task;
  const question = classify("Where can I rent a car?", task, { today });
  assert.equal(question.intent, "side_question");
  assert.equal(question.carStance, null);
  assert.equal(question.planShaping, false);
  for (const phrase of ["we have a car", "we'll rent a car", "no car", "sem carro", "sans voiture"]) {
    const result = classify(phrase, { ...task, constraints: { ...task.constraints, car: false } }, { today });
    assert.notEqual(result.carStance, null, phrase);
    assert.equal(result.planShaping, true, phrase);
  }
});

test("whens the next flight then plan from wed 18 survives the car question", async () => {
  const flight = await runPlanAgent(
    [{ role: "user", content: "whens the next flight" }],
    null,
    { model: bomb(), fetchImpl: liveFetch(), now: TODAY },
    emptyTask("en"),
  );
  assert.equal(flight.plan, null);
  assert.match(flight.reply, /flight|vol/i);
  assert.doesNotMatch(flight.reply, BLURB);
  const asked = await runPlanAgent(
    [{ role: "user", content: "ok make me a plan from wed 18 2 days" }],
    null,
    { model: bomb(), fetchImpl: liveFetch(), now: TODAY },
    flight.task,
  );
  assert.equal(asked.plan, null);
  assert.equal(asked.task.constraints.dates?.start, "2026-11-18");
  assert.equal(asked.task.constraints.dates?.days, 2);
  assert.match(asked.reply, /car/i);
  const built = await runPlanAgent(
    [{ role: "user", content: "Yes, renting a car" }],
    null,
    {
      model: scriptedModel([[{ tool: "propose_itinerary", input: { startDate: "2026-11-16", days: 3, locale: "en", adults: 2, hasCar: false, boatTrips: 0, pace: "slow" } }]], "Done — I added a plan from Monday."),
      fetchImpl: liveFetch(),
      now: TODAY,
    },
    asked.task,
  );
  assert.deepEqual(built.plan?.days.map((day) => day.date), ["2026-11-18", "2026-11-19"]);
  assert.equal(built.plan?.hasCar, true);
  assert.equal(built.task.constraints.dates?.start, "2026-11-18");
  assert.doesNotMatch(built.reply, /Done — I added/);
});

for (const [locale, ask, yes] of [
  ["pt", "a partir de quarta 18, 2 dias", "Sim, vamos alugar"],
  ["fr", "à partir du mercredi 18, 2 jours", "Oui, on loue"],
] as const) {
  test(`${locale}: spoken Wednesday the 18th survives the car question`, async () => {
    const held = await runPlanAgent(
      [{ role: "user", content: ask }],
      null,
      { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
      emptyTask(locale),
    );
    assert.equal(held.plan, null);
    assert.equal(held.task.constraints.dates?.start, "2026-11-18", held.reply);
    assert.equal(held.task.constraints.dates?.days, 2);
    const built = await runPlanAgent(
      [{ role: "user", content: yes }],
      null,
      { model: scriptedModel([[{ tool: "propose_itinerary", input: { startDate: "2026-11-16", days: 3, locale, adults: 2, hasCar: false, boatTrips: 0 } }]], "Lundi."), fetchImpl: quietFetch(), now: TODAY },
      held.task,
    );
    assert.deepEqual(built.plan?.days.map((day) => day.date), ["2026-11-18", "2026-11-19"]);
  });
}

test("plan around that ferry anchors day 1 after the 07:00 arrival", async () => {
  const listed = await runPlanAgent(
    [{ role: "user", content: "Is there a ferry on Wednesday?" }],
    null,
    { model: bomb(), fetchImpl: liveFetch(), now: TODAY },
    emptyTask("en"),
  );
  const rows = decodeTransportFact(listed.task.lastToolFacts.find((fact) => fact.name === "get_transport")?.value);
  assert.ok(rows.some((row) => row.date === "2026-11-18" && row.time === "09:00" && row.kind === "in"), JSON.stringify(rows));
  const built = await runPlanAgent(
    [{ role: "user", content: "plan around that ferry, 2 days, with a car" }],
    null,
    { model: scriptedModel([[{ tool: "propose_itinerary", input: { startDate: "2026-11-16", days: 2, locale: "en", adults: 2, hasCar: true, boatTrips: 0 } }]], "Monday."), fetchImpl: liveFetch(), now: TODAY },
    listed.task,
  );
  assert.equal(built.plan?.days[0].date, "2026-11-18");
  assert.equal(built.plan?.days.length, 2);
  const arrival = built.plan?.days[0].items.find((item) => item.kind === "transport");
  assert.equal(arrival?.start, "09:00");
  for (const item of built.plan?.days[0].items ?? []) {
    if (item.kind === "transport" || !item.start) continue;
    assert.ok(item.start >= "09:00", item.start);
  }
});

test("plan from that date uses the date in the last transport answer", async () => {
  const listed = await runPlanAgent(
    [{ role: "user", content: "When is the next ferry to Praia?" }],
    null,
    { model: bomb(), fetchImpl: liveFetch(), now: TODAY },
    emptyTask("en"),
  );
  const date = decodeTransportFact(listed.task.lastToolFacts.find((fact) => fact.name === "get_transport")?.value)[0]?.date;
  assert.ok(date, listed.reply);
  const held = await runPlanAgent(
    [{ role: "user", content: "plan from that date, 2 days" }],
    null,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
    listed.task,
  );
  assert.equal(held.task.constraints.dates?.start, date);
  assert.equal(held.plan, null);
});

test("add the first listed restaurant onto day 2", async () => {
  const { plan, task } = planned("en", "2026-11-18", 3);
  const listed = await runPlanAgent(
    [{ role: "user", content: "list three restaurants in Vila do Maio" }],
    plan,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
    task,
  );
  assert.equal(listed.plan, plan);
  assert.ok(listed.task.lastPlaces.length >= 2, listed.reply);
  const first = listed.task.lastPlaces[0]!;
  const added = await runPlanAgent(
    [{ role: "user", content: "add the first one to day 2" }],
    plan,
    { model: scriptedModel([], "Done — I added it."), fetchImpl: quietFetch(), now: TODAY },
    listed.task,
  );
  assert.ok(added.plan);
  assert.notEqual(added.plan, plan);
  assert.ok(added.plan.days[1].items.some((item) => item.refId === first.id), added.reply);
  assert.equal(JSON.stringify(added.plan.days[0].items), JSON.stringify(plan.days[0].items));
  assert.match(added.reply, new RegExp(first.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(added.reply, /^Done/);
  const again = await runPlanAgent(
    [{ role: "user", content: "add the first one to day 2" }],
    added.plan,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
    added.task,
  );
  assert.equal(again.plan, added.plan);
  assert.match(again.reply, /already/i);
});

const EDITS: { q: string; locale: "en" | "pt" | "fr"; days: number; start: string }[] = [
  { q: "add another day", locale: "en", days: 3, start: "2026-11-18" },
  { q: "add 2 days", locale: "en", days: 4, start: "2026-11-18" },
  { q: "remove last day", locale: "en", days: 1, start: "2026-11-18" },
  { q: "one more day at the start", locale: "en", days: 3, start: "2026-11-17" },
  { q: "make it 4 days", locale: "en", days: 4, start: "2026-11-18" },
  { q: "mais um dia", locale: "pt", days: 3, start: "2026-11-18" },
  { q: "un jour de plus", locale: "fr", days: 3, start: "2026-11-18" },
];

for (const item of EDITS) {
  test(`${item.locale} length edit: ${item.q}`, async () => {
    const { plan, task } = planned(item.locale);
    assert.equal(plan.days.length, 2);
    const result = await runPlanAgent(
      [{ role: "user", content: item.q }],
      plan,
      { model: scriptedModel([], "Done — I added a third day: your trip now runs three days starting Wed 18 Nov."), fetchImpl: quietFetch(), now: TODAY },
      task,
    );
    assert.ok(result.plan);
    assert.equal(result.plan.days.length, item.days, result.reply);
    assert.equal(result.plan.days[0].date, item.start, result.reply);
    assert.equal(result.task.constraints.dates?.days, item.days);
    assert.equal(result.task.constraints.dates?.start, item.start);
    assert.equal(result.plan.hasCar, true);
    assert.match(result.reply, new RegExp(String(item.days)));
    assert.doesNotMatch(result.reply, /Done —/);
    assert.doesNotMatch(result.reply, BLURB);
  });
}

test("saying add another day twice does not claim a new day when the span is unchanged", async () => {
  const { plan, task } = planned("en");
  const once = await runPlanAgent(
    [{ role: "user", content: "add another day" }],
    plan,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
    task,
  );
  assert.equal(once.plan?.days.length, 3);
  const twice = await runPlanAgent(
    [{ role: "user", content: "make it 3 days" }],
    once.plan,
    { model: scriptedModel([], "Done — I added another day."), fetchImpl: quietFetch(), now: TODAY },
    once.task,
  );
  assert.equal(twice.plan?.days.length, 3);
  assert.match(twice.reply, /already|já tem|déjà/i);
  assert.doesNotMatch(twice.reply, /Done —/);
});

test("questions about the open plan do not change it", async () => {
  const { plan, task } = planned("en", "2026-11-18", 3);
  for (const q of ["what's on day 2", "when do I leave", "where is lunch day 1"]) {
    const result = await runPlanAgent(
      [{ role: "user", content: q }],
      plan,
      { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
      task,
    );
    assert.equal(result.plan, plan, q);
    assert.doesNotMatch(result.reply, BLURB, result.reply);
    assert.ok(result.reply.length > 8, result.reply);
  }
  const day = await runPlanAgent([{ role: "user", content: "o que há no dia 2" }], planned("pt").plan, { model: bomb(), fetchImpl: quietFetch(), now: TODAY }, planned("pt").task);
  assert.match(day.reply, /Dia 2/);
  const leave = await runPlanAgent([{ role: "user", content: "quand est-ce que je pars" }], planned("fr").plan, { model: bomb(), fetchImpl: quietFetch(), now: TODAY }, planned("fr").task);
  assert.match(leave.reply, /jour|départ|plan/i);
});

test("PT and FR relax phrasings change day 2 and do not claim it when repeated", async () => {
  for (const [locale, phrase] of [
    ["pt", "deixa o dia 2 mais relaxado"],
    ["fr", "rends le jour 2 plus détendu"],
    ["en", "make day 2 more relaxed"],
  ] as const) {
    const { plan, task } = planned(locale, "2026-11-18", 3);
    const before = plan.days[1].items.length;
    const result = await runPlanAgent(
      [{ role: "user", content: phrase }],
      plan,
      { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
      task,
    );
    assert.ok(result.plan);
    assert.notEqual(JSON.stringify(result.plan.days[1].items), JSON.stringify(plan.days[1].items));
    assert.ok(result.plan.days[1].items.length <= before);
    assert.match(result.reply, locale === "pt" ? /mais leve|mais calmo|tarde/i : locale === "fr" ? /léger|calme|après-midi/i : /lighter now/);
    const again = await runPlanAgent(
      [{ role: "user", content: phrase }],
      result.plan,
      { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
      result.task,
    );
    assert.equal(JSON.stringify(again.plan?.days[1].items), JSON.stringify(result.plan.days[1].items));
    assert.doesNotMatch(again.reply, /lighter now|ficou mais leve|est plus léger/);
  }
});

test("an evening 20:00 ferry choice rebuilds the last day with morning and lunch", async () => {
  const { plan, task } = planned("en", "2026-11-18", 3);
  const result = await runPlanAgent(
    [{ role: "user", content: "we'll take the 20:00 ferry" }],
    plan,
    { model: scriptedModel([[{ tool: "propose_itinerary", input: { startDate: "2026-11-16", days: 3, locale: "en", adults: 2, hasCar: true, boatTrips: 0, departure: { mode: "ferry", time: "09:00" } } }]], "Short day."), fetchImpl: liveFetch(), now: TODAY },
    task,
  );
  assert.equal(result.intent, "correction");
  const last = result.plan!.days.at(-1)!;
  const depart = last.items.find((item) => item.slot === "departure");
  assert.equal(depart?.start, "20:00");
  assert.ok(last.items.some((item) => item.slot === "morning" || item.kind === "place"));
  assert.ok(last.items.some((item) => item.slot === "lunch"));
  assert.equal(result.plan?.days[0].date, "2026-11-18");
});

const MORE: { locale: "en" | "pt" | "fr"; q: string; plan: boolean; kind: "info" | "greet" | "edit" }[] = [
  { locale: "en", q: "hi", plan: true, kind: "greet" },
  { locale: "pt", q: "olá", plan: true, kind: "greet" },
  { locale: "fr", q: "bonjour", plan: false, kind: "greet" },
  { locale: "en", q: "thanks", plan: true, kind: "greet" },
  { locale: "pt", q: "obrigado", plan: false, kind: "greet" },
  { locale: "fr", q: "merci", plan: true, kind: "greet" },
  { locale: "en", q: "where is a pharmacy", plan: true, kind: "info" },
  { locale: "pt", q: "há uma farmácia", plan: true, kind: "info" },
  { locale: "fr", q: "où est la pharmacie", plan: true, kind: "info" },
  { locale: "en", q: "is there an ATM", plan: true, kind: "info" },
  { locale: "en", q: "what is the wave forecast", plan: true, kind: "info" },
  { locale: "pt", q: "o que há no dia 1", plan: true, kind: "info" },
  { locale: "fr", q: "quand est-ce que je pars", plan: true, kind: "info" },
  { locale: "en", q: "where is lunch day 2", plan: true, kind: "info" },
  { locale: "pt", q: "onde é o almoço do dia 1", plan: true, kind: "info" },
  { locale: "en", q: "no car", plan: true, kind: "edit" },
  { locale: "pt", q: "sem carro", plan: true, kind: "edit" },
  { locale: "fr", q: "sans voiture", plan: true, kind: "edit" },
  { locale: "en", q: "we have a car", plan: true, kind: "edit" },
  { locale: "pt", q: "faz 5 dias", plan: true, kind: "edit" },
  { locale: "fr", q: "passe à 4 jours", plan: true, kind: "edit" },
  { locale: "en", q: "remove the last day", plan: true, kind: "edit" },
  { locale: "pt", q: "tira o último dia", plan: true, kind: "edit" },
  { locale: "en", q: "Arriving 18 November, departing 20 November", plan: true, kind: "edit" },
];

for (const item of MORE) {
  test(`${item.locale} turn: ${item.q}`, async () => {
    const seeded = item.plan ? planned(item.locale, "2026-11-18", 2) : { plan: null, task: emptyTask(item.locale) };
    const result = await runPlanAgent(
      [{ role: "user", content: item.q }],
      seeded.plan,
      { model: item.kind === "edit" ? scriptedModel([[{ tool: "propose_itinerary", input: { startDate: "2026-11-16", days: 3, locale: item.locale, adults: 2, hasCar: true, boatTrips: 0 } }]], "Done — I added a day.") : bomb(), fetchImpl: quietFetch(), now: TODAY },
      seeded.task,
    );
    assert.ok(result.reply.length > 1, item.q);
    assert.ok(result.chips.length <= 3, result.chips.join("|"));
    if (item.kind !== "edit") {
      assert.equal(result.plan, seeded.plan, result.reply);
      assert.doesNotMatch(result.reply, BLURB, result.reply);
      assert.doesNotMatch(result.reply, /Done —/);
    } else if (result.plan && seeded.plan) {
      const changed = JSON.stringify(result.plan.days.map((day) => day.date)) !== JSON.stringify(seeded.plan.days.map((day) => day.date)) || result.plan.hasCar !== seeded.plan.hasCar;
      if (!changed) assert.doesNotMatch(result.reply, /Done —|I added|acrescentei|j'ai ajout/i);
    }
  });
}

test("date correction to 18-20 November rebuilds those days", async () => {
  const { plan, task } = planned("en", "2026-11-16", 3);
  const result = await runPlanAgent(
    [{ role: "user", content: "start on 18 November and end on 20 November" }],
    plan,
    { model: scriptedModel([[{ tool: "propose_itinerary", input: { startDate: "2026-11-16", days: 3, locale: "en", adults: 2, hasCar: true, boatTrips: 0 } }]], "Same plan."), fetchImpl: quietFetch(), now: TODAY },
    task,
  );
  assert.deepEqual(result.plan?.days.map((day) => day.date), ["2026-11-18", "2026-11-19", "2026-11-20"]);
  assert.equal(result.task.constraints.dates?.start, "2026-11-18");
  assert.equal(result.task.constraints.dates?.days, 3);
});
