import { generateText, stepCountIs, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { maioClock } from "../agora.ts";
import { carRentalRecords, loadBusinesses, searchBusinesses } from "../maio-catalog.ts";
import { readWeather } from "../maio-chat-tools.ts";
import { loadTimetable } from "../timetable.ts";
import { scrubReply } from "./scrub.ts";
import { MAIO_BACKGROUND } from "./background.ts";
import { fold, zoneFromText } from "./geo.ts";
import { findPlace, loadPlaces, nearby, resolveAnchor, PLACE_KINDS, type Anchor, type NearbyRow, type Place, type PlaceKind } from "./places.ts";

export type VisitorLocale = "en" | "pt" | "fr";
export type VisitorTurn = { role: "user" | "assistant"; content: string };
export type PlaceCard = { id: string; name: string; kind: PlaceKind; area: string | null; km: number | null; walkMin: number | null; driveMin: number | null; image: string | null; approxLocation: boolean };
export type VisitorContext = {
  locale: VisitorLocale;
  /** Known car answer from the task; null when the guest has not said. */
  car: boolean | null;
  /** Saved stay (name/area/coords) from the task. */
  stay?: { name: string; area?: string; lat?: number; lon?: number } | null;
  /** Place names last shown to the guest, newest first. */
  lastPlaces?: string[];
};
export type VisitorResult = { reply: string; cards: PlaceCard[]; toolEvents: { name: string; ok: boolean; arguments?: unknown }[]; facts: string[]; anchor: Anchor | null };
export type VisitorDeps = { model: LanguageModel; fetchImpl: typeof fetch; /** Unbudgeted fetch for the cached place list. */ placesFetch?: typeof fetch; now?: Date; timeoutMs?: number };

/** Static first, so the provider can cache the prefix across turns. */
export const VISITOR_RULES = `
You are the Maio guide on maio.cv: a local friend who knows the island of Maio, Cabo Verde, well. You answer visitors' questions in chat.

How to answer:
- Answer the actual question first. HARD LIMIT: at most 3 sentences and 60 words in total, one paragraph. Key fact first. Plain text: no headings, no bold, no tables, no lists. Pick the best one to three places instead of listing everything; the app shows place cards above your text.
- Do not start a trip plan unless the guest asks for one (dates, "plan my days", "itinerary"). An open question such as "what's the best thing to do in Maio?" gets a thoughtful, opinionated answer with one or two highlights, not a plan and not a question back.
- Never open with a question, and never start by repeating the guest's question back ("Windy day?"). Do not ask whether they have a car unless the answer truly depends on it, and then answer for both cases first. Ask at most ONE short follow-up, only when it changes the advice, as the last sentence. Never end with an offer ("Would you like…", "Do you want…", "I can check…"). A follow-up question is allowed only when you could not give a useful answer without it.
- Nearby means the same village or area. Use places_nearby for anything "near", "close", "around", "in <village>", "where to eat/swim/stay". Recommend the nearest results first and give the distance as walking minutes (no car / in town) or driving minutes (car). If nothing is listed close by, say so plainly and name the nearest with its distance. Never present a place in another village (e.g. Vila do Maio for someone in Calheta) as "nearby".
- Name only places, restaurants, stays, operators and businesses from "Listed places" below, a tool result, or the background. If a name is not there, it does not exist for you. For open questions without a location, pick from the background highlights and the listed places. Never invent a venue, phone number, price, opening hour, menu or timetable. If a detail is not in the data, say it is not listed and suggest asking the place or locals.
- Describe a place only with what its summary or the background says (do not call a beach calm, a restaurant cheap, good for breakfast, or a view stunning unless that is in the data).
- Never mention a tourist office or tourist information point: none is listed. When asked about tours or a tourist office, say none is listed and name the listed tour operators to book with, or say to ask the stay.
- Never quote listing wording or labels ("location not listed", "listed as", "(listed)"), and never say "the listing says/shows"; just state the fact. If a place's village is not given, just do not say where it is.
- No superlatives you cannot back: do not say "most visitors", "everyone says", "widely considered" or "the best/most beautiful" as a fact. Give your own pick as an opinion ("I'd pick …") with the reason from its summary.
- Listings have no opening hours, menus, prices or diet flags.
- Transport times only from get_transport. Weather and sea only from get_maio_weather.
- When the guest says where they are or are staying, use it as the location for distances for the rest of the chat.
- Reply in the guest's language (English, Portuguese or French). Use the place names as the tools return them.
- Never mention tools, ids, "the API", "the data", "listings data" or the background document. Say "I don't have that" naturally.
`.trim();

const KIND_ALIASES: Record<string, PlaceKind[]> = {
  food: ["food"], eat: ["food"], restaurant: ["food"], lunch: ["food"], dinner: ["food"], breakfast: ["food"], bar: ["bar"], drinks: ["bar"], nightlife: ["bar"],
  beach: ["beach"], swim: ["beach"], stay: ["stay"], hotel: ["stay"], experience: ["experience"], activity: ["experience"], tour: ["experience"],
  sight: ["sight"], culture: ["sight"], nature: ["nature"], hike: ["nature"], village: ["village"], shop: ["shop"], groceries: ["shop"], any: [],
};

function kindsFrom(values: string[] | undefined): PlaceKind[] {
  const out = new Set<PlaceKind>();
  for (const value of values ?? []) {
    const key = fold(value);
    if ((PLACE_KINDS as string[]).includes(key)) out.add(key as PlaceKind);
    for (const kind of KIND_ALIASES[key] ?? []) out.add(kind);
  }
  return [...out];
}

/** Where the guest is, from what they said: newest user turn that names a village or a listed place. */
export function locationFromConversation(places: Place[], turns: VisitorTurn[], context: VisitorContext): Anchor | null {
  const users = turns.filter((turn) => turn.role === "user").map((turn) => turn.content).reverse();
  for (const text of users) {
    const n = fold(text);
    // Destinations ("how far is Morro", "go to Calheta") are not where the guest is.
    const here = n.match(/\b(?:staying|stay|we re|i m|im|we are|i am|based|sleeping|ficamos|ficar|estamos|estou|hospedad\w*|on loge|nous sommes|je suis|logeons)\b(?:\s+\S+){0,2}?\s+(?:in|at|on|near|em|no|na|a|au|dans|pres de|perto de|perto do|perto da)\s+(.{3,60})$/)
      ?? n.match(/\b(?:near|close to|around|in|perto de|perto do|perto da|em|no|na|pres de|autour de|a cote de)\s+(.{3,40})$/);
    const phrase = here?.[1] ?? null;
    if (phrase) {
      const anchor = resolveAnchor(places, phrase);
      if (anchor) return anchor;
    }
  }
  if (context.stay?.lat !== undefined && context.stay?.lon !== undefined) {
    const zone = zoneFromText(context.stay.area ?? context.stay.name);
    return { name: context.stay.name, lat: context.stay.lat, lon: context.stay.lon, zone: zone?.name ?? context.stay.area ?? "", zoneId: zone?.id ?? "", source: "context" };
  }
  if (context.stay) {
    const anchor = resolveAnchor(places, context.stay.name) ?? resolveAnchor(places, context.stay.area ?? "");
    if (anchor) return { ...anchor, source: "context" };
  }
  return null;
}

/** Every listed name by village, so the model can only pick real ones. Changes only when the API does. */
export function catalogBlock(places: Place[]): string {
  if (!places.length) return "Listed places: unavailable right now. Name no restaurant, stay, shop or operator.";
  const byZone = new Map<string, Map<PlaceKind, string[]>>();
  for (const place of places) {
    const zone = place.zone ?? "Elsewhere on the island";
    const kinds = byZone.get(zone) ?? new Map<PlaceKind, string[]>();
    kinds.set(place.kind, [...(kinds.get(place.kind) ?? []), place.name]);
    byZone.set(zone, kinds);
  }
  const lines = [...byZone.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([zone, kinds]) =>
    `- ${zone}: ${[...kinds.entries()].map(([kind, names]) => `${kind}: ${names.join("; ")}`).join(" | ")}`);
  return `Listed places by nearest village (use places_nearby for distances):\n${lines.join("\n")}`;
}

function contextBlock(today: string, context: VisitorContext, anchor: Anchor | null): string {
  const where = anchor ? `${anchor.name}${anchor.zone && anchor.zone !== anchor.name ? ` (${anchor.zone})` : ""}` : "unknown";
  return [
    `Today in Cabo Verde: ${today}.`,
    `Guest language: ${context.locale}.`,
    `Guest location for distances: ${where}.`,
    `Car: ${context.car === true ? "yes" : context.car === false ? "no car" : "not said"}.`,
    context.lastPlaces?.length ? `Places shown to the guest last: ${context.lastPlaces.slice(0, 6).join(", ")}.` : "",
  ].filter(Boolean).join("\n");
}

function card(place: Place | undefined, row: NearbyRow): PlaceCard {
  return { id: row.id, name: row.name, kind: row.kind, area: row.area, km: row.km, walkMin: row.walkMin, driveMin: row.driveMin, image: place?.image ?? null, approxLocation: row.approxLocation };
}

/** Cards for the places the reply actually names, in the order it names them. */
const OFFER = /^(?:if you(?:'|’)?d like,? (?:i|me)\b|if you want,? (?:i|me)\b|if you want me to|if you tell me\b.*\bi(?:'|’)ll|would you like (?:me|to know)|do you want me to|want me to|i can (?:also )?(?:check|fetch|look|share|send)|let me know|se quiser,? (?:eu|posso)|queres que|si vous voulez,? je|voulez-vous que)/i;

/** Chat-sized: at most three sentences and about 60 words, no trailing offers. The first sentence always stays. */
export function clampReply(text: string, maxWords = 60, maxSentences = 3): string {
  const flat = text.replace(/\*\*|__|^#+\s*/gm, "").replace(/^\s*[-•]\s+/gm, "").replace(/\s*\n+\s*/g, " ").trim();
  const sentences = flat.split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter(Boolean);
  // "Windy day? Head into…": a short echo of the question is not an answer.
  if (sentences.length > 1 && /\?$/.test(sentences[0]) && sentences[0].split(/\s+/).length <= 4) sentences.shift();
  const kept: string[] = [];
  let words = 0;
  for (const sentence of sentences) {
    if (kept.length && OFFER.test(sentence)) continue;
    const count = sentence.split(/\s+/).length;
    if (kept.length && (kept.length >= maxSentences || words + count > maxWords)) break;
    kept.push(sentence);
    words += count;
  }
  return kept.join(" ");
}

/** Every sentence is a question: nothing was answered. */
export function onlyQuestions(text: string): boolean {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.length > 0 && sentences.every((sentence) => sentence.trim().endsWith("?"));
}

export function cardsForReply(reply: string, offered: Map<string, PlaceCard>, places: Place[] = [], anchor: Anchor | null = null, locale: "en" | "pt" = "en"): PlaceCard[] {
  // Places named from the catalogue without a tool call still get a card (distance from the guest, if known).
  for (const place of places) {
    if (offered.has(place.id) || place.kind === "village") continue;
    const row = nearby([place], { kinds: [], anchor, car: true, limit: 1, locale }).results[0];
    if (row) offered.set(place.id, { ...card(place, row), area: place.zone });
  }
  const text = fold(reply);
  const hits: { at: number; len: number; card: PlaceCard }[] = [];
  for (const item of offered.values()) {
    const name = fold(item.name);
    let at = name.length >= 4 ? text.indexOf(name) : -1;
    let len = name.length;
    if (at < 0) {
      // "Baxona" for "Baxona Beach", "Vanuza" for "Bar restaurante Vanuza".
      const core = name.replace(/\b(beach|beaches|praia|bar|restaurante|restaurant|the|of|and|do|da|de|hotel|village|lda)\b/g, " ").replace(/\s+/g, " ").trim();
      if (core.length >= 5) { at = text.indexOf(core); len = core.length; }
    }
    if (at >= 0) hits.push({ at, len, card: item });
  }
  // Two listings with one name ("Cadjetinha Beach" in Vila and in Morrinho): keep the one nearer the guest.
  for (const hit of [...hits]) {
    const twin = hits.find((other) => other !== hit && other.at === hit.at && other.len === hit.len);
    if (twin && (hit.card.km ?? Infinity) > (twin.card.km ?? Infinity)) hits.splice(hits.indexOf(hit), 1);
  }
  // "Rotcha" inside "Bitche Rotcha" is one place, not two.
  const kept = hits.filter((hit) => !hits.some((other) => other !== hit && other.len > hit.len && other.at <= hit.at && hit.at + hit.len <= other.at + other.len));
  kept.sort((a, b) => a.at - b.at);
  const seen = new Set<string>();
  return kept.filter((hit) => !seen.has(hit.card.id) && seen.add(hit.card.id)).slice(0, 4).map((hit) => hit.card);
}

export async function runVisitorAgent(turns: VisitorTurn[], context: VisitorContext, deps: VisitorDeps): Promise<VisitorResult> {
  const now = deps.now ?? new Date();
  const today = maioClock(now).date;
  const places = await loadPlaces(deps.placesFetch ?? deps.fetchImpl);
  const byId = new Map(places.map((place) => [place.id, place]));
  let anchor = locationFromConversation(places, turns, context);
  const events: VisitorResult["toolEvents"] = [];
  const facts: string[] = [];
  const offered = new Map<string, PlaceCard>();
  const locale = context.locale === "pt" ? "pt" : "en";
  const note = <T,>(name: string, args: unknown, ok: boolean, payload: T): T => {
    events.push({ name, ok, arguments: args });
    facts.push(JSON.stringify(payload).slice(0, 3000));
    return payload;
  };

  const tools = {
    places_nearby: tool({
      description: "Listed places on Maio sorted by distance (computed) from a location. Use for anything near/around/in a village, and for 'where to eat/swim/stay/go'. Returns distance, walking and driving minutes. Categories: food, bar, beach, stay, experience, sight, nature, village, shop.",
      inputSchema: z.object({
        categories: z.array(z.string()).max(4).describe("e.g. [\"food\"], [\"beach\"], [\"food\",\"bar\"]"),
        near: z.string().max(80).nullable().describe("Village, beach, stay or place name the guest is at or asked about. Null = the guest's known location."),
        car: z.boolean().nullable().describe("true with car, false without, null if unknown"),
        limit: z.number().int().min(1).max(8).nullable(),
      }),
      execute: async ({ categories, near, car, limit }) => {
        const asked = near ? resolveAnchor(places, near) : null;
        const from = asked ?? anchor;
        if (asked && !anchor) anchor = asked;
        const result = nearby(places, { kinds: kindsFrom(categories), anchor: from, car: car ?? context.car, limit: limit ?? 5, locale });
        for (const row of result.results) offered.set(row.id, card(byId.get(row.id), row));
        const unknownNear = near && !asked ? `"${near}" is not a place I can locate on Maio; distances use ${from ? from.name : "no location"}.` : "";
        if (!places.length) return note("places_nearby", { categories, near, car }, false, { listed: false, results: [], note: "The place list could not be loaded right now. Do not say a village has no restaurants, beaches or stays; say you can't load the list just now and give general advice from the background." });
        return note("places_nearby", { categories, near, car }, true, { ...result, note: [unknownNear, result.note].filter(Boolean).join(" "), listed: true });
      },
    }),
    place_details: tool({
      description: "Full details for one listed place by name: description, area, tips, phone, website, distance from the guest.",
      inputSchema: z.object({ name: z.string().min(2).max(80) }),
      execute: async ({ name }) => {
        const place = findPlace(places, name);
        if (!place) return note("place_details", { name }, false, { found: false, note: `"${name}" is not in the Maio listings.` });
        const row = nearby([place], { kinds: [], anchor, car: true, limit: 1, locale }).results[0];
        if (row) offered.set(place.id, card(place, row));
        return note("place_details", { name }, true, {
          found: true, name: place.name, kind: place.kind, area: place.zone, location: place.location, approxLocation: place.approx,
          description: locale === "pt" ? place.descriptionPt || place.description : place.description,
          tips: place.tips, phone: place.phone || null, website: place.website || null, booking: place.booking || null,
          distanceFromGuest: row?.km ?? null, walkMin: row?.walkMin ?? null, driveMin: row?.driveMin ?? null,
        });
      },
    }),
    get_transport: tool({
      description: "Published Santiago (Praia)–Maio ferry sailings (CV Interilhas) and Praia–Maio flights (CVSky) for upcoming dates. Not live status.",
      inputSchema: z.object({}),
      execute: async () => {
        const table = await loadTimetable(deps.fetchImpl, now);
        const upcoming = <T extends { date: string }>(rows: T[]) => rows.filter((row) => row.date >= today).slice(0, 12);
        return note("get_transport", {}, table.ok, { available: table.ok, stale: table.stale, sailings: upcoming(table.sailings), flights: upcoming(table.flights), note: "Published timetable only. Empty means none published, not no service." });
      },
    }),
    get_maio_weather: tool({
      description: "Current weather, wind and sea state for Maio.",
      inputSchema: z.object({}),
      execute: async () => {
        const result = await readWeather(deps.fetchImpl, now);
        return note("get_maio_weather", {}, result.available, result);
      },
    }),
    find_business: tool({
      description: "Search the Maio business directory by name or need: car rental, pharmacy, supermarket, bank, a named business. Phones only as published.",
      inputSchema: z.object({ query: z.string().min(3).max(60) }),
      execute: async ({ query }) => {
        const catalog = await loadBusinesses(deps.fetchImpl);
        const rows = /\b(car|rent|rental|aluguer|alugar|location|voiture|carro)\b/i.test(query) ? carRentalRecords(catalog.records) : searchBusinesses(catalog.records, query);
        return note("find_business", { query }, catalog.source === "api", { results: rows.slice(0, 6).map((row) => ({ name: row.name, phone: row.phone || null, location: row.location || null, category: row.category })) });
      },
    }),
  };

  const system = `${VISITOR_RULES}\n\n${MAIO_BACKGROUND}\n\n# Listed places\n${catalogBlock(places)}\n\n# This conversation\n${contextBlock(today, context, anchor)}`;
  const started = Date.now();
  const budget = deps.timeoutMs ?? 14_000;
  const ask = (extra: string, timeoutMs: number) => generateText({
    model: deps.model,
    system: system + extra,
    messages: turns.slice(-10),
    tools,
    stopWhen: stepCountIs(4),
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(timeoutMs),
  });
  const generated = await ask("", budget);
  let reply = clampReply(scrubReply(generated.text));
  // A reply that is only a question back is a dodge. One re-ask if there is time; otherwise keep it.
  const remaining = budget - (Date.now() - started);
  if (onlyQuestions(reply) && remaining > 3_000) {
    const retry = await ask(`\n\n# Correction\nYour last draft only asked the guest a question ("${reply.slice(0, 160)}"). Answer now with what you know: give the useful answer first, then at most one short follow-up.`, remaining - 500).catch(() => null);
    const second = retry ? clampReply(scrubReply(retry.text)) : "";
    if (second && !onlyQuestions(second)) reply = second;
  }
  // The guest's own location is context, not a suggestion.
  const cards = cardsForReply(reply, offered, places, anchor, locale).filter((item) => !anchor || anchor.source === "village" || fold(item.name) !== fold(anchor.name));
  return { reply, cards, toolEvents: events, facts, anchor };
}
