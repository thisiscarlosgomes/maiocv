// Planner awareness harness. Scripted model and fake transport, same shape as tests/plan-evals.test.ts.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModel } from "ai";
import { runPlanAgent, type PlanAgentResult } from "../../lib/plan-agent.ts";
import { clipToolBody, prepareContext, TOOL_BODY_CHARS } from "../../lib/awareness/context.ts";
import { readTask, signTask } from "../../lib/awareness/sign.ts";
import { emptyTask, type Task } from "../../lib/awareness/task.ts";
import { EMERGENCY, EMERGENCY_VERIFIED_AT } from "../../lib/emergency.ts";
import { distanceKm, experience, place, unknownRefs, type TripPlan } from "../../lib/trip.ts";
import { NOW, week, type ToolStep } from "../plan/fixtures.ts";
import { scriptedModel } from "../plan/mock-model.ts";

const dev = { NODE_ENV: "development" };
const town = place("cidade-porto-ingles")!;
const calm = week("2026-10-28", [1.0, 0.6, 0.9, 0.8, 0.8]);

function bomb(): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => { throw new Error("model should not be called"); },
  }) as unknown as LanguageModel;
}

function awareFetch(opts: { waves?: Record<string, number>; sailings?: { date: string; from: string; to: string; departure: string }[]; retrievedAt?: string; flight?: "no-current-records" | "unavailable" } = {}): typeof fetch {
  const waves = opts.waves ?? {};
  const sailings = opts.sailings ?? [];
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    const dates = Object.keys(waves).sort();
    if (url.includes("marine-api")) return json({ daily: { time: dates, wave_height_max: dates.map((d) => waves[d]) } });
    if (url.includes("api.open-meteo.com")) return json({ daily: { time: dates, wind_speed_10m_max: dates.map((d) => ((waves[d] ?? 0) >= 2 ? 38 : 16)), temperature_2m_max: dates.map(() => 28) } });
    if (url.includes("/boats")) return json({ schedules: sailings, retrievedAt: opts.retrievedAt ?? NOW.toISOString(), caveats: ["No current records does not mean no service."] });
    if (url.includes("/flights")) {
      if (opts.flight === "unavailable") return new Response("down", { status: 503 });
      return json({ status: "partial", retrievedAt: opts.retrievedAt ?? NOW.toISOString(), routes: {}, sourceUrls: {}, caveats: ["No current records does not mean no flights."] });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

const base = { startDate: "2026-10-28", days: 3, locale: "en" as const, adults: 2, kids: 0, hasCar: false, boatTrips: 1, interests: ["beach", "sea"] };

function numbers(text: string): string[] {
  return text.match(/\d+(?:[.:]\d+)?/g) ?? [];
}

function grounded(reply: string, corpus: string) {
  for (const token of numbers(reply)) assert.ok(corpus.includes(token), `ungrounded number ${token} in: ${reply}`);
}

function noPrice(reply: string) {
  assert.doesNotMatch(reply, /€|\$|\bCVE\b|\beuros?\b|\bescudos?\b/);
}

async function ask(opts: {
  content: string;
  history?: { role: "user" | "assistant"; content: string }[];
  task?: Task | null;
  plan?: TripPlan | null;
  script?: ToolStep[];
  reply?: string;
  skipModel?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<PlanAgentResult> {
  const messages = [...(opts.history ?? []), { role: "user" as const, content: opts.content }];
  const model = opts.skipModel ? bomb() : scriptedModel(opts.script ?? [], opts.reply ?? "Okay.");
  return runPlanAgent(messages, opts.plan ?? null, { model, fetchImpl: opts.fetchImpl ?? awareFetch({ waves: calm }), now: NOW }, opts.task);
}

const placesOf = (plan: TripPlan) => plan.days.flatMap((day) => day.items).flatMap((item) => {
  if (item.kind !== "place") return [];
  const record = place(item.refId);
  return record ? [record] : [];
});

test("continuation keeps the trip and makes Saturday night quiet", async () => {
  const first = await ask({
    content: "3 days from Friday, two adults, no car, one boat trip.",
    script: [[{ tool: "propose_itinerary", input: { ...base, startDate: "2026-10-30", boatTrips: 1, hasCar: false } }]],
    reply: "Three days from Friday for two adults, no car, with one boat trip.",
    fetchImpl: awareFetch({ waves: week("2026-10-30", [0.8, 0.6, 0.9]) }),
  });
  assert.equal(first.intent, "new_objective");
  assert.equal(first.task.constraints.dates?.start, "2026-10-30");
  assert.equal(first.task.constraints.car, false);
  const second = await ask({
    content: "add Saturday night as quiet.",
    history: [{ role: "user", content: "3 days from Friday, two adults, no car, one boat trip." }, { role: "assistant", content: first.reply }],
    task: first.task,
    plan: first.plan,
    script: [[{ tool: "propose_itinerary", input: { ...base, startDate: "2026-10-30", hasCar: false, drinks: false, boatTrips: 1 } }]],
    reply: "Saturday night stays quiet.",
    fetchImpl: awareFetch({ waves: week("2026-10-30", [0.8, 0.6, 0.9]) }),
  });
  assert.equal(second.intent, "continuation");
  assert.equal(second.task.constraints.dates?.start, "2026-10-30");
  assert.equal(second.task.constraints.party?.adults, 2);
  assert.equal(second.task.constraints.car, false);
  assert.equal(second.task.constraints.quietEvenings, true);
  assert.equal(second.task.objective, first.task.objective);
  assert.ok(!second.plan!.days.some((day) => day.items.some((item) => item.slot === "drinks")));
});

test("a date correction rebuilds the plan and does not repeat Friday as the start", async () => {
  const first = await ask({
    content: "3 days from Friday, two adults, no car.",
    script: [[{ tool: "propose_itinerary", input: { ...base, startDate: "2026-10-30", boatTrips: 0, hasCar: false } }]],
    reply: "Starting Friday.",
    fetchImpl: awareFetch({ waves: week("2026-10-30", [0.8, 0.7, 0.9]) }),
  });
  const fridayStop = first.plan!.days[0].items.find((item) => item.kind === "place")?.refId;
  const second = await ask({
    content: "not Friday, Saturday.",
    task: first.task,
    plan: first.plan,
    script: [[{ tool: "propose_itinerary", input: { ...base, startDate: "2026-10-31", boatTrips: 0, hasCar: false } }]],
    reply: "Saturday it is. I rebuilt the days.",
    fetchImpl: awareFetch({ waves: week("2026-10-31", [0.8, 0.7, 0.9]) }),
  });
  assert.equal(second.intent, "correction");
  assert.equal(second.plan!.days[0].date, "2026-10-31");
  assert.equal(second.task.constraints.dates?.start, "2026-10-31");
  assert.equal(second.task.constraints.car, false);
  assert.equal(second.task.constraints.party?.adults, 2);
  assert.ok(!second.reply.includes("2026-10-30"));
  assert.ok(!fridayStop || !second.reply.includes(fridayStop));
  assert.notDeepEqual(second.plan!.days.map((day) => day.date), first.plan!.days.map((day) => day.date));
});

test("a party correction rebuilds with the new party", async () => {
  const first = await ask({
    content: "3 days from tomorrow, two adults, no car.",
    script: [[{ tool: "propose_itinerary", input: { ...base, boatTrips: 0 } }]],
    reply: "Two adults, three days.",
  });
  const second = await ask({
    content: "actually we are 2 adults and a 5-year-old.",
    task: first.task,
    plan: first.plan,
    script: [[{ tool: "propose_itinerary", input: { ...base, boatTrips: 0, kids: 1, youngestAge: 5 } }]],
    reply: "Updated for two adults and a 5-year-old.",
  });
  assert.equal(second.intent, "correction");
  assert.equal(second.plan!.party.adults, 2);
  assert.equal(second.plan!.party.kids, 1);
  assert.equal(second.plan!.party.youngestAge, 5);
  assert.equal(second.task.constraints.party?.youngestAge, 5);
  assert.equal(second.task.constraints.dates?.start, first.task.constraints.dates?.start);
  assert.ok(second.reply.split("\n").filter((line) => line.trim()).length <= 2, second.reply);
  grounded(second.reply, "3");
});

test("no car stays walkable, and renting a car replaces that constraint", async () => {
  const first = await ask({
    content: "No car, beaches only, 3 days from tomorrow.",
    script: [[{ tool: "propose_itinerary", input: { ...base, boatTrips: 0, hasCar: false, interests: ["beach"] } }]],
    reply: "Walkable beaches for three days.",
  });
  for (const spot of placesOf(first.plan!)) assert.ok(distanceKm(spot, town) <= 3, spot.id);
  assert.equal(first.plan!.hasCar, false);
  const second = await ask({
    content: "we rented a car.",
    task: first.task,
    plan: first.plan,
    script: [[{ tool: "propose_itinerary", input: { ...base, boatTrips: 0, hasCar: true, interests: ["beach"] } }]],
    reply: "You have a car, so I rebuilt the days.",
  });
  assert.equal(second.intent, "correction");
  assert.equal(second.plan!.hasCar, true);
  assert.equal(second.task.constraints.car, true);
  assert.equal(second.task.constraints.dates?.start, first.task.constraints.dates?.start);
  assert.notEqual(second.task.constraints.car, false);
});

test("a hospital question keeps the objective, dates and pending question", async () => {
  const task = emptyTask("en");
  task.objective = "3 days on Maio";
  task.pendingQuestion = "How many days?";
  task.constraints = { dates: { start: "2026-10-30", days: 3 }, party: { adults: 2 }, car: false };
  const result = await ask({ content: "what's the hospital number?", task, skipModel: true });
  assert.equal(result.intent, "side_question");
  assert.equal(result.toolEvents.some((event) => event.name === "propose_itinerary"), false);
  assert.match(result.reply, /\+238 255 11 30/);
  assert.match(result.reply, /11 October 2026|2026-10-11/);
  assert.equal(result.task.objective, "3 days on Maio");
  assert.equal(result.task.pendingQuestion, "How many days?");
  assert.equal(result.task.constraints.dates?.start, "2026-10-30");
  assert.equal(result.plan, null);
  grounded(result.reply, `${EMERGENCY.map((item) => item.number).join(" ")} ${EMERGENCY_VERIFIED_AT}`);
  noPrice(result.reply);
});

test("never mind, esquece and laisse tomber clear only the pending question", async () => {
  for (const phrase of ["never mind", "esquece", "laisse tomber"]) {
    const task = emptyTask("en");
    task.objective = "Ferry or flight still open";
    task.pendingQuestion = "Ferry or flight?";
    task.constraints = { dates: { start: "2026-10-30", days: 2 }, car: false };
    const result = await ask({ content: phrase, task, skipModel: true });
    assert.equal(result.intent, "cancel_pending");
    assert.equal(result.task.pendingQuestion, null);
    assert.equal(result.task.objective, task.objective);
    assert.equal(result.task.constraints.car, false);
    assert.equal(result.toolEvents.length, 0);
    noPrice(result.reply);
  }
});

test("a new objective replaces the trip and does not keep building it", async () => {
  const task = emptyTask("en");
  task.objective = "3 days on Maio";
  task.constraints = { car: false, diet: "vegetarian", dates: { start: "2026-10-30", days: 3 } };
  const result = await ask({ content: "forget the trip, what was Maio's 2024 guest count?", task, skipModel: true });
  assert.equal(result.intent, "new_objective");
  assert.equal(result.plan, null);
  assert.match(result.task.objective ?? "", /2024 guest count/);
  assert.equal(result.task.scope.mode, "research");
  assert.equal(result.task.constraints.car, undefined);
  assert.equal(result.task.constraints.diet, undefined);
  assert.doesNotMatch(result.reply, /still building|plan is fixed|I rebuilt/);
  grounded(result.reply, "");
  noPrice(result.reply);
});

test("the second beach, that one, and around there resolve from last places", async () => {
  const task = emptyTask("en");
  task.objective = "Pick a beach";
  task.lastPlaces = [
    { id: "praia-bitche-rotcha", name: "Bitche Rotcha Beach", area: "Porto Inglês" },
    { id: "praia-do-morro", name: "Morro Beach", area: "Morro", lat: 15.180635, lon: -23.2320507 },
    { id: "praia-ponta-dos-flamingos", name: "Ponta dos Flamingos", area: "North" },
  ];
  const second = await ask({ content: "the second beach", task, skipModel: true });
  assert.match(second.reply, /Morro Beach/);
  assert.equal(second.toolEvents.some((event) => event.name === "search_experiences"), false);
  const pt = await ask({ content: "a segunda praia", task, skipModel: true });
  assert.match(pt.reply, /Morro Beach/);
  const fr = await ask({ content: "la deuxième", task, skipModel: true });
  assert.match(fr.reply, /Morro Beach/);
  const that = await ask({ content: "that one", task, skipModel: true });
  assert.match(that.reply, /Ponta dos Flamingos/);
  const calheta = emptyTask("en");
  calheta.objective = "Lunch near Calheta";
  calheta.lastPlaces = [{ id: "baxona-ribinha", name: "Calheta", area: "Calheta", lat: 15.22642185, lon: -23.2160701 }];
  const food = await ask({ content: "somewhere to eat around there", task: calheta, skipModel: true });
  assert.match(food.reply, /Vasuza/);
  assert.doesNotMatch(food.reply, /Porto Inglês|Big Game|Nha Terra/);
  noPrice(food.reply);
});

test("directions use stored coordinates and do not invent a walking time", async () => {
  const result = await ask({ content: "Directions to Praia do Morro from Porto Inglês.", task: { ...emptyTask("en"), objective: "Getting around" }, skipModel: true });
  assert.match(result.reply, /15\.180635/);
  assert.match(result.reply, /-23\.2112673/);
  assert.match(result.reply, /walking time/i);
  assert.doesNotMatch(result.reply, /\d+\s*min/);
  const morro = place("praia-do-morro")!;
  const porto = place("cidade-porto-ingles")!;
  grounded(result.reply, `${morro.lat} ${morro.lon} ${porto.lat} ${porto.lon}`);
});

test("diet and budget are stored and the reply invents neither a menu nor a price", async () => {
  const task = emptyTask("en");
  task.objective = "3 days on Maio";
  task.constraints = { dates: { start: "2026-10-28", days: 3 }, party: { adults: 2 }, car: false };
  const diet = await ask({ content: "Vegetarian lunch.", task, skipModel: true });
  assert.equal(diet.task.constraints.diet, "vegetarian");
  assert.equal(diet.task.constraints.dates?.start, "2026-10-28");
  assert.match(diet.reply, /don't record diet|não têm dieta|n'indiquent pas de régime/i);
  assert.doesNotMatch(diet.reply, /vegetarian menu|prato vegetariano/i);
  noPrice(diet.reply);
  const budget = await ask({ content: "Cheapest lunch.", task, skipModel: true });
  assert.equal(budget.task.constraints.budget, "cheapest");
  assert.match(budget.reply, /don't have prices|Não tenho preços|pas de prix/i);
  noPrice(budget.reply);
  grounded(budget.reply, budget.reply);
});

test("an unpublished ferry is not given 14:00 and the reply does not say no boat", async () => {
  const result = await ask({
    content: "We arrive by ferry on Friday and stay 2 days, no car.",
    script: [[{ tool: "propose_itinerary", input: { ...base, startDate: "2026-10-30", days: 2, boatTrips: 0, arrival: { mode: "ferry", dayIndex: 0 } } }]],
    reply: "The timetable has no published trip that day.",
    fetchImpl: awareFetch({ waves: week("2026-10-30", [0.8, 0.9]), sailings: [] }),
  });
  const transport = result.plan!.days.flatMap((day) => day.items).find((item) => item.kind === "transport");
  assert.ok(transport);
  assert.equal(transport!.start, undefined);
  assert.match(transport!.note ?? "", /not published/i);
  assert.equal(result.plan!.days.some((day) => day.items.some((item) => item.start === "14:00")), false);
  assert.doesNotMatch(result.reply, /14:00/);
  assert.doesNotMatch(result.reply, /no boat/i);
  noPrice(result.reply);
});

test("an empty ferry payload is not described as no service", async () => {
  const retrievedAt = "2026-01-01T00:00:00.000Z";
  const task = emptyTask("en");
  task.objective = "Check the boat";
  const result = await ask({
    content: "Is there a ferry on Friday?",
    task,
    skipModel: true,
    fetchImpl: awareFetch({ sailings: [], retrievedAt }),
  });
  assert.equal(result.intent, "side_question");
  assert.match(result.reply, /2026-01-01T00:00:00.000Z/);
  assert.match(result.reply, /not the same as no service/i);
  assert.doesNotMatch(result.reply, /no boat/i);
  assert.equal(result.task.objective, "Check the boat");
  grounded(result.reply, `${retrievedAt} ${result.reply}`);
});

test("a stated landing time stays unverified and no airline is invented", async () => {
  const result = await ask({
    content: "We land at 11:00 and stay 2 days from tomorrow, no car.",
    script: [[{ tool: "propose_itinerary", input: { ...base, days: 2, boatTrips: 0, arrival: { mode: "flight", dayIndex: 0, time: "11:00" } } }]],
    reply: "11:00 is the time you gave. It is not in the published timetable and it is not live status.",
    fetchImpl: awareFetch({ waves: week("2026-10-28", [0.8, 0.9]), flight: "no-current-records" }),
  });
  const transport = result.plan!.days[0].items.find((item) => item.kind === "transport");
  assert.equal(transport?.start, "11:00");
  assert.match(transport?.note ?? "", /not live status/i);
  assert.ok(result.reply.split("\n").filter((line) => line.trim()).length <= 2, result.reply);
  assert.doesNotMatch(result.reply, /TACV|airline|Bestfly|Cabo Verde Airlines/i);
  assert.equal(result.task.constraints.arrival?.verified, false);
  grounded(result.reply, `11:00 ${JSON.stringify(result.plan)}`);
});

test("a flight-status question does not claim live status", async () => {
  const task = emptyTask("en");
  task.objective = "3 days on Maio";
  task.constraints = { dates: { start: "2026-10-30", days: 2 } };
  const retrievedAt = NOW.toISOString();
  const result = await ask({
    content: "is our Praia flight in the air?",
    task,
    skipModel: true,
    fetchImpl: awareFetch({ flight: "no-current-records", retrievedAt }),
  });
  assert.equal(result.intent, "side_question");
  assert.equal(result.toolEvents.some((event) => event.name === "propose_itinerary"), false);
  assert.match(result.reply, /not live status/i);
  assert.match(result.reply, /no-current-records/);
  assert.doesNotMatch(result.reply, /on time|delayed|in the air/i);
  assert.equal(result.task.objective, task.objective);
  assert.equal(result.task.constraints.dates?.start, "2026-10-30");
  grounded(result.reply, `${retrievedAt} no-current-records`);
});

test("a toddler surf lesson is unmet and beaches remain", async () => {
  const result = await ask({
    content: "Family of 4 with a toddler, age 3, no car, 3 days from tomorrow. We want a surf lesson.",
    script: [[{ tool: "propose_itinerary", input: { ...base, kids: 2, youngestAge: 3, boatTrips: 0, interests: ["beach"], include: ["blue-ondaazul-maio"], unmet: ["surf lesson"] } }]],
    reply: "Surf lessons at onda azul start at age 8, so that stays unmet. The beaches are still in the days.",
  });
  assert.ok(result.plan!.unmet.some((item) => /surf|onda azul|age 8/i.test(item)));
  assert.equal(result.plan!.days.some((day) => day.items.some((item) => item.refId === "blue-ondaazul-maio")), false);
  assert.equal(experience("blue-ondaazul-maio")!.example.minAge, 8);
  assert.ok(result.plan!.days.some((day) => day.items.some((item) => item.kind === "place")));
  assert.deepEqual(unknownRefs(result.plan!), []);
});

test("diving, nightlife and a dolphin cruise go to unmet", async () => {
  const result = await ask({
    content: "2 days, no car. I want diving, nightlife and a dolphin cruise.",
    script: [[{ tool: "search_experiences", input: { kind: "any", query: "dolphin" } }], [{ tool: "propose_itinerary", input: { ...base, days: 2, boatTrips: 0, include: ["dolphin-cruise"], unmet: ["diving", "nightlife", "dolphin cruise"] } }]],
    reply: "We don't list diving, nightlife or dolphin cruises yet.",
  });
  assert.ok(result.plan!.unmet.length > 0);
  assert.deepEqual(unknownRefs(result.plan!), []);
  assert.equal(result.toolEvents.find((event) => event.name === "propose_itinerary")?.dropped?.[0], "dolphin-cruise");
  assert.match(result.plan!.unmet.join(" "), /diving|nightlife|dolphin/i);
  assert.ok(result.reply.split("\n").filter((line) => line.trim()).length <= 2, result.reply);
});

test("rough sea moves the boat off that day", async () => {
  const result = await ask({
    content: "3 days from tomorrow, we want two sea outings. Two adults, we rent a car.",
    script: [[{ tool: "get_sea_forecast", input: { startDate: "2026-10-28", days: 3 } }], [{ tool: "propose_itinerary", input: { ...base, hasCar: true, boatTrips: 2 } }]],
    reply: "Day 2 is rough, so the sea outing is on another day.",
    fetchImpl: awareFetch({ waves: week("2026-10-28", [0.7, 2.6, 0.9]) }),
  });
  assert.equal(result.plan!.days[1].sea?.status, "rough");
  assert.equal(result.plan!.days[1].items.some((item) => item.kind === "experience" && experience(item.refId)?.seaDependent), false);
  assert.equal(result.plan!.hasCar, true);
});

test("answering in English changes the locale and not the constraints", async () => {
  const task = emptyTask("pt");
  task.objective = "3 dias no Maio";
  task.constraints = { dates: { start: "2026-10-30", days: 2 }, party: { adults: 2 }, car: false };
  const plan = await ask({
    content: "3 days from Friday, two adults, no car.",
    script: [[{ tool: "propose_itinerary", input: { ...base, startDate: "2026-10-30", days: 2, boatTrips: 0, locale: "pt" } }]],
    reply: "Plano de sexta.",
  });
  const switched = await ask({
    content: "answer in English",
    task: { ...plan.task, locale: "pt" },
    plan: plan.plan,
    reply: "Same days, in English.",
  });
  assert.equal(switched.task.locale, "en");
  assert.equal(switched.task.constraints.dates?.start, plan.task.constraints.dates?.start);
  assert.equal(switched.task.constraints.car, false);
  assert.equal(switched.toolEvents.some((event) => event.name === "propose_itinerary"), false);
  assert.equal(switched.plan!.days[0].date, plan.plan!.days[0].date);
});

test("a French party request sets adults, kids, car, days and locale", async () => {
  const result = await ask({
    content: "Nous sommes 4, dont un enfant, sans voiture, 2 jours.",
    script: [[{ tool: "propose_itinerary", input: { startDate: "2026-10-28", days: 2, locale: "fr", adults: 3, kids: 1, hasCar: false, boatTrips: 0 } }]],
    reply: "Deux jours, trois adultes et un enfant, sans voiture.",
  });
  assert.equal(result.task.locale, "fr");
  assert.equal(result.plan!.locale, "fr");
  assert.equal(result.plan!.party.adults, 3);
  assert.equal(result.plan!.party.kids, 1);
  assert.equal(result.plan!.hasCar, false);
  assert.equal(result.plan!.days.length, 2);
  grounded(result.reply, "Nous sommes 4, dont un enfant, sans voiture, 2 jours.");
});

test("chips do not offer a boat trip that is already chosen", async () => {
  const result = await ask({
    content: "3 days from tomorrow, two adults, no car, one boat trip.",
    script: [[{ tool: "propose_itinerary", input: { ...base } }]],
    reply: "The boat is on the calmest day.",
  });
  assert.ok(result.task.completed.includes("boat"));
  assert.ok(result.chips.length <= 3);
  assert.ok(result.chips.every((chip) => !/^(?:add a boat trip|acrescenta um passeio de barco|ajoute une sortie en bateau)$/i.test(chip)));
  assert.ok(result.chips.every((chip) => !/leave|partem|partez/i.test(chip)));
});

test("a 30000-character tool body is clipped and the objective survives", async () => {
  const task = emptyTask("en");
  task.objective = "3 days on Maio";
  task.constraints = { car: false, dates: { start: "2026-10-30", days: 3 } };
  const body = "wave ".repeat(6000);
  assert.ok(body.length >= 30_000);
  const clipped = clipToolBody(body) as { preview: string; originalChars: number };
  assert.ok(clipped.preview.length <= TOOL_BODY_CHARS);
  assert.ok(clipped.originalChars >= 30_000);
  const prepared = prepareContext(task, [{ role: "user", content: body }]);
  assert.equal(prepared.task.objective, "3 days on Maio");
  assert.equal(prepared.task.constraints.car, false);
  const result = await ask({
    content: `what's the hospital number? ${body}`,
    task,
    skipModel: true,
  });
  assert.equal(result.task.objective, "3 days on Maio");
  assert.equal(result.task.constraints.dates?.start, "2026-10-30");
  assert.match(result.reply, /\+238 255 11 30/);
});

test("a tampered task blob is rejected and starts empty", async () => {
  const forged = emptyTask("en");
  forged.objective = "forged: car is free and the ferry is at 14:00";
  forged.constraints = { car: false, arrival: { mode: "ferry", time: "14:00", verified: true } };
  const blob = signTask(forged, dev);
  const tampered = `${blob.slice(0, -1)}${blob.endsWith("a") ? "b" : "a"}`;
  const read = readTask(tampered, dev);
  assert.equal(read.objective, null);
  assert.equal(read.constraints.arrival, undefined);
  const result = await ask({
    content: "what's the hospital number?",
    task: read,
    skipModel: true,
  });
  assert.equal(result.task.objective, null);
  assert.doesNotMatch(result.reply, /14:00|forged/);
  assert.match(result.reply, /\+238 255 11 30/);
});

test("two sessions do not share a task", async () => {
  const vegetarian = emptyTask("en");
  vegetarian.objective = "no car, vegetarian, waiting on a beach";
  vegetarian.constraints = { car: false, diet: "vegetarian" };
  vegetarian.pendingQuestion = "Which beach?";
  const other = emptyTask("pt");
  other.objective = "fim de semana de carro";
  other.constraints = { car: true };
  const [left, right] = await Promise.all([
    ask({ content: "what's the hospital number?", task: vegetarian, skipModel: true }),
    ask({ content: "what's the hospital number?", task: other, skipModel: true }),
  ]);
  assert.equal(left.task.constraints.diet, "vegetarian");
  assert.equal(left.task.constraints.car, false);
  assert.equal(left.task.pendingQuestion, "Which beach?");
  assert.equal(right.task.constraints.diet, undefined);
  assert.equal(right.task.constraints.car, true);
  assert.equal(right.task.objective, other.objective);
  assert.doesNotMatch(right.reply, /vegetarian|waiting on a beach/);
  assert.notEqual(signTask(left.task, dev), signTask(right.task, dev));
});

test("Portuguese and French corrections use the same rules", async () => {
  const pt = await ask({
    content: "3 dias a partir de sexta, dois adultos, sem carro.",
    script: [[{ tool: "propose_itinerary", input: { ...base, startDate: "2026-10-30", locale: "pt", boatTrips: 0 } }]],
    reply: "A começar na sexta.",
    fetchImpl: awareFetch({ waves: week("2026-10-30", [0.8, 0.7, 0.9]) }),
  });
  const moved = await ask({
    content: "não sexta, sábado.",
    task: pt.task,
    plan: pt.plan,
    script: [[{ tool: "propose_itinerary", input: { ...base, startDate: "2026-10-31", locale: "pt", boatTrips: 0 } }]],
    reply: "Passa para sábado.",
    fetchImpl: awareFetch({ waves: week("2026-10-31", [0.8, 0.7, 0.9]) }),
  });
  assert.equal(moved.intent, "correction");
  assert.equal(moved.task.locale, "pt");
  assert.equal(moved.plan!.days[0].date, "2026-10-31");
  assert.equal(moved.task.constraints.car, false);
});
