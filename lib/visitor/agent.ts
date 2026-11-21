import { generateText, stepCountIs, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { maioClock } from "../agora.ts";
import { carRentalRecords, loadBusinesses, pharmacyRecords, searchBusinessesByNeed, type BusinessRecord } from "../maio-catalog.ts";
import { readWeather } from "../maio-chat-tools.ts";
import { loadTimetable } from "../timetable.ts";
import { scrubReply } from "./scrub.ts";
import { MAIO_BACKGROUND } from "./background.ts";
import { fold, zoneFromText, ZONES } from "./geo.ts";
import { dropUnknownNames, knownText } from "./names.ts";
import { citeWebFacts, webFacts, type WebFacts } from "./enrichment.ts";
import { cleanOutsideHits, outsideNeed, type OutsideNeed } from "./needs.ts";
import { fallbackConfig, searchBeyondListings, type FallbackEnv, type FallbackHit } from "./fallback.ts";
import { findPlace, loadPlaces, nearby, resolveAnchor, PLACE_KINDS, type Anchor, type NearbyRow, type Place, type PlaceKind } from "./places.ts";

export type VisitorLocale = "en" | "pt" | "fr";
export type VisitorTurn = { role: "user" | "assistant"; content: string };
export type PlaceCard = { id: string; name: string; kind: PlaceKind; area: string | null; km: number | null; walkMin: number | null; driveMin: number | null; image: string | null; approxLocation: boolean; lat: number | null; lon: number | null; /** Absent = Maio listings. */ source?: "google"; url?: string | null };
/** Outside sources the reply used, shown under it. */
export type ReplySource = { label: string; url: string | null; kind: "google" | "web" };
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
export type VisitorResult = { reply: string; cards: PlaceCard[]; sources: ReplySource[]; toolEvents: { name: string; ok: boolean; arguments?: unknown }[]; facts: string[]; anchor: Anchor | null };
export type VisitorDeps = { model: LanguageModel; fetchImpl: typeof fetch; /** Unbudgeted fetch for the cached place list. */ placesFetch?: typeof fetch; now?: Date; timeoutMs?: number; /** Keys for the outside lookup; defaults to process.env. */ env?: FallbackEnv };

/** Static first, so the provider can cache the prefix across turns. */
export const VISITOR_RULES = `
You are the Maio guide on maio.cv: a local friend who knows the island of Maio, Cabo Verde, well. You answer visitors' questions in chat.

How to answer:
- Answer the actual question first. HARD LIMIT: at most 3 sentences and 60 words in total, one paragraph. Key fact first. Plain text: no headings, no bold, no tables, no lists. Pick the best one to three places instead of listing everything; the app shows place cards above your text.
- Do not start a trip plan unless the guest asks for one (dates, "plan my days", "itinerary"). An open question such as "what's the best thing to do in Maio?" gets a thoughtful, opinionated answer with one or two highlights, not a plan and not a question back.
- Never open with a question, and never start by repeating the guest's question back ("Windy day?"). Do not ask whether they have a car unless the answer truly depends on it, and then answer for both cases first. Ask at most ONE short follow-up, only when it changes the advice, as the last sentence. Never end with an offer ("Would you like…", "Do you want…", "I can check…"). A follow-up question is allowed only when you could not give a useful answer without it.
- Nearby means the same village or area. Use places_nearby for anything "near", "close", "around", "in <village>", "where to eat/swim/stay". Recommend the nearest results first and give the distance exactly as places_nearby returns it ("3 min walk", not a made-up range) as walking minutes (no car / in town) or driving minutes (car). If nothing is listed close by, say so plainly and name the nearest with its distance. Never present a place in another village (e.g. Vila do Maio for someone in Calheta) as "nearby".
- Name only places, restaurants, stays, operators and businesses from "Listed places" below, a tool result, or the background. If a name is not there, it does not exist for you. For open questions without a location, pick from the background highlights and the listed places. Never invent a venue, phone number, price, opening hour, menu or timetable. If a detail is not in the data, say it is not listed and suggest asking the place or locals. A "fromWeb" value (or "per <site>" in the directory) comes from a public web page, not the Maio listings: give it with its source, e.g. "open 7:00–23:00 (per biggamemaio.com)". Before saying hours, a phone or a website are not listed for a named place, call place_details: it may have a fromWeb value.
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

/** Added only when an outside lookup is configured; without keys the guide never hears of it. */
export const FALLBACK_RULE = `
# Beyond the listings
Only when the listed places, place_details and find_business have nothing that fits (a dentist, yoga, a laundry, a hairdresser…), call search_beyond_listings once. Listed places always come first. Name what it finds with its source right after the name: "(Google Maps)" or "(source: <site>)". Opening hours and prices from it are unknown. If it finds nothing, say plainly you don't have it and suggest asking the stay or locals.`;

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
      // "near Calheta" from a guest staying at Casa do Mar (Calheta) still measures from Casa do Mar.
      if (anchor) return originFor(anchor, stayAnchor(places, context));
    }
  }
  return stayAnchor(places, context);
}

/** The saved stay (or village) as an anchor, without reading the conversation. */
function stayAnchor(places: Place[], context: VisitorContext): Anchor | null {
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

/** Services from the Maio business directory that are not already listed places ("hairdresser: Barbearia DAD"). */
export function directoryBlock(records: { name: string; category: string; location?: string | null; phone?: string | null }[], places: Place[]): string {
  if (!records.length) return "";
  const known = new Set(places.map((place) => fold(place.name)));
  const byCategory = new Map<string, string[]>();
  for (const record of records) {
    if (known.has(fold(record.name)) || !record.category) continue;
    // The directory has no location for some (Barbearia DAD): a reviewed web source may, and is named.
    const web = webFacts(record.name, { village: record.location, phone: record.phone });
    const label = web?.village ? `${record.name} (near ${web.village.value}, per ${web.village.source})` : record.name;
    byCategory.set(record.category.replace(/_/g, " "), [...(byCategory.get(record.category.replace(/_/g, " ")) ?? []), label]);
  }
  const lines = [...byCategory.entries()].map(([category, names]) => `${category}: ${names.join("; ")}`);
  const noCarHire = carRentalRecords(records as never).length === 0 ? "\nNo car hire company is listed (a quad rental is not car hire)." : "";
  return `Business directory services (name them when asked; find_business has phones): ${lines.join(" | ")}.${noCarHire}\nAny other service (dentist, gym, yoga, laundry, bank branch…) is NOT listed: say so, never make up a clinic, shop or person.`;
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
  return `arriving ${dates.start}${dates.days ? ` for ${dates.days} days` : ""} (${month}). ${seasonCheck(dates.start)}`;
}

/** Season facts from the background, decided in code for the guest's month so the model cannot flip them. */
export function seasonCheck(start: string): string {
  const m = Number(start.slice(5, 7));
  const month = MONTHS[m - 1];
  const turtles = m >= 6 && m <= 10 ? `${month} IS in turtle nesting season (June–October)` : `${month} is OUTSIDE turtle nesting season (June–October); nesting turtles are unlikely`;
  const whales = m === 4 || m === 5 ? `${month} is peak humpback whale time (April–May)` : m === 3 || m === 6 ? `${month} is at the edge of humpback whale time (best April–May)` : `${month} is outside the usual humpback whale months (April–May)`;
  const wind = m === 12 || m <= 4 ? `${month} is in the windy season (about December–April; good for kite, rougher exposed coasts)` : `${month} is outside the strongest trade-wind months (about December–April)`;
  return `Season check for their dates: ${turtles}; ${whales}; ${wind}.`;
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
const OFFER = /^(?:if you(?:'|’)?d like,? (?:i|me)\b|if you want,? (?:i|me)\b|if you want me to|if you tell me\b.*\bi(?:'|’)ll|would you like\b|do you want me to|want me to|i can (?:also )?(?:check|fetch|look|share|send)|let me know|se quiser,? (?:eu|posso|procuro)|queres que|quer que eu|quere(?:m|is) que eu|si vous voulez,? je|voulez-vous que)/i;

/** An offer to go and do more, anywhere in a later sentence ("…I can check for monitoring programs, should I look?"). */
const OFFER_ANYWHERE = /\b(?:i can (?:also )?(?:check|look(?: up)?|find|fetch|send|share|call|book|ring|search)|should i (?:look|check|call)|shall i|want me to|quer que eu|posso verificar|posso procurar|voulez-vous que je|je peux v[ée]rifier)\b/i;

/** Chat-sized: at most three sentences and about 60 words, no trailing offers. The first sentence always stays. */
export function clampReply(text: string, maxWords = 60, maxSentences = 3): string {
  const flat = text.replace(/[\u2010\u2011]/g, "-")
    // "…; otherwise I can search beyond…" / "sinon je peux chercher…": an offer tacked onto a useful sentence.
    .replace(/[;,]\s*(?:(?:and |or |otherwise |sinon |ou |sen[aã]o |se n[aã]o )?(?:if you want,? )?)(?:i can|je peux|posso)\s+(?:also\s+)?(?:search|look|check|find|chercher|v[ée]rifier|regarder|procurar|pesquisar|verificar)[^.!?]*[.!?]?/gi, ".").replace(/\*\*|__|^#+\s*/gm, "").replace(/^\s*[-•]\s+/gm, "").replace(/\s*\n+\s*/g, " ").trim();
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

/**
 * Where distances are measured from. A known stay wins over its own village: "near Calheta" from a guest staying
 * at Casa do Mar (Calheta) is measured from Casa do Mar, so the minutes match every turn. A different place or
 * village the guest asks about ("near Praia Real") is used as asked.
 */
export function originFor(asked: Anchor | null, known: Anchor | null): Anchor | null {
  if (!asked) return known;
  if (!known) return asked;
  if (asked.source === "village" && known.source !== "village" && asked.zoneId && asked.zoneId === known.zoneId) return known;
  if (fold(asked.name) === fold(known.name)) return known;
  return asked;
}

const ISLAND_NAMES = /^(?:ilha do |island of |the )?(?:maio|maio island|ilha do maio|cabo verde|cape verde|cap vert|porto ingles|vila do maio)(?: island| cabo verde| cape verde)?$/;
function isGeographyName(name: string): boolean {
  const n = fold(name);
  return ISLAND_NAMES.test(n) || ZONES.some((zone) => fold(zone.name) === n || zone.aliases.includes(n));
}

/** Outside results the reply actually used get a source label, a card (Google, with coordinates) or a citation. */
export function labelOutsideSources(reply: string, hits: FallbackHit[], listed: Place[] = []): { reply: string; cards: PlaceCard[]; sources: ReplySource[] } {
  const text = fold(reply);
  const cards: PlaceCard[] = [];
  const sources: ReplySource[] = [];
  let out = reply;
  for (const [index, hit] of hits.entries()) {
    // A page titled "Maio" or "Cape Verde" is not named by a reply that mentions the island.
    // A page or pin for a place Maio already lists ("Onda Azul Maio") is the listing, not an outside source.
    const isListed = listed.some((place) => fold(place.name) === fold(hit.name)) || Boolean(findPlace(listed, hit.name));
    const generic = isListed || isGeographyName(hit.name) || (hit.source === "web" && fold(hit.name).split(" ").length < 2);
    const named = !generic && fold(hit.name).length >= 3 && text.includes(fold(hit.name));
    const cited = hit.source === "web" && text.includes(fold(hit.sourceLabel));
    if (!named && !cited) continue;
    if (hit.source === "google") {
      if (!/google maps/i.test(out)) out = `${out.replace(/\s+$/, "")} Source: Google Maps.`;
      cards.push({ id: `google-${index}-${fold(hit.name).replace(/\s+/g, "-").slice(0, 40)}`, name: hit.name, kind: "shop", area: hit.area, km: hit.km, walkMin: hit.walkMin, driveMin: hit.driveMin, image: null, approxLocation: hit.km === null, lat: hit.lat, lon: hit.lon, source: "google", url: hit.url });
      if (!sources.some((item) => item.kind === "google")) sources.push({ label: "Google Maps", url: hit.url, kind: "google" });
    } else {
      if (!fold(out).includes(fold(hit.sourceLabel))) out = `${out.replace(/\s+$/, "")} Source: ${hit.sourceLabel}.`;
      if (!sources.some((item) => item.url === hit.url)) sources.push({ label: hit.sourceLabel, url: hit.url, kind: "web" });
    }
  }
  return { reply: out, cards, sources };
}

/** Same place: equal names, or one name contains the other's whole (2+ word) name ("Onda Azul Maio Kite School"). */
export function sameListing(a: string, b: string): boolean {
  const x = fold(a), y = fold(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.split(" ").length >= 2 && ` ${long} `.includes(` ${short} `);
}

/** Maio records that already cover a need (the Maio API wins: no outside search then). */
export function listedForNeed(need: OutsideNeed, records: BusinessRecord[], places: Place[]): string[] {
  if (need.id === "car") return carRentalRecords(records).map((record) => record.name);
  if (need.id === "pharmacy") return pharmacyRecords(records).map((record) => record.name);
  return [
    ...records.filter((record) => need.listed.test(fold(`${record.name} ${record.category.replace(/_/g, " ")}`))).map((record) => record.name),
    ...places.filter((place) => need.listed.test(fold(place.name))).map((place) => place.name),
  ];
}

function hospitalLine(locale: string): string {
  return locale === "pt" ? "Para urgências, Hospital do Maio (Vila do Maio): +238 255 11 30." : locale === "fr" ? "En cas d'urgence, Hôpital do Maio (Vila do Maio) : +238 255 11 30." : "For urgent care, Hospital do Maio (Vila do Maio) is +238 255 11 30.";
}

/** Deterministic reply from outside results, when the model's draft did not use them. */
export function outsideReply(need: OutsideNeed, hits: FallbackHit[], locale: string): string {
  const top = hits.slice(0, 2).map((hit) => `${hit.name} (${hit.sourceLabel}${hit.area ? `, ${hit.area}` : ""})`);
  const names = top.join(locale === "pt" ? " e " : locale === "fr" ? " et " : " and ");
  const label = locale === "pt" ? need.label.pt : locale === "fr" ? need.label.fr : need.label.en;
  if (locale === "pt") return `Não há ${label} nas listas do Maio. Fora das listas encontrei ${names}. Horário e preços não são conhecidos; confirme antes de ir.`;
  if (locale === "fr") return `Pas de ${label} dans les listes de Maio. Hors des listes, j'ai trouvé ${names}. Horaires et prix inconnus ; vérifiez avant d'y aller.`;
  return `Maio's listings have no ${label}. Outside the listings I found ${names}. Hours and prices are not known, so check before you go.`;
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
  const outside: FallbackHit[] = [];
  /** Reviewed secondary names (enrichment) the guard also accepts. */
  const extraKnownNames: string[] = [];
  /** A name the Maio data already has: never shown as an outside (Google/web) result. */
  // Strict on purpose: the fuzzy findPlace maps "Maio Car, Lda" to Onda Azul Maio, which would hide a real outside result.
  const isListedName = (name: string) => places.some((place) => sameListing(name, place.name) || sameListing(name, place.namePt ?? "")) || isDirectoryName(name);
  let isDirectoryName = (_name: string) => false;
  /** Web facts (secondary) shown to the model this turn, cited in the reply when used. */
  const webShown = new Map<string, WebFacts>();
  /** Names whose web facts a tool call returned this turn (the reply is about them even if it doesn't repeat the name). */
  const webAsked = new Set<string>();
  const withWeb = (name: string, maio: Parameters<typeof webFacts>[1]) => {
    const facts = webFacts(name, maio);
    if (facts) { webShown.set(name, facts); webAsked.add(name); }
    return facts ? { fromWeb: Object.fromEntries(Object.entries(facts).map(([field, fact]) => [field, { value: fact.value, source: fact.source }])), fromWebNote: "fromWeb is NOT Maio listing data but a public web page. Lead with the value and its source, e.g. \"Nha Terra opens 8:30–23:00, closed Wednesday (per mapquest.com; may be out of date).\" Name only that source, never another site." } : {};
  };
  const locale = context.locale === "pt" ? "pt" : "en";
  const note = <T,>(name: string, args: unknown, ok: boolean, payload: T): T => {
    events.push({ name, ok, arguments: args });
    facts.push(JSON.stringify(payload).slice(0, 3000));
    return payload;
  };

  const outsideOn = (() => { const config = fallbackConfig(deps.env); return config.google || config.parallel; })();
  const baseTools = {
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
        const from = originFor(asked, anchor);
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
          ...withWeb(place.name, { hours: (place as { hours?: string }).hours, phone: place.phone, website: place.website, description: place.description, village: place.zone }),
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
      description: "Search the Maio business directory by name or need: car rental, pharmacy, supermarket, market, hairdresser/barber, tours, water sports, a named business. Phones only as published.",
      inputSchema: z.object({ query: z.string().min(3).max(60) }),
      execute: async ({ query }) => {
        const catalog = await loadBusinesses(deps.fetchImpl);
        const rows = /\b(car|rent|rental|aluguer|alugar|location|voiture|carro)\b/i.test(query) ? carRentalRecords(catalog.records) : searchBusinessesByNeed(catalog.records, query);
        return note("find_business", { query }, catalog.source === "api", { results: rows.slice(0, 6).map((row) => ({ name: row.name, phone: row.phone || null, location: row.location || null, category: row.category, ...withWeb(row.name, { phone: row.phone, village: row.location }) })) });
      },
    }),
  };
  const tools = outsideOn ? { ...baseTools, search_beyond_listings: tool({
      description: "Last resort when listed places, place_details and find_business have nothing that fits. Checks the Maio listings once more, then Google Maps on Maio, then the web with citations. Results are NOT Maio listings and must be labelled with their source.",
      inputSchema: z.object({ query: z.string().min(3).max(80).describe("What the guest needs, short: \"dentist\", \"yoga class\", \"SIM card\"") }),
      execute: async ({ query }) => {
        // The Maio API stays the source of truth: a listed match ends the search here.
        const listed = findPlace(places, query);
        const catalog = await loadBusinesses(deps.fetchImpl).catch(() => null);
        // Car hire only counts when it is car hire ("Big Game Rental Quad" rents quads, not cars).
        const carHire = /\b(car|cars|rent a car|car rental|car hire|aluguer de carro|alugar carro|location de voiture|voiture|carro|4x4|jeep)\b/i.test(query);
        const businesses = catalog ? (carHire ? carRentalRecords(catalog.records) : searchBusinessesByNeed(catalog.records, query)).slice(0, 4) : [];
        if (listed || businesses.length) {
          if (listed) {
            const row = nearby([listed], { kinds: [], anchor, car: true, limit: 1, locale }).results[0];
            if (row) offered.set(listed.id, card(listed, row));
          }
          return note("search_beyond_listings", { query }, true, { listed: true, places: listed ? [{ name: listed.name, area: listed.zone }] : [], businesses: businesses.map((row) => ({ name: row.name, phone: row.phone || null, location: row.location || null })), note: "These are in the Maio listings; use them and do not search further." });
        }
        const raw = await searchBeyondListings(query, { fetchImpl: deps.fetchImpl, near: anchor, deadline: started + budget, env: deps.env });
        const result = { ...raw, hits: cleanOutsideHits(raw.hits, outsideNeed(query), isListedName) };
        outside.push(...result.hits.filter((hit) => !outside.some((known) => fold(known.name) === fold(hit.name))));
        return note("search_beyond_listings", { query }, result.hits.length > 0, {
          listed: false, source: result.source, note: result.note,
          results: result.hits.map((hit) => ({ name: hit.name, source: hit.sourceLabel, address: hit.address, area: hit.area, walkMin: hit.walkMin, driveMin: hit.driveMin, snippet: hit.snippet })),
        });
      },
    }) } : baseTools;

  const directory = await loadBusinesses(deps.placesFetch ?? deps.fetchImpl).catch(() => null);
  isDirectoryName = (name: string) => (directory?.records ?? []).some((record) => sameListing(name, record.name));
  // Hours, phone or website asked for a named listed place: give its reviewed web facts up front (no tool call needed).
  const asked = fold(turns.filter((turn) => turn.role === "user").at(-1)?.content ?? "");
  const askedWeb = /\b(?:hours?|open|opens|opening|close|closes|phone|number|call|website|site|horario|abre|fecha|telefone|numero|heures|ouvert|ouvre|ferme|telephone)\b/.test(asked)
    ? places.filter((place) => fold(place.name).length >= 5 && asked.includes(fold(place.name))).slice(0, 2) : [];
  const askedLines = askedWeb.flatMap((place) => {
    const facts = webFacts(place.name, { phone: place.phone, website: place.website, description: place.description, village: place.zone });
    if (!facts) return [];
    webShown.set(place.name, facts); webAsked.add(place.name);
    return [`${place.name}: ${Object.entries(facts).filter(([field]) => field !== "description").map(([field, fact]) => `${field} ${fact!.value} (per ${fact!.source})`).join("; ")}`];
  });
  const webBlock = askedLines.length ? `\n\n# Web facts for the place asked about (NOT Maio listing data; give each with its source, may be out of date)\n${askedLines.join("\n")}` : "";
  const started = Date.now();
  const budget = deps.timeoutMs ?? 14_000;
  // A service Maio rarely lists (gym, dentist, pharmacy…) with no Maio match: search outside in code, every time.
  const need = outsideOn ? outsideNeed(turns.filter((turn) => turn.role === "user").at(-1)?.content ?? "") : null;
  const maioMatch = need ? listedForNeed(need, directory?.source === "api" ? directory.records : [], places) : [];
  let outsideBlock = "";
  let searchedFor: OutsideNeed | null = null;
  if (need && !maioMatch.length) {
    searchedFor = need;
    const raw = await searchBeyondListings(need.query, { fetchImpl: deps.fetchImpl, near: anchor, deadline: started + Math.min(8_000, budget - 3_500), env: deps.env });
    const hits = cleanOutsideHits(raw.hits, need, isListedName);
    outside.push(...hits);
    events.push({ name: "search_beyond_listings", ok: hits.length > 0, arguments: { query: need.query, auto: true } });
    facts.push(JSON.stringify({ need: need.id, source: raw.source, hits: hits.map((hit) => hit.name) }).slice(0, 3000));
    outsideBlock = hits.length
      ? `\n\n# Already searched outside the Maio listings for "${need.query}" (do not call search_beyond_listings again)\nThe Maio listings have none. These are NOT Maio listings; name one or two with their source right after the name, and say hours and prices are not known:\n${hits.map((hit) => `- ${hit.name} (${hit.sourceLabel})${hit.area ? `, ${hit.area}` : ""}${hit.walkMin !== null && hit.walkMin <= 25 ? `, ${hit.walkMin} min walk` : hit.driveMin !== null ? `, ${hit.driveMin} min drive` : ""}${hit.snippet ? `: ${hit.snippet.slice(0, 200)}` : ""}`).join("\n")}${need.extra ? `\n${need.extra}` : ""}`
      : `\n\n# Already searched outside the Maio listings for "${need.query}"\nNothing on Google Maps or the web either. Say plainly the Maio listings don't have it and suggest asking the stay or locals. Do not name any place for it.${need.extra ? `\n${need.extra}` : ""}`;
  }
  const system = `${VISITOR_RULES}${outsideOn ? `\n${FALLBACK_RULE}` : ""}\n\n${MAIO_BACKGROUND}\n\n# Listed places\n${catalogBlock(places)}\n${directoryBlock(directory?.source === "api" ? directory.records : [], places)}\n\n# This conversation\n${contextBlock(today, context, anchor)}${webBlock}${outsideBlock}`;
  const ask = (extra: string, timeoutMs: number) => generateText({
    model: deps.model,
    system: system + extra,
    messages: turns.slice(-10),
    tools,
    stopWhen: stepCountIs(4),
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(timeoutMs),
  });
  const generated = await ask("", Math.max(2_500, budget - (Date.now() - started)));
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
  // Names not in the Maio data or this turn's outside results are dropped (sentence by sentence).
  const known = knownText([
    ...places.flatMap((place) => [place.name, place.namePt]),
    ...(directory?.records ?? []).map((record) => record.name),
    ...ZONES.flatMap((zone) => [zone.name, ...zone.aliases]),
    ...outside.map((hit) => hit.name),
    ...extraKnownNames,
    MAIO_BACKGROUND,
  ]);
  const guarded = dropUnknownNames(local.reply, known, context.locale);
  if (guarded.dropped.length) events.push({ name: "name_guard", ok: false, arguments: { dropped: guarded.dropped } });
  local = { ...local, reply: guarded.reply };
  // The search ran in code and found something, but the draft ignored it: say it plainly, with the source.
  if (searchedFor && outside.length && !outside.some((hit) => fold(local.reply).includes(fold(hit.name)))) {
    local = { ...local, reply: outsideReply(searchedFor, outside, context.locale) };
  }
  if (searchedFor?.extra && !/255\s?11\s?30/.test(local.reply)) {
    const sentences = local.reply.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length < 3) local = { ...local, reply: `${local.reply.replace(/\s+$/, "")} ${hospitalLine(context.locale)}` };
  }
  const labelled = labelOutsideSources(local.reply, outside, places);
  // Directory web villages are in the prompt without a tool call: cite those too when used.
  for (const record of directory?.source === "api" ? directory.records : []) {
    const facts = webFacts(record.name, { village: record.location, phone: record.phone });
    if (facts && !webShown.has(record.name)) webShown.set(record.name, facts);
  }
  const cited = citeWebFacts(labelled.reply, [...webShown.entries()].map(([name, facts]) => ({ name, facts, asked: webAsked.has(name) && webAsked.size === 1 })));
  const sources = [...labelled.sources, ...cited.sources.filter((item) => !labelled.sources.some((known) => known.url === item.url))];
  const cards = [...local.cards, ...labelled.cards].slice(0, 4);
  return { reply: withNoCarAccess(cited.reply, cards, context), cards, sources, toolEvents: events, facts, anchor };
}
