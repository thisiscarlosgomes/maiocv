import { strict as assert } from "node:assert";
import { test } from "node:test";
import { applyClassification, classify } from "../../lib/awareness/classify.ts";
import { DEV_TASK_SECRET, readTask, signTask } from "../../lib/awareness/sign.ts";
import { emptyTask } from "../../lib/awareness/task.ts";

const dev = { NODE_ENV: "development" };
const prod = { NODE_ENV: "production", VERCEL_ENV: "production" };
const today = "2026-10-27";

test("the dev fallback is marked and is not a committed production secret", () => {
  assert.match(DEV_TASK_SECRET, /dev-only/);
  assert.match(DEV_TASK_SECRET, /not-for-production/);
});

test("sign and read round-trip in development without MAIO_TASK_SECRET", () => {
  const task = applyClassification(emptyTask(), classify("3 days from Friday, two adults, no car.", emptyTask(), { today }));
  const blob = signTask(task, dev);
  assert.equal(blob.includes("MAIO_TASK_SECRET"), false);
  assert.deepEqual(readTask(blob, dev), task);
});

test("a configured secret is used and the dev fallback does not verify it", () => {
  const task = emptyTask("en");
  task.objective = "quiet week";
  const blob = signTask(task, { ...dev, MAIO_TASK_SECRET: "test-secret-value" });
  assert.equal(readTask(blob, { ...dev, MAIO_TASK_SECRET: "test-secret-value" }).objective, "quiet week");
  assert.equal(readTask(blob, dev).objective, null);
});

test("a tampered blob starts an empty task", () => {
  const task = emptyTask("pt");
  task.objective = "3 dias";
  const blob = signTask(task, dev);
  const flipped = `${blob.slice(0, -1)}${blob.endsWith("a") ? "b" : "a"}`;
  const read = readTask(flipped, dev, "pt");
  assert.equal(read.objective, null);
  assert.deepEqual(read.constraints, {});
  assert.equal(read.locale, "pt");
  assert.equal(readTask(blob.slice(0, blob.indexOf(".")), dev).objective, null);
});

test("production fails closed when MAIO_TASK_SECRET is unset", () => {
  const task = emptyTask();
  task.objective = "trip";
  assert.throws(() => signTask(task, prod), /MAIO_TASK_SECRET/);
  const devBlob = signTask(task, dev);
  assert.equal(readTask(devBlob, prod).objective, null);
  assert.equal(readTask("not-a-blob", prod).objective, null);
});

test("production accepts a blob signed with the configured secret", () => {
  const env = { ...prod, MAIO_TASK_SECRET: "preview-secret" };
  const task = emptyTask("fr");
  task.objective = "2 jours";
  task.constraints = { car: false, party: { adults: 3, kids: 1 } };
  assert.deepEqual(readTask(signTask(task, env), env, "fr"), task);
});

test("two signed tasks stay isolated", () => {
  const first = emptyTask("en");
  first.objective = "no car, vegetarian";
  first.constraints = { car: false, diet: "vegetarian" };
  first.pendingQuestion = "Which beach?";
  const second = emptyTask("pt");
  second.objective = "fim de semana";
  second.constraints = { car: true };
  const a = signTask(first, dev);
  const b = signTask(second, dev);
  assert.notEqual(a, b);
  assert.equal(readTask(a, dev).constraints.car, false);
  assert.equal(readTask(a, dev).constraints.diet, "vegetarian");
  assert.equal(readTask(b, dev).constraints.car, true);
  assert.equal(readTask(b, dev).constraints.diet, undefined);
  assert.equal(readTask(b, dev).pendingQuestion, null);
});
