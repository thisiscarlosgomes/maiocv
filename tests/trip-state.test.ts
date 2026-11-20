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

import { keepToVillage, locationFromConversation, type PlaceCard } from "../lib/visitor/agent.ts";

const card = (name: string, area: string, kind: PlaceCard["kind"] = "food"): PlaceCard => ({ id: name, name, kind, area, km: 1, walkMin: 10, driveMin: 3, image: null, approxLocation: false, lat: 15.2, lon: -23.1 });
const CALHETA = { name: "Calheta", lat: 15.19, lon: -23.22, zone: "Calheta", zoneId: "calheta", source: "context" as const };

test("nearby stays in the guest's village: a later sentence about another village goes", () => {
  const reply = "I'd pick Restaurante Bar Anita in Calheta. In Vila, Praça Restaurante has more choice.";
  const out = keepToVillage(reply, [card("Restaurante Bar Anita", "Calheta"), card("Praça Restaurante", "Vila do Maio")], CALHETA);
  assert.equal(out.reply, "I'd pick Restaurante Bar Anita in Calheta.");
  assert.deepEqual(out.cards.map((item) => item.name), ["Restaurante Bar Anita"]);
});

test("another village is fine when the guest's village has nothing of that kind", () => {
  const reply = "Calheta has no listed pizza; Big Game Restaurant - Pizzeria in Vila is the nearest.";
  const out = keepToVillage(reply, [card("Baxona Beach", "Calheta", "beach"), card("Big Game Restaurant - Pizzeria", "Vila do Maio")], CALHETA);
  assert.equal(out.reply, reply);
  assert.equal(out.cards.length, 2);
});

test("the remembered base village anchors distances when the chat no longer mentions it", () => {
  const anchor = locationFromConversation([], [{ role: "user", content: "Where should we have dinner?" }], { locale: "en", car: null, base: { zoneId: "morro", name: "Morro", lat: 15.18, lon: -23.2 } });
  assert.equal(anchor?.zoneId, "morro");
});

test("moving village in the chat beats the older one", () => {
  const anchor = locationFromConversation([], [
    { role: "user", content: "We're staying in Vila do Maio." },
    { role: "user", content: "Actually we moved to Calheta today." },
    { role: "user", content: "Where can we get dinner close by?" },
  ], { locale: "en", car: null });
  assert.equal(anchor?.zoneId, "calheta");
});

import { withNoCarAccess } from "../lib/visitor/agent.ts";

test("no car: a far recommendation gets a way to get there, a walkable one does not", () => {
  const far = [card("Praia Real", "Cascabulho", "beach")].map((item) => ({ ...item, walkMin: null, km: null }));
  assert.match(withNoCarAccess("Praia Real is worth it.", far, { car: false, locale: "en" }), /aluguer or a taxi/);
  assert.equal(withNoCarAccess("Praia Real is worth it; take an aluguer.", far, { car: false, locale: "en" }), "Praia Real is worth it; take an aluguer.");
  assert.equal(withNoCarAccess("Praia Real is worth it.", far, { car: true, locale: "en" }), "Praia Real is worth it.");
  assert.equal(withNoCarAccess("Anita is close.", [card("Restaurante Bar Anita", "Calheta")], { car: false, locale: "en" }), "Anita is close.");
});
