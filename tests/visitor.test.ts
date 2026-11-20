// The visitor guide: distances in code, same-area ranking, routing away from the plan builder, cards.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModel } from "ai";
import { driveMinutes, haversineKm, nearestZone, walkMinutes, zoneFromText } from "../lib/visitor/geo.ts";
import { buildIndex, findPlace, nearby, resolveAnchor, setPlaceIndex } from "../lib/visitor/places.ts";
import { cardsForReply, clampReply, onlyQuestions, locationFromConversation, runVisitorAgent } from "../lib/visitor/agent.ts";
import { isVisitorQuestion } from "../lib/visitor/route.ts";
import { scrubReply } from "../lib/visitor/scrub.ts";
import { MAIO_BACKGROUND } from "../lib/visitor/background.ts";

const feature = (id: string, lon: number | null, lat: number | null, attributes: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: "Feature", id, geometry: lon === null ? null : { type: "Point", coordinates: [lon, lat] }, properties: { attributes, publicationStatus: "published", ...extra },
});
const FIXTURE = [
  feature("visit-maio-praia-baxona", -23.216503, 15.224127, { name: { en: "Baxona Beach", pt: "Praia da Baxona" }, category: "beach", location: { en: "Calheta" }, description: { en: "The water is very calm year-round." }, tips: [{ en: "Best late afternoon." }] }),
  feature("visit-maio-praia-bitche-rotcha", -23.21549, 15.140366, { name: { en: "Bitche Rotcha Beach" }, category: "beach", description: { en: "Town beach." } }),
  feature("visit-maio-rotcha", -23.213305, 15.136882, { name: { en: "Rotcha" }, category: "beach", description: { en: "West of town." } }),
  feature("maio-guide-food-003", -23.2128235, 15.229882, { name: "Bar restaurante Vanuza", businessCategory: "restaurant", location: "Calheta", description: { en: "Fresh fish." } }),
  feature("maio-guide-food-002", null, null, { name: "Big Game Restaurant - Pizzeria", experience: "food", location: "Cidade do Porto Inglês" }),
  feature("osm-node-1", -23.2205695, 15.1805545, { amenity: "restaurant", name: "A Caminhada" }),
  feature("osm-node-2", -23.2123681, 15.2300935, { name: "Barbearia DAD", shop: "hairdresser" }),
  feature("guide-offroad-1", null, null, { name: "Route" }),
  feature("visit-maio-draft", -23.2, 15.2, { name: { en: "Draft" }, category: "beach" }, { publicationStatus: "draft" }),
];

test("distances are computed in code and travel minutes are rough but ordered", () => {
  const vila = { lat: 15.1375142, lon: -23.2112673 };
  const calheta = { lat: 15.2292429, lon: -23.2112107 };
  const km = haversineKm(vila, calheta);
  assert.ok(km > 9.5 && km < 11, `${km}`);
  assert.ok(walkMinutes(1) < walkMinutes(2));
  assert.ok(driveMinutes(km) >= 12 && driveMinutes(km) <= 25);
  assert.equal(nearestZone({ lat: 15.2301, lon: -23.2129 }).zone.id, "calheta");
  assert.equal(zoneFromText("we're in Calheta de Baixo")?.id, "calheta");
  assert.equal(zoneFromText("Cidade do Porto Inglês")?.id, "vila");
});

test("the index keeps published, typed places and places a no-coordinate listing at its village", () => {
  const places = buildIndex(FIXTURE);
  const names = places.map((place) => place.name);
  assert.ok(!names.includes("Draft") && !names.includes("Route") && !names.includes("Barbearia DAD"));
  const pizza = places.find((place) => place.name.startsWith("Big Game"))!;
  assert.equal(pizza.kind, "food");
  assert.equal(pizza.zoneId, "vila");
  assert.equal(pizza.approx, true);
  assert.equal(places.find((place) => place.name === "A Caminhada")?.zoneId, "morro");
});

test("nearby food for a guest in Calheta stays in Calheta, nearest first, without a car", () => {
  const places = buildIndex(FIXTURE);
  const anchor = resolveAnchor(places, "Calheta")!;
  assert.equal(anchor.zoneId, "calheta");
  const result = nearby(places, { kinds: ["food"], anchor, car: false });
  assert.deepEqual(result.results.map((row) => row.name), ["Bar restaurante Vanuza"]);
  assert.ok(result.results[0].walkMin! <= 5);
  const fromBeach = nearby(places, { kinds: ["food"], anchor: resolveAnchor(places, "Baxona Beach"), car: false });
  assert.equal(fromBeach.results[0].name, "Bar restaurante Vanuza");
});

test("when nothing is in walking range the nearest is returned and flagged", () => {
  const places = buildIndex(FIXTURE);
  const result = nearby(places, { kinds: ["beach"], anchor: resolveAnchor(places, "Morro"), car: false });
  assert.equal(result.beyondRadius, true);
  assert.ok(result.note.includes("nearest"));
  assert.ok(result.results.every((row) => row.km !== null && row.km > 3));
});

test("the guest's location comes from what they said, newest first, not from a destination", () => {
  const places = buildIndex(FIXTURE);
  assert.equal(locationFromConversation(places, [{ role: "user", content: "We're staying in Calheta." }, { role: "user", content: "where can we eat?" }], { locale: "en", car: null })?.zoneId, "calheta");
  assert.equal(locationFromConversation(places, [{ role: "user", content: "Estamos na Vila do Maio" }], { locale: "pt", car: null })?.zoneId, "vila");
  assert.equal(locationFromConversation(places, [{ role: "user", content: "what's the best thing to do?" }], { locale: "en", car: null }), null);
});

test("cards follow the order the reply names places, once each, nested names collapse", () => {
  const places = buildIndex(FIXTURE);
  const anchor = resolveAnchor(places, "Vila do Maio");
  const cards = cardsForReply("Walk to Bitche Rotcha, then eat at Big Game Restaurant - Pizzeria.", new Map(), places, anchor);
  assert.deepEqual(cards.map((card) => card.name), ["Bitche Rotcha Beach", "Big Game Restaurant - Pizzeria"]);
  assert.equal(findPlace(places, "Vanuza")?.name, "Bar restaurante Vanuza");
});

test("routing: open and nearby questions go to the guide; plans, edits and emergencies do not", () => {
  const base = { planShaping: false, intent: "side_question", research: false, carPending: false, hasPlan: false, planEdit: false };
  for (const q of ["What's the best thing to do in Maio?", "Where to eat near Calheta?", "How do I get to Maio from Lisbon?", "Onde comer perto da Calheta?", "Coming from London, what's the easiest way to Maio?"]) {
    assert.equal(isVisitorQuestion(q, base), true, q);
  }
  assert.equal(isVisitorQuestion("Plan my 3 days", base), false);
  assert.equal(isVisitorQuestion("Where is the hospital?", base), false);
  assert.equal(isVisitorQuestion("What's the phone of Casa do Mar?", base), false);
  assert.equal(isVisitorQuestion("Where to eat?", { ...base, carPending: true }), false);
  assert.equal(isVisitorQuestion("can we take it easier on the last day?", { ...base, hasPlan: true }), false);
  assert.equal(isVisitorQuestion("quero um segundo dia mais lento", { ...base, hasPlan: true }), false);
  assert.equal(isVisitorQuestion("How many tourists came in 2024?", { ...base, research: true }), false);
});

test("the background is a 2–4k word document and names the main villages and routes", () => {
  const words = MAIO_BACKGROUND.split(/\s+/).length;
  assert.ok(words >= 1800 && words <= 4000, `${words}`);
  for (const name of ["Vila do Maio", "Calheta", "Morrinho", "Cascabulho", "Pedro Vaz", "Barreiro", "Figueira", "Ribeira D. João", "Pilão Cão", "Alcatraz", "CVSky", "CV Interilhas", "Lisbon"]) {
    assert.ok(MAIO_BACKGROUND.includes(name), name);
  }
});

test("the agent sorts by distance in the tool and returns cards for what it names", async () => {
  setPlaceIndex(buildIndex(FIXTURE));
  let step = 0;
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      step += 1;
      if (step === 1) return { content: [{ type: "tool-call" as const, toolCallId: "c1", toolName: "places_nearby", input: JSON.stringify({ categories: ["food"], near: null, car: false, limit: 3 }) }], finishReason: { unified: "tool-calls" as const, raw: undefined }, usage, warnings: [] };
      return { content: [{ type: "text" as const, text: "Bar restaurante Vanuza is a 3-minute walk." }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
    },
  }) as unknown as LanguageModel;
  try {
    const result = await runVisitorAgent([{ role: "user", content: "We're staying in Calheta, where can we eat?" }], { locale: "en", car: false }, { model, fetchImpl: fetch });
    assert.equal(result.anchor?.zoneId, "calheta");
    assert.deepEqual(result.cards.map((card) => card.name), ["Bar restaurante Vanuza"]);
    assert.equal(result.toolEvents[0].name, "places_nearby");
    assert.ok(result.facts[0].includes("Bar restaurante Vanuza"));
    assert.ok(!result.facts[0].includes("Big Game"));
  } finally {
    setPlaceIndex(null);
  }
});

test("replies are clamped to chat size and drop trailing offers", () => {
  assert.equal(clampReply("The sea is calm today. If you’d like, I can fetch the 7-day forecast."), "The sea is calm today.");
  assert.equal(clampReply("One. Two is 2.5 km away. Three? Four."), "One. Two is 2.5 km away. Three?");
  const long = Array.from({ length: 5 }, (_, i) => `Sentence ${i} has exactly some twenty words in it to push the total count well past the sixty word limit ok.`).join(" ");
  assert.ok(clampReply(long).split(/\s+/).length <= 60);
  assert.equal(clampReply("Windy day? Head into Vila for the fort."), "Head into Vila for the fort.");
  assert.equal(clampReply("Is it safe?"), "Is it safe?");
  assert.ok(clampReply("**Best:** Baxona Beach.\n- calm water").startsWith("Best: Baxona Beach."));
});

test("scrub drops a made-up tourist office, raw listing wording and borrowed superlatives", () => {
  assert.equal(scrubReply("J&Tour (listed) offers island excursions; ask your hotel or the Tourist Office in Vila to book."), "J&Tour offers island excursions; ask your hotel to book.");
  assert.equal(scrubReply('Big Game Sport Fishing (listed as a "location not listed" experience) runs trips.'), "Big Game Sport Fishing runs trips.");
  assert.equal(scrubReply("Most visitors call Praia Real the most beautiful: long white sand."), "I'd call Praia Real the most beautiful: long white sand.");
  assert.equal(scrubReply("Praia Real is widely considered the best beach."), "Praia Real is arguably the best beach.");
  assert.equal(scrubReply("Visit the tourist office. Bitche Rotcha is by the pier."), "Bitche Rotcha is by the pier.");
  assert.equal(scrubReply("Ask at the tourist office."), "");
  assert.equal(scrubReply("Morro Beach is walkable. Note the listing says the sea there can make swimming unsafe."), "Morro Beach is walkable. Note the sea there can make swimming unsafe.");
  assert.equal(scrubReply("Restaurante Bar Anita — the local listing shows it as a Calheta restaurant."), "Restaurante Bar Anita — it is a Calheta restaurant.");
  assert.equal(scrubReply("Most visitors without a car also stay in Vila do Maio."), "You can also stay in Vila do Maio.");
  assert.equal(scrubReply("Ring them directly; the phone is not listed."), "Ring them directly; the phone is not listed.");
  assert.equal(scrubReply("Baxona Beach in Calheta has very calm water."), "Baxona Beach in Calheta has very calm water.");
});

test("a reply that only asks a question back is detected", () => {
  assert.equal(onlyQuestions("Which village are you staying in?"), true);
  assert.equal(onlyQuestions("J&Tour runs island tours. Which village are you in?"), false);
  assert.equal(onlyQuestions(""), false);
});
