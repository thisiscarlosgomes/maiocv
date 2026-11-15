// A new start keeps the length, and a reply that claims a move must bring a new plan.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { emptyTask, followUpChips, refreshTask, type Task } from "../lib/awareness/task.ts";
import { runPlanAgent } from "../lib/plan-agent.ts";
import { claimsUnappliedEdit } from "../lib/plan-router.ts";
import { buildPlan } from "../lib/trip-planner.ts";
import { planStrings } from "../lib/trip-strings.ts";
import type { TripPlan } from "../lib/trip.ts";
import { scriptedModel } from "./plan/mock-model.ts";

const TODAY = new Date("2026-11-15T12:00:00Z");
const forecast = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"].map((date) => ({
  date, waveHeightM: 0.8, windKmh: 16, tempMaxC: 28, sunset: "18:10",
}));

function bomb(): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => { throw new Error("model should not be called"); },
  }) as unknown as LanguageModel;
}

function quietFetch(): typeof fetch {
  return (async () => new Response("not found", { status: 404 })) as typeof fetch;
}

function fourDays(locale: "en" | "pt" | "fr" = "en"): { plan: TripPlan; task: Task } {
  const plan = buildPlan({
    request: { startDate: "2026-11-16", days: 4, locale, adults: 2, hasCar: false, boatTrips: 0, pace: "slow" },
    forecast, sailings: [],
  });
  const task = refreshTask({
    ...emptyTask(locale),
    objective: plan.title,
    constraints: { dates: { start: "2026-11-16", days: 4 }, party: { adults: 2, kids: 0 }, car: false, pace: "slow" },
    completed: ["itinerary"],
  });
  return { plan, task };
}

function cardWouldShow(before: TripPlan, after: TripPlan | null): boolean {
  return JSON.stringify(after) !== JSON.stringify(before);
}

const STARTS = [
  "ok am actually going on the 18th",
  "am actually going on the 18th",
  "going on the 18th",
  "arriving the 18th",
  "we land on the 18th",
  "actually the 18th",
  "chego dia 18",
  "vou a 18",
  "j'arrive le 18",
  "finalement le 18",
];

for (const phrase of STARTS) {
  test(`start shift keeps 4 days: ${phrase}`, async () => {
    const { plan, task } = fourDays();
    const result = await runPlanAgent(
      [{ role: "user", content: phrase }],
      plan,
      { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
      task,
    );
    assert.deepEqual(result.plan?.days.map((day) => day.date), ["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"], result.reply);
    assert.equal(result.plan?.hasCar, false);
    assert.equal(result.task.constraints.dates?.start, "2026-11-18");
    assert.equal(result.task.constraints.dates?.days, 4);
    assert.match(result.reply, /18/);
    assert.match(result.reply, /21/);
    assert.equal(cardWouldShow(plan, result.plan), true);
    assert.equal(claimsUnappliedEdit(result.reply), true, result.reply);
    assert.doesNotMatch(result.reply, /I didn't change|Não alterei|n'ai pas modifié/);
  });
}

test("a day later, push it 2 days, and next week keep the length", async () => {
  const cases = [
    ["a day later", ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]],
    ["push it 2 days", ["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"]],
    ["next week", ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"]],
  ] as const;
  for (const [phrase, dates] of cases) {
    const { plan, task } = fourDays();
    const result = await runPlanAgent(
      [{ role: "user", content: phrase }],
      plan,
      { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
      task,
    );
    assert.deepEqual(result.plan?.days.map((day) => day.date), [...dates], `${phrase} ${result.reply}`);
    assert.equal(cardWouldShow(plan, result.plan), claimsUnappliedEdit(result.reply));
  }
});

test("an end date alone keeps the start and changes the length", async () => {
  const { plan, task } = fourDays();
  const result = await runPlanAgent(
    [{ role: "user", content: "until the 21st" }],
    plan,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
    task,
  );
  assert.equal(result.plan?.days[0].date, "2026-11-16");
  assert.equal(result.plan?.days.at(-1)?.date, "2026-11-21");
  assert.equal(result.plan?.days.length, 6);
  assert.equal(cardWouldShow(plan, result.plan), true);
});

test("a claimed move with no date intent is replaced and does not show a new plan", async () => {
  const { plan, task } = fourDays();
  const result = await runPlanAgent(
    [{ role: "user", content: "tell me a joke" }],
    plan,
    { model: scriptedModel([], "All set — I've moved your 4-day slow-paced trip to start on Wed 18 Nov."), fetchImpl: quietFetch(), now: TODAY },
    task,
  );
  assert.equal(result.plan, plan);
  assert.equal(cardWouldShow(plan, result.plan), false);
  assert.doesNotMatch(result.reply, /moved|all set|Done/i);
  assert.match(result.reply, /didn't change/);
});

test("show me the best beaches is a guest chip and does not change the plan", async () => {
  assert.ok(followUpChips(emptyTask("en")).includes("Show me the best beaches"));
  assert.ok(followUpChips(emptyTask("pt")).includes("Mostra-me as melhores praias"));
  assert.ok(followUpChips(emptyTask("fr")).includes("Montre-moi les meilleures plages"));
  assert.equal(planStrings.en.startChips[2], "Show me the best beaches");
  const { plan, task } = fourDays();
  const result = await runPlanAgent(
    [{ role: "user", content: "Show me the best beaches" }],
    plan,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
    task,
  );
  assert.equal(result.plan, plan);
  assert.match(result.reply, /beach/i);
  assert.equal(claimsUnappliedEdit(result.reply), false);
});

test("export as pdf does not call the model", async () => {
  const { plan, task } = fourDays();
  const result = await runPlanAgent(
    [{ role: "user", content: "Export as PDF" }],
    plan,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
    task,
  );
  assert.equal(result.plan, plan);
  assert.match(result.reply, /PDF|pdf|print|impress/i);
  assert.equal(claimsUnappliedEdit(result.reply), false);
});
