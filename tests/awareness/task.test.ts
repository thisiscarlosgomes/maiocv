import { strict as assert } from "node:assert";
import { test } from "node:test";
import { applyClassification, classify } from "../../lib/awareness/classify.ts";
import { emptyTask, followUpChips, isGuestChip, parseTask, refreshTask, type Task } from "../../lib/awareness/task.ts";

const today = "2026-10-27";

function taskWith(partial: Partial<Task>): Task {
  return refreshTask({ ...emptyTask("en"), objective: "3 days on Maio", ...partial });
}

test("empty task has identity fields and no invented constraints", () => {
  const task = emptyTask("pt");
  assert.equal(task.version, 1);
  assert.equal(task.objective, null);
  assert.equal(task.pendingQuestion, null);
  assert.deepEqual(task.constraints, {});
  assert.equal(task.scope.mode, "planning");
  assert.equal(task.locale, "pt");
  assert.equal(parseTask({ version: 1, objective: "x" }), null);
});

test("continuation keeps dates, party and no-car, and records a quiet evening", () => {
  const start = applyClassification(emptyTask(), classify("3 days from Friday, two adults, no car, one boat trip.", emptyTask(), { today }));
  const next = applyClassification(start, classify("add Saturday night as quiet.", start, { today }));
  assert.equal(next.constraints.dates?.start, "2026-10-30");
  assert.equal(next.constraints.dates?.days, 3);
  assert.equal(next.constraints.party?.adults, 2);
  assert.equal(next.constraints.car, false);
  assert.equal(next.constraints.quietEvenings, true);
  assert.equal(next.objective, start.objective);
});

test("a date correction replaces the start and keeps party and car", () => {
  const start = applyClassification(emptyTask(), classify("3 days from Friday, two adults, no car.", emptyTask(), { today }));
  const next = applyClassification(start, classify("not Friday, Saturday.", start, { today }));
  assert.equal(classify("not Friday, Saturday.", start, { today }).intent, "correction");
  assert.equal(next.constraints.dates?.start, "2026-10-31");
  assert.equal(next.constraints.dates?.days, 3);
  assert.equal(next.constraints.party?.adults, 2);
  assert.equal(next.constraints.car, false);
});

test("a car correction replaces the constraint", () => {
  const start = taskWith({ constraints: { car: false, dates: { start: "2026-10-28", days: 3 }, party: { adults: 2, kids: 0 } } });
  const next = applyClassification(start, classify("we rented a car.", start, { today }));
  assert.equal(classify("we rented a car.", start, { today }).intent, "correction");
  assert.equal(next.constraints.car, true);
  assert.equal(next.constraints.dates?.start, "2026-10-28");
});

test("never mind, esquece and laisse tomber clear only the pending question", () => {
  for (const phrase of ["never mind", "Esquece.", "laisse tomber"]) {
    const start = taskWith({ pendingQuestion: "Ferry or flight?", constraints: { dates: { start: "2026-10-30", days: 2 } } });
    const result = classify(phrase, start, { today });
    assert.equal(result.intent, "cancel_pending");
    assert.equal(result.cancelOnly, true);
    const next = applyClassification(start, result);
    assert.equal(next.pendingQuestion, null);
    assert.equal(next.objective, start.objective);
    assert.equal(next.constraints.dates?.start, "2026-10-30");
  }
});

test("a side question keeps the objective, dates and pending question", () => {
  const start = taskWith({
    pendingQuestion: "How many days?",
    constraints: { dates: { start: "2026-10-30", days: 3 }, party: { adults: 2 } },
  });
  const result = classify("what's the hospital number?", start, { today });
  assert.equal(result.intent, "side_question");
  const next = applyClassification(start, result);
  assert.equal(next.objective, start.objective);
  assert.equal(next.pendingQuestion, "How many days?");
  assert.deepEqual(next.constraints, start.constraints);
});

test("a new objective replaces the trip task", () => {
  const start = taskWith({ constraints: { car: false, diet: "vegetarian" }, pendingQuestion: "Ferry or flight?" });
  const phrase = "forget the trip, what was Maio's 2024 guest count?";
  const result = classify(phrase, start, { today });
  assert.equal(result.intent, "new_objective");
  assert.equal(result.research, true);
  const next = applyClassification(start, result);
  assert.match(next.objective ?? "", /2024 guest count/);
  assert.equal(next.scope.mode, "research");
  assert.equal(next.constraints.car, undefined);
  assert.equal(next.constraints.diet, undefined);
  assert.equal(next.pendingQuestion, null);
});

test("diet and budget are constraints and do not invent a price", () => {
  const start = taskWith({ constraints: { dates: { start: "2026-10-28", days: 2 }, party: { adults: 2 }, car: false } });
  const diet = applyClassification(start, classify("Vegetarian lunch.", start, { today }));
  assert.equal(diet.constraints.diet, "vegetarian");
  assert.equal(diet.constraints.dates?.start, "2026-10-28");
  const budget = applyClassification(start, classify("Cheapest lunch.", start, { today }));
  assert.equal(budget.constraints.budget, "cheapest");
  assert.equal(JSON.stringify(budget.constraints.budget).includes("€"), false);
});

test("French party, car and days are extracted together", () => {
  const phrase = "Nous sommes 4, dont un enfant, sans voiture, 2 jours.";
  const result = classify(phrase, emptyTask(), { today });
  assert.equal(result.intent, "new_objective");
  assert.equal(result.locale, "fr");
  const next = applyClassification(emptyTask(), result);
  assert.equal(next.locale, "fr");
  assert.equal(next.constraints.party?.adults, 3);
  assert.equal(next.constraints.party?.kids, 1);
  assert.equal(next.constraints.car, false);
  assert.equal(next.constraints.dates?.days, 2);
});

test("Portuguese and English trip openers agree on the facts", () => {
  const en = applyClassification(emptyTask(), classify("3 days from tomorrow, two adults, no car, one boat trip.", emptyTask(), { today }));
  const pt = applyClassification(emptyTask(), classify("3 dias a partir de amanhã, dois adultos, sem carro, uma saída de barco.", emptyTask(), { today }));
  assert.equal(pt.locale, "pt");
  assert.equal(pt.constraints.dates?.start, en.constraints.dates?.start);
  assert.equal(pt.constraints.dates?.days, 3);
  assert.equal(pt.constraints.party?.adults, 2);
  assert.equal(pt.constraints.car, false);
  assert.equal(pt.constraints.boatTrips, 1);
});

test("a language switch changes locale only", () => {
  const start = taskWith({ locale: "pt", constraints: { dates: { start: "2026-10-30", days: 2 }, party: { adults: 2 }, car: false } });
  const next = applyClassification(start, classify("answer in English", start, { today }));
  assert.equal(next.locale, "en");
  assert.deepEqual(next.constraints, start.constraints);
  assert.equal(next.objective, start.objective);
});

test("chips stay within two and do not ask when you leave once dates are set", () => {
  const task = refreshTask(taskWith({
    constraints: { dates: { start: "2026-10-28", days: 3 }, party: { adults: 2 }, car: false, boatTrips: 1, interests: ["boat"] },
    completed: ["boat"],
    remaining: ["Want a boat trip?", "When do you leave?"],
  }));
  const chips = followUpChips(task);
  assert.ok(chips.length <= 3);
  assert.ok(chips.every(isGuestChip));
  assert.ok(chips.every((chip) => !/when do you leave|quando partem|quand partez/i.test(chip)));
  assert.ok(chips.every((chip) => !/add a boat|passeio de barco|sortie en bateau/i.test(chip)));
});

test("a rental car in the setup is a yes in English, Portuguese, and French", () => {
  const phrases = [
    "slow pace, with a rental car, from 16 to 18 November",
    "slow pace, with a car, from 16 to 18 November",
    "ritmo calmo, com carro alugado, de 16 a 18 de novembro",
    "rythme lent, avec une voiture de location, du 16 au 18 novembre",
  ];
  for (const phrase of phrases) {
    const result = classify(phrase, emptyTask(), { today: "2026-11-15" });
    assert.equal(result.patch.car, true, phrase);
    assert.equal(result.carStance, "yes", phrase);
  }
  const declined = classify("slow pace, no rental car, from 16 to 18 November", emptyTask(), { today: "2026-11-15" });
  assert.equal(declined.patch.car, false);
});

test("a pending ferry-or-flight question offers those choices, not a finished intent", () => {
  const task = taskWith({
    pendingQuestion: "Ferry or flight?",
    constraints: { dates: { start: "2026-10-30", days: 2 }, party: { adults: 2 }, car: false, boatTrips: 1 },
    completed: ["boat"],
  });
  assert.deepEqual(followUpChips(task), ["Ferry", "Flight"]);
});
