import { strict as assert } from "node:assert";
import { test } from "node:test";
import { applyClassification, classify } from "../../lib/awareness/classify.ts";
import {
  MESSAGE_CHARS, RECALL_CHARS, TOOL_BODY_CHARS, WINDOW_CHARS, WINDOW_MESSAGES,
  clipToolBody, foodNear, prepareContext, resolveReference, windowMessages,
} from "../../lib/awareness/context.ts";
import { emptyTask, type LastPlace } from "../../lib/awareness/task.ts";

const today = "2026-10-27";

const beaches: LastPlace[] = [
  { id: "praia-bitche-rotcha", name: "Bitche Rotcha Beach", area: "Porto Inglês" },
  { id: "praia-do-morro", name: "Morro Beach", area: "Morro", lat: 15.180635, lon: -23.2320507 },
  { id: "praia-ponta-dos-flamingos", name: "Ponta dos Flamingos", area: "North" },
];

test("ordinals in English, Portuguese and French use lastPlaces order", () => {
  assert.equal(resolveReference("the second beach", beaches).place?.id, "praia-do-morro");
  assert.equal(resolveReference("a segunda praia", beaches).place?.id, "praia-do-morro");
  assert.equal(resolveReference("la deuxième", beaches).place?.id, "praia-do-morro");
  assert.equal(resolveReference("the second one", beaches).kind, "ordinal");
  assert.equal(resolveReference("o segundo dia mais calmo", beaches).kind, null);
  assert.equal(resolveReference("deuxième jour plus tranquille", beaches).kind, null);
});

test("that one, around there and directions resolve without inventing a place", () => {
  assert.equal(resolveReference("that one", beaches).place?.id, "praia-ponta-dos-flamingos");
  const calheta: LastPlace = { id: "baxona-ribinha", name: "Calheta", area: "Calheta", lat: 15.22642185, lon: -23.2160701 };
  assert.equal(resolveReference("somewhere to eat around there", [beaches[0], calheta]).place?.id, "baxona-ribinha");
  const food = foodNear(calheta);
  assert.ok(food.some((item) => /vasuza/i.test(item.name)));
  assert.ok(food.every((item) => /calheta/i.test(item.area)));
  const directions = resolveReference("Directions to Praia do Morro from Porto Inglês.", []);
  assert.equal(directions.kind, "directions");
  assert.equal(directions.to?.id, "praia-do-morro");
  assert.equal(directions.from?.id, "cidade-porto-ingles");
  assert.equal(typeof directions.to?.lat, "number");
});

test("the window keeps 25 messages, 500 characters each and 8000 total", () => {
  const messages = Array.from({ length: 30 }, (_, i) => ({ role: "user" as const, content: `${i}:${"m".repeat(900)}` }));
  const windowed = windowMessages(messages);
  assert.ok(windowed.messages.length <= WINDOW_MESSAGES);
  assert.ok(windowed.messages.length < 30);
  assert.ok(windowed.messages.every((message) => message.content.length <= MESSAGE_CHARS));
  assert.ok(windowed.messages.reduce((sum, message) => sum + message.content.length, 0) <= WINDOW_CHARS);
  assert.ok(windowed.recall.length <= RECALL_CHARS);
  assert.match(windowed.recall, /user:/);
  assert.equal(windowed.messages.at(-1)?.content.startsWith("29:"), true);
});

test("a 30000-character tool body is clipped and the objective survives the window", () => {
  const task = applyClassification(emptyTask(), classify("3 days from Friday, two adults, no car.", emptyTask(), { today }));
  const body = "wave ".repeat(6000);
  assert.ok(body.length >= 30_000);
  const clipped = clipToolBody(body);
  assert.equal(typeof clipped, "object");
  const preview = (clipped as { preview: string; originalChars: number }).preview;
  assert.ok(preview.length <= TOOL_BODY_CHARS);
  assert.ok((clipped as { originalChars: number }).originalChars >= 30_000);
  const messages = [
    { role: "user" as const, content: "remember the Friday start and no car" },
    ...Array.from({ length: 29 }, (_, i) => ({ role: "assistant" as const, content: `note ${i} ${body}` })),
  ];
  const prepared = prepareContext(task, messages);
  assert.equal(prepared.task, task);
  assert.equal(prepared.task.objective, task.objective);
  assert.equal(prepared.task.constraints.car, false);
  assert.equal(prepared.task.constraints.dates?.start, "2026-10-30");
  assert.ok(prepared.messages.length <= WINDOW_MESSAGES);
  assert.ok(prepared.messages.every((message) => message.content.length <= MESSAGE_CHARS));
});
