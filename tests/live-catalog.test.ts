import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { emptyTask } from "../lib/awareness/task.ts";
import { LIVE_STALE_MS, LIVE_TOURISM_URL, LIVE_TTL_MS, bundledListings, primeLiveCatalog, syncLiveCatalog } from "../lib/live-catalog.ts";
import { runPlanAgent } from "../lib/plan-agent.ts";
import { BUNDLED_FOOD, BUNDLED_PLACES, EXPERIENCES, FOOD, PLACES } from "../lib/trip.ts";

const TODAY = new Date("2026-11-15T12:00:00Z");
const DROPPED = "food-006";
const DROPPED_NAME = "Enzo Caffe Pizza";

function bomb(): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => { throw new Error("model should not be called"); },
  }) as unknown as LanguageModel;
}

/** The tourism collection as api.maio.cv served it on Nov 16: no Enzo, and Vasuza spelled Vanuza. */
function tourismRows() {
  const rows = bundledListings();
  rows.delete(`maio-guide-${DROPPED}`);
  rows.set("maio-guide-food-003", { name: "Bar restaurante Vanuza" });
  return [...rows].map(([id, row]) => ({
    type: "Feature",
    id,
    geometry: null,
    properties: { name: row.name, publicationStatus: "published", attributes: { name: row.name } },
  }));
}

function apiFetch(state = { down: false }): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (state.down) throw new Error("offline");
    if (url === LIVE_TOURISM_URL) return Response.json({ type: "FeatureCollection", features: tourismRows() });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

const listedFoodNames = () => new Set(tourismRows().filter((row) => row.id.startsWith("maio-guide-food-")).map((row) => row.properties.name));
const unlistedFoodNames = () => BUNDLED_FOOD.map((item) => item.title).filter((name) => !listedFoodNames().has(name));

async function ask(content: string, locale: "en" | "pt" | "fr", fetchImpl: typeof fetch) {
  return runPlanAgent([{ role: "user", content }], null, { model: bomb(), fetchImpl, now: TODAY }, emptyTask(locale));
}

test("a place missing from the API is never suggested, in EN, PT and FR", async () => {
  primeLiveCatalog(null);
  const fetchImpl = apiFetch();
  assert.equal(await syncLiveCatalog(fetchImpl), "api");
  assert.equal(FOOD.some((item) => item.id === DROPPED), false);
  assert.ok(FOOD.some((item) => item.title === "Bar restaurante Vanuza"), FOOD.map((item) => item.title).join(" | "));

  const asks = [
    ["en", "where can we get coffee?"],
    ["en", "where to eat?"],
    ["en", "list three restaurants in Vila do Maio"],
    ["en", "list three restaurants"],
    ["pt", "onde tomar um café?"],
    ["pt", "onde comer?"],
    ["pt", "lista três restaurantes na Vila do Maio"],
    ["fr", "où prendre un café ?"],
  ] as const;
  for (const [locale, content] of asks) {
    const result = await ask(content, locale, fetchImpl);
    assert.doesNotMatch(result.reply, /Enzo/i, `${content}: ${result.reply}`);
    for (const name of unlistedFoodNames()) assert.equal(result.reply.includes(name), false, `${content} named ${name}: ${result.reply}`);
    for (const place of result.task.lastPlaces) {
      if (BUNDLED_FOOD.some((item) => item.id === place.id)) assert.ok(listedFoodNames().has(place.name), `${content}: ${place.name}`);
    }
  }
});

test("a built plan only uses ids the API lists", async () => {
  primeLiveCatalog(null);
  const fetchImpl = apiFetch();
  const listed = new Set(tourismRows().map((row) => row.id));
  for (const [locale, content] of [["en", "slow pace, with a rental car, from 18 to 20 November"], ["pt", "ritmo calmo, com carro alugado, de 18 a 20 de novembro"]] as const) {
    const result = await ask(content, locale, fetchImpl);
    assert.ok(result.plan, result.reply);
    for (const day of result.plan!.days) {
      for (const item of day.items) {
        if (item.kind === "food" || item.kind === "experience") assert.ok(listed.has(`maio-guide-${item.refId}`), `${item.kind} ${item.refId}`);
        if (item.kind === "place") assert.ok(listed.has(`visit-maio-${item.refId}`), `place ${item.refId}`);
      }
    }
    assert.equal(JSON.stringify(result.plan).includes(DROPPED), false);
  }
});

test("with the API down and no recent read, nothing bundled is suggested", async () => {
  primeLiveCatalog(null);
  const fetchImpl = apiFetch({ down: true });
  assert.equal(await syncLiveCatalog(fetchImpl), "unavailable");
  assert.equal(FOOD.length, 0);
  assert.equal(PLACES.length, 0);
  assert.equal(EXPERIENCES.length, 0);
  for (const [locale, content, down] of [["en", "where can we get coffee?", /couldn't open the Maio listings/], ["pt", "onde comer?", /Não consegui abrir as listas do Maio/]] as const) {
    const result = await ask(content, locale, fetchImpl);
    assert.match(result.reply, down, result.reply);
    for (const item of BUNDLED_FOOD) assert.equal(result.reply.includes(item.title), false, result.reply);
  }
});

test("a failed read keeps the last listing for 15 minutes, then empties it", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-16T09:00:00Z") });
  primeLiveCatalog(null);
  const state = { down: false };
  const fetchImpl = apiFetch(state);
  assert.equal(await syncLiveCatalog(fetchImpl), "api");
  const count = FOOD.length;
  assert.ok(count > 0);
  state.down = true;
  t.mock.timers.tick(LIVE_TTL_MS - 1_000);
  assert.equal(await syncLiveCatalog(fetchImpl), "api");
  t.mock.timers.tick(2_000);
  assert.equal(await syncLiveCatalog(fetchImpl), "stale");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(FOOD.length, count);
  t.mock.timers.tick(LIVE_STALE_MS);
  assert.equal(await syncLiveCatalog(fetchImpl), "unavailable");
  assert.equal(FOOD.length, 0);
  assert.equal(PLACES.length, 0);
  assert.ok(BUNDLED_PLACES.length > 0);
});
