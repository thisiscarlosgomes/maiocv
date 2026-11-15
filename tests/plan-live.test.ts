// Regressions from live checks on the production planner.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { runPlanAgent } from "../lib/plan-agent.ts";
import { anchoredCount, toMin } from "../lib/full-day.ts";
import { planRuleViolations } from "../lib/plan-rules.ts";
import { buildPlan } from "../lib/trip-planner.ts";
import { distanceKm, place, type TripPlan } from "../lib/trip.ts";
import { CAR_CHIPS, CAR_QUESTION, emptyTask, type Task } from "../lib/awareness/task.ts";
import { scriptedModel } from "./plan/mock-model.ts";

const TODAY = new Date("2026-11-15T12:00:00Z");
const town = place("cidade-porto-ingles")!;
const forecast = ["2026-11-16", "2026-11-17", "2026-11-18"].map((date) => ({ date, waveHeightM: 0.8, windKmh: 16, tempMaxC: 28, sunset: "18:10" }));

function quietFetch(): typeof fetch {
  return (async () => new Response("not found", { status: 404 })) as typeof fetch;
}

function bomb(): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => { throw new Error("model should not be called"); },
  }) as unknown as LanguageModel;
}

function beachIds(plan: TripPlan): string[] {
  return plan.days.flatMap((day) => day.items.filter((item) => item.kind === "place").map((item) => item.refId));
}

const LIST = {
  en: { ask: "list three restaurants in Vila do Maio", first: "the first one", second: "the second one", that: "That is" },
  pt: { ask: "lista três restaurantes na Vila do Maio", first: "o primeiro", second: "o segundo", that: "É" },
  fr: { ask: "liste trois restaurants à Vila do Maio", first: "le premier", second: "le deuxième", that: "C'est" },
} as const;

const ORDER = ["Sete Sois Sete Luas", "Enzo Caffe Pizza", "Big Game Restaurant - Pizzeria"];

for (const locale of ["en", "pt", "fr"] as const) {
  test(`${locale}: a restaurant list replaces stale itinerary memory, and ordinals follow that list`, async () => {
    const task = emptyTask(locale);
    task.objective = "3 days on Maio";
    task.constraints = { dates: { start: "2026-11-16", days: 3 }, party: { adults: 2 }, car: false, pace: "slow" };
    task.lastPlaces = [{ id: "rotcha", name: "Rotcha", area: "Porto Inglês" }];
    const copy = LIST[locale];
    const listed = await runPlanAgent(
      [{ role: "user", content: copy.ask }],
      null,
      { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
      task,
    );
    assert.equal(listed.intent, "side_question");
    const at = ORDER.map((name) => listed.reply.indexOf(name));
    assert.ok(at.every((index) => index >= 0), listed.reply);
    assert.deepEqual(at, [...at].sort((a, b) => a - b));
    assert.deepEqual(listed.task.lastPlaces.map((item) => item.name), ORDER);
    assert.notEqual(listed.task.lastPlaces[0]?.id, "rotcha");

    const first = await runPlanAgent(
      [{ role: "user", content: copy.first }],
      null,
      { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
      listed.task,
    );
    assert.match(first.reply, new RegExp(`^${copy.that} ${ORDER[0]}\\.`));
    assert.doesNotMatch(first.reply, /Rotcha/);
    assert.equal(first.task.lastPlaces[0]?.name, ORDER[0]);
    assert.equal(first.task.lastPlaces[1]?.name, ORDER[1]);

    const second = await runPlanAgent(
      [{ role: "user", content: copy.second }],
      null,
      { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
      first.task,
    );
    assert.match(second.reply, new RegExp(`${ORDER[1]}`));
    assert.doesNotMatch(second.reply, /Rotcha/);
  });
}

test("slow pace stays sparse, skips an unrequested quad, and does not repeat a beach when a car can go further", () => {
  const walk = buildPlan({ request: { startDate: "2026-11-16", days: 3, locale: "en", pace: "slow", boatTrips: 0, hasCar: false, adults: 2 }, forecast, sailings: [] });
  const drive = buildPlan({ request: { startDate: "2026-11-16", days: 3, locale: "en", pace: "slow", boatTrips: 0, hasCar: true, adults: 2 }, forecast, sailings: [] });
  for (const built of [walk, drive]) {
    assert.deepEqual(planRuleViolations(built), []);
    assert.equal(built.days.some((day) => day.items.some((item) => /quad|jetski|offroad/i.test(item.refId))), false);
    for (const day of built.days) {
      assert.ok(anchoredCount(day.items) <= 4, `${day.date} anchors ${anchoredCount(day.items)}`);
      assert.ok(anchoredCount(day.items) >= 1);
      const rows = day.items.filter((item) => item.start).sort((a, b) => toMin(a.start) - toMin(b.start));
      const breakfast = rows.findIndex((item) => item.slot === "breakfast");
      assert.ok(breakfast >= 0);
      const gap = toMin(rows[breakfast + 1].start) - toMin(rows[breakfast].start);
      assert.ok(gap >= 90, `${rows[breakfast].start} then ${rows[breakfast + 1].start}`);
      assert.equal(day.items.some((item) => item.slot === "drinks" || item.slot === "rest"), false);
    }
  }
  const walking = beachIds(walk);
  const driving = beachIds(drive);
  assert.ok(walking.filter((id, index) => walking.indexOf(id) !== index).length <= 1);
  assert.equal(driving.filter((id, index) => driving.indexOf(id) !== index).length, 0);
  assert.ok(driving.some((id) => distanceKm(place(id)!, town) > 3));
  assert.ok(driving.some((id) => !walking.includes(id)));
});

test("naming a quad on a slow trip keeps that one activity", () => {
  const built = buildPlan({
    request: { startDate: "2026-11-16", days: 3, locale: "en", pace: "slow", boatTrips: 0, hasCar: true, adults: 2, include: ["blue-rental-quad-big-game"] },
    forecast,
    sailings: [],
  });
  const quads = built.days.flatMap((day) => day.items.filter((item) => item.refId === "blue-rental-quad-big-game"));
  assert.equal(quads.length, 1);
  assert.ok(built.days.every((day) => anchoredCount(day.items) <= 4));
});

test("asking for a quad on a slow trip keeps it through the agent", async () => {
  const result = await runPlanAgent(
    [{ role: "user", content: "3 days from Monday, slow pace, two adults, no car, and a quad." }],
    null,
    {
      model: scriptedModel([[{ tool: "propose_itinerary", input: { startDate: "2026-11-16", days: 3, locale: "en", adults: 2, hasCar: false, boatTrips: 0, pace: "slow", include: [] } }]], "Slow days, with the quad you asked for."),
      fetchImpl: quietFetch(),
      now: TODAY,
    },
  );
  const quads = result.plan!.days.flatMap((day) => day.items.filter((item) => item.refId === "blue-rental-quad-big-game"));
  assert.equal(quads.length, 1);
  assert.ok(result.plan!.days.every((day) => anchoredCount(day.items) <= 4));
});

test("a car correction rebuilds every day and drops a quad the guest did not ask for", async () => {
  const waves = { "2026-11-16": 0.8, "2026-11-17": 0.7, "2026-11-18": 0.9 };
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    const dates = Object.keys(waves);
    if (url.includes("marine-api")) return json({ daily: { time: dates, wave_height_max: dates.map((date) => waves[date as keyof typeof waves]) } });
    if (url.includes("api.open-meteo.com")) return json({ daily: { time: dates, wind_speed_10m_max: dates.map(() => 16), temperature_2m_max: dates.map(() => 28) } });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  const first = await runPlanAgent(
    [{ role: "user", content: "3 days from Monday, slow pace, two adults, no car." }],
    null,
    {
      model: scriptedModel([[{ tool: "propose_itinerary", input: { startDate: "2026-11-16", days: 3, locale: "en", adults: 2, hasCar: false, boatTrips: 0, pace: "slow", include: ["blue-rental-quad-big-game"] } }]], "Here is a slow plan."),
      fetchImpl,
      now: TODAY,
    },
  );
  assert.equal(first.task.constraints.pace, "slow");
  assert.equal(first.plan!.hasCar, false);
  assert.equal(first.plan!.days.length, 3);
  assert.equal(first.plan!.days.some((day) => day.items.some((item) => /quad/.test(item.refId))), false);
  const before = beachIds(first.plan!);

  const second = await runPlanAgent(
    [
      { role: "user", content: "3 days from Monday, slow pace, two adults, no car." },
      { role: "assistant", content: first.reply },
      { role: "user", content: "we rented a car." },
    ],
    first.plan,
    {
      model: scriptedModel([[{ tool: "propose_itinerary", input: { startDate: "2026-11-16", days: 1, locale: "en", adults: 2, hasCar: true, boatTrips: 0, pace: "slow", include: ["blue-rental-quad-big-game"] } }]], "Monday still has the quad, and you have a car."),
      fetchImpl,
      now: TODAY,
    },
    first.task,
  );
  assert.equal(second.intent, "correction");
  assert.equal(second.plan!.hasCar, true);
  assert.equal(second.plan!.days.length, 3);
  assert.deepEqual(second.plan!.days.map((day) => day.date), ["2026-11-16", "2026-11-17", "2026-11-18"]);
  assert.equal(second.plan!.days.some((day) => day.items.some((item) => /quad/.test(item.refId))), false);
  assert.ok(second.plan!.days.every((day) => day.items.length >= 4));
  const after = beachIds(second.plan!);
  assert.ok(after.some((id) => distanceKm(place(id)!, town) > 3));
  assert.ok(after.some((id) => !before.includes(id)));
  assert.equal(second.task.constraints.car, true);
  assert.equal(second.task.constraints.pace, "slow");
});

test("a plan without a car answer asks once, then a chip or a short reply builds that same trip", async () => {
  const prompts = {
    en: { plan: "3 days, slow pace", yes: "yes we rent one", no: "nope", unsure: "Not sure yet", hi: "hi" },
    pt: { plan: "3 dias, ritmo calmo", yes: "sim", no: "não", unsure: "Ainda não sei", hi: "olá" },
    fr: { plan: "3 jours, rythme calme", yes: "oui", no: "non", unsure: "Pas encore sûr", hi: "bonjour" },
  } as const;
  for (const locale of ["en", "pt", "fr"] as const) {
    const copy = prompts[locale];
    const asked = await runPlanAgent(
      [{ role: "user", content: copy.plan }],
      null,
      { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
    );
    assert.equal(asked.plan, null);
    assert.equal(asked.intent, "new_objective");
    assert.equal(asked.task.pendingQuestion, CAR_QUESTION[locale]);
    assert.equal(asked.task.objective, copy.plan);
    assert.equal(asked.task.constraints.car, undefined);
    assert.deepEqual(asked.chips, [...CAR_CHIPS[locale]]);
    assert.ok(asked.reply.length < 80, asked.reply);

    const greeted = await runPlanAgent(
      [{ role: "user", content: copy.plan }, { role: "assistant", content: asked.reply }, { role: "user", content: copy.hi }],
      null,
      { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
      asked.task,
    );
    assert.equal(greeted.plan, null);
    assert.equal(greeted.task.pendingQuestion, CAR_QUESTION[locale]);
    assert.equal(greeted.task.objective, copy.plan);
    assert.deepEqual(greeted.chips, [...CAR_CHIPS[locale]]);

    const side = await runPlanAgent(
      [{ role: "user", content: "what's the hospital number?" }],
      null,
      { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
      asked.task,
    );
    assert.match(side.reply, /255 11 30/);
    assert.equal(side.plan, null);
    assert.equal(side.task.pendingQuestion, CAR_QUESTION[locale]);
    assert.equal(side.task.objective, copy.plan);

    const held = await runPlanAgent(
      [{ role: "user", content: "make it 4 days" }],
      null,
      { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
      asked.task,
    );
    assert.equal(held.plan, null);
    assert.equal(held.task.pendingQuestion, CAR_QUESTION[locale]);
    assert.equal(held.task.constraints.dates?.days, 4);
    assert.match(held.reply, /Noted|Anotado|Noté/);
  }

  const withCar = await runPlanAgent(
    [{ role: "user", content: "3 days, slow pace" }, { role: "assistant", content: CAR_QUESTION.en }, { role: "user", content: "Yes, renting a car" }],
    null,
    { model: scriptedModel([[{ tool: "propose_itinerary", input: { startDate: "2026-11-16", days: 3, locale: "en", adults: 2, hasCar: false, boatTrips: 0, pace: "slow" } }]], "Overview - Length: 3 days - Pace: slow Day 1 — 2026-11-16 - 08:10 — Breakfast: Cafe"), fetchImpl: quietFetch(), now: TODAY },
    (await runPlanAgent([{ role: "user", content: "3 days, slow pace" }], null, { model: bomb(), fetchImpl: quietFetch(), now: TODAY })).task,
  );
  assert.equal(withCar.task.constraints.car, true);
  assert.equal(withCar.task.pendingQuestion, null);
  assert.equal(withCar.task.objective, "3 days, slow pace");
  assert.equal(withCar.plan?.hasCar, true);
  assert.match(withCar.reply, /with a car/i);
  assert.doesNotMatch(withCar.reply, /## Day/);
  assert.ok(withCar.reply.split(/[.!?]+/).filter((part) => part.trim()).length <= 2);

  const noCar = await runPlanAgent(
    [{ role: "user", content: "3 days, slow pace" }, { role: "assistant", content: CAR_QUESTION.en }, { role: "user", content: "nope" }],
    null,
    { model: scriptedModel([[{ tool: "propose_itinerary", input: { startDate: "2026-11-16", days: 3, locale: "en", pace: "slow", hasCar: true, boatTrips: 0, adults: 2 } }]], "Overview - Length: 3 days Day 1 — 2026-11-16 - 08:30 — Beach"), fetchImpl: quietFetch(), now: TODAY },
    (await runPlanAgent([{ role: "user", content: "3 days, slow pace" }], null, { model: bomb(), fetchImpl: quietFetch(), now: TODAY })).task,
  );
  assert.equal(noCar.plan?.hasCar, false);
  assert.match(noCar.reply, /no car/i);
  assert.match(noCar.reply, /aluguer/);
  assert.ok(noCar.plan!.days.flatMap((day) => day.items).filter((item) => item.kind === "place").every((item) => distanceKm(place(item.refId)!, town) <= 3));

  const unsure = await runPlanAgent(
    [{ role: "user", content: "3 days, slow pace" }, { role: "assistant", content: CAR_QUESTION.en }, { role: "user", content: "Not sure yet" }],
    null,
    { model: scriptedModel([[{ tool: "propose_itinerary", input: { startDate: "2026-11-16", days: 3, locale: "en", pace: "slow", hasCar: false, boatTrips: 0, adults: 2 } }]], "Overview - Length: 3 days Day 1 — 2026-11-16 - 08:30 — Beach"), fetchImpl: quietFetch(), now: TODAY },
    (await runPlanAgent([{ role: "user", content: "3 days, slow pace" }], null, { model: bomb(), fetchImpl: quietFetch(), now: TODAY })).task,
  );
  assert.equal(unsure.plan?.hasCar, true);
  assert.match(unsure.reply, /assuming a rental car/i);

  const upfront = await runPlanAgent(
    [{ role: "user", content: "3 days, slow pace, with a car" }],
    null,
    { model: scriptedModel([[{ tool: "propose_itinerary", input: { startDate: "2026-11-16", days: 3, locale: "en", pace: "slow", hasCar: false, boatTrips: 0, adults: 2 } }]], "Overview - Length: 3 days Day 1 — 2026-11-16 - 08:30 — Beach"), fetchImpl: quietFetch(), now: TODAY },
  );
  assert.equal(upfront.task.pendingQuestion, null);
  assert.equal(upfront.plan?.hasCar, true);
  assert.doesNotMatch(upfront.reply, /Will you have a car/);
});

test("what can you tell me about maio is a short visitor intro, not a catalog count", async () => {
  const prompts = [
    ["en", "what can you tell me about maio"],
    ["pt", "o que me podes dizer sobre o Maio"],
    ["fr", "parle-moi de Maio"],
  ] as const;
  for (const [locale, content] of prompts) {
    const task: Task = emptyTask(locale);
    task.objective = "3 days on Maio";
    const result = await runPlanAgent([{ role: "user", content }], null, { model: bomb(), fetchImpl: quietFetch(), now: TODAY }, task);
    const sentences = result.reply.split(/[.!?]+/).filter((part) => part.trim());
    assert.ok(sentences.length >= 3 && sentences.length <= 3, result.reply);
    assert.doesNotMatch(result.reply, /lists \d+|lista \d+|liste \d+|\b\d+\s+(?:beaches|praias|plages|places|experiences|expériences|sítios)\b/i);
    assert.match(result.reply, /Vila do Maio/);
    assert.match(result.reply, /Porto Inglês/);
    assert.ok(result.reply.length < 520, String(result.reply.length));
  }
});
