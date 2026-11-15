import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { emptyTask, type Task } from "../lib/awareness/task.ts";
import { runPlanAgent } from "../lib/plan-agent.ts";
import { isSeaForecastStatus, loadingStatus, turnWork } from "../lib/plan-status.ts";
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
  assert.match(phone.status, /Looking up places/);
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
  assert.match(result.status, SEA);
  assert.ok(result.plan);
});
