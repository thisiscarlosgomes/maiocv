// Step 3: outside-the-listings fallback (Google Places → Parallel web search), labels, time caps, origin.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModel } from "ai";
import { fallbackConfig, googlePlaces, parallelSearch, searchBeyondListings, type FallbackHit } from "../lib/visitor/fallback.ts";
import { labelOutsideSources, originFor, runVisitorAgent } from "../lib/visitor/agent.ts";
import { buildIndex, setPlaceIndex, type Anchor } from "../lib/visitor/places.ts";

const NONE = {};
const BOTH = { GOOGLE_PLACES_API_KEY: "g-test", PARALLEL_API_KEY: "p-test" };
const far = () => Date.now() + 20_000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function recorder(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    for (const [part, reply] of Object.entries(routes)) if (url.includes(part)) return reply();
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const GOOGLE_BODY = { places: [
  { id: "a", displayName: { text: "Clinica Dentaria Maio" }, formattedAddress: "Vila do Maio", location: { latitude: 15.137, longitude: -23.212 }, googleMapsUri: "https://maps.google.com/?cid=1", businessStatus: "OPERATIONAL" },
  { id: "b", displayName: { text: "Dentist in Sal" }, location: { latitude: 16.6, longitude: -22.9 }, businessStatus: "OPERATIONAL" },
  { id: "c", displayName: { text: "Old Dentist" }, location: { latitude: 15.14, longitude: -23.21 }, businessStatus: "CLOSED_PERMANENTLY" },
] };
const PARALLEL_BODY = { results: [
  { url: "https://www.yogacaboverde.com/", title: "Yoga Cabo Verde | classes in Santa Maria, Sal", excerpts: ["Group classes in Santa Maria, Sal."] },
  { url: "https://maio-yoga.example/classes", title: "Maio Yoga – beach classes", excerpts: ["Sunrise yoga on the beach in Vila do Maio, Maio island, three mornings a week."] },
] };

test("with no keys the fallback is a no-op and makes no request", async () => {
  const { calls, fetchImpl } = recorder({});
  assert.deepEqual(fallbackConfig(NONE), { google: false, parallel: false });
  const result = await searchBeyondListings("dentist", { fetchImpl, deadline: far(), env: NONE });
  assert.equal(result.source, "none");
  assert.deepEqual(result.hits, []);
  assert.deepEqual(calls, []);
  assert.match(result.note, /don't have it/);
});

test("Google Places keeps operational places on Maio, with distances from the guest", async () => {
  const { calls, fetchImpl } = recorder({ "places.googleapis.com": () => json(GOOGLE_BODY) });
  const hits = await googlePlaces("dentist", { fetchImpl, deadline: far(), env: BOTH, near: { lat: 15.135, lon: -23.215 } });
  assert.equal(calls.length, 1);
  assert.deepEqual(hits?.map((hit) => hit.name), ["Clinica Dentaria Maio"]);
  assert.equal(hits?.[0].sourceLabel, "Google Maps");
  assert.equal(hits?.[0].area, "Vila do Maio");
  assert.ok((hits?.[0].walkMin ?? 99) <= 10);
});

test("Google first; the web only when Google has nothing, and only pages about Maio", async () => {
  const { calls, fetchImpl } = recorder({ "places.googleapis.com": () => json({ places: [] }), "api.parallel.ai": () => json(PARALLEL_BODY) });
  const result = await searchBeyondListings("yoga", { fetchImpl, deadline: far(), env: BOTH });
  assert.deepEqual(result.tried, ["google", "web"]);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes("googleapis") && calls[1].includes("parallel"));
  assert.equal(result.source, "web");
  assert.deepEqual(result.hits.map((hit) => hit.sourceLabel), ["maio-yoga.example"]);
  assert.match(result.hits[0].snippet ?? "", /Vila do Maio/);
});

test("a failing or slow provider falls through; nothing left in the budget means no call", async () => {
  const { fetchImpl } = recorder({ "places.googleapis.com": () => { throw new Error("boom"); }, "api.parallel.ai": () => json({}, 500) });
  const result = await searchBeyondListings("yoga", { fetchImpl, deadline: far(), env: BOTH });
  assert.equal(result.source, "none");
  const idle = recorder({});
  assert.equal(await googlePlaces("x", { fetchImpl: idle.fetchImpl, deadline: Date.now() + 1_000, env: BOTH }), null);
  assert.equal(await parallelSearch("x", { fetchImpl: idle.fetchImpl, deadline: Date.now() + 1_000, env: BOTH }), null);
  assert.deepEqual(idle.calls, []);
});

test("each provider call is capped in time", async () => {
  let aborted = false;
  const fetchImpl = ((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); });
  })) as typeof fetch;
  const t0 = Date.now();
  assert.equal(await googlePlaces("x", { fetchImpl, deadline: Date.now() + 4_500, env: BOTH }), null);
  assert.ok(aborted);
  assert.ok(Date.now() - t0 < 3_000, `${Date.now() - t0}ms`);
});

const googleHit: FallbackHit = { name: "Clinica Dentaria Maio", source: "google", sourceLabel: "Google Maps", url: "https://maps.google.com/?cid=1", address: null, lat: 15.137, lon: -23.212, area: "Vila do Maio", km: 0.4, walkMin: 6, driveMin: 2, snippet: null };
const webHit: FallbackHit = { name: "Maio Yoga", source: "web", sourceLabel: "maio-yoga.example", url: "https://maio-yoga.example/classes", address: null, lat: null, lon: null, area: null, km: null, walkMin: null, driveMin: null, snippet: "…" };

test("outside results the reply uses are labelled, carded and cited", () => {
  const google = labelOutsideSources("Clinica Dentaria Maio in Vila is a 6 min walk.", [googleHit]);
  assert.match(google.reply, /Source: Google Maps\.$/);
  assert.equal(google.cards[0].source, "google");
  assert.deepEqual(google.sources, [{ label: "Google Maps", url: googleHit.url, kind: "google" }]);
  const already = labelOutsideSources("Clinica Dentaria Maio (Google Maps) is a 6 min walk.", [googleHit]);
  assert.equal(already.reply, "Clinica Dentaria Maio (Google Maps) is a 6 min walk.");
  const web = labelOutsideSources("Sunrise yoga runs on the beach in Vila (source: maio-yoga.example).", [webHit]);
  assert.equal(web.reply, "Sunrise yoga runs on the beach in Vila (source: maio-yoga.example).");
  assert.deepEqual(web.sources.map((item) => item.url), [webHit.url]);
  assert.equal(web.cards.length, 0);
  const unused = labelOutsideSources("I don't have a yoga class for Maio; ask your stay.", [webHit, googleHit]);
  assert.deepEqual(unused, { reply: "I don't have a yoga class for Maio; ask your stay.", cards: [], sources: [] });
});

test("distances use the guest's stay, not the centre of its own village", () => {
  const stay: Anchor = { name: "Casa do Mar", lat: 15.2271, lon: -23.2167, zone: "Calheta", zoneId: "calheta", source: "context" };
  const village: Anchor = { name: "Calheta", lat: 15.2292, lon: -23.2112, zone: "Calheta", zoneId: "calheta", source: "village" };
  const other: Anchor = { name: "Morro", lat: 15.18, lon: -23.22, zone: "Morro", zoneId: "morro", source: "village" };
  const beach: Anchor = { name: "Baxona Beach", lat: 15.23, lon: -23.22, zone: "Calheta", zoneId: "calheta", source: "place" };
  assert.equal(originFor(village, stay), stay);
  assert.equal(originFor(null, stay), stay);
  assert.equal(originFor(other, stay), other);
  assert.equal(originFor(beach, stay), beach);
  assert.equal(originFor(village, null), village);
  assert.equal(originFor(village, village), village);
});

test("the guide reaches the fallback only through its tool, and labels what it found", async () => {
  setPlaceIndex(buildIndex([]));
  let step = 0;
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      step += 1;
      if (step === 1) return { content: [{ type: "tool-call" as const, toolCallId: "c1", toolName: "search_beyond_listings", input: JSON.stringify({ query: "dentist" }) }], finishReason: { unified: "tool-calls" as const, raw: undefined }, usage, warnings: [] };
      return { content: [{ type: "text" as const, text: "Clinica Dentaria Maio in Vila do Maio is the one I found." }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
    },
  }) as unknown as LanguageModel;
  const { calls, fetchImpl } = recorder({ "places.googleapis.com": () => json(GOOGLE_BODY), "": () => json({ data: [] }) });
  try {
    const result = await runVisitorAgent([{ role: "user", content: "Is there a dentist?" }], { locale: "en", car: null }, { model, fetchImpl, placesFetch: fetchImpl, env: { GOOGLE_PLACES_API_KEY: "g-test" } });
    assert.ok(calls.some((url) => url.includes("places.googleapis.com")));
    assert.match(result.reply, /Source: Google Maps\./);
    assert.equal(result.cards[0]?.source, "google");
    assert.equal(result.sources[0]?.kind, "google");
    assert.equal(result.toolEvents[0].name, "search_beyond_listings");
  } finally {
    setPlaceIndex(null);
  }
});

test("a page titled after the island is not 'named' just because the reply says Maio", () => {
  const island: FallbackHit = { ...webHit, name: "Maio", sourceLabel: "triptamba.com", url: "https://triptamba.com/cape-verde/maio" };
  const result = labelOutsideSources("Ask your guesthouse in Vila do Maio; most stays on Maio wash for guests.", [island]);
  assert.deepEqual(result.sources, []);
  assert.doesNotMatch(result.reply, /triptamba/);
});

test("'near <their own village>' still measures from the saved stay", async () => {
  const { locationFromConversation } = await import("../lib/visitor/agent.ts");
  const stay = { name: "Casa do Mar", area: "Calheta", lat: 15.2271, lon: -23.2167 };
  const anchor = locationFromConversation([], [{ role: "user", content: "Any restaurant near Calheta?" }], { locale: "en", car: null, stay });
  assert.equal(anchor?.name, "Casa do Mar");
  const moved = locationFromConversation([], [{ role: "user", content: "Any restaurant near Morro?" }], { locale: "en", car: null, stay });
  assert.equal(moved?.zoneId, "morro");
});

test("without keys the guide is never offered the outside lookup", async () => {
  setPlaceIndex(buildIndex([]));
  let seen: string[] = [];
  let system = "";
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
  const model = new MockLanguageModelV4({
    doGenerate: async (options: { tools?: { name: string }[]; prompt: { role: string; content: unknown }[] }) => {
      seen = (options.tools ?? []).map((item) => item.name);
      system = String(options.prompt.find((item) => item.role === "system")?.content ?? "");
      return { content: [{ type: "text" as const, text: "I don't have a dentist for Maio; ask your stay." }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
    },
  } as never) as unknown as LanguageModel;
  const { calls, fetchImpl } = recorder({ "": () => json({ data: [] }) });
  try {
    const result = await runVisitorAgent([{ role: "user", content: "Is there a dentist?" }], { locale: "en", car: null }, { model, fetchImpl, placesFetch: fetchImpl, env: {} });
    assert.ok(seen.includes("places_nearby"));
    assert.ok(!seen.includes("search_beyond_listings"));
    assert.doesNotMatch(system, /search_beyond_listings/);
    assert.ok(!calls.some((url) => /googleapis|parallel\.ai/.test(url)));
    assert.deepEqual(result.sources, []);
  } finally {
    setPlaceIndex(null);
  }
});

test("an outside hit for a place Maio already lists is not labelled as outside", () => {
  const listed = buildIndex([]);
  const onda: FallbackHit = { ...webHit, name: "Onda Azul Maio", sourceLabel: "kitesurfing.me", url: "https://www.kitesurfing.me/schools/onda-azul-maio" };
  const place = { ...(listed[0] ?? {}), id: "onda", name: "Onda Azul Maio" } as never;
  const result = labelOutsideSources("Ask Onda Azul Maio in Vila about classes.", [onda], [place]);
  assert.deepEqual(result.sources, []);
  assert.doesNotMatch(result.reply, /kitesurfing/);
});

test("offers to search further are dropped, the useful part stays", async () => {
  const { clampReply } = await import("../lib/visitor/agent.ts");
  assert.equal(clampReply("No studio is listed. Ask your stay or Onda Azul Maio; sinon je peux chercher au-delà des listes."), "No studio is listed. Ask your stay or Onda Azul Maio.");
  assert.equal(clampReply("I don't have a dentist listed. Ask the health centre in Vila. Would you like the health centre phone number?"), "I don't have a dentist listed. Ask the health centre in Vila.");
});

test("a need matches Maio business categories before anything goes outside", async () => {
  const { searchBusinessesByNeed } = await import("../lib/maio-catalog.ts");
  const records = [
    { id: "1", name: "Barbearia DAD", phone: "", location: "Vila do Maio", category: "hairdresser" },
    { id: "2", name: "Casa Blanca Supermarket", phone: "", location: "Vila do Maio", category: "supermarket" },
  ];
  assert.deepEqual(searchBusinessesByNeed(records, "hairdresser").map((row) => row.name), ["Barbearia DAD"]);
  assert.deepEqual(searchBusinessesByNeed(records, "cabeleireiro").map((row) => row.name), ["Barbearia DAD"]);
  assert.deepEqual(searchBusinessesByNeed(records, "groceries").map((row) => row.name), ["Casa Blanca Supermarket"]);
  assert.deepEqual(searchBusinessesByNeed(records, "dentist"), []);
});
