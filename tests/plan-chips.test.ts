import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { classify } from "../lib/awareness/classify.ts";
import { emptyTask, followUpChips, refreshTask, type Task } from "../lib/awareness/task.ts";
import { runPlanAgent } from "../lib/plan-agent.ts";
import { keepAssistantReply, visibleStopCount, visibleStops } from "../lib/plan-edits.ts";
import { buildPlan } from "../lib/trip-planner.ts";
import type { TripPlan } from "../lib/trip.ts";

const TODAY = new Date("2026-11-15T12:00:00Z");
const forecast = ["2026-11-16", "2026-11-17", "2026-11-18"].map((date) => ({ date, waveHeightM: 0.8, windKmh: 16, tempMaxC: 28, sunset: "18:10" }));

function quietFetch(): typeof fetch {
  return (async () => new Response("not found", { status: 404 })) as typeof fetch;
}

function bomb(): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => { throw new Error("model should not be called"); },
  }) as unknown as LanguageModel;
}

function planned(locale: "en" | "pt" | "fr"): { plan: TripPlan; task: Task } {
  const plan = buildPlan({ request: { startDate: "2026-11-16", days: 3, locale, adults: 2, hasCar: true, boatTrips: 0, pace: "slow" }, forecast, sailings: [] });
  const task = refreshTask({
    ...emptyTask(locale),
    objective: plan.title,
    constraints: { dates: { start: "2026-11-16", days: 3 }, party: { adults: 2, kids: 0 }, car: true, pace: "slow" },
    completed: ["itinerary"],
  });
  return { plan, task };
}

const RELAX = { en: "Make day 2 more relaxed", pt: "Deixa o dia 2 mais calmo", fr: "Rends le jour 2 plus calme" };
const BOAT = { en: "Add a boat trip", pt: "Acrescenta um passeio de barco", fr: "Ajoute une sortie en bateau" };
const PDF = { en: "Export as PDF", pt: "Exportar em PDF", fr: "Exporter en PDF" };

test("correction chips are not a new trip", () => {
  const task = planned("en").task;
  for (const text of [RELAX.en, BOAT.en, PDF.en, RELAX.pt, BOAT.fr]) {
    const result = classify(text, task, { today: "2026-11-15" });
    assert.equal(result.intent, "correction", text);
    assert.equal(result.planShaping, false, text);
    assert.ok(result.chip, text);
  }
  assert.deepEqual(classify(RELAX.en, task, { today: "2026-11-15" }).chip, { kind: "relax", day: 2 });
});

test("an identical reply is not appended when the card did not change", () => {
  assert.equal(keepAssistantReply("Slow 3 days with a car.", "Slow 3 days with a car.", false), false);
  assert.equal(keepAssistantReply("Slow 3 days with a car.", "Day 2 is lighter now.", false), true);
  assert.equal(keepAssistantReply("Slow 3 days with a car.", "Slow 3 days with a car.", true), true);
});

test("the open trip view no longer offers a day map link", () => {
  const source = readFileSync(new URL("../components/plan/planner.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /viewDayMap|plan-daymap|View day on map|Ver o dia no mapa|Voir la journée sur la carte/);
  const strings = readFileSync(new URL("../lib/trip-strings.ts", import.meta.url), "utf8");
  assert.doesNotMatch(strings, /View day on map|Ver o dia no mapa|Voir la journée sur la carte/);
});

for (const locale of ["en", "pt", "fr"] as const) {
  test(`${locale} make day 2 more relaxed drops that day only`, async () => {
    const { plan, task } = planned(locale);
    const before = visibleStops(plan.days[1].items);
    const result = await runPlanAgent(
      [{ role: "user", content: RELAX[locale] }],
      plan,
      { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
      task,
    );
    assert.ok(result.plan);
    assert.ok(visibleStops(result.plan.days[1].items) < before, `${before} -> ${visibleStops(result.plan.days[1].items)}`);
    assert.deepEqual(result.plan.days[0].items, plan.days[0].items);
    assert.deepEqual(result.plan.days[2].items, plan.days[2].items);
    assert.match(result.reply, locale === "pt" ? /mais leve/ : locale === "fr" ? /plus léger/ : /lighter now/);
    assert.match(result.reply, locale === "pt" ? /tarde longa livre/ : locale === "fr" ? /après-midi libre/ : /afternoon free/);
    assert.doesNotMatch(result.reply, /Tap the card|Toque no cartão|Touchez la carte/);
    assert.ok(result.chips.every((chip) => !/day 2|dia 2|jour 2/i.test(chip)), result.chips.join(" | "));
    assert.ok(result.chips.some((chip) => /day 3|dia 3|jour 3|beach|praia|plage/i.test(chip)), result.chips.join(" | "));
    assert.doesNotMatch(result.status, /sea forecast|previsão do mar|prévision de la mer/i);
  });

  test(`${locale} add a boat trip uses the listing or says it is missing`, async () => {
    const { plan, task } = planned(locale);
    const result = await runPlanAgent(
      [{ role: "user", content: BOAT[locale] }],
      plan,
      { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
      task,
    );
    assert.ok(result.plan);
    const boat = result.plan.days.flatMap((day) => day.items).find((item) => item.refId === "blue-sport-fishing-big-game");
    assert.ok(boat, result.reply);
    assert.match(result.reply, /Sport Fishing/);
    assert.doesNotMatch(result.reply, /Tap the card|Toque no cartão|Touchez la carte/);
    assert.ok(result.chips.every((chip) => !/boat trip|passeio de barco|sortie en bateau/i.test(chip)), result.chips.join(" | "));
    assert.ok(visibleStopCount(result.plan) >= visibleStopCount(plan) - 1);
  });

  test(`${locale} export as pdf does not rebuild the plan`, async () => {
    const { plan, task } = planned(locale);
    const result = await runPlanAgent(
      [{ role: "user", content: PDF[locale] }],
      plan,
      { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
      task,
    );
    assert.equal(result.plan, plan);
    assert.match(result.reply, /PDF|pdf|impressão|impression/i);
    assert.doesNotMatch(result.reply, /Use Export|Utilize Exporter|Utilisez Exporter/i);
    assert.ok(result.chips.every((chip) => !/pdf/i.test(chip)), result.chips.join(" | "));
    assert.equal(result.status, "");
    assert.ok(followUpChips(result.task).every((chip) => !/pdf/i.test(chip)));
  });
}
