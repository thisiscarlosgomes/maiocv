import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { emptyTask, refreshTask, type Task } from "../lib/awareness/task.ts";
import { runPlanAgent } from "../lib/plan-agent.ts";
import { editDiffReply } from "../lib/plan-diff.ts";
import { addListedActivity } from "../lib/plan-edits.ts";
import { suggestionChips } from "../lib/plan-chips.ts";
import { buildPlan } from "../lib/trip-planner.ts";
import { FOOD, PLACES, experience, type PlanItem, type TripPlan } from "../lib/trip.ts";

const TODAY = new Date("2026-11-16T12:00:00Z");
const dates = ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
const calm = dates.map((date) => ({ date, waveHeightM: 0.8, windKmh: 16, tempMaxC: 28, sunset: "18:10" }));
const rough = dates.map((date) => ({ date, waveHeightM: 2.6, windKmh: 40, tempMaxC: 28, sunset: "18:10" }));

function bomb(): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => { throw new Error("model should not be called"); },
  }) as unknown as LanguageModel;
}

function quietFetch(): typeof fetch {
  return (async () => new Response("not found", { status: 404 })) as typeof fetch;
}

function fourDay(locale: "en" | "pt" | "fr", sea = calm, extra: { kids?: number; youngestAge?: number } = {}): { plan: TripPlan; task: Task } {
  const plan = buildPlan({
    request: {
      startDate: "2026-11-17",
      days: 4,
      locale,
      adults: 2,
      kids: extra.kids ?? 0,
      ...(extra.youngestAge !== undefined ? { youngestAge: extra.youngestAge } : {}),
      hasCar: false,
      boatTrips: 0,
      pace: "slow",
    },
    forecast: sea,
    sailings: [],
  });
  const task = refreshTask({
    ...emptyTask(locale),
    objective: plan.title,
    constraints: {
      dates: { start: "2026-11-17", days: 4 },
      party: { adults: 2, kids: extra.kids ?? 0, ...(extra.youngestAge !== undefined ? { youngestAge: extra.youngestAge } : {}) },
      car: false,
      pace: "slow",
    },
    completed: ["itinerary"],
  });
  return { plan, task };
}

const ASK = {
  en: "add surf",
  pt: "acrescenta surf",
  fr: "ajoute le surf",
} as const;

const BLURB = /Tap the card|Toque no cartão|Touchez la carte|Slow \d+ days without|Calmo, \d+ dias sem|Tranquille, \d+ jours sans/;

for (const locale of ["en", "pt", "fr"] as const) {
  test(`${locale} add surf says where and when, and the chips follow`, async () => {
    const { plan, task } = fourDay(locale);
    const result = await runPlanAgent(
      [{ role: "user", content: ASK[locale] }],
      plan,
      { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
      task,
    );
    assert.ok(result.plan);
    assert.notEqual(result.plan, plan);
    const surf = result.plan.days.flatMap((day, index) => day.items.filter((item) => item.refId === "blue-ondaazul-maio").map((item) => ({ index, item })));
    assert.equal(surf.length, 1, result.reply);
    assert.match(result.reply, /surf/i);
    assert.match(result.reply, locale === "pt" ? /dia \d+/i : locale === "fr" ? /jour \d+/i : /day \d+/i);
    assert.match(result.reply, /\d{2}:\d{2}/);
    assert.match(result.reply, locale === "en" ? /Morro Beach/ : /Praia do Morro/);
    assert.doesNotMatch(result.reply, BLURB);
    assert.ok(result.reply.split("\n").length <= 2, result.reply);
    const afternoon = Number((result.reply.match(/\b(\d{2}):\d{2}\b/) ?? [])[1] ?? "0") >= 12;
    assert.ok(result.chips.length <= 3 && result.chips.length >= 2, result.chips.join(" | "));
    assert.ok(result.chips.some((chip) => afternoon
      ? /morning|manhã|matin/i.test(chip)
      : /afternoon|tarde|après-midi/i.test(chip)), result.chips.join(" | "));
    assert.ok(result.chips.some((chip) => /another surf|outra sessão de surf|autre session de surf/i.test(chip)), result.chips.join(" | "));
    assert.ok(result.chips.every((chip) => !/rent a car|alugo um carro|louer une voiture/i.test(chip)), result.chips.join(" | "));
    assert.ok(result.chips.every((chip) => !/board|prancha|planche/i.test(chip)), result.chips.join(" | "));
    assert.ok(!result.plan.days.some((day) => day.items.some((item) => item.kind === "experience" && item.refId !== "blue-ondaazul-maio")));

    const again = await runPlanAgent(
      [{ role: "user", content: ASK[locale] }],
      result.plan,
      { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
      result.task,
    );
    assert.equal(again.plan, result.plan);
    assert.match(again.reply, locale === "pt" ? /já está no dia/i : locale === "fr" ? /déjà au jour/i : /already on day/i);
    assert.match(again.reply, /surf/i);
    assert.match(again.reply, /\d{2}:\d{2}/);
    assert.doesNotMatch(again.reply, BLURB);
    assert.ok(again.chips.every((chip) => !/another surf|outra sessão de surf|autre session de surf/i.test(chip)), again.chips.join(" | "));
  });

  test(`${locale} a missing activity is not rebuilt`, async () => {
    const { plan, task } = fourDay(locale);
    const phrase = locale === "pt" ? "acrescenta um cruzeiro com golfinhos" : locale === "fr" ? "ajoute une sortie dauphins" : "add a dolphin cruise";
    const result = await runPlanAgent(
      [{ role: "user", content: phrase }],
      plan,
      { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
      task,
    );
    assert.equal(result.plan, plan);
    assert.match(result.reply, locale === "pt" ? /não está nas listas/i : locale === "fr" ? /pas dans les listes/i : /isn't in the listings/i);
    assert.match(result.reply, locale === "pt" ? /manhã/i : locale === "fr" ? /matinée/i : /morning/i);
    assert.doesNotMatch(result.reply, BLURB);
  });
}

test("rough seas and a young child keep surf off the card", async () => {
  const storm = fourDay("en", rough);
  const roughResult = await runPlanAgent(
    [{ role: "user", content: "add surf" }],
    storm.plan,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
    storm.task,
  );
  assert.equal(roughResult.plan, storm.plan);
  assert.match(roughResult.reply, /rough/i);
  assert.match(roughResult.reply, /closest/i);
  assert.doesNotMatch(roughResult.reply, /Added surf/);

  const child = fourDay("en", calm, { kids: 1, youngestAge: 3 });
  const young = await runPlanAgent(
    [{ role: "user", content: "add surf" }],
    child.plan,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
    child.task,
  );
  assert.equal(young.plan, child.plan);
  assert.match(young.reply, /age 8/);
  assert.doesNotMatch(young.reply, /Added surf/);
});

test("a surf spot that needs a car is refused on a no-car plan", () => {
  const { plan } = fourDay("en");
  const surf = experience("blue-ondaazul-maio");
  assert.ok(surf);
  const far = { ...surf, example: { ...surf.example, pickup: false }, placeId: "monte-batalha" };
  const result = addListedActivity(plan, "surf", "en", undefined, far);
  assert.equal(result.plan, plan);
  assert.equal(result.changed, false);
  assert.match(result.reply, /without a car/i);
  assert.match(result.reply, /closest/i);
});

test("a second surf session is not stacked on a slow day", async () => {
  const { plan, task } = fourDay("en");
  const once = await runPlanAgent([{ role: "user", content: "add surf" }], plan, { model: bomb(), fetchImpl: quietFetch(), now: TODAY }, task);
  const twice = await runPlanAgent(
    [{ role: "user", content: "Add another surf session" }],
    once.plan,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
    once.task,
  );
  assert.equal(twice.plan, once.plan);
  assert.match(twice.reply, /doesn't fit a slow day/i);
  assert.match(twice.reply, /already on day/i);
});

test("moving surf to the morning reports the new time", async () => {
  const { plan, task } = fourDay("en");
  const added = await runPlanAgent([{ role: "user", content: "add surf" }], plan, { model: bomb(), fetchImpl: quietFetch(), now: TODAY }, task);
  const moved = await runPlanAgent(
    [{ role: "user", content: "Move surf to the morning" }],
    added.plan,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
    added.task,
  );
  assert.ok(moved.plan);
  assert.notEqual(moved.plan, added.plan);
  assert.match(moved.reply, /Moved surf on day \d+ to the morning, \d{2}:\d{2}/);
  assert.doesNotMatch(moved.reply, BLURB);
  const again = await runPlanAgent(
    [{ role: "user", content: "Move surf to the morning" }],
    moved.plan,
    { model: bomb(), fetchImpl: quietFetch(), now: TODAY },
    moved.task,
  );
  assert.equal(again.plan, moved.plan);
  assert.match(again.reply, /already in the morning/i);
});

test("lunch, a removal and extra edits are listed from the diff", () => {
  const { plan } = fourDay("en");
  const days = plan.days.map((day) => ({ ...day, items: day.items.map((item) => ({ ...item })) }));
  const lunch = days[1].items.find((item) => item.slot === "lunch" && item.kind === "food");
  assert.ok(lunch);
  const target = FOOD.find((item) => item.title === "Nha Terra" && item.id !== lunch.refId) ?? FOOD.find((item) => item.id !== lunch.refId);
  assert.ok(target);
  lunch.refId = target.id;
  lunch.start = "13:15";
  const boat: PlanItem = { id: "d1-boat", kind: "experience", refId: "blue-sport-fishing-big-game", slot: "activity", start: "15:00", durationMin: 120 };
  days[1].items = days[1].items.filter((item) => item.kind !== "experience").concat(boat);
  const after: TripPlan = { ...plan, days };
  const reply = editDiffReply(plan, after, "en", "move lunch");
  assert.ok(reply);
  assert.match(reply, new RegExp(`Moved lunch on day 2 to ${target.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, 13:15`));
  assert.match(reply, /Added Sport Fishing \(Big Game\) on day 2 \(Wed 18 Nov\), 15:00/);
  assert.ok(reply.split("\n").length <= 2, reply);

  const crowded = plan.days.map((day, index) => ({
    ...day,
    items: day.items.map((item, itemIndex) => item.kind === "place" ? { ...item, refId: PLACES[(index * 3 + itemIndex) % PLACES.length].id } : { ...item }),
  }));
  const many = editDiffReply(plan, { ...plan, days: crowded }, "en");
  assert.ok(many);
  assert.match(many, /Also \d+ other/);
  assert.ok(many.split("\n").length <= 2, many);
  const pt = editDiffReply(plan, { ...plan, days: crowded }, "pt");
  const fr = editDiffReply(plan, { ...plan, days: crowded }, "fr");
  assert.match(pt ?? "", /Mais \d+ mudan/);
  assert.match(fr ?? "", /autre/);
});

test("removing the boat names the day", () => {
  const withBoat = buildPlan({
    request: { startDate: "2026-11-17", days: 4, locale: "en", adults: 2, hasCar: false, boatTrips: 1, pace: "slow" },
    forecast: calm,
    sailings: [],
  });
  assert.ok(withBoat.days.some((day) => day.items.some((item) => item.refId === "blue-sport-fishing-big-game")));
  const strip = (locale: "en" | "pt" | "fr"): TripPlan => ({
    ...withBoat,
    locale,
    days: withBoat.days.map((day) => ({ ...day, items: day.items.filter((item) => item.refId !== "blue-sport-fishing-big-game") })),
  });
  assert.match(editDiffReply(withBoat, strip("en"), "en") ?? "", /Removed the boat trip from day \d+/);
  assert.match(editDiffReply({ ...withBoat, locale: "pt" }, strip("pt"), "pt") ?? "", /Tirei o passeio de barco do dia/);
  assert.match(editDiffReply({ ...withBoat, locale: "fr" }, strip("fr"), "fr") ?? "", /sortie en bateau du jour/);
});

test("chips follow a side question, a boat already on the plan, and a no-car trip", () => {
  const { plan, task } = fourDay("en");
  const pharmacy = suggestionChips({ locale: "en", plan, task, lastAsk: "where is a pharmacy", reply: "Pharmacy: Farmácia Central.", intent: "side_question" });
  assert.deepEqual(pharmacy, ["Where is the hospital?", "Is there an ATM?", "Where is the police?"]);
  assert.ok(pharmacy.every((chip) => !/pharmacy/i.test(chip)));

  const pt = suggestionChips({ locale: "pt", plan, task: { ...task, locale: "pt" }, lastAsk: "onde fica a farmácia", reply: "Farmácia: Central.", intent: "side_question" });
  assert.ok(pt.every((chip) => !/farmácia/i.test(chip)));
  assert.ok(pt.some((chip) => /hospital/i.test(chip)));

  const fr = suggestionChips({ locale: "fr", plan, task: { ...task, locale: "fr" }, lastAsk: "où est la pharmacie", reply: "Pharmacie : Centrale.", intent: "side_question" });
  assert.ok(fr.some((chip) => /hôpital/i.test(chip)));

  const boatPlan = buildPlan({
    request: { startDate: "2026-11-17", days: 4, locale: "en", adults: 2, hasCar: false, boatTrips: 1, pace: "slow" },
    forecast: calm,
    sailings: [],
  });
  const boatChips = suggestionChips({ locale: "en", plan: boatPlan, task, lastAsk: "hello", reply: "Hi! Your 4-day trip is still here.", intent: "side_question" });
  assert.ok(boatChips.includes("Remove the boat trip"), boatChips.join(" | "));
  assert.ok(boatChips.every((chip) => chip !== "Add a boat trip"));
  assert.ok(boatChips.every((chip) => !/rent a car/i.test(chip)), boatChips.join(" | "));

  const around = suggestionChips({ locale: "en", plan, task, lastAsk: "how do we get around without a car", reply: "You walk in town.", intent: "side_question" });
  assert.ok(around.includes("Where can I rent a car?"), around.join(" | "));

  const withSurf: TripPlan = {
    ...plan,
    days: plan.days.map((day, index) => index === 1 ? {
      ...day,
      items: [...day.items, { id: "d1-surf", kind: "experience", refId: "blue-ondaazul-maio", slot: "activity", start: "15:00", durationMin: 120 }],
    } : day),
  };
  const parked = suggestionChips({
    locale: "en",
    plan: withSurf,
    task,
    lastAsk: "add surf",
    reply: "Added surf at Morro Beach on day 2 (Wed 18 Nov), 15:00.",
    intent: "correction",
    boardRental: true,
  });
  assert.ok(parked.includes("Move surf to the morning"));
  assert.ok(parked.includes("Add another surf session"));
  assert.ok(parked.includes("Where can I rent a board?"));
  assert.equal(parked.length, 3);
});
