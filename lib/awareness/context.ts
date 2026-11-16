import { distanceKm, EXPERIENCES, FOOD, PLACES, place } from "../trip.ts";
import type { LastPlace, Task, TaskLocale } from "./task.ts";

/** Last messages the model may see. Older turns survive only as capped recall, never as the task. */
export const WINDOW_MESSAGES = 25;
export const MESSAGE_CHARS = 500;
export const WINDOW_CHARS = 8000;
export const RECALL_CHARS = 800;
/** Tool JSON handed back to the model. A 30k body is clipped; the task is not. */
export const TOOL_BODY_CHARS = 4000;

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type WindowedContext = {
  messages: ChatTurn[];
  recall: string;
};

export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** Keep the newest turns inside the message count and the character budget. */
export function windowMessages(messages: ChatTurn[]): WindowedContext {
  const clipped = messages.map((message) => ({ ...message, content: clipText(message.content, MESSAGE_CHARS) }));
  const recent = clipped.slice(-WINDOW_MESSAGES);
  const kept: ChatTurn[] = [];
  let total = 0;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const len = recent[i].content.length;
    if (kept.length > 0 && total + len > WINDOW_CHARS) break;
    kept.push(recent[i]);
    total += len;
  }
  kept.reverse();
  const dropped = clipped.length - kept.length;
  const older = dropped > 0 ? clipped.slice(0, dropped) : [];
  const recall = clipText(older.map((message) => `${message.role}: ${message.content}`).join("\n"), RECALL_CHARS);
  return { messages: kept, recall };
}

/**
 * Window the transcript. The task object is returned unchanged: leaving the window
 * must not erase objective, constraints, or pending work.
 */
export function prepareContext(task: Task, messages: ChatTurn[]): WindowedContext & { task: Task } {
  return { task, ...windowMessages(messages) };
}

export function clipToolBody(value: unknown, max = TOOL_BODY_CHARS): unknown {
  const raw = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  if (raw.length <= max) return value;
  return { clipped: true, originalChars: raw.length, preview: raw.slice(0, max) };
}

export type ReferenceKind = "ordinal" | "that-one" | "around-there" | "directions" | null;

export type ReferenceHit = {
  kind: ReferenceKind;
  place: LastPlace | null;
  from: LastPlace | null;
  to: LastPlace | null;
};

const ORDINALS: { pattern: RegExp; index: number }[] = [
  { pattern: /\b(?:the |a |la |o |le )?first\b|\b(?:a |o )?primeir[oa]\b|\b(?:la |le )?premi[eè]re?\b|\b1(?:st|er|re|a)\b/, index: 0 },
  { pattern: /\b(?:the |a |la |o |le )?second(?: one)?\b|\b(?:a |o )?segund[oa](?: praia)?\b|\b(?:la |le )?(?:deuxi[eè]me|seconde)\b|\b2(?:nd|e|a)\b/, index: 1 },
  { pattern: /\b(?:the |a |la |o )?third\b|\b(?:a |o )?terceir[oa]\b|\b(?:la |le )?troisi[eè]me\b|\b3(?:rd|e|a)\b/, index: 2 },
  { pattern: /\b(?:the )?fourth\b|\b(?:a )?quarta(?: praia)?\b|\b(?:la |le )?quatri[eè]me\b/, index: 3 },
  { pattern: /\b(?:the )?fifth\b|\b(?:a )?quinta(?: praia)?\b|\b(?:la |le )?cinqui[eè]me\b/, index: 4 },
];

function norm(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function asPlace(record: { id: string; name: { en: string; pt: string }; location: string; lat: number; lon: number }, localeName = "en"): LastPlace {
  return { id: record.id, name: localeName === "pt" ? record.name.pt : record.name.en, area: record.location, lat: record.lat, lon: record.lon };
}

const ALIASES: { pattern: RegExp; id: string }[] = [
  { pattern: /praia do morro|morro beach/, id: "praia-do-morro" },
  { pattern: /porto ingles|vila do maio|cidade do porto/, id: "cidade-porto-ingles" },
  { pattern: /bitche rotcha|bitxe rotcha/, id: "praia-bitche-rotcha" },
  { pattern: /ponta dos flamingos|flamingo beach|praia dos flamingos/, id: "praia-ponta-dos-flamingos" },
  { pattern: /\bcalheta\b/, id: "baxona-ribinha" },
];

/** Resolve a place name against Visit Maio places. No invented coordinates. */
export function lookupPlace(query: string): LastPlace | null {
  const text = norm(query).trim();
  if (text.length < 3) return null;
  for (const alias of ALIASES) {
    if (alias.pattern.test(text)) {
      const found = place(alias.id);
      if (found) return asPlace(found);
    }
  }
  let best: { score: number; item: (typeof PLACES)[number] } | null = null;
  for (const item of PLACES) {
    const names = [item.name.en, item.name.pt, item.id.replace(/-/g, " ")].map(norm);
    let score = 0;
    for (const name of names) {
      if (name === text) score = Math.max(score, 100);
      else if (name.includes(text)) score = Math.max(score, 80);
      else if (text.includes(name) && name.length > 4) score = Math.max(score, 60);
    }
    if (score > (best?.score ?? 0)) best = { score, item };
  }
  return best && best.score >= 60 ? asPlace(best.item) : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Places, restaurants and experiences named in a reply, in the order a guest reads them.
 * A longer name wins over a shorter one inside it ("Praia de Bitche Rotcha" beats "Rotcha").
 */
export function presentedPlaces(text: string, locale: TaskLocale = "en"): LastPlace[] {
  const hay = norm(text);
  const hits: { start: number; end: number; place: LastPlace }[] = [];
  const consider = (label: string, item: LastPlace) => {
    const needle = norm(label).trim();
    if (needle.length < 4) return;
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}(?![a-z0-9])`, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(hay))) {
      const start = match.index + match[1].length;
      hits.push({ start, end: start + needle.length, place: item });
    }
  };
  for (const item of FOOD) {
    const spot = place(item.placeId);
    consider(item.title, { id: item.id, name: item.title, area: item.location, ...(spot ? { lat: spot.lat, lon: spot.lon } : {}) });
  }
  for (const item of PLACES) {
    const record: LastPlace = {
      id: item.id,
      name: locale === "pt" ? item.name.pt : item.name.en,
      area: item.location,
      lat: item.lat,
      lon: item.lon,
    };
    consider(item.name.en, record);
    if (norm(item.name.pt) !== norm(item.name.en)) consider(item.name.pt, record);
  }
  for (const item of EXPERIENCES) {
    const spot = place(item.placeId);
    consider(item.title, { id: item.id, name: item.title, area: item.location, ...(spot ? { lat: spot.lat, lon: spot.lon } : {}) });
  }
  hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const accepted: { start: number; end: number; place: LastPlace }[] = [];
  for (const hit of hits) {
    if (accepted.some((prev) => hit.start < prev.end && hit.end > prev.start)) continue;
    accepted.push(hit);
  }
  const seen = new Set<string>();
  const out: LastPlace[] = [];
  for (const hit of accepted) {
    if (seen.has(hit.place.id)) continue;
    seen.add(hit.place.id);
    out.push(hit.place);
    if (out.length === 8) break;
  }
  return out;
}

function beachLike(placeItem: LastPlace): boolean {
  return /praia|beach|plage/.test(norm(`${placeItem.id} ${placeItem.name}`));
}

/** An open question about a subject, not a finger pointed at the last list. */
export function isOpenQuestion(text: string): boolean {
  const n = norm(text);
  const words = n.split(/\s+/).filter(Boolean);
  if (/\b(?:what can you|tell me|fale-me|fala-me|fala me|parle-moi|parle moi|dis-moi|dis moi)\b/.test(n)) return true;
  if (/\b(?:about|sobre|propos de)\s+(?:the\s+)?(?:maio|island|ilha|ile|beach|praia|plage|town|vila)\b/.test(n)) return true;
  if (/^(?:what|whats|what's|why|how|who|o que|qual|quais|porque|por que|pourquoi|comment est|qu'est|quest-ce|c'est quoi)\b/.test(n)) return true;
  return /\?/.test(text) && words.length > 6;
}

/** "the second beach" / "that one" / "o primeiro". Not a sentence that merely contains "first". */
export function isShortPointer(text: string): boolean {
  const n = norm(text).replace(/[.!?…]+$/g, "").trim();
  if (!n || isOpenQuestion(text)) return false;
  const words = n.split(/\s+/).filter(Boolean);
  if (words.length > 7) return false;
  if (/\b(?:maio|island|ilha)\b/.test(n)) return false;
  if (/\b(?:first|primeir\w*|premi\w*)\s+(?:time|vez|fois)\b/.test(n)) return false;
  return true;
}

/**
 * Point "the second beach", "a segunda praia", "la deuxième", "that one",
 * "around there" and "directions to X from Y" at lastPlaces or known places.
 * Ordinals and deictics only fire for a short pointer, never for an open question.
 */
export function resolveReference(text: string, lastPlaces: LastPlace[]): ReferenceHit {
  const n = norm(text);
  const empty: ReferenceHit = { kind: null, place: null, from: null, to: null };
  const directions = n.match(/\b(?:directions? to|como chegar a|itineraire (?:jusqu'a|pour|vers)) (.+?) \b(?:from|desde|depuis)\b (.+)$/);
  if (/\b(directions?|como chegar|itineraire)\b/.test(n) && !isOpenQuestion(text)) {
    const toQuery = directions?.[1] ?? (n.match(/\b(?:to|a|vers|ate) ([a-z0-9' ]+)$/)?.[1] ?? "");
    const fromQuery = directions?.[2] ?? "";
    const to = lookupPlace(toQuery) ?? lastPlaces.find((item) => n.includes(norm(item.name))) ?? null;
    const from = fromQuery ? lookupPlace(fromQuery) : null;
    return { kind: "directions", place: to, from, to };
  }
  const wantsBeach = /\b(beach|praia|plage)\b/.test(n);
  const pool = wantsBeach ? lastPlaces.filter(beachLike) : lastPlaces;
  const list = pool.length ? pool : lastPlaces;
  const pointer = isShortPointer(text);
  // "o segundo dia" / "deuxième jour" names a day of the trip, not a row in the last list.
  const dayOrdinal = /\b(?:first|second|third|fourth|fifth|primeir\w*|segund\w*|terceir\w*|premi\w*|deuxi\w*|troisi\w*|dernier|ultimo|last|middle|meio|milieu)\b/.test(n)
    && /\b(?:day|dia|jour|journee|jornada)\b/.test(n);
  if (pointer && !dayOrdinal && !/\bsegunda-feira\b|\bsegunda feira\b/.test(n)) {
    const leading = /^(?:please |por favor |s'il vous plait )?(?:the |a |o |os |as |le |la |les )?(?:first|second|third|fourth|fifth|primeir[oa]s?|segund[oa]s?|terceir[oa]s?|quart[oa]s?|quint[oa]s?|premi(?:er|ere)|deuxieme|seconde|troisieme|quatrieme|cinquieme|\d(?:st|nd|rd|er|re|a))\b/;
    if (leading.test(n)) {
      for (const ordinal of ORDINALS) {
        if (ordinal.pattern.test(n)) {
          return { kind: "ordinal", place: list[ordinal.index] ?? null, from: null, to: null };
        }
      }
    }
  }
  if (pointer && /^(?:that one|this one|esse|essa|aquele|aquela|celui-la|celle-la|celui la|celle la|o primeiro|a primeira|le premier|la premiere)$/.test(n.replace(/[.!?…]+$/g, "").trim())) {
    const placeHit = /^(?:that one|this one|esse|essa|aquele|aquela|celui)/.test(n) ? (list[list.length - 1] ?? null) : (list[0] ?? null);
    const kind = /primeiro|premiere|premier|primeira/.test(n) ? "ordinal" as const : "that-one" as const;
    return { kind, place: placeHit, from: null, to: null };
  }
  if (pointer && /\b(around there|over there|near there|por ali|la-bas|la bas|pres de la)\b/.test(n) && !/\b(?:island|ilha|ile|maio)\b/.test(n)) {
    const placeHit = list[list.length - 1] ?? null;
    return { kind: "around-there", place: placeHit, from: null, to: null };
  }
  return empty;
}

export type NearbyFood = { id: string; name: string; area: string };

/**
 * Food whose listing area matches the anchor. No silent substitute from another town.
 * Calheta resolves to the Calheta row (Vanuza), not a Porto Inglês restaurant.
 */
export function foodNear(anchor: LastPlace): NearbyFood[] {
  const area = norm(`${anchor.area ?? ""} ${anchor.name} ${anchor.id}`);
  const anchorPoint = anchor.lat !== undefined && anchor.lon !== undefined ? { lat: anchor.lat, lon: anchor.lon } : null;
  return FOOD.flatMap((item) => {
    const loc = norm(`${item.location} ${item.title}`);
    const spot = place(item.placeId);
    const sameTown = (area.includes("calheta") && loc.includes("calheta"))
      || (area.includes("bitche") && /bitche|bitxe|nha terra/.test(loc))
      || (norm(anchor.name).length > 3 && loc.includes(norm(anchor.name)));
    const close = !sameTown && anchorPoint && spot ? distanceKm(spot, anchorPoint) <= 3 && areaTown(area, loc) : false;
    if (!sameTown && !close) return [];
    if (area.includes("calheta") && !loc.includes("calheta")) return [];
    return [{ id: item.id, name: item.title, area: item.location }];
  });
}

function areaTown(anchor: string, foodLocation: string): boolean {
  if (anchor.includes("calheta")) return foodLocation.includes("calheta");
  if (anchor.includes("porto ingles") || anchor.includes("vila")) return foodLocation.includes("porto ingles");
  return true;
}
