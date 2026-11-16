// Ordinary plan builds and listed side questions must not call the planner model.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { emptyTask, refreshTask } from "../lib/awareness/task.ts";
import { runPlanAgent, TURN_MODEL_MS } from "../lib/plan-agent.ts";
import { buildPlan } from "../lib/trip-planner.ts";
import { LIVE_BOATS, LIVE_FLIGHTS } from "./plan/live-window.ts";

const TODAY = new Date("2026-11-15T12:00:00Z");

function bomb(): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => { throw new Error("model should not be called"); },
  }) as unknown as LanguageModel;
}

function quietFetch(): typeof fetch {
  const dates = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("marine-api")) return Response.json({ daily: { time: dates, wave_height_max: dates.map(() => 0.8) } });
    if (url.includes("api.open-meteo.com")) {
      return Response.json({ daily: { time: dates, wind_speed_10m_max: dates.map(() => 16), temperature_2m_max: dates.map(() => 28), sunset: dates.map((date) => `${date}T18:10`) } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

test("a full plan with dates and a car is built without the model", async () => {
  const started = Date.now();
  const result = await runPlanAgent(
    [{ role: "user", content: "3 days, slow pace, renting a car, from 18 to 20 November" }],
    null,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
  );
  assert.ok(Date.now() - started < 6_000);
  assert.equal(result.plan?.days.length, 3);
  assert.deepEqual(result.plan?.days.map((day) => day.date), ["2026-11-18", "2026-11-19", "2026-11-20"]);
  assert.equal(result.plan?.hasCar, true);
  assert.match(result.reply, /with a car/i);
  assert.ok(result.reply.split("\n").filter((line) => line.trim()).length <= 2);
  assert.equal(result.toolEvents.some((event) => event.name === "propose_itinerary"), true);
});

test("yes, renting a car builds the held plan without the model", async () => {
  const asked = await runPlanAgent(
    [{ role: "user", content: "3 days, slow pace, from 18 to 20 November" }],
    null,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
  );
  assert.equal(asked.plan, null);
  const started = Date.now();
  const built = await runPlanAgent(
    [
      { role: "user", content: "3 days, slow pace, from 18 to 20 November" },
      { role: "assistant", content: asked.reply },
      { role: "user", content: "Yes, renting a car" },
    ],
    null,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
    asked.task,
  );
  assert.ok(Date.now() - started < 6_000);
  assert.equal(built.plan?.hasCar, true);
  assert.equal(built.plan?.days.length, 3);
  assert.match(built.reply, /with a car/i);
});

const SIDES = [
  ["where can I see turtles?", /turtle|tartaruga|tortue/i],
  ["how do I get from the airport to town?", /aluguer/i],
  ["where can I get a coffee?", /coffee|café|cafe/i],
  ["where's a good sunset?", /west|oeste|ouest/i],
] as const;

test("yes, renting a car after plan around that ferry does not call the model", async () => {
  const fetchImpl: typeof fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("schedules/boats")) return Response.json(LIVE_BOATS);
    if (url.includes("schedules/flights")) return Response.json(LIVE_FLIGHTS);
    return quietFetch()(input);
  }) as typeof fetch;
  const listed = await runPlanAgent(
    [{ role: "user", content: "Is there a ferry on Wednesday?" }],
    null,
    { model: bomb(), fetchImpl, now: TODAY },
  );
  const held = await runPlanAgent(
    [{ role: "user", content: "plan around that ferry" }],
    null,
    { model: bomb(), fetchImpl, now: TODAY },
    listed.task,
  );
  assert.equal(held.plan, null);
  assert.equal(held.task.constraints.dates?.start, "2026-11-18");
  const started = Date.now();
  const built = await runPlanAgent(
    [{ role: "user", content: "Yes, renting a car" }],
    null,
    { model: bomb(), fetchImpl, now: TODAY },
    held.task,
  );
  assert.ok(Date.now() - started < 6_000);
  assert.equal(built.plan?.hasCar, true);
  assert.equal(built.plan?.days[0]?.date, "2026-11-18");
  assert.equal(built.plan?.days[0]?.items.find((item) => item.kind === "transport")?.start, "09:00");
});

test("plan around that ferry names the sailing and asks for a car only when it is unknown", async () => {
  const fetchImpl: typeof fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("schedules/boats")) return Response.json(LIVE_BOATS);
    if (url.includes("schedules/flights")) return Response.json(LIVE_FLIGHTS);
    return quietFetch()(input);
  }) as typeof fetch;
  const listed = await runPlanAgent(
    [{ role: "user", content: "Is there a ferry on Wednesday?" }],
    null,
    { model: bomb(), fetchImpl, now: TODAY },
  );
  const around = await runPlanAgent(
    [{ role: "user", content: "plan around that ferry" }],
    null,
    { model: bomb(), fetchImpl, now: TODAY },
    listed.task,
  );
  assert.equal(around.plan, null);
  assert.match(around.reply, /Plan starts Wed 18 Nov with the 07:00 ferry from Santiago, arriving around 09:00/);
  assert.doesNotMatch(around.reply, /is the arrival/);
  assert.match(around.reply, /car/i);
  assert.equal(around.task.constraints.arrival?.time, "09:00");
  assert.equal(around.task.constraints.dates?.start, "2026-11-18");
});

test("hospital, police, pharmacy and contact stay listings answers with no open plan", async () => {
  let task = (await runPlanAgent(
    [{ role: "user", content: "Do I need a 4x4?" }],
    null,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
  )).task;
  task = (await runPlanAgent(
    [{ role: "user", content: "Do I need a 4x4?" }],
    null,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
    task,
  )).task;
  assert.equal(task.objective, null);
  const hospital = await runPlanAgent(
    [{ role: "user", content: "hospital number" }],
    null,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
    task,
  );
  assert.equal(hospital.intent, "side_question");
  assert.equal(hospital.plan, null);
  assert.match(hospital.reply, /\+238 255 11 30/);
  assert.doesNotMatch(hospital.reply, /can't reach the model/);
  const police = await runPlanAgent(
    [{ role: "user", content: "police number" }],
    null,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
  );
  assert.match(police.reply, /\b132\b/);
  assert.equal(police.intent, "side_question");
  const pharmacy = await runPlanAgent(
    [{ role: "user", content: "where is a pharmacy" }],
    null,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
  );
  assert.match(pharmacy.reply, /pharmacy|farmácia|pharmacie/i);
  assert.equal(pharmacy.plan, null);
  const contact = await runPlanAgent(
    [{ role: "user", content: "who do I contact" }],
    null,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
  );
  assert.match(contact.reply, /255 11 30/);
  assert.equal(contact.intent, "side_question");
});

test("an open 18-20 plan already on the Wednesday ferry names that sailing without the model", async () => {
  const fetchImpl: typeof fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("schedules/boats")) return Response.json(LIVE_BOATS);
    if (url.includes("schedules/flights")) return Response.json(LIVE_FLIGHTS);
    return quietFetch()(input);
  }) as typeof fetch;
  const built = await runPlanAgent(
    [{ role: "user", content: "3 days, slow pace, renting a car, from 18 to 20 November" }],
    null,
    { model: bomb(), fetchImpl, now: TODAY },
  );
  assert.deepEqual(built.plan?.days.map((day) => day.date), ["2026-11-18", "2026-11-19", "2026-11-20"]);
  const asked = await runPlanAgent(
    [{ role: "user", content: "Is there a ferry on Wednesday?" }],
    built.plan,
    { model: bomb(), fetchImpl, now: TODAY },
    built.task,
  );
  const started = Date.now();
  const around = await runPlanAgent(
    [{ role: "user", content: "plan around that ferry" }],
    asked.plan ?? built.plan,
    { model: bomb(), fetchImpl, now: TODAY },
    asked.task,
  );
  assert.ok(Date.now() - started < 1_000, around.reply);
  assert.match(around.reply, /Plan starts Wed 18 Nov with the 07:00 ferry from Santiago, arriving around 09:00/);
  assert.doesNotMatch(around.reply, /is the arrival|now starts with that arrival/);
  assert.doesNotMatch(around.reply, /didn't change the plan/);
  assert.deepEqual(around.plan?.days.map((day) => day.date), ["2026-11-18", "2026-11-19", "2026-11-20"]);
  assert.equal(around.plan?.days[0]?.items.find((item) => item.kind === "transport")?.start, "09:00");
});

test("plan around that ferry names the departure and the estimated arrival in en, pt and fr", async () => {
  const cases = [
    ["en", "Is there a ferry on Wednesday?", "plan around that ferry", "Plan starts Wed 18 Nov with the 07:00 ferry from Santiago, arriving around 09:00."],
    ["pt", "barco quarta?", "apanhar esse ferry", "O plano começa qua 18 nov com o ferry das 07:00 de Santiago, a chegar por volta das 09:00."],
    ["fr", "ferry mercredi ?", "autour de ce ferry", "Le plan commence mer. 18 nov avec le ferry de 07:00 de Santiago, arrivant vers 09:00."],
  ] as const;
  for (const [locale, ask, follow, expected] of cases) {
    const plan = buildPlan({
      request: { startDate: "2026-11-16", days: 3, locale, adults: 2, kids: 0, hasCar: true, boatTrips: 0, pace: "slow" },
      forecast: [],
      sailings: [],
    });
    const task = refreshTask({
      ...emptyTask(locale),
      objective: plan.title,
      constraints: { dates: { start: "2026-11-16", days: 3 }, party: { adults: 2, kids: 0 }, car: true, pace: "slow" },
      completed: ["itinerary"],
    });
    const fetchImpl: typeof fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("schedules/boats")) return Response.json(LIVE_BOATS);
      if (url.includes("schedules/flights")) return Response.json(LIVE_FLIGHTS);
      return quietFetch()(input);
    }) as typeof fetch;
    const listed = await runPlanAgent(
      [{ role: "user", content: ask }],
      plan,
      { model: bomb(), fetchImpl, now: TODAY },
      task,
    );
    assert.equal(listed.plan, plan, listed.reply);
    const around = await runPlanAgent(
      [{ role: "user", content: follow }],
      listed.plan,
      { model: bomb(), fetchImpl, now: TODAY },
      listed.task,
    );
    assert.equal(around.reply, expected, `${locale}: ${around.reply}`);
    assert.equal(around.plan?.days[0]?.date, "2026-11-18");
    assert.equal(around.plan?.days[0]?.items.find((item) => item.kind === "transport")?.start, "09:00");
    assert.doesNotMatch(around.reply, /is the arrival|essa chegada|cette arrivée/);
  }
});

test("a setup that already names a rental car does not ask again", async () => {
  const phrases = [
    "slow pace, with a rental car, from 16 to 18 November",
    "slow pace, with a car, from 16 to 18 November",
    "ritmo calmo, com carro alugado, de 16 a 18 de novembro",
    "rythme lent, avec une voiture de location, du 16 au 18 novembre",
  ];
  for (const phrase of phrases) {
    const started = Date.now();
    const result = await runPlanAgent(
      [{ role: "user", content: phrase }],
      null,
      { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
    );
    assert.ok(Date.now() - started < 1_000, phrase);
    assert.equal(result.plan?.hasCar, true, result.reply);
    assert.doesNotMatch(result.reply, /Will you have a car|Vão ter carro|Vous aurez une voiture/i);
  }
});

test("plan around a ferry uses that sailing's arrival, not a 07:00 departure", async () => {
  const boats = {
    retrievedAt: "2026-11-15T12:00:00.000Z",
    schedules: [
      { date: "2026-11-18", from: "Santiago", to: "Maio", departure: "07:00", arrival: "10:30" },
      { date: "2026-11-18", from: "Maio", to: "Santiago", departure: "15:00", arrival: "18:00" },
    ],
  };
  const fetchImpl: typeof fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("schedules/boats")) return Response.json(boats);
    if (url.includes("schedules/flights")) return Response.json({ retrievedAt: boats.retrievedAt, routes: {}, upcoming: {} });
    return quietFetch()(input);
  }) as typeof fetch;
  const asked = await runPlanAgent(
    [{ role: "user", content: "Is there a ferry on Wednesday?" }],
    null,
    { model: bomb(), fetchImpl, now: TODAY },
  );
  assert.match(asked.reply, /10:30/);
  const started = Date.now();
  const around = await runPlanAgent(
    [{ role: "user", content: "plan around that ferry, with a car" }],
    null,
    { model: bomb(), fetchImpl, now: TODAY },
    asked.task,
  );
  assert.ok(Date.now() - started < 1_000, around.reply);
  const arrival = around.plan?.days[0]?.items.find((item) => item.kind === "transport");
  assert.equal(arrival?.start, "10:30", around.reply);
  assert.notEqual(arrival?.start, "07:00");
  assert.match(around.reply, /Plan starts Wed 18 Nov with the 07:00 ferry from Santiago, arriving at 10:30/);
  assert.doesNotMatch(around.reply, /around 10:30|is the arrival/);
});

test("oui on an open plan and a hospital lookup stay under the model budget", async () => {
  const hang = new MockLanguageModelV4({
    doGenerate: () => new Promise(() => {}),
  }) as unknown as LanguageModel;
  const built = await runPlanAgent(
    [{ role: "user", content: "3 days, slow pace, with a car, from 16 to 18 November" }],
    null,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
  );
  const ouiStarted = Date.now();
  const oui = await runPlanAgent(
    [{ role: "user", content: "bonjour" }, { role: "assistant", content: "Bonjour !" }, { role: "user", content: "oui" }],
    built.plan,
    { model: hang, fetchImpl: quietFetch(), now: TODAY },
    { ...built.task, locale: "fr" },
  );
  const ouiMs = Date.now() - ouiStarted;
  assert.ok(ouiMs < 1_000, `${ouiMs}ms ${oui.reply}`);
  const hello = "Bonjour ! Votre voyage de 3 jours est toujours là. Vous voulez changer quelque chose ?";
  assert.notEqual(oui.reply, hello);
  assert.match(oui.reply, /plus calme|sortie en bateau|décaler/i);
  assert.doesNotMatch(oui.reply, /est toujours là/);
  assert.ok(oui.chips.length >= 2 && oui.chips.length <= 3);
  assert.ok(oui.chips.every((chip) => oui.reply.toLowerCase().includes(chip.split(" ").slice(-2).join(" ").toLowerCase()) || /jour|bateau|jours/i.test(chip)));
  for (const [word, pattern] of [["yes", /calmer|boat trip|shift the dates/i], ["sim", /calmo|barco|datas/i]] as const) {
    const answer = await runPlanAgent(
      [{ role: "user", content: word }],
      built.plan,
      { model: hang, fetchImpl: quietFetch(), now: TODAY },
      { ...built.task, locale: word === "sim" ? "pt" : "en" },
    );
    assert.match(answer.reply, pattern, word);
    assert.notEqual(answer.reply, oui.reply);
    assert.ok(answer.chips.length >= 2 && answer.chips.length <= 3, word);
  }
  const hospitalStarted = Date.now();
  const hospital = await runPlanAgent(
    [{ role: "user", content: "what's the hospital number?" }],
    null,
    { model: hang, fetchImpl: quietFetch(), now: TODAY },
  );
  const hospitalMs = Date.now() - hospitalStarted;
  assert.ok(hospitalMs < 1_000, `${hospitalMs}ms`);
  assert.match(hospital.reply, /\+238 255 11 30/);
  const slowStarted = Date.now();
  const slow = await runPlanAgent(
    [{ role: "user", content: "Is the water warm in December?" }],
    null,
    { model: hang, fetchImpl: quietFetch(), now: TODAY },
  );
  const slowMs = Date.now() - slowStarted;
  assert.ok(slowMs < 5_000, `${slowMs}ms`);
  assert.ok(slowMs >= TURN_MODEL_MS - 500);
  assert.match(slow.reply, /listings|model/i);
});

test("a 4x4 question is answered from the listings", async () => {
  const started = Date.now();
  const result = await runPlanAgent(
    [{ role: "user", content: "Do I need a 4x4?" }],
    null,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
  );
  assert.ok(Date.now() - started < 4_000, result.reply);
  assert.match(result.reply, /Praia Real/);
  assert.match(result.reply, /Morrinho|Cadjetinha/);
  assert.match(result.reply, /dirt or sand/);
  assert.match(result.reply, /won't say a 4x4 is required/);
  assert.equal(result.plan, null);
});

test("a dirt-road question stays off the model", async () => {
  const result = await runPlanAgent(
    [{ role: "user", content: "Are the dirt roads bad?" }],
    null,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
  );
  assert.match(result.reply, /dirt or sand/);
  assert.equal(result.plan, null);
});

test("a side question whose model aborts still answers", async () => {
  const result = await runPlanAgent(
    [{ role: "user", content: "Is the water warm in December?" }],
    null,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
  );
  assert.match(result.reply, /listings/);
  assert.equal(result.plan, null);
});

for (const [phrase, pattern] of SIDES) {
  test(`side question stays off the model: ${phrase}`, async () => {
    const started = Date.now();
    const result = await runPlanAgent(
      [{ role: "user", content: phrase }],
      null,
      { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
    );
    assert.ok(Date.now() - started < 4_000, result.reply);
    assert.match(result.reply, pattern);
    assert.equal(result.plan, null);
    assert.equal(result.toolEvents.length, 0);
  });
}
