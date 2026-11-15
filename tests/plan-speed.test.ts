// Ordinary plan builds and listed side questions must not call the planner model.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { runPlanAgent } from "../lib/plan-agent.ts";
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
  assert.equal(built.plan?.days[0]?.items.find((item) => item.kind === "transport")?.start, "07:00");
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
