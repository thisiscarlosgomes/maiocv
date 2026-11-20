import { generateText, stepCountIs, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { maioClock } from "../agora.ts";
import { carRentalRecords, loadBusinesses, searchBusinesses } from "../maio-catalog.ts";
import { readWeather } from "../maio-chat-tools.ts";
import { loadTimetable } from "../timetable.ts";
import { scrubReply } from "./scrub.ts";
import { MAIO_BACKGROUND } from "./background.ts";
import { fold, zoneFromText, ZONES } from "./geo.ts";
import { findPlace, loadPlaces, nearby, resolveAnchor, PLACE_KINDS, type Anchor, type NearbyRow, type Place, type PlaceKind } from "./places.ts";

export type VisitorLocale = "en" | "pt" | "fr";
export type VisitorTurn = { role: "user" | "assistant"; content: string };
export type PlaceCard = { id: string; name: string; kind: PlaceKind; area: string | null; km: number | null; walkMin: number | null; driveMin: number | null; image: string | null; approxLocation: boolean; lat: number | null; lon: number | null };
export type VisitorContext = {
  locale: VisitorLocale;
  /** Known car answer from the task; null when the guest has not said. */
  car: boolean | null;
  /** Saved stay (name/area/coords) from the task. */
  stay?: { name: string; area?: string; lat?: number; lon?: number } | null;
  /** Place names last shown to the guest, newest first. */
  lastPlaces?: string[];
  /** The village the guest is based in, when they named a village rather than a listed stay. */
  base?: { zoneId: string; name: string; lat: number; lon: number } | null;
  party?: { adults?: number; kids?: number; youngestAge?: number } | null;
  dates?: { start?: string; days?: number } | null;
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
- Nearby means the same village or area. Use places_nearby for anything "near", "close", "around", "in <village>", "where to eat/swim/stay". Recommend the nearest results first and give the distance exactly as places_nearby returns it ("3 min walk", not a made-up range) as walking minutes (no car / in town) or driving minutes (car). If nothing is listed close by, say so plainly and name the nearest with its distance. Never present a place in another village (e.g. Vila do Maio for someone in Calheta) as "nearby".
- Name only places, restaurants, stays, operators and businesses from "Listed places" below, a tool result, or the background. If a name is not there, it does not exist for you. For open questions without a location, pick from the background highlights and the listed places. Never invent a venue, phone number, price, opening hour, menu or timetable. If a detail is not in the data, say it is not listed and suggest asking the place or locals.
- Describe a place only with what its summary or the background says (do not call a beach calm, a restaurant cheap, good for breakfast, or a view stunning unless that is in the data).
- Never mention a tourist office or tourist information point: none is listed. When asked about tours or a tourist office, say none is listed and name the listed tour operators to book with, or say to ask the stay.
- Never quote listing wording or labels ("location not listed", "listed as", "(listed)"), and never say "the listing says/shows"; just state the fact. If a place's village is not given, just do not say where it is.
- No superlatives you cannot back: do not say "most visitors", "everyone says", "widely considered" or "the best/most beautiful" as a fact. Give your own pick as an opinion ("I'd pick …") with the reason from its summary.
- Listings have no opening hours, menus, prices or diet flags.
- Transport times only from get_transport. Weather and sea only from get_maio_weather.
- When the guest says where they are or are staying, use it as the location for distances for the rest of the chat.
- "This conversation" below holds what the guest already told you (location, car, party, dates, places shown). Use it; never ask for something already there. Season questions ("will we see turtles?") are answered for their dates.
- When Car is NO and you recommend a place beyond walking distance, say in the same reply how to get there without a car (aluguer, taxi or a guided tour).
- Nearby recommendations stay in the guest's village. Do not add options in another village unless nothing fitting is listed in theirs; then name only the single nearest one with its distance.
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
    const here = n.match(/\b(?:moved|moving|switched|mudamos|mudamo nos|nous avons demenage|on a demenage)\s+(?:\S+\s+)?(?:to|para|a|au|dans)\s+(.{3,60})$/)
      ?? n.match(/\b(?:staying|stay|booked|we re|i m|im|we are|i am|based|sleeping|ficamos|ficar|estamos|estou|hospedad\w*|on loge|nous sommes|je suis|logeons)\b(?:\s+\S+){0,2}?\s+(?:in|at|on|near|em|no|na|a|au|dans|pres de|perto de|perto do|perto da)\s+(.{3,60})$/)
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
  if (context.base) return { name: context.base.name, lat: context.base.lat, lon: context.base.lon, zone: context.base.name, zoneId: context.base.zoneId, source: "context" };
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

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function partyLine(party: VisitorContext["party"]): string {
  if (!party || (party.adults === undefined && party.kids === undefined)) return "not said";
  const parts = [party.adults !== undefined ? `${party.adults} adult${party.adults === 1 ? "" : "s"}` : "", party.kids ? `${party.kids} child${party.kids === 1 ? "" : "ren"}${party.youngestAge !== undefined ? ` (youngest ${party.youngestAge})` : ""}` : ""].filter(Boolean);
  return `${parts.join(", ")}${party.kids ? " — favour calm, shallow, easy places" : ""}`;
}

function datesLine(dates: VisitorContext["dates"]): string {
  if (!dates?.start) return dates?.days ? `${dates.days} days, start not said` : "not said";
  const month = MONTHS[Number(dates.start.slice(5, 7)) - 1];
  return `arriving ${dates.start}${dates.days ? ` for ${dates.days} days` : ""} (${month}; use this month for season questions)`;
}

function contextBlock(today: string, context: VisitorContext, anchor: Anchor | null): string {
  const where = anchor ? `${anchor.name}${anchor.zone && anchor.zone !== anchor.name ? ` (${anchor.zone})` : ""}` : "unknown";
  return [
    `Today in Cabo Verde: ${today}.`,
    `Guest language: ${context.locale}.`,
    `Guest location for distances: ${where}.`,
    `Car: ${context.car === true ? "yes" : context.car === false ? "NO car (never suggest driving; give walking, aluguer, taxi or guided-tour options)" : "not said"}.`,
    `Party: ${partyLine(context.party)}.`,
    `Dates: ${datesLine(context.dates)}.`,
    context.lastPlaces?.length ? `Places already shown to the guest, newest first ("those", "the first one" mean these): ${context.lastPlaces.slice(0, 8).join(", ")}.` : "",
  ].filter(Boolean).join("\n");
}

function card(place: Place | undefined, row: NearbyRow): PlaceCard {
  return { id: row.id, name: row.name, kind: row.kind, area: row.area, km: row.km, walkMin: row.walkMin, driveMin: row.driveMin, image: place?.image ?? null, approxLocation: row.approxLocation, lat: place?.lat ?? null, lon: place?.lon ?? null };
}

/** Cards for the places the reply actually names, in the order it names them. */
const OFFER = /^(?:if you(?:'|’)?d like,? (?:i|me)\b|if you want,? (?:i|me)\b|if you want me to|if you tell me\b.*\bi(?:'|’)ll|would you like (?:me|to know)|do you want me to|want me to|i can (?:also )?(?:check|fetch|look|share|send)|let me know|se quiser,? (?:eu|posso)|queres que|quer que eu|quere(?:m|is) que eu|si vous voulez,? je|voulez-vous que)/i;

/** An offer to go and do more, anywhere in a later sentence ("…I can check for monitoring programs, should I look?"). */
const OFFER_ANYWHERE = /\b(?:i can (?:also )?(?:check|look(?: up)?|find|fetch|send|share|call|book|ring)|should i (?:look|check|call)|shall i|want me to|quer que eu|posso verificar|voulez-vous que je|je peux v[ée]rifier)\b/i;

/** Chat-sized: at most three sentences and about 60 words, no trailing offers. The first sentence always stays. */
export function clampReply(text: string, maxWords = 60, maxSentences = 3): string {
  const flat = text.replace(/\*\*|__|^#+\s*/gm, "").replace(/^\s*[-•]\s+/gm, "").replace(/\s*\n+\s*/g, " ").trim();
  const sentences = flat.split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter(Boolean);
  // "Windy day? Head into…": a short echo of the question is not an answer.
  if (sentences.length > 1 && /\?$/.test(sentences[0]) && sentences[0].split(/\s+/).length <= 4) sentences.shift();
  const kept: string[] = [];
  let words = 0;
  for (const sentence of sentences) {
    if (kept.length && (OFFER.test(sentence) || OFFER_ANYWHERE.test(sentence))) continue;
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

export function cardsForReply(reply: string, offered: Map<string, PlaceCard>, places: Place[] = [], anchor: Anchor | null = null, locale: "en" | "pt" = "en", limit = 4): PlaceCard[] {
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
      // "Morro" alone is the village, not Morro Beach.
      const village = ZONES.some((zone) => fold(zone.name) === core || zone.aliases.includes(core));
      if (core.length >= 5 && !village) { at = text.indexOf(core); len = core.length; }
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
  return kept.filter((hit) => !seen.has(hit.card.id) && seen.add(hit.card.id)).slice(0, limit).map((hit) => hit.card);
}

const NEAR_KINDS = new Set<PlaceKind>(["food", "bar", "beach", "shop"]);

/**
 * Nearby means the guest's village. When the reply already names a fitting place there, a same-kind place in
 * another village is dropped from the text (its clause) and from the cards.
 */
export function keepToVillage(reply: string, cards: PlaceCard[], anchor: Anchor | null): { reply: string; cards: PlaceCard[]; away: PlaceCard[] } {
  if (!anchor?.zone) return { reply, cards, away: [] };
  const home = fold(anchor.zone);
  const local = (item: PlaceCard) => !item.area || fold(item.area) === home;
  const inZone = cards.filter((item) => NEAR_KINDS.has(item.kind) && local(item));
  const sameKind = (a: PlaceKind, b: PlaceKind) => a === b || (a === "bar" && b === "food") || (a === "food" && b === "bar");
  const away = cards.filter((item) => NEAR_KINDS.has(item.kind) && !local(item) && inZone.some((other) => sameKind(other.kind, item.kind)));
  if (!inZone.length || !away.length) return { reply, cards, away: [] };
  const awayNames = away.map((item) => fold(item.name));
  // Whole sentences only: a sentence that names the other village's place goes, unless it is the opening answer.
  const sentences = reply.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((sentence, index) => index === 0 || !awayNames.some((name) => fold(sentence).includes(name)));
  return { reply: kept.join(" ").trim() || reply, cards: cards.filter((item) => !away.includes(item)), away };
}

const NO_CAR_WAYS = /\b(?:taxi|aluguer|guided|guide|tour|transfer|driver|on foot|walk|walking|a pe|a pied|excurs)/i;
const NO_CAR_LINE = {
  en: "Without a car, take an aluguer or a taxi, or join a guided tour.",
  pt: "Sem carro, apanhe um aluguer ou um táxi, ou faça uma visita guiada.",
  fr: "Sans voiture, prenez un aluguer ou un taxi, ou une visite guidée.",
} as const;

/** The guest said no car: a recommended place beyond walking distance must come with a way to get there. */
export function withNoCarAccess(reply: string, cards: PlaceCard[], context: Pick<VisitorContext, "car" | "locale">): string {
  if (context.car !== false || !reply || NO_CAR_WAYS.test(fold(reply))) return reply;
  const far = cards.some((item) => (item.walkMin !== null ? item.walkMin > 30 : Boolean(item.area) && fold(item.area!) !== "vila do maio"));
  if (!far) return reply;
  return `${reply} ${NO_CAR_LINE[context.locale === "pt" || context.locale === "fr" ? context.locale : "en"]}`;
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
  const cardsFor = (text: string) => cardsForReply(text, offered, places, anchor, locale, 12).filter((item) => !anchor || anchor.source === "village" || fold(item.name) !== fold(anchor.name));
  let local = keepToVillage(reply, cardsFor(reply), anchor);
  // The opening sentence itself sent the guest to another village while theirs has a fitting place: one rewrite if there is time.
  const left = budget - (Date.now() - started);
  if (local.away.length && anchor && local.away.some((item) => fold(local.reply).includes(fold(item.name))) && left > 3_000) {
    const retry = await ask(`\n\n# Correction\nThe guest is in ${anchor.zone}. Your draft also sent them to ${local.away.map((item) => `${item.name} (${item.area})`).join(", ")}. Rewrite naming only places in ${anchor.zone}.`, left - 500).catch(() => null);
    const second = retry ? clampReply(scrubReply(retry.text)) : "";
    if (second && !onlyQuestions(second)) {
      const again = keepToVillage(second, cardsFor(second), anchor);
      if (!again.away.some((item) => fold(again.reply).includes(fold(item.name)))) local = again;
    }
  }
  const cards = local.cards.slice(0, 4);
  return { reply: withNoCarAccess(local.reply, cards, context), cards, toolEvents: events, facts, anchor };
}
