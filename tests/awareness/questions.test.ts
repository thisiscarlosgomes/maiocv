// Visitor, planning and on-island questions. The agent must not answer with a lone place
// or a capability menu. Greetings stay short. The exact production miss is included.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { runPlanAgent, type PlanAgentResult } from "../../lib/plan-agent.ts";
import { classify } from "../../lib/awareness/classify.ts";
import { resolveReference } from "../../lib/awareness/context.ts";
import { emptyTask, type Task } from "../../lib/awareness/task.ts";
import type { TripPlan } from "../../lib/trip.ts";
import { buildPlan } from "../../lib/trip-planner.ts";
import { scriptedModel } from "../plan/mock-model.ts";

const TODAY = new Date("2026-11-15T12:00:00Z");

function quietFetch(): typeof fetch {
  return (async () => new Response("not found", { status: 404 })) as typeof fetch;
}

function bomb(): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => { throw new Error("model should not be called"); },
  }) as unknown as LanguageModel;
}

const forecast = [
  { date: "2026-11-16", waveHeightM: 0.8, windKmh: 16, tempMaxC: 28, sunset: "18:10" },
  { date: "2026-11-17", waveHeightM: 0.7, windKmh: 14, tempMaxC: 28, sunset: "18:10" },
  { date: "2026-11-18", waveHeightM: 0.9, windKmh: 18, tempMaxC: 27, sunset: "18:09" },
];

function activePlan(locale: "en" | "pt" | "fr" = "en"): { plan: TripPlan; task: Task } {
  const plan = buildPlan({ request: { startDate: "2026-11-16", days: 3, locale, adults: 2, hasCar: false, boatTrips: 0, pace: "slow" }, forecast, sailings: [] });
  const task = emptyTask(locale);
  task.objective = plan.title;
  task.constraints = { dates: { start: "2026-11-16", days: 3 }, party: { adults: 2, kids: 0 }, car: false, pace: "slow" };
  task.lastPlaces = plan.days.flatMap((day) => day.items).flatMap((item) => {
    if (item.kind !== "place" && item.kind !== "food") return [];
    return [{ id: item.refId, name: item.refId, area: "Maio" }];
  }).slice(0, 4);
  return { plan, task };
}

function assertGuestReply(reply: string, opts: { min?: number; max?: number } = {}) {
  assert.ok(reply.trim().length >= (opts.min ?? 4), reply);
  if (opts.max) assert.ok(reply.length <= opts.max, reply);
  assert.doesNotMatch(reply, /^That is .+\.$/);
  assert.doesNotMatch(reply, /options i can|finish the full day-by-day|what would you like next/i);
  assert.doesNotMatch(reply, /food listing|\(id\s|we list that by id|blue-[a-z0-9-]+/i);
  assert.doesNotMatch(reply, /\b20\d{2}-\d{2}-\d{2}\b/);
}

async function ask(content: string, opts: { task?: Task | null; plan?: TripPlan | null; skipModel?: boolean; reply?: string } = {}): Promise<PlanAgentResult> {
  const model = opts.skipModel ? bomb() : scriptedModel([], opts.reply ?? "Maio is a quiet island with long beaches.");
  return runPlanAgent(
    [{ role: "user", content }],
    opts.plan ?? null,
    { model, fetchImpl: quietFetch(), now: TODAY },
    opts.task ?? null,
  );
}

const CASES: { locale: "en" | "pt" | "fr"; q: string; kind: "greet" | "island" | "service" }[] = [
  { locale: "en", q: "hi", kind: "greet" },
  { locale: "en", q: "hello", kind: "greet" },
  { locale: "en", q: "thanks", kind: "greet" },
  { locale: "en", q: "ok", kind: "greet" },
  { locale: "pt", q: "olá", kind: "greet" },
  { locale: "pt", q: "obrigado", kind: "greet" },
  { locale: "fr", q: "bonjour", kind: "greet" },
  { locale: "fr", q: "merci", kind: "greet" },
  { locale: "en", q: "what can you tell me about maio first", kind: "island" },
  { locale: "en", q: "tell me about Maio", kind: "island" },
  { locale: "en", q: "what is Maio like", kind: "island" },
  { locale: "en", q: "is it safe", kind: "island" },
  { locale: "en", q: "best beaches", kind: "island" },
  { locale: "en", q: "where should we eat", kind: "island" },
  { locale: "en", q: "how do we get around without a car", kind: "island" },
  { locale: "pt", q: "o que me podes dizer sobre o Maio", kind: "island" },
  { locale: "pt", q: "como é o Maio", kind: "island" },
  { locale: "pt", q: "é seguro", kind: "island" },
  { locale: "pt", q: "melhores praias", kind: "island" },
  { locale: "pt", q: "onde comer", kind: "island" },
  { locale: "fr", q: "parle-moi de Maio", kind: "island" },
  { locale: "fr", q: "c'est comment Maio", kind: "island" },
  { locale: "fr", q: "est-ce sûr", kind: "island" },
  { locale: "fr", q: "meilleures plages", kind: "island" },
  { locale: "fr", q: "où manger", kind: "island" },
  { locale: "en", q: "where is a pharmacy", kind: "service" },
  { locale: "en", q: "is there an ATM", kind: "service" },
  { locale: "pt", q: "há uma farmácia", kind: "service" },
  { locale: "fr", q: "où est la pharmacie", kind: "service" },
  { locale: "en", q: "what was Maio's 2024 guest count?", kind: "island" },
];

test("ordinals stay short pointers and do not swallow an open question", () => {
  const places = [{ id: "enzo", name: "Enzo Caffe Pizza", area: "Vila" }];
  assert.equal(resolveReference("what can you tell me about maio first", places).kind, null);
  assert.equal(resolveReference("tell me about the island first", places).kind, null);
  assert.equal(resolveReference("the first one", places).place?.id, "enzo");
  assert.equal(resolveReference("o primeiro", places).place?.id, "enzo");
  assert.equal(resolveReference("le premier", places).place?.id, "enzo");
  assert.equal(resolveReference("that one", places).kind, "that-one");
  const task = emptyTask("en");
  task.objective = "3 days on Maio";
  task.lastPlaces = places;
  assert.equal(classify("what can you tell me about maio first", task, { today: "2026-11-15" }).intent, "side_question");
  assert.equal(classify("hi", task, { today: "2026-11-15" }).smallTalk, true);
  assert.equal(classify("hi", task, { today: "2026-11-15" }).intent, "side_question");
});

test("greetings with and without a plan stay one short line in EN, PT and FR", async () => {
  for (const locale of ["en", "pt", "fr"] as const) {
    const hello = locale === "pt" ? "olá" : locale === "fr" ? "bonjour" : "hi";
    const bare = await ask(hello, { task: emptyTask(locale), skipModel: true });
    assert.equal(bare.intent, "side_question");
    assert.equal(bare.task.objective, null);
    assert.deepEqual(bare.chips, []);
    assertGuestReply(bare.reply, { max: 180 });
    assert.ok((bare.reply.match(/[.!?]/g) ?? []).length <= 2, bare.reply);
    const { plan, task } = activePlan(locale);
    const withPlan = await ask(hello, { task, plan, skipModel: true });
    assert.equal(withPlan.intent, "side_question");
    assert.equal(withPlan.task.objective, task.objective);
    assert.equal(withPlan.task.constraints.dates?.start, "2026-11-16");
    assert.equal(withPlan.plan, plan);
    assert.deepEqual(withPlan.chips, []);
    assertGuestReply(withPlan.reply, { max: 220 });
    assert.match(withPlan.reply, locale === "pt" ? /3 dias/ : locale === "fr" ? /3 jours/ : /3-day/);
    assert.doesNotMatch(withPlan.reply, /unfinished|options i can|08:10/i);
  }
});

for (const item of CASES) {
  test(`${item.locale} ${item.kind}: ${item.q}`, async () => {
    const { plan, task } = activePlan(item.locale);
    const research = /guest count|visitantes|visiteurs/.test(item.q);
    const result = await ask(item.q, { task, plan, skipModel: !research });
    if (item.kind === "greet") {
      assert.equal(result.intent, "side_question");
      assert.equal(result.plan, plan);
      assert.equal(result.task.constraints.dates?.start, task.constraints.dates?.start);
      assert.deepEqual(result.chips, []);
      assertGuestReply(result.reply, { max: 220 });
      return;
    }
    if (research) {
      assert.equal(result.intent, "new_objective");
      assert.match(result.reply, /won't guess|não vou inventar|n'en invente pas|n'ai pas/i);
      assert.doesNotMatch(result.reply, /\b\d{3,}\b/);
      return;
    }
    assert.equal(result.intent, "side_question", result.reply);
    assert.equal(result.plan, plan);
    assert.equal(result.task.objective, task.objective);
    assert.equal(result.task.constraints.dates?.start, "2026-11-16");
    assert.ok(result.chips.length <= 2);
    assert.ok(result.chips.every((chip) => !/leave|partem|partez/i.test(chip)));
    assertGuestReply(result.reply, { min: 40 });
    assert.ok(result.reply.split(/[.!?]/).filter((part) => part.trim()).length >= 2, result.reply);
    assert.doesNotMatch(result.reply, /^That is /);
  });
}

test("the first one after a saved list names that place and keeps the trip", async () => {
  const { plan, task } = activePlan();
  task.lastPlaces = [
    { id: "praia-bitche-rotcha", name: "Bitche Rotcha Beach", area: "Porto Inglês" },
    { id: "praia-do-morro", name: "Morro Beach", area: "Morro" },
  ];
  const result = await ask("the first one", { task, plan, skipModel: true });
  assert.equal(result.intent, "side_question");
  assert.match(result.reply, /Bitche Rotcha/);
  assert.equal(result.plan, plan);
  assert.equal(result.task.constraints.dates?.start, "2026-11-16");
  assert.doesNotMatch(result.reply, /options i can/i);
});

test("a dumped model itinerary is rewritten with human dates and no ids", async () => {
  const dump = "Overview - Length: 3 days - Pace: slow Day 1 — 2026-11-16 - 08:10 — Breakfast: Cafe (food listing) - 09:00 — Experience: Rental Quad (id blue-rental-quad-big-game)";
  const result = await ask("3 days, slow pace", {
    reply: dump,
    task: null,
  });
  // The scripted model is only reached when this is a plan, not a side question.
  assert.ok(result.plan);
  assert.match(result.reply, /\n/);
  assert.match(result.reply, /## Day 1 — /);
  assert.doesNotMatch(result.reply, /blue-rental|food listing|\d{4}-\d{2}-\d{2}/);
  assert.equal(result.task.constraints.pace, "slow");
  assert.equal(result.task.constraints.dates?.days, 3);
});
