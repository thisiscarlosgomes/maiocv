// Natural edit phrasings. The gateway model emits EditIntent; without a key the same
// schema is filled by the regex fallback. Replies come from the plan diff.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { classify } from "../lib/awareness/classify.ts";
import { emptyTask, refreshTask, type Task } from "../lib/awareness/task.ts";
import { runPlanAgent } from "../lib/plan-agent.ts";
import { visibleStops } from "../lib/plan-edits.ts";
import { EditIntentSchema, intentFromToolInput, parseEditIntent, resolveDayRef, shiftFromIntent } from "../lib/plan-intent.ts";
import { parseDateShift } from "../lib/plan-router.ts";
import { buildPlan } from "../lib/trip-planner.ts";
import type { TripPlan } from "../lib/trip.ts";

const TODAY = new Date("2026-11-15T12:00:00Z");
const today = "2026-11-15";
const forecast = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"].map((date) => ({
  date, waveHeightM: 0.8, windKmh: 16, tempMaxC: 28, sunset: "18:10",
}));

function bomb(): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => { throw new Error("model should not be called"); },
  }) as unknown as LanguageModel;
}

function quietFetch(): typeof fetch {
  const dates = forecast.map((day) => day.date);
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("marine-api")) return Response.json({ daily: { time: dates, wave_height_max: dates.map(() => 0.8) } });
    if (url.includes("api.open-meteo.com")) {
      return Response.json({ daily: { time: dates, wind_speed_10m_max: dates.map(() => 16), temperature_2m_max: dates.map(() => 28), sunset: dates.map((date) => `${date}T18:10`) } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function planned(locale: "en" | "pt" | "fr" = "en", boat = false): { plan: TripPlan; task: Task } {
  const plan = buildPlan({
    request: { startDate: "2026-11-16", days: 3, locale, adults: 2, kids: 0, hasCar: true, boatTrips: boat ? 1 : 0, pace: "slow" },
    forecast,
    sailings: [],
  });
  const task = refreshTask({
    ...emptyTask(locale),
    objective: plan.title,
    constraints: { dates: { start: "2026-11-16", days: 3 }, party: { adults: 2, kids: 0 }, car: true, pace: "slow", ...(boat ? { boatTrips: 1 } : {}) },
    completed: ["itinerary"],
  });
  return { plan, task };
}

const UNCHANGED = /I didn't change|Não alterei|n'ai pas modifié/;
const ADJUSTED = /suitable|adequados|convienne|kid-friendly/i;

async function ask(phrase: string, locale: "en" | "pt" | "fr" = "en", boat = false) {
  const { plan, task } = planned(locale, boat);
  const result = await runPlanAgent(
    [{ role: "user", content: phrase }],
    plan,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
    task,
  );
  return { ...result, before: plan };
}

const RELAX_DAY_2 = [
  "i want a slow second day",
  "make the second day slower",
  "day two should be easy",
  "a chill day 2",
  "lazy tuesday",
  "make tuesday lighter",
  "rest day on the 17th",
  "the 17th should be calm",
  "quero um segundo dia mais lento",
  "o segundo dia mais calmo",
  "terça mais leve",
  "quero descansar no dia 17",
  "je veux un deuxième jour plus calme",
  "le deuxième jour plus léger",
  "mardi tranquille",
  "une journée de repos le 17",
];

for (const phrase of RELAX_DAY_2) {
  test(`relax day 2: ${phrase}`, async () => {
    const locale = /quero|terça|descans|segundo dia mais calmo|dia 17/.test(phrase) ? "pt" as const
      : /je veux|deuxième|léger|mardi|journée|repos/.test(phrase) ? "fr" as const
      : "en" as const;
    const { plan, before, reply } = await ask(phrase, locale);
    assert.ok(plan);
    assert.ok(visibleStops(plan.days[1].items) < visibleStops(before.days[1].items), `${phrase} ${reply}`);
    assert.deepEqual(plan.days[0].items, before.days[0].items);
    assert.deepEqual(plan.days[2].items, before.days[2].items);
    assert.match(reply, locale === "pt" ? /mais leve|tarde/i : locale === "fr" ? /léger|après-midi/i : /lighter now|afternoon free/);
    assert.equal(reply.includes("\n"), false, reply);
    assert.doesNotMatch(reply, UNCHANGED);
    const intent = parseEditIntent(phrase, before, today);
    assert.equal(intent?.kind, "relax_day", phrase);
    assert.equal(intent?.day, 2, phrase);
  });
}

const OTHER_DAYS: { phrase: string; day: number; locale: "en" | "pt" | "fr" }[] = [
  { phrase: "make the last day easy", day: 3, locale: "en" },
  { phrase: "first day more relaxed", day: 1, locale: "en" },
  { phrase: "tomorrow should be slow", day: 1, locale: "en" },
  { phrase: "quero o último dia mais calmo", day: 3, locale: "pt" },
  { phrase: "le premier jour plus tranquille", day: 1, locale: "fr" },
];

for (const item of OTHER_DAYS) {
  test(`relax ${item.phrase}`, async () => {
    const { plan, before, reply } = await ask(item.phrase, item.locale);
    assert.ok(plan);
    const index = item.day - 1;
    assert.ok(visibleStops(plan.days[index].items) < visibleStops(before.days[index].items), reply);
    for (const other of [0, 1, 2]) if (other !== index) assert.deepEqual(plan.days[other].items, before.days[other].items);
    assert.doesNotMatch(reply, UNCHANGED);
  });
}

const AMBIGUOUS = ["i want a slower day", "make it more relaxed", "quero um dia mais calmo", "je veux une journée plus calme"];

for (const phrase of AMBIGUOUS) {
  test(`ambiguous day asks once: ${phrase}`, async () => {
    const locale = phrase.startsWith("quero") ? "pt" as const : phrase.startsWith("je") ? "fr" as const : "en" as const;
    const { plan, before, reply } = await ask(phrase, locale);
    assert.equal(plan, before);
    assert.match(reply, locale === "pt" ? /Qual dia: seg 16, ter 17 ou qua 18/ : locale === "fr" ? /Quel jour/ : /Which day: Mon 16, Tue 17 or Wed 18/);
    assert.doesNotMatch(reply, UNCHANGED);
  });
}

const BUSY = [
  { phrase: "make day 2 busier", locale: "en" as const },
  { phrase: "more stuff on tuesday", locale: "en" as const },
  { phrase: "pack it on the second day", locale: "en" as const },
  { phrase: "quero o segundo dia mais cheio", locale: "pt" as const },
  { phrase: "mardi plus chargé", locale: "fr" as const },
];

for (const item of BUSY) {
  test(`busier day: ${item.phrase}`, async () => {
    const { plan, before, reply } = await ask(item.phrase, item.locale);
    assert.ok(plan);
    assert.ok(visibleStops(plan.days[1].items) > visibleStops(before.days[1].items), reply);
    assert.deepEqual(plan.days[0].items, before.days[0].items);
    assert.match(reply, item.locale === "pt" ? /cheio/i : item.locale === "fr" ? /chargé/i : /busier now/i);
    assert.doesNotMatch(reply, UNCHANGED);
  });
}

const SPANS = [
  "arriving 18, leaving 20 Nov",
  "from 18 to 20 Nov",
  "18-20 Nov",
  "arriving 18 Nov, leaving 20 Nov",
  "from the 18th to the 20th",
  "chego 18 e saio 20",
  "chego dia 18 e saio dia 20 de novembro",
  "arrivée le 18, départ le 20",
  "start on 18 November and end on 20 November",
];

for (const phrase of SPANS) {
  test(`span keeps both ends: ${phrase}`, async () => {
    const locale = /chego|saio|novembro/.test(phrase) ? "pt" as const : /arrivée|départ/.test(phrase) ? "fr" as const : "en" as const;
    const shift = parseDateShift(phrase, today, "2026-11-16");
    assert.notEqual(shift, "ask", phrase);
    assert.equal(typeof shift === "object" && shift?.start, "2026-11-18", phrase);
    assert.equal(typeof shift === "object" && shift?.end, "2026-11-20", phrase);
    assert.equal(typeof shift === "object" && shift?.days, 3, phrase);
    const { plan, reply } = await ask(phrase, locale);
    assert.deepEqual(plan?.days.map((day) => day.date), ["2026-11-18", "2026-11-19", "2026-11-20"], reply);
    assert.equal(plan?.days.length, 3);
    assert.doesNotMatch(reply, /1 day|1 dia|1 jour/);
    assert.match(reply, /18/);
    assert.match(reply, /20/);
    assert.doesNotMatch(reply, UNCHANGED);
    const intent = parseEditIntent(phrase, planned(locale).plan, today);
    assert.equal(intent?.kind, "set_dates", phrase);
    assert.equal(intent?.start, "2026-11-18");
    assert.equal(intent?.end, "2026-11-20");
  });
}

test("a start-only move still keeps the length", () => {
  const shift = parseDateShift("going on the 18th", today, "2026-11-16");
  assert.deepEqual(shift, { start: "2026-11-18" });
});

const PARTIES: { phrase: string; locale: "en" | "pt" | "fr"; adults: number; kids: number; age?: number; baby?: boolean }[] = [
  { phrase: "We're two adults and a 6 year old", locale: "en", adults: 2, kids: 1, age: 6 },
  { phrase: "we're 2 adults and a 6-year-old", locale: "en", adults: 2, kids: 1, age: 6 },
  { phrase: "two kids aged 4 and 9", locale: "en", adults: 2, kids: 2, age: 4 },
  { phrase: "a baby", locale: "en", adults: 2, kids: 1, age: 1, baby: true },
  { phrase: "family of 4", locale: "en", adults: 4, kids: 0 },
  { phrase: "dois adultos e uma criança de 6 anos", locale: "pt", adults: 2, kids: 1, age: 6 },
  { phrase: "deux adultes et un enfant de 6 ans", locale: "fr", adults: 2, kids: 1, age: 6 },
];

for (const item of PARTIES) {
  test(`party: ${item.phrase}`, async () => {
    const parsed = classify(item.phrase, planned(item.locale).task, { today });
    assert.equal(parsed.patch.party?.adults ?? planned(item.locale).task.constraints.party?.adults, item.adults, item.phrase);
    assert.equal(parsed.patch.party?.kids, item.kids, item.phrase);
    if (item.age !== undefined) assert.equal(parsed.patch.party?.youngestAge, item.age, item.phrase);
    const { plan, before, reply } = await ask(item.phrase, item.locale);
    assert.equal(plan?.party.adults, item.adults, reply);
    assert.equal(plan?.party.kids, item.kids, reply);
    if (item.age !== undefined) assert.equal(plan?.party.youngestAge, item.age, reply);
    assert.deepEqual(plan?.days.map((day) => day.date), before.days.map((day) => day.date));
    assert.doesNotMatch(reply, UNCHANGED);
    assert.doesNotMatch(reply, ADJUSTED, reply);
    if (item.baby) assert.match(reply, /baby|bebé|bébé/i);
  });
}

test("a 6-year-old drops an age-limited boat and the reply says so", async () => {
  const { plan, before, reply } = await ask("We're two adults and a 6 year old", "en", true);
  assert.equal(plan?.party.kids, 1);
  assert.equal(plan?.party.youngestAge, 6);
  assert.ok(before.days.some((day) => day.items.some((item) => item.kind === "experience")), "fixture should include the boat");
  assert.equal(plan?.days.some((day) => day.items.some((item) => item.kind === "experience")), false);
  assert.match(reply, ADJUSTED);
  assert.doesNotMatch(reply, UNCHANGED);
});

test("repeating a relax day does not claim a new change", async () => {
  const { plan, task } = planned("en");
  const once = await runPlanAgent([{ role: "user", content: "i want a slow second day" }], plan, { model: bomb(), fetchImpl: quietFetch(), now: TODAY }, task);
  const twice = await runPlanAgent([{ role: "user", content: "i want a slow second day" }], once.plan, { model: bomb(), fetchImpl: quietFetch(), now: TODAY }, once.task);
  assert.equal(JSON.stringify(twice.plan?.days[1].items), JSON.stringify(once.plan?.days[1].items));
  assert.match(twice.reply, /already/i);
  assert.doesNotMatch(twice.reply, UNCHANGED);
});

const FIXTURES: { name: string; input: unknown; day?: number; start?: string; end?: string; days?: number }[] = [
  { name: "relax by index", input: { kind: "relax_day", day: 2 }, day: 2 },
  { name: "relax by spoken ref", input: { kind: "relax_day", day: "second" }, day: 2 },
  { name: "relax by ISO", input: { kind: "relax_day", day: "2026-11-17" }, day: 2 },
  { name: "relax tuesday", input: { kind: "relax_day", day: "tuesday" }, day: 2 },
  { name: "busy last day", input: { kind: "busier_day", day: "last" }, day: 3 },
  { name: "span", input: { kind: "set_dates", start: "2026-11-18", end: "2026-11-20" }, start: "2026-11-18", end: "2026-11-20", days: 3 },
  { name: "party", input: { kind: "set_party", adults: 2, kids: 1, youngestAge: 6 } },
  { name: "shift", input: { kind: "shift_dates", shiftDays: 2 } },
  { name: "add day", input: { kind: "add_day", days: 1, where: "end" } },
  { name: "question", input: { kind: "question" } },
];

for (const fixture of FIXTURES) {
  test(`model fixture ${fixture.name}`, () => {
    const intent = intentFromToolInput(fixture.input);
    assert.ok(intent, fixture.name);
    assert.deepEqual(intent, EditIntentSchema.parse(fixture.input));
    const plan = planned().plan;
    if (fixture.day) assert.equal(resolveDayRef(intent?.day, plan, today), fixture.day);
    if (fixture.start) {
      const shift = shiftFromIntent(intent!);
      assert.equal(typeof shift === "object" && shift?.start, fixture.start);
      assert.equal(typeof shift === "object" && shift?.end, fixture.end);
      assert.equal(typeof shift === "object" && shift?.days, fixture.days);
    }
  });
}

test("a fixture that is not an edit intent is rejected", () => {
  assert.equal(intentFromToolInput({ kind: "dance", day: 2 }), null);
  assert.equal(intentFromToolInput(null), null);
});

test("day refs resolve across EN PT and FR", () => {
  const plan = planned().plan;
  for (const [ref, day] of [
    ["second day", 2],
    ["day two", 2],
    ["day 2", 2],
    ["tuesday", 2],
    ["the 17th", 2],
    ["tomorrow", 1],
    ["last day", 3],
    ["first day", 1],
    ["segundo dia", 2],
    ["terca", 2],
    ["deuxieme jour", 2],
    ["mardi", 2],
  ] as const) {
    assert.equal(resolveDayRef(undefined, plan, today, ref), day, ref);
  }
  assert.equal(resolveDayRef(undefined, plan, today, "make it slower"), "ambiguous");
});
