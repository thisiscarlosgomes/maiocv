import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { emptyTask, type Task } from "../lib/awareness/task.ts";
import { dailyForecastCached, loadDailyForecast } from "../lib/agora.ts";
import { runPlanAgent } from "../lib/plan-agent.ts";
import { isSeaForecastStatus, isPlacesStatus, loadingStatus, paceLines, planTurn, pushStatusPlay, readPlanEvents, startStatusPlay, STATUS_HOLD_MS, stepText, stepTexts, tickStatusPlay, turnWork, type PlanStep } from "../lib/plan-status.ts";
import { buildPlan } from "../lib/trip-planner.ts";
import { scriptedModel } from "./plan/mock-model.ts";

const TODAY = new Date("2026-11-15T12:00:00Z");
const SEA = /checking sea forecast|previsão do mar|prévision de la mer/i;
const FERRY = /checking ferries and flights|barcos e voos|ferries et des vols/i;

function quietFetch(): typeof fetch {
  return (async () => new Response("not found", { status: 404 })) as typeof fetch;
}

function bomb(): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => { throw new Error("model should not be called"); },
  }) as unknown as LanguageModel;
}

function withPlan(locale: "en" | "pt" | "fr"): Task {
  const task = emptyTask(locale);
  task.objective = "3 days on Maio";
  task.constraints = { dates: { start: "2026-11-16", days: 3 }, party: { adults: 2 }, car: true };
  task.lastPlaces = [{ id: "praia-bitche-rotcha", name: "Bitche Rotcha Beach", area: "Porto Inglês" }];
  task.completed = ["itinerary", "dates", "party", "car"];
  return task;
}

test("loading copy stays off the sea line unless that is the work", () => {
  for (const locale of ["en", "pt", "fr"] as const) {
    assert.equal(isSeaForecastStatus(loadingStatus(locale, "thinking")), false);
    assert.equal(isSeaForecastStatus(loadingStatus(locale, "moment")), false);
    assert.equal(isSeaForecastStatus(loadingStatus(locale, "places")), false);
    assert.equal(isSeaForecastStatus(loadingStatus(locale, "ferries")), false);
    assert.equal(isSeaForecastStatus(loadingStatus(locale, "forecast")), true);
    assert.equal(loadingStatus(locale, "none"), "");
  }
});

test("greetings, ordinals, hospital and phone questions do not predict a sea forecast", () => {
  const task = withPlan("en");
  const today = "2026-11-15";
  for (const text of ["hi", "hello", "the first one", "what's the hospital number", "phone number for Enzo Caffe Pizza"]) {
    const work = turnWork(text, task, today);
    assert.equal(isSeaForecastStatus(loadingStatus("en", work)), false, text);
    assert.notEqual(work, "ferries", text);
  }
  assert.equal(turnWork("phone number for Enzo Caffe Pizza", task, today), "places");
  assert.equal(turnWork("when is the next ferry to Praia", task, today), "ferries");
  assert.equal(turnWork("3 days, slow pace, with a car", emptyTask("en"), today), "forecast");
});

test("hi, the first one, and the hospital never emit the sea-forecast status", async () => {
  const task = withPlan("en");
  for (const text of ["hi", "the first one", "what's the hospital number"]) {
    const result = await runPlanAgent([{ role: "user", content: text }], null, { model: bomb(), fetchImpl: quietFetch(), now: TODAY }, task);
    assert.doesNotMatch(result.status, SEA, `${text}: ${result.status}`);
    assert.doesNotMatch(result.status, FERRY, text);
    assert.equal(result.task.objective, task.objective);
  }
  const phone = await runPlanAgent(
    [{ role: "user", content: "phone number for Enzo Caffe Pizza" }],
    null,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
    task,
  );
  assert.doesNotMatch(phone.status, SEA);
  assert.match(phone.status, /Looking that up/);
  assert.deepEqual(phone.steps, [phone.status]);
});

test("a plan turn may say it is checking the sea", async () => {
  const task = emptyTask("en");
  task.constraints = { car: true };
  const result = await runPlanAgent(
    [{ role: "user", content: "3 days, slow pace, with a car" }],
    null,
    { model: scriptedModel([[{ tool: "propose_itinerary", input: { startDate: "2026-11-16", days: 3, locale: "en", adults: 2, hasCar: true, boatTrips: 0, pace: "slow" } }]], "Here is the plan."), fetchImpl: quietFetch(), now: TODAY },
    task,
  );
  assert.ok(result.steps.some((line) => SEA.test(line)), result.steps.join(" | "));
  assert.equal(result.steps.at(-1), "Finalizing…");
  assert.ok(result.plan);
});

const IDS = (steps: PlanStep[]) => steps.map((step) => step.id);

test("turn type picks only the steps that turn will run", () => {
  const today = "2026-11-15";
  const task = withPlan("en");
  const built = buildPlan({
    request: { startDate: "2026-11-16", days: 3, locale: "en", adults: 2, hasCar: true, boatTrips: 0, pace: "slow" },
    forecast: ["2026-11-16", "2026-11-17", "2026-11-18"].map((date) => ({ date, waveHeightM: 0.8, windKmh: 16, tempMaxC: 28, sunset: "18:10" })),
    sailings: [],
  });
  const build = planTurn("3 days, slow pace, with a car", emptyTask("en"), today);
  assert.deepEqual(IDS(build.steps), ["understand", "forecast", "build", "finalize"]);
  assert.equal(build.pace, false);
  const cached = planTurn("3 days, slow pace, with a car", emptyTask("en"), today, { refetchForecast: false });
  assert.deepEqual(IDS(cached.steps), ["understand", "places", "build", "finalize"]);
  assert.equal(isSeaForecastStatus(stepText("en", cached.steps[1])), false);

  const relax = planTurn("Make day 2 more relaxed", task, today, { hasPlan: true, plan: built });
  assert.deepEqual(IDS(relax.steps), ["read", "update", "finalize"]);
  assert.equal(relax.steps[1].day, 2);
  assert.equal(relax.pace, true);
  assert.equal(relax.steps.some((step) => step.id === "forecast"), false);

  const beach = planTurn("replace the beach on day 1", task, today, { hasPlan: true, plan: built });
  assert.deepEqual(IDS(beach.steps), ["read", "update", "finalize"]);
  assert.equal(beach.steps[1].day, 1);
  assert.equal(beach.pace, true);

  const shift = planTurn("going on the 18th", task, today, { hasPlan: true, plan: built });
  assert.deepEqual(IDS(shift.steps), ["read", "update", "finalize"]);
  assert.equal(shift.steps[1].dates, true);
  assert.equal(shift.pace, false);
  const shiftFetch = planTurn("going on the 18th", task, today, { hasPlan: true, plan: built, refetchForecast: true });
  assert.deepEqual(IDS(shiftFetch.steps), ["read", "forecast", "update", "finalize"]);

  assert.deepEqual(planTurn("hi", task, today).steps, []);
  assert.deepEqual(planTurn("Export as PDF", task, today, { hasPlan: true, plan: built }).steps, []);
  assert.deepEqual(IDS(planTurn("when is the next ferry to Praia", task, today).steps), ["ferries"]);
  assert.deepEqual(IDS(planTurn("Flights from Maio on Wednesday", task, today).steps), ["flights"]);
  assert.deepEqual(IDS(planTurn("phone number for Enzo Caffe Pizza", task, today).steps), ["lookup"]);
  assert.deepEqual(IDS(planTurn("what's the hospital number", task, today).steps), ["lookup"]);
  assert.equal(planTurn("the first one", task, today, { hasPlan: true, plan: built }).steps.some((step) => step.id === "forecast"), false);
});

test("status copy is short, in all three languages, and the sea line stays on the forecast step", () => {
  const steps: PlanStep[] = [
    { id: "understand" }, { id: "read" }, { id: "forecast" }, { id: "places" }, { id: "build" },
    { id: "update", day: 2 }, { id: "update", dates: true }, { id: "lookup" }, { id: "ferries" }, { id: "flights" }, { id: "finalize" },
  ];
  for (const locale of ["en", "pt", "fr"] as const) {
    for (const step of steps) {
      const text = stepText(locale, step);
      assert.ok(text.length > 0 && text.length < 48, `${locale} ${step.id}: ${text}`);
      assert.equal(isSeaForecastStatus(text), step.id === "forecast", text);
    }
    assert.equal(isPlacesStatus(stepText(locale, { id: "places" })), true);
  }
  assert.equal(stepText("en", { id: "update", day: 2 }), "Updating day 2…");
  assert.equal(stepText("pt", { id: "update", dates: true }), "A atualizar as datas…");
  assert.equal(stepText("fr", { id: "read" }), "Je lis le changement…");
});

test("the client holds each line and jumps to the latest server line", () => {
  const relax = paceLines("en", planTurn("Make day 2 more relaxed", withPlan("en"), "2026-11-15", { hasPlan: true }));
  assert.deepEqual(relax.lines, ["Reading your change…", "Updating day 2…", "Finalizing…"]);
  assert.equal(relax.blocked, false);
  let play = startStatusPlay(relax.lines, relax.blocked, 0);
  assert.equal(tickStatusPlay(play, STATUS_HOLD_MS - 1).label, "Reading your change…");
  play = tickStatusPlay(play, STATUS_HOLD_MS);
  assert.equal(play.label, "Updating day 2…");
  play = tickStatusPlay(play, STATUS_HOLD_MS * 2);
  assert.equal(play.label, "Finalizing…");
  play = tickStatusPlay(play, STATUS_HOLD_MS * 3);
  assert.equal(play.label, "Finalizing…");

  const build = paceLines("en", planTurn("3 days, slow pace, with a car", emptyTask("en"), "2026-11-15"));
  assert.deepEqual(build.lines, ["Understanding your trip…"]);
  let slow = startStatusPlay(build.lines, build.blocked, 0);
  slow = pushStatusPlay(slow, "Checking sea forecast and places…", 30);
  slow = pushStatusPlay(slow, "Building your plan…", 50);
  slow = pushStatusPlay(slow, "Finalizing…", 70);
  assert.equal(slow.label, "Understanding your trip…");
  slow = tickStatusPlay(slow, STATUS_HOLD_MS);
  assert.equal(slow.label, "Finalizing…");

  let fetch = startStatusPlay(["Reading your change…"], true, 0);
  fetch = pushStatusPlay(fetch, "Checking sea forecast and places…", 40);
  fetch = tickStatusPlay(fetch, STATUS_HOLD_MS);
  assert.equal(fetch.label, "Checking sea forecast and places…");
  assert.equal(tickStatusPlay(fetch, STATUS_HOLD_MS * 3).label, "Checking sea forecast and places…");
  fetch = pushStatusPlay(fetch, "Updating your dates…", STATUS_HOLD_MS + 10);
  assert.equal(fetch.label, "Checking sea forecast and places…");
  fetch = tickStatusPlay(fetch, STATUS_HOLD_MS * 2);
  assert.equal(fetch.label, "Updating your dates…");
});

test("a stream of status events is readable, and a json body still parses", async () => {
  const encoder = new TextEncoder();
  const lines = [
    JSON.stringify({ type: "status", text: "Understanding your trip…" }),
    JSON.stringify({ type: "status", text: "Checking sea forecast and places…" }),
    JSON.stringify({ type: "result", reply: "Done.", plan: null, steps: ["Understanding your trip…", "Checking sea forecast and places…", "Finalizing…"] }),
  ];
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`${lines[0]}\n${lines[1]}\n`));
      controller.enqueue(encoder.encode(lines[2]));
      controller.close();
    },
  });
  const seen: string[] = [];
  const body = await readPlanEvents(new Response(stream, { headers: { "content-type": "application/x-ndjson" } }), (text) => seen.push(text));
  assert.deepEqual(seen, ["Understanding your trip…", "Checking sea forecast and places…"]);
  assert.equal(body.reply, "Done.");

  const json = await readPlanEvents(Response.json({ reply: "Ok.", status: "" }), () => { throw new Error("no status on a finished body"); });
  assert.equal(json.reply, "Ok.");
});

function seaFetch(dates: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("marine-api.open-meteo.com")) {
      return Response.json({ daily: { time: dates, wave_height_max: dates.map(() => 0.8) } });
    }
    if (url.includes("api.open-meteo.com")) {
      return Response.json({
        daily: {
          time: dates,
          wind_speed_10m_max: dates.map(() => 12),
          temperature_2m_max: dates.map(() => 28),
          sunset: dates.map((date) => `${date}T18:10`),
        },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

test("a relax edit never says it is checking the sea, and a cached date move skips it too", async () => {
  const built = buildPlan({
    request: { startDate: "2026-11-16", days: 4, locale: "en", adults: 2, hasCar: true, boatTrips: 0, pace: "slow" },
    forecast: ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"].map((date) => ({ date, waveHeightM: 0.8, windKmh: 16, tempMaxC: 28, sunset: "18:10" })),
    sailings: [],
  });
  const task = withPlan("en");
  task.constraints.dates = { start: "2026-11-16", days: 4 };
  const heard: string[] = [];
  const relax = await runPlanAgent(
    [{ role: "user", content: "Make day 2 more relaxed" }],
    built,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY, onStatus: (text) => { heard.push(text); throw new Error("status must not fail the turn"); } },
    task,
  );
  assert.deepEqual(relax.steps, stepTexts("en", planTurn("Make day 2 more relaxed", task, "2026-11-15", { hasPlan: true, plan: built }).steps));
  assert.equal(relax.steps.some((line) => isSeaForecastStatus(line)), false);
  assert.deepEqual(heard, relax.steps);

  const live = seaFetch(["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"]);
  await loadDailyForecast(live, "2026-11-18", 4);
  assert.equal(dailyForecastCached(live, "2026-11-18", 4), true);
  const shifted = await runPlanAgent(
    [{ role: "user", content: "going on the 18th" }],
    built,
    { model: bomb(), fetchImpl: live, now: TODAY },
    task,
  );
  assert.equal(shifted.plan?.days[0]?.date, "2026-11-18");
  assert.equal(shifted.steps.some((line) => isSeaForecastStatus(line)), false, shifted.steps.join(" | "));
  assert.ok(shifted.steps.includes("Updating your dates…"), shifted.steps.join(" | "));

  const cold = await runPlanAgent(
    [{ role: "user", content: "going on the 18th" }],
    built,
    { model: bomb(), fetchImpl: seaFetch(["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"]), now: TODAY },
    task,
  );
  assert.ok(cold.steps.some((line) => isSeaForecastStatus(line)), cold.steps.join(" | "));
  assert.deepEqual(cold.steps, stepTexts("en", planTurn("going on the 18th", task, "2026-11-15", { hasPlan: true, plan: built, refetchForecast: true }).steps));
});

test("a cached forecast build says it is checking places", async () => {
  const dates = ["2026-11-16", "2026-11-17", "2026-11-18"];
  const fetchImpl = seaFetch(dates);
  await loadDailyForecast(fetchImpl, "2026-11-16", 3);
  const task = emptyTask("en");
  task.constraints = { car: true };
  const result = await runPlanAgent(
    [{ role: "user", content: "3 days, slow pace, with a car" }],
    null,
    { model: bomb(), fetchImpl, now: TODAY },
    task,
  );
  assert.equal(result.steps.some((line) => isSeaForecastStatus(line)), false, result.steps.join(" | "));
  assert.ok(result.steps.some((line) => isPlacesStatus(line)), result.steps.join(" | "));
  assert.deepEqual(result.steps, stepTexts("en", planTurn("3 days, slow pace, with a car", task, "2026-11-15", { refetchForecast: false }).steps));
});

test("a greeting emits no status line", async () => {
  const result = await runPlanAgent(
    [{ role: "user", content: "hi" }],
    null,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
    emptyTask("en"),
  );
  assert.deepEqual(result.steps, []);
  assert.equal(result.status, "");
});
