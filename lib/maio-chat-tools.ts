import { maioClock } from "./agora.ts";
import { loadAgora } from "./agora.ts";
import { budgetFetch } from "./fetch-budget.ts";
import { MAIO_API, loadBusinesses, searchBusinesses, type BusinessRecord } from "./maio-catalog.ts";
import { formatCapeVerdePhone } from "./phone.ts";

/** Reply language for Ask Maio. The page sends this as context.lang. */
export type AskLocale = "pt" | "en" | "fr";

export type AskKind =
  | "stays"
  | "stay_contact"
  | "activities"
  | "boat_trip"
  | "ferry"
  | "flight"
  | "business"
  | "weather"
  | "open";

export type Citation = { name: string; href?: string; kind?: string };
export type ToolEvent = { name: string; arguments: Record<string, unknown>; ok: boolean };

export type GroundedAnswer = {
  message: string;
  toolEvents: ToolEvent[];
  citations: Citation[];
  /** Tool JSON, used to reject contacts and prices the model did not get from a tool. */
  facts: string;
};

const TTL_MS = 10 * 60 * 1000;
const BOATS_URL = `${MAIO_API}/boats`;
const FLIGHTS_URL = `${MAIO_API}/flights`;
const STAYS_URL = `${MAIO_API}/accommodation?limit=100`;
const EXPERIENCES_URL = `${MAIO_API}/experiences?limit=100`;

const ACCOMMODATION_CAVEAT =
  "Incomplete accommodation directory, not a live inventory. Prices and availability are not live.";
const EXPERIENCE_CAVEAT =
  "Experience directory. Prices and schedules are indicative, not live availability. Confirm with the operator.";

const parents = new WeakMap<object, object>();
const fetchIds = new WeakMap<object, number>();
let nextFetchId = 1;
const responseCache = new Map<string, { at: number; value: unknown }>();

/** Point a budget-wrapped fetch at the fetch whose successes are already cached. */
export function shareChatCache(child: object, parent: object): void {
  parents.set(child, parent);
}

export function clearMaioChatCache(): void {
  responseCache.clear();
}

function say(locale: AskLocale, en: string, pt: string, fr: string): string {
  return locale === "pt" ? pt : locale === "fr" ? fr : en;
}

function norm(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  const en = typeof row.en === "string" ? row.en.trim() : "";
  const pt = typeof row.pt === "string" ? row.pt.trim() : "";
  return en || pt;
}

function cacheIdentity(fetchImpl: object): object {
  return parents.get(fetchImpl) ?? fetchImpl;
}

function fetchKey(fetchImpl: object): number {
  const target = cacheIdentity(fetchImpl);
  let id = fetchIds.get(target);
  if (!id) {
    id = nextFetchId;
    nextFetchId += 1;
    fetchIds.set(target, id);
  }
  return id;
}

async function cachedJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const key = `${fetchKey(fetchImpl)} ${url}`;
  const hit = responseCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const response = await fetchImpl(url, {
    headers: { accept: "application/geo+json, application/json" },
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`Maio API HTTP ${response.status}`);
  const value = await response.json();
  responseCache.set(key, { at: Date.now(), value });
  return value;
}

function published(feature: unknown): boolean {
  const status = textOf(asRecord(asRecord(feature).properties).publicationStatus);
  return !status || status === "published";
}

function attrsOf(feature: unknown): Record<string, unknown> {
  return asRecord(asRecord(asRecord(feature).properties).attributes);
}

function featureName(feature: unknown): string {
  const attrs = attrsOf(feature);
  return textOf(attrs.name) || textOf(asRecord(asRecord(feature).properties).name);
}

/** A phone string copied from the directory. Empty stays empty. */
export function listedPhone(value: unknown): string | null {
  const raw = textOf(value);
  if (!raw) return null;
  return formatCapeVerdePhone(raw);
}

function listedPrice(attrs: Record<string, unknown>): { amount: number; currency: string | null; basis: string | null } | null {
  const amount = attrs.price;
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  const currency = textOf(attrs.currency) || null;
  const basis = textOf(attrs.priceBasis) || null;
  return { amount, currency, basis };
}

export type SailingRow = {
  date: string;
  from: string;
  to: string;
  departure: string;
  arrival: string | null;
  operator: string | null;
};

export type BoatResult = {
  available: boolean;
  source: string;
  sourceName: string;
  status: string | null;
  stale: boolean;
  retrievedAt: string | null;
  caveats: string[];
  schedules: SailingRow[];
  nextSantiagoToMaio: SailingRow | null;
  error?: string;
};

function clock(value: unknown): string | null {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

function sailingRows(payload: unknown): SailingRow[] {
  const rows = Array.isArray(asRecord(payload).schedules) ? asRecord(payload).schedules as unknown[] : [];
  return rows.flatMap((row) => {
    const item = asRecord(row);
    const departure = clock(item.departure);
    if (typeof item.date !== "string" || !departure || typeof item.from !== "string" || typeof item.to !== "string") return [];
    const arrival = clock(item.arrival);
    return [{
      date: item.date,
      from: item.from,
      to: item.to,
      departure,
      arrival,
      operator: textOf(item.operator) || null,
    }];
  });
}

function stillAhead(date: string, departure: string, today: string, time: string): boolean {
  if (date > today) return true;
  if (date < today) return false;
  return departure > time;
}

export function nextSantiagoToMaio(rows: SailingRow[], today: string, time: string): SailingRow | null {
  const inbound = rows.filter((row) => /santiago|praia/i.test(row.from) && /maio/i.test(row.to) && !/maio/i.test(row.from));
  inbound.sort((a, b) => a.date.localeCompare(b.date) || a.departure.localeCompare(b.departure));
  return inbound.find((row) => stillAhead(row.date, row.departure, today, time)) ?? null;
}

export async function readBoatSchedule(fetchImpl: typeof fetch, now = new Date(), range?: { from?: string | null; to?: string | null }): Promise<BoatResult> {
  const url = new URL(BOATS_URL);
  if (range?.from) url.searchParams.set("from", range.from);
  if (range?.to) url.searchParams.set("to", range.to);
  try {
    const payload = asRecord(await cachedJson(fetchImpl, url.toString()));
    const schedules = sailingRows(payload);
    const clockNow = maioClock(now);
    const caveats = Array.isArray(payload.caveats) ? payload.caveats.filter((item): item is string => typeof item === "string") : [];
    return {
      available: true,
      source: textOf(payload.source) || BOATS_URL,
      sourceName: textOf(payload.sourceName) || "CV Interilhas",
      status: textOf(payload.status) || null,
      stale: payload.stale === true,
      retrievedAt: textOf(payload.retrievedAt) || null,
      caveats,
      schedules,
      nextSantiagoToMaio: nextSantiagoToMaio(schedules, clockNow.date, clockNow.time),
    };
  } catch (error) {
    return {
      available: false,
      source: BOATS_URL,
      sourceName: "CV Interilhas",
      status: null,
      stale: false,
      retrievedAt: null,
      caveats: [],
      schedules: [],
      nextSantiagoToMaio: null,
      error: error instanceof Error ? error.message : "Boat timetable unavailable",
    };
  }
}

export type FlightLeg = {
  date: string;
  from: string;
  to: string;
  departure: string;
  arrival: string | null;
  flight: string | null;
  airline: string | null;
};

export type FlightResult = {
  available: boolean;
  source: string;
  sourceName: string;
  status: string | null;
  stale: boolean;
  retrievedAt: string | null;
  caveats: string[];
  upcoming: FlightLeg[];
  nextPraiaToMaio: FlightLeg | null;
  error?: string;
};

function flightLegs(payload: unknown): FlightLeg[] {
  const body = asRecord(payload);
  const bags = [body.routes, body.upcoming].flatMap((bag) => Object.values(asRecord(bag)));
  const seen = new Set<string>();
  const legs: FlightLeg[] = [];
  for (const rows of bags) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const item = asRecord(row);
      const departure = clock(item.departure);
      if (typeof item.date !== "string" || !departure || typeof item.from !== "string" || typeof item.to !== "string") continue;
      const flight = textOf(item.flight) || null;
      const key = `${item.date}|${item.from}|${item.to}|${departure}|${flight ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const arrival = clock(item.arrival);
      legs.push({
        date: item.date,
        from: item.from,
        to: item.to,
        departure,
        arrival,
        flight,
        airline: textOf(item.airline) || textOf(body.source) || null,
      });
    }
  }
  legs.sort((a, b) => a.date.localeCompare(b.date) || a.departure.localeCompare(b.departure));
  return legs;
}

function placeCode(code: string): string {
  if (code === "RAI") return "Praia";
  if (code === "MMO") return "Maio";
  return code;
}

export async function readFlightSchedule(fetchImpl: typeof fetch, now = new Date(), range?: { from?: string | null; to?: string | null }): Promise<FlightResult> {
  const url = new URL(FLIGHTS_URL);
  if (range?.from) url.searchParams.set("from", range.from);
  if (range?.to) url.searchParams.set("to", range.to);
  try {
    const payload = asRecord(await cachedJson(fetchImpl, url.toString()));
    const clockNow = maioClock(now);
    const upcoming = flightLegs(payload).filter((leg) => stillAhead(leg.date, leg.departure, clockNow.date, clockNow.time)).slice(0, 8);
    const caveats = Array.isArray(payload.caveats) ? payload.caveats.filter((item): item is string => typeof item === "string") : [];
    return {
      available: true,
      source: FLIGHTS_URL,
      sourceName: textOf(payload.source) || "CVSky",
      status: textOf(payload.status) || null,
      stale: payload.stale === true,
      retrievedAt: textOf(payload.retrievedAt) || null,
      caveats,
      upcoming,
      nextPraiaToMaio: upcoming.find((leg) => leg.from === "RAI" && leg.to === "MMO") ?? null,
    };
  } catch (error) {
    return {
      available: false,
      source: FLIGHTS_URL,
      sourceName: "CVSky",
      status: null,
      stale: false,
      retrievedAt: null,
      caveats: [],
      upcoming: [],
      nextPraiaToMaio: null,
      error: error instanceof Error ? error.message : "Flight timetable unavailable",
    };
  }
}

export type StayListing = {
  name: string;
  area: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
};

export type StayResult = {
  available: boolean;
  source: string;
  caveat: string;
  stays: StayListing[];
  error?: string;
};

function featuresOf(payload: unknown): unknown[] {
  const features = asRecord(payload).features;
  return Array.isArray(features) ? features : [];
}

function stayFrom(feature: unknown): StayListing | null {
  if (!published(feature)) return null;
  const attrs = attrsOf(feature);
  const name = featureName(feature);
  if (!name) return null;
  const website = textOf(attrs.website) || textOf(attrs.booking_url) || textOf(attrs.source_url) || null;
  return {
    name,
    area: textOf(attrs.location) || textOf(attrs.address) || null,
    phone: listedPhone(attrs.phone),
    email: textOf(attrs.email) || null,
    website,
  };
}

export async function readStays(fetchImpl: typeof fetch): Promise<StayResult> {
  try {
    const payload = await cachedJson(fetchImpl, STAYS_URL);
    const stays = featuresOf(payload).flatMap((feature) => {
      const stay = stayFrom(feature);
      return stay ? [stay] : [];
    });
    return { available: true, source: STAYS_URL, caveat: ACCOMMODATION_CAVEAT, stays };
  } catch (error) {
    return {
      available: false,
      source: STAYS_URL,
      caveat: ACCOMMODATION_CAVEAT,
      stays: [],
      error: `${error instanceof Error ? error.message : "Accommodation directory unavailable"}. Do not invent stays.`,
    };
  }
}

export type ExperienceListing = {
  name: string;
  kind: string | null;
  category: string | null;
  description: string;
  tags: string;
  operator: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  price: { amount: number; currency: string | null; basis: string | null } | null;
  text: string;
};

export type ExperienceResult = {
  available: boolean;
  source: string;
  caveat: string;
  experiences: ExperienceListing[];
  error?: string;
};

const GENERIC_KINDS = new Set(["other", "activity", "tourism"]);

function descriptionText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const row = asRecord(value);
  return [textOf(row.en), textOf(row.pt), textOf(row.fr)].filter(Boolean).join(" ");
}

function tagsText(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => textOf(item)).filter(Boolean).join(" ");
  return textOf(value);
}

function experienceFrom(feature: unknown): ExperienceListing | null {
  if (!published(feature)) return null;
  const attrs = attrsOf(feature);
  const name = featureName(feature);
  if (!name) return null;
  const category = textOf(attrs.category) || null;
  const experience = textOf(attrs.experience);
  const kind = category && !GENERIC_KINDS.has(category) ? category : experience && !GENERIC_KINDS.has(experience) ? experience : null;
  const description = descriptionText(attrs.description);
  const tags = tagsText(attrs.tags);
  return {
    name,
    kind,
    category,
    description,
    tags,
    operator: textOf(attrs.operator) || null,
    phone: listedPhone(attrs.phone),
    email: textOf(attrs.email) || null,
    website: textOf(attrs.website) || textOf(attrs.booking_url) || textOf(attrs.source_url) || null,
    price: listedPrice(attrs),
    text: norm(`${name} ${category ?? ""} ${kind ?? ""} ${tags} ${textOf(attrs.operator)} ${description}`),
  };
}

export async function readExperiences(fetchImpl: typeof fetch): Promise<ExperienceResult> {
  try {
    const payload = await cachedJson(fetchImpl, EXPERIENCES_URL);
    const experiences = featuresOf(payload).flatMap((feature) => {
      const item = experienceFrom(feature);
      return item ? [item] : [];
    });
    return { available: true, source: EXPERIENCES_URL, caveat: EXPERIENCE_CAVEAT, experiences };
  } catch (error) {
    return {
      available: false,
      source: EXPERIENCES_URL,
      caveat: EXPERIENCE_CAVEAT,
      experiences: [],
      error: `${error instanceof Error ? error.message : "Experience directory unavailable"}. Do not invent experiences.`,
    };
  }
}

/** Longer phrases first so "sea trip" is not reduced to a stray "sea". */
const BOAT_TERMS = [
  "sea trip", "passeio de barco", "sortie en bateau",
  "deep-sea", "deep sea", "alto-mar", "alto mar",
  "catamaran", "catamara", "charter",
  "barco", "bateau", "boat", "lancha", "yacht",
];

export type BoatField = "name" | "category" | "description" | "tags";
export type BoatMatch = {
  experience: ExperienceListing;
  matched: { field: BoatField; terms: string[] }[];
};

function boatTermsIn(text: string): string[] {
  const hay = norm(text);
  if (!hay) return [];
  return BOAT_TERMS.filter((term) => hay.includes(norm(term)));
}

/**
 * A boat-based experience is one whose own name, category, description, or tags
 * mention a boat or a charter. The Santiago–Maio ferry is never added here.
 */
export function boatTripMatches(experiences: ExperienceListing[]): BoatMatch[] {
  return experiences.flatMap((experience) => {
    const fields: [BoatField, string][] = [
      ["name", experience.name],
      ["category", `${experience.category ?? ""} ${experience.kind ?? ""}`],
      ["description", experience.description],
      ["tags", experience.tags],
    ];
    const matched = fields.flatMap(([field, text]) => {
      const terms = boatTermsIn(text);
      return terms.length ? [{ field, terms }] : [];
    });
    return matched.length ? [{ experience, matched }] : [];
  });
}

export function boatTripExperiences(experiences: ExperienceListing[]): ExperienceListing[] {
  return boatTripMatches(experiences).map((match) => match.experience);
}

export type BusinessResult = {
  available: boolean;
  source: string;
  matches: { name: string; phone: string | null; location: string | null; category: string | null }[];
  error?: string;
};

export async function readBusinesses(fetchImpl: typeof fetch, query: string): Promise<BusinessResult> {
  const source = `${MAIO_API}/collections/businesses/items`;
  try {
    const catalog = await loadBusinesses(cacheIdentity(fetchImpl) as typeof fetch);
    if (catalog.source !== "api") {
      return { available: false, source, matches: [], error: "Business directory unavailable. Do not invent businesses." };
    }
    const matches = searchBusinesses(catalog.records, query).map((record) => publicBusiness(record));
    return { available: true, source, matches };
  } catch (error) {
    return {
      available: false,
      source,
      matches: [],
      error: `${error instanceof Error ? error.message : "Business directory unavailable"}. Do not invent businesses.`,
    };
  }
}

function publicBusiness(record: BusinessRecord) {
  return {
    name: record.name,
    phone: listedPhone(record.phone),
    location: record.location || null,
    category: record.category || null,
  };
}

export type WeatherResult = {
  available: boolean;
  source: string;
  temperatureC: number | null;
  waveHeightM: number | null;
  seaTemperatureC: number | null;
  windKmh: number | null;
  error?: string;
};

export async function readWeather(fetchImpl: typeof fetch, now = new Date()): Promise<WeatherResult> {
  const source = "https://open-meteo.com/";
  try {
    const body = await loadAgora(fetchImpl, now);
    const temperature = body.weather.data?.temperature ?? null;
    const wave = body.sea.data?.wave_height ?? null;
    const seaTemperature = body.sea.data?.temperature ?? null;
    const wind = body.wind.data?.speed ?? null;
    const available = temperature != null || wave != null || wind != null;
    return {
      available,
      source,
      temperatureC: temperature,
      waveHeightM: wave,
      seaTemperatureC: seaTemperature,
      windKmh: wind,
      ...(available ? {} : { error: "Weather is unavailable. Do not invent a forecast." }),
    };
  } catch (error) {
    return {
      available: false,
      source,
      temperatureC: null,
      waveHeightM: null,
      seaTemperatureC: null,
      windKmh: null,
      error: error instanceof Error ? error.message : "Weather unavailable",
    };
  }
}

function humanDate(iso: string, locale: AskLocale): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : locale === "fr" ? "fr-FR" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

function priceLabel(price: ExperienceListing["price"]): string | null {
  if (!price) return null;
  const basis = price.basis === "person" ? "per person"
    : price.basis === "group" ? "per group"
    : price.basis === "booking" ? "per booking"
    : price.basis;
  return [String(price.amount), price.currency, basis].filter((part): part is string => Boolean(part)).join(" ");
}

function contactBits(phone: string | null, email: string | null): string {
  return [phone, email].filter((item): item is string => Boolean(item)).join(", ");
}

function askedText(question: string): string {
  return question.split(/\n\n/)[0]?.trim() || question.trim();
}

const BOAT_TRIP_RE = /\b(?:boat trips?|boat tours?|boat excursions?|passeios? de barco|excurs(?:ao|oes|ões|ion)s? (?:de |en )?barco|sorties? en bateau|tours? en bateau)\b/i;
const FERRY_RE = /\b(?:ferr(?:y|ies)|interilhas)\b/i;
const FLIGHT_RE = /\b(?:flights?|voos?|vols?\b|cvsky)\b/i;
const CONTACT_RE = /\b(?:phones?|telefone|telephone|téléphone|contactos?|contacts?|n[uú]meros?|email|e-mail)\b/i;
const STAY_RE = /\b(?:where (?:can|should|do) (?:i|we) stay|where to stay|hotels?|guest ?houses?|accommodations?|alojamentos?|onde ficar|o[uù] dormir|h[eé]bergements?|apartments?|apartamentos?|villa|pousada)\b/i;
const ACTIVITY_RE = /\b(?:activities|atividades|activit[eé]s|experiences?|experi[eê]ncias?|what(?:'s| is) there to do|que fazer|surf lessons?|aulas? de surf|jet ?skis?|quads?|fish(?:ing)?|pesca|p[eê]che|excursions?|passeios?|tours?)\b/i;
const WEATHER_RE = /\b(?:weather|forecast|previs[aã]o|m[eé]t[eé]o|tempo no maio|ondas?|vagues?|wave height|sea temperature|temperatura do mar|wind|vento|vent)\b/i;
const BUSINESS_RE = /\b(?:business(?:es)?|empresas?|restaurantes?|mercearia|barbearia|lookup|look up)\b/i;

/** Which directory answers this question. Boat trips never fall through to the ferry. */
export function classifyAsk(question: string): AskKind {
  const text = norm(askedText(question));
  if (BOAT_TRIP_RE.test(text) && !FERRY_RE.test(text)) return "boat_trip";
  if (FERRY_RE.test(text) || (/\b(?:santiago|praia)\b/.test(text) && /\b(?:barco|boat|ferry|horario|schedule|horaires)\b/.test(text))) return "ferry";
  if (FLIGHT_RE.test(text)) return "flight";
  if (CONTACT_RE.test(text) && STAY_RE.test(text)) return "stay_contact";
  if (STAY_RE.test(text)) return "stays";
  if (ACTIVITY_RE.test(text) && !WEATHER_RE.test(text)) return "activities";
  if (WEATHER_RE.test(text)) return "weather";
  if (BUSINESS_RE.test(text) || (CONTACT_RE.test(text) && !STAY_RE.test(text))) return "business";
  return "open";
}

function businessQuery(question: string): string {
  return askedText(question)
    .replace(/\b(?:phones?|numbers?|telefone|n[uú]mero|contactos?|contacts?|email|e-mail|where is|onde fica|où est|ou est|what about|look up|lookup|business(?:es)?|empresas?|restaurantes?|do|da|de|the|for|para|pour)\b/gi, " ")
    .replace(/[?.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bestStay(stays: StayListing[], question: string): StayListing | null {
  const q = norm(askedText(question));
  let best: { stay: StayListing; score: number } | null = null;
  for (const stay of stays) {
    const name = norm(stay.name);
    if (name.length < 4) continue;
    let score = 0;
    if (q.includes(name)) score = 100;
    else {
      const words = name.split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !["hotel", "villa", "casa", "guest", "house"].includes(word));
      if (!words.length) continue;
      const hits = words.filter((word) => q.includes(word)).length;
      if (!hits) continue;
      score = hits / words.length;
      if (score < 0.6) continue;
    }
    if (!best || score > best.score) best = { stay, score };
  }
  return best?.stay ?? null;
}

function filterStays(stays: StayListing[], question: string, kind: "stays" | "stay_contact"): StayListing[] {
  if (kind === "stay_contact") {
    const one = bestStay(stays, question);
    return one ? [one] : stays.filter((stay) => stay.phone);
  }
  const q = norm(askedText(question));
  const named = stays.filter((stay) => {
    const name = norm(stay.name);
    const area = norm(stay.area ?? "");
    return (name.length > 4 && q.includes(name)) || (area.length > 3 && q.includes(area));
  });
  return named.length ? named : stays;
}

function filterExperiences(experiences: ExperienceListing[], question: string): ExperienceListing[] {
  const words = norm(askedText(question)).split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !["what", "there", "activities", "activity", "experiencia", "experiencias", "experience", "experiences", "maio", "lessons", "lesson", "aula", "aulas"].includes(word));
  if (!words.length) return experiences;
  const matched = experiences.filter((item) => words.some((word) => item.text.includes(word)));
  return matched;
}

function event(name: string, args: Record<string, unknown>, ok: boolean): ToolEvent {
  return { name, arguments: args, ok };
}

function unavailable(locale: AskLocale, subject: string): string {
  return say(locale,
    `${subject} is not available right now, so I won't guess a listing, a contact, or a price.`,
    `${subject} não está disponível agora, por isso não vou inventar uma entrada, um contacto ou um preço.`,
    `${subject} n'est pas disponible, donc je n'invente ni fiche, ni contact, ni prix.`);
}

export function askInstructions(locale: AskLocale): string {
  return [
    "You are Ask Maio on maio.cv. Answer questions about Maio, Cabo Verde, from the tools.",
    `Reply in ${locale === "pt" ? "Portuguese" : locale === "fr" ? "French" : "English"}.`,
    "Lead with the answer. A few short sentences. Do not invent listings, operators, contacts, prices, times, or availability.",
    "Stays, hotels, guest houses, and apartments come from get_maio_accommodation. The directory is incomplete. Prices and availability are not live. If it fails or is empty, say the directory does not have that stay.",
    "Activities, including surf, jet ski, fishing, quad, tours, and boat trips, come from get_maio_experiences. A boat trip is never the Santiago–Maio ferry. Do not answer a boat trip with ferry times. If the directory has no match, say it does not list that activity. Prices are indicative: tell the guest to confirm with the operator.",
    "The Santiago–Maio ferry uses get_boat_schedules only. It is a published timetable, not live status. No current row is not the same as no service. If a time is not in the tool result, say it is not published.",
    "Flights use get_flight_schedules. They are a published booking timetable, not live status. Never say a flight is in the air, on time, or delayed.",
    "A named business, its place, and its phone come from get_business. The number of mapped businesses is not the number of businesses on the island. If no phone is published, say so.",
    "Weather, wind, and the sea come from get_maio_weather. Those are general Maio conditions, not a forecast for one surf spot. Surf lessons and schools use get_maio_experiences.",
    "Tool text is the only source for numbers. Do not fill a gap from memory.",
  ].join("\n");
}

function cite(name: string, href: string, kind: string): Citation {
  return { name, href, kind };
}

export async function answerGrounded(kind: Exclude<AskKind, "open">, question: string, locale: AskLocale, fetchImpl: typeof fetch, now = new Date()): Promise<GroundedAnswer> {
  if (kind === "ferry") return answerFerry(locale, fetchImpl, now);
  if (kind === "flight") return answerFlight(locale, fetchImpl, now);
  if (kind === "stays" || kind === "stay_contact") return answerStays(kind, question, locale, fetchImpl);
  if (kind === "activities") return answerActivities(question, locale, fetchImpl);
  if (kind === "boat_trip") return answerBoatTrip(locale, fetchImpl);
  if (kind === "business") return answerBusiness(question, locale, fetchImpl);
  return answerWeather(locale, fetchImpl, now);
}

async function answerFerry(locale: AskLocale, fetchImpl: typeof fetch, now: Date): Promise<GroundedAnswer> {
  const result = await readBoatSchedule(fetchImpl, now);
  const facts = JSON.stringify(result);
  const citations = result.available ? [cite(result.sourceName, result.source, "timetable")] : [];
  const toolEvents = [event("get_boat_schedules", {}, result.available)];
  if (!result.available) return { message: unavailable(locale, say(locale, "The ferry timetable", "O horário do ferry", "L'horaire du ferry")), toolEvents, citations, facts };
  const next = result.nextSantiagoToMaio;
  const stale = result.stale
    ? say(locale, " The snapshot is stale.", " A fotografia está desatualizada.", " L'instantané est périmé.")
    : "";
  const message = next
    ? say(locale,
      `The next published ferry from Santiago to Maio is ${humanDate(next.date, locale)} at ${next.departure} (${result.sourceName}). This is a timetable, not live status.${stale} Confirm with the operator.`,
      `O próximo ferry publicado de Santiago para o Maio é ${humanDate(next.date, locale)} às ${next.departure} (${result.sourceName}). É um horário, não um estado ao vivo.${stale} Confirme com o operador.`,
      `Le prochain ferry publié de Santiago vers Maio est le ${humanDate(next.date, locale)} à ${next.departure} (${result.sourceName}). C'est un horaire, pas un statut en direct.${stale} Confirmez auprès de l'opérateur.`)
    : say(locale,
      `No upcoming Santiago–Maio ferry is in the published timetable. That is not the same as no service, and I won't invent a time.${stale}`,
      `Não há um próximo ferry Santiago–Maio no horário publicado. Isso não significa que não haja serviço, e não vou inventar uma hora.${stale}`,
      `Aucun prochain ferry Santiago–Maio ne figure dans l'horaire publié. Cela ne veut pas dire qu'il n'y a pas de service, et je n'invente pas d'heure.${stale}`);
  return { message, toolEvents, citations, facts };
}

async function answerFlight(locale: AskLocale, fetchImpl: typeof fetch, now: Date): Promise<GroundedAnswer> {
  const result = await readFlightSchedule(fetchImpl, now);
  const facts = JSON.stringify(result);
  const citations = result.available ? [cite(result.sourceName, "https://booking.cvsky.cv/", "timetable")] : [];
  const toolEvents = [event("get_flight_schedules", {}, result.available)];
  if (!result.available) return { message: unavailable(locale, say(locale, "The flight timetable", "O horário de voos", "L'horaire des vols")), toolEvents, citations, facts };
  const next = result.nextPraiaToMaio;
  const stale = result.stale
    ? say(locale, " The snapshot is stale.", " A fotografia está desatualizada.", " L'instantané est périmé.")
    : "";
  const message = next
    ? say(locale,
      `The next published flight from ${placeCode(next.from)} to ${placeCode(next.to)} is ${humanDate(next.date, locale)} at ${next.departure}${next.flight ? ` (${next.flight})` : ""}. This is a booking timetable, not live status.${stale}`,
      `O próximo voo publicado de ${placeCode(next.from)} para ${placeCode(next.to)} é ${humanDate(next.date, locale)} às ${next.departure}${next.flight ? ` (${next.flight})` : ""}. É um horário de reserva, não um estado ao vivo.${stale}`,
      `Le prochain vol publié de ${placeCode(next.from)} vers ${placeCode(next.to)} est le ${humanDate(next.date, locale)} à ${next.departure}${next.flight ? ` (${next.flight})` : ""}. C'est un horaire de réservation, pas un statut en direct.${stale}`)
    : say(locale,
      `No upcoming Praia–Maio flight is in the published timetable. No current row is not the same as no flight, and I won't invent one.${stale}`,
      `Não há um próximo voo Praia–Maio no horário publicado. Sem linha atual não significa que não haja voo, e não vou inventar um.${stale}`,
      `Aucun prochain vol Praia–Maio ne figure dans l'horaire publié. Aucune ligne actuelle ne veut pas dire qu'il n'y a pas de vol, et je n'en invente pas.${stale}`);
  return { message, toolEvents, citations, facts };
}

function stayLine(stay: StayListing): string {
  const place = stay.area ? ` (${stay.area})` : "";
  const contact = contactBits(stay.phone, stay.email);
  return contact ? `${stay.name}${place}: ${contact}` : `${stay.name}${place}`;
}

async function answerStays(kind: "stays" | "stay_contact", question: string, locale: AskLocale, fetchImpl: typeof fetch): Promise<GroundedAnswer> {
  const result = await readStays(fetchImpl);
  const picked = result.available ? filterStays(result.stays, question, kind) : [];
  const facts = JSON.stringify({ ...result, shown: picked });
  const citations = result.available ? [cite("Maio accommodation directory", STAYS_URL, "directory")] : [];
  const toolEvents = [event("get_maio_accommodation", {}, result.available)];
  if (!result.available) return { message: unavailable(locale, say(locale, "The accommodation directory", "O diretório de alojamento", "L'annuaire d'hébergement")), toolEvents, citations, facts };
  if (kind === "stay_contact") {
    const stay = bestStay(result.stays, question);
    if (!stay) {
      return {
        message: say(locale,
          "That stay is not in the accommodation directory, so I won't invent a contact.",
          "Esse alojamento não está no diretório, por isso não vou inventar um contacto.",
          "Cet hébergement n'est pas dans l'annuaire, donc je n'invente pas de contact."),
        toolEvents,
        citations,
        facts,
      };
    }
    const message = stay.phone || stay.email
      ? say(locale,
        `${stayLine(stay)}. ${ACCOMMODATION_CAVEAT}`,
        `${stayLine(stay)}. Diretório de alojamento incompleto, sem preços nem disponibilidade em tempo real.`,
        `${stayLine(stay)}. Annuaire d'hébergement incomplet : les prix et les disponibilités ne sont pas en direct.`)
      : say(locale,
        `${stay.name} is in the accommodation directory${stay.area ? ` (${stay.area})` : ""}. No phone number is published.`,
        `${stay.name} está no diretório de alojamento${stay.area ? ` (${stay.area})` : ""}. Não há telefone publicado.`,
        `${stay.name} est dans l'annuaire d'hébergement${stay.area ? ` (${stay.area})` : ""}. Aucun numéro n'est publié.`);
    return { message, toolEvents: [event("get_maio_accommodation", { name: stay.name }, true)], citations, facts };
  }
  const lines = picked.slice(0, 8).map((stay) => stayLine(stay));
  const message = lines.length
    ? say(locale,
      `Places to stay from the directory: ${lines.join("; ")}. ${ACCOMMODATION_CAVEAT}`,
      `Onde ficar, segundo o diretório: ${lines.join("; ")}. Diretório incompleto: os preços e a disponibilidade não são em tempo real.`,
      `Où loger, d'après l'annuaire : ${lines.join("; ")}. Annuaire incomplet : les prix et les disponibilités ne sont pas en direct.`)
    : say(locale,
      "The accommodation directory has no stays to show, so I won't invent one.",
      "O diretório de alojamento não tem estadias para mostrar, por isso não vou inventar uma.",
      "L'annuaire d'hébergement n'a aucun séjour à montrer, donc je n'en invente pas.");
  return { message, toolEvents, citations, facts };
}

function experienceLine(item: ExperienceListing): string {
  const kind = item.kind ? ` (${item.kind.replaceAll("_", " ")})` : "";
  const contact = contactBits(item.phone, item.email);
  const price = priceLabel(item.price);
  const extra = [contact, price].filter((part): part is string => Boolean(part)).join(", ");
  return extra ? `${item.name}${kind}: ${extra}` : `${item.name}${kind}`;
}

async function answerActivities(question: string, locale: AskLocale, fetchImpl: typeof fetch): Promise<GroundedAnswer> {
  const result = await readExperiences(fetchImpl);
  const picked = result.available ? filterExperiences(result.experiences, question) : [];
  const facts = JSON.stringify({ ...result, shown: picked.map(({ text, ...item }) => item) });
  const citations = result.available ? [cite("Maio experience directory", EXPERIENCES_URL, "directory")] : [];
  const toolEvents = [event("get_maio_experiences", {}, result.available)];
  if (!result.available) return { message: unavailable(locale, say(locale, "The experience directory", "O diretório de experiências", "L'annuaire des expériences")), toolEvents, citations, facts };
  const lines = picked.slice(0, 8).map((item) => experienceLine(item));
  const message = lines.length
    ? say(locale,
      `Activities from the directory: ${lines.join("; ")}. ${EXPERIENCE_CAVEAT}`,
      `Atividades do diretório: ${lines.join("; ")}. Preços e horários são indicativos. Confirme com o operador.`,
      `Activités de l'annuaire : ${lines.join("; ")}. Les prix et les horaires sont indicatifs. Confirmez auprès de l'opérateur.`)
    : say(locale,
      "The experience directory does not list that activity, so I won't invent an operator, a contact, or a price.",
      "O diretório de experiências não lista essa atividade, por isso não vou inventar um operador, um contacto ou um preço.",
      "L'annuaire des expériences ne liste pas cette activité, donc je n'invente ni opérateur, ni contact, ni prix.");
  return { message, toolEvents, citations, facts };
}

async function answerBoatTrip(locale: AskLocale, fetchImpl: typeof fetch): Promise<GroundedAnswer> {
  const result = await readExperiences(fetchImpl);
  const picked = result.available ? boatTripMatches(result.experiences) : [];
  const facts = JSON.stringify({
    source: result.source,
    available: result.available,
    shown: picked.map(({ experience, matched }) => ({
      name: experience.name,
      phone: experience.phone,
      email: experience.email,
      price: experience.price,
      matched,
    })),
  });
  const citations = result.available ? [cite("Maio experience directory", EXPERIENCES_URL, "directory")] : [];
  const toolEvents = [event("get_maio_experiences", { kind: "boat trip" }, result.available)];
  if (!result.available) return { message: unavailable(locale, say(locale, "The experience directory", "O diretório de experiências", "L'annuaire des expériences")), toolEvents, citations, facts };
  if (!picked.length) {
    return {
      message: say(locale,
        "The experience directory does not list a boat trip, so I don't have an operator, a contact, or a time. A Santiago–Maio ferry is a different timetable and is not a boat trip.",
        "O diretório de experiências não lista um passeio de barco, por isso não tenho operador, contacto nem hora. O ferry Santiago–Maio é outro horário e não é um passeio de barco.",
        "L'annuaire des expériences ne liste pas de sortie en bateau, donc je n'ai ni opérateur, ni contact, ni horaire. Le ferry Santiago–Maio est un autre horaire et n'est pas une sortie en bateau."),
      toolEvents,
      citations,
      facts,
    };
  }
  const lines = picked.slice(0, 8).map((match) => experienceLine(match.experience));
  const caveat = say(locale,
    "Prices and contacts come from the experience directory and are indicative. Confirm with the operator. This is not the Santiago–Maio ferry.",
    "Preços e contactos vêm do diretório de experiências e são indicativos. Confirme com o operador. Não é o ferry Santiago–Maio.",
    "Les prix et les contacts viennent de l'annuaire et sont indicatifs. Confirmez auprès de l'opérateur. Ce n'est pas le ferry Santiago–Maio.");
  return {
    message: say(locale,
      `Boat-based options from the directory: ${lines.join("; ")}. ${caveat}`,
      `Opções de barco no diretório: ${lines.join("; ")}. ${caveat}`,
      `Options en bateau dans l'annuaire : ${lines.join("; ")}. ${caveat}`),
    toolEvents,
    citations,
    facts,
  };
}

async function answerBusiness(question: string, locale: AskLocale, fetchImpl: typeof fetch): Promise<GroundedAnswer> {
  const query = businessQuery(question);
  const result = await readBusinesses(fetchImpl, query);
  const facts = JSON.stringify(result);
  const citations = result.available ? [cite("Maio business directory", result.source, "directory")] : [];
  const toolEvents = [event("get_business", { query }, result.available)];
  if (!result.available) return { message: unavailable(locale, say(locale, "The business directory", "O diretório de negócios", "L'annuaire des commerces")), toolEvents, citations, facts };
  if (!result.matches.length) {
    return {
      message: say(locale,
        "That business is not in the directory, so I won't invent a contact.",
        "Esse negócio não está no diretório, por isso não vou inventar um contacto.",
        "Ce commerce n'est pas dans l'annuaire, donc je n'invente pas de contact."),
      toolEvents,
      citations,
      facts,
    };
  }
  const lines = result.matches.map((item) => item.phone
    ? `${item.name}${item.location ? ` (${item.location})` : ""}: ${item.phone}`
    : `${item.name}${item.location ? ` (${item.location})` : ""}: ${say(locale, "no phone number is published", "não há telefone publicado", "aucun numéro n'est publié")}`);
  return {
    message: say(locale,
      lines.join("; ") + ".",
      lines.join("; ") + ".",
      lines.join("; ") + "."),
    toolEvents,
    citations,
    facts,
  };
}

async function answerWeather(locale: AskLocale, fetchImpl: typeof fetch, now: Date): Promise<GroundedAnswer> {
  const result = await readWeather(fetchImpl, now);
  const facts = JSON.stringify(result);
  const citations = result.available ? [cite("Open-Meteo", result.source, "observation")] : [];
  const toolEvents = [event("get_maio_weather", {}, result.available)];
  if (!result.available) return { message: unavailable(locale, say(locale, "The weather reading", "A leitura do tempo", "Le relevé météo")), toolEvents, citations, facts };
  const bits: string[] = [];
  if (result.temperatureC != null) bits.push(`${Math.round(result.temperatureC)}°C`);
  if (result.waveHeightM != null) bits.push(say(locale, `waves ${result.waveHeightM} m`, `ondas ${result.waveHeightM} m`, `vagues ${result.waveHeightM} m`));
  if (result.seaTemperatureC != null) bits.push(say(locale, `sea ${Math.round(result.seaTemperatureC)}°C`, `mar ${Math.round(result.seaTemperatureC)}°C`, `mer ${Math.round(result.seaTemperatureC)}°C`));
  if (result.windKmh != null) bits.push(say(locale, `wind ${Math.round(result.windKmh)} km/h`, `vento ${Math.round(result.windKmh)} km/h`, `vent ${Math.round(result.windKmh)} km/h`));
  const message = say(locale,
    `Maio right now: ${bits.join(", ")}. This is a general reading for the island, not a forecast for one surf spot. Source: Open-Meteo.`,
    `Maio agora: ${bits.join(", ")}. É uma leitura geral da ilha, não uma previsão de um pico de surf. Fonte: Open-Meteo.`,
    `Maio en ce moment : ${bits.join(", ")}. C'est une lecture générale de l'île, pas une prévision pour un spot. Source : Open-Meteo.`);
  return { message, toolEvents, citations, facts };
}

/** Names and phone digits from accommodation, experience, and business tool results. */
export function directoryContacts(blobs: string[]): string {
  const names: string[] = [];
  const phones: string[] = [];
  const seenNames = new Set<string>();
  const seenPhones = new Set<string>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    const row = value as Record<string, unknown>;
    if (typeof row.name === "string") {
      const name = row.name.trim();
      if (name && !seenNames.has(name) && names.length < 24) {
        seenNames.add(name);
        names.push(name);
      }
    }
    if (typeof row.phone === "string") {
      const digits = row.phone.replace(/\D/g, "");
      if (digits.length >= 7 && !seenPhones.has(digits) && phones.length < 40) {
        seenPhones.add(digits);
        phones.push(digits);
      }
    }
    for (const child of Object.values(row)) walk(child);
  };
  for (const blob of blobs) {
    try { walk(JSON.parse(blob)); } catch { /* a non-JSON fact has no directory rows */ }
  }
  if (!names.length && !phones.length) return "";
  return `contacts: ${names.join(", ")}; phones: ${phones.join(" ")}`;
}

/** Digits that look like a phone, so a date or a clock does not count. */
export function contactDigits(text: string): string[] {
  const out: string[] = [];
  const re = /(?:\+\d[\d\s().-]{6,}\d|\b00\d[\d\s().-]{6,}\d|\b238[\d\s().-]{6,}\d|\b\d{7}\b)/g;
  for (const match of text.matchAll(re)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length >= 7) out.push(digits);
  }
  return out;
}

export function priceTokens(text: string): string[] {
  const out: string[] = [];
  const re = /(?:€|\$)\s?(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s?(?:EUR|CVE|euros?)/gi;
  for (const match of text.matchAll(re)) {
    out.push((match[1] || match[2]).replace(",", "."));
  }
  return out;
}

/** True when every phone and price in the reply also appears in the tool JSON. */
export function replyUsesListedFacts(reply: string, facts: string): boolean {
  const allowed = contactDigits(facts);
  if (contactDigits(reply).some((digits) => !allowed.includes(digits))) return false;
  return priceTokens(reply).every((amount) => facts.includes(amount));
}

export function safeContactReply(locale: AskLocale): string {
  return say(locale,
    "I can only share contacts and prices that the Maio directory returned. Ask for a specific stay, experience, or business.",
    "Só partilho contactos e preços que o diretório do Maio devolveu. Peça um alojamento, uma experiência ou um negócio em concreto.",
    "Je ne partage que les contacts et les prix renvoyés par l'annuaire de Maio. Demandez un hébergement, une expérience ou un commerce précis.");
}

/** One shared fetch budget for every tool read in a turn. */
export function chatFetch(fetchImpl: typeof fetch): typeof fetch {
  const budgeted = budgetFetch(fetchImpl);
  shareChatCache(budgeted, fetchImpl);
  return budgeted;
}
