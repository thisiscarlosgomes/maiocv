import { strict as assert } from "node:assert";
import { test } from "node:test";
import { applyClassification, classify } from "../lib/awareness/classify.ts";
import { emptyTask, type Task } from "../lib/awareness/task.ts";

const TODAY = "2026-11-21";
function say(task: Task, text: string): Task {
  return applyClassification(task, classify(text, task, { today: TODAY }));
}

test("a negated car sentence means no car", () => {
  for (const text of ["We won't have a car on Maio.", "We don't have a car.", "Actually we decided not to rent a car.", "Não vamos alugar carro.", "No car for us this trip."]) {
    assert.equal(say(emptyTask("en"), text).constraints.car, false, text);
  }
  assert.equal(say(emptyTask("en"), "We'll have a car.").constraints.car, true);
});

test("a correction flips the car and later questions keep it", () => {
  let task = say(emptyTask("en"), "We'll have a car.");
  task = say(task, "Actually we decided not to rent a car.");
  task = say(task, "What's the weather like this week?");
  task = say(task, "Which beach is best for us?");
  assert.equal(task.constraints.car, false);
});

test("party and dates survive side questions", () => {
  let task = say(emptyTask("en"), "We're two adults and a 4-year-old.");
  task = say(task, "We arrive on 12 December for 5 days.");
  task = say(task, "Is Maio safe?");
  task = say(task, "Do people speak English?");
  assert.deepEqual(task.constraints.party, { adults: 2, kids: 1, youngestAge: 4 });
  assert.deepEqual(task.constraints.dates, { start: "2026-12-12", days: 5 });
});

test("a fact inside a side question is kept", () => {
  const task = say(say(emptyTask("en"), "Is Maio safe?"), "No car, where can we eat?");
  assert.equal(task.constraints.car, false);
});

test("a new trip idea keeps where the guest sleeps", () => {
  const base = { ...emptyTask("en"), objective: "plan", constraints: { base: { zoneId: "morro", name: "Morro", lat: 15.18, lon: -23.21 } } };
  const next = say(base, "Forget the trip, start over.");
  assert.equal(next.constraints.base?.zoneId, "morro");
});
