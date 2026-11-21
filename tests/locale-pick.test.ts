// English browsers and English questions get English, not the Portuguese default.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { preferredLocale } from "../lib/locale.ts";
import { classify, looksEnglish } from "../lib/awareness/classify.ts";
import { emptyTask } from "../lib/awareness/task.ts";
import { normalizeUtterance } from "../lib/awareness/classify.ts";

test("bare URLs pick the saved language, then Accept-Language, then Portuguese", () => {
  assert.equal(preferredLocale(null, "en-US,en;q=0.9"), "en");
  assert.equal(preferredLocale(null, "de-DE,fr;q=0.8,en;q=0.5"), "fr");
  assert.equal(preferredLocale(null, "pt-PT,pt;q=0.9,en;q=0.8"), "pt");
  assert.equal(preferredLocale("pt", "en-US"), "pt");
  assert.equal(preferredLocale(null, "de-DE"), "pt");
  assert.equal(preferredLocale(null, null), "pt");
  assert.equal(preferredLocale(null, "en;q=0, fr"), "fr");
});

test("a plainly English message switches the task to English; Portuguese and French do not", () => {
  const ctx = { today: "2026-11-21" } as never;
  assert.equal(classify("Where can we eat nearby?", emptyTask("pt"), ctx).locale, "en");
  assert.equal(classify("Which beach is best for us tomorrow?", emptyTask("pt"), ctx).locale, "en");
  assert.notEqual(classify("Onde podemos comer perto?", emptyTask("pt"), ctx).locale, "en");
  assert.notEqual(classify("Où peut-on faire du yoga à Maio ?", emptyTask("fr"), ctx).locale, "en");
  assert.equal(looksEnglish(normalizeUtterance("Praia Real")), false);
});

test("an English statement with trip facts still goes through the normal path", () => {
  const ctx = { today: "2026-11-21" } as never;
  const result = classify("We'll have a car for the whole week, where can we go?", emptyTask("pt"), ctx);
  assert.equal(result.locale, "en");
  assert.notEqual(result.carStance ?? null, null);
});
