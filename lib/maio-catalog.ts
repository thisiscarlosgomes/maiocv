import { EXPERIENCES, FOOD, experience, isExcludedExperience, type Experience } from "./trip.ts";

/** Public Maio Open API. No key. */
export const MAIO_API = "https://api.maio.cv/api/v1";
const TTL_MS = 10 * 60 * 1000;

export type BusinessRecord = {
  id: string;
  name: string;
  phone: string;
  location: string;
  category: string;
};

export type BusinessCatalog = {
  records: BusinessRecord[];
  source: "api" | "fallback";
};

type Cache = { epoch: number; at: number; value: BusinessCatalog };
const businessCaches = new WeakMap<object, Cache>();
let businessEpoch = 0;

export function clearBusinessCache(): void {
  businessEpoch += 1;
}

function norm(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Trip fixture, used only when api.maio.cv cannot be read. Phones live on the API, not here. */
export function fallbackBusinesses(): BusinessRecord[] {
  const food = FOOD.map((item) => ({ id: item.id, name: item.title, phone: "", location: item.location, category: "food" }));
  const experiences = EXPERIENCES.map((item) => ({ id: item.id, name: item.title, phone: "", location: item.location, category: item.kind }));
  return [...food, ...experiences];
}

function fromFeature(feature: unknown): BusinessRecord | null {
  const row = asRecord(feature);
  const props = asRecord(row.properties);
  const attrs = asRecord(props.attributes);
  const name = textOf(attrs.name) || textOf(attrs.title) || textOf(props.name);
  if (!name) return null;
  const id = textOf(row.id) || textOf(attrs.id) || name;
  const status = textOf(props.publicationStatus);
  if (status && status !== "published") return null;
  return {
    id,
    name,
    phone: textOf(attrs.phone),
    location: textOf(attrs.location) || textOf(attrs.address),
    category: textOf(attrs.category) || textOf(attrs.amenity) || textOf(attrs.experience) || textOf(attrs.shop),
  };
}

async function fetchPage(fetchImpl: typeof fetch, offset: number): Promise<unknown[]> {
  const url = `${MAIO_API}/collections/businesses/items?limit=100&offset=${offset}`;
  const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error(`Maio API HTTP ${response.status}`);
  const body = asRecord(await response.json());
  const features = body.features;
  if (!Array.isArray(features)) throw new Error("Maio API businesses payload has no features");
  return features;
}

/** Businesses from api.maio.cv, cached for 10 minutes per fetch. Falls back to the trip fixture. */
export async function loadBusinesses(fetchImpl: typeof fetch = fetch): Promise<BusinessCatalog> {
  const hit = businessCaches.get(fetchImpl);
  if (hit && hit.epoch === businessEpoch && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    const features: unknown[] = [];
    for (let offset = 0; offset < 500; offset += 100) {
      const page = await fetchPage(fetchImpl, offset);
      features.push(...page);
      if (page.length < 100) break;
    }
    const records = features.flatMap((feature) => {
      const row = fromFeature(feature);
      return row ? [row] : [];
    });
    if (!records.length) throw new Error("Maio API returned no businesses");
    const value: BusinessCatalog = { records, source: "api" };
    businessCaches.set(fetchImpl, { epoch: businessEpoch, at: Date.now(), value });
    return value;
  } catch {
    return { records: fallbackBusinesses(), source: "fallback" };
  }
}

export function searchBusinesses(records: BusinessRecord[], query: string): BusinessRecord[] {
  const needle = norm(query).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (needle.length < 3) return [];
  const ranked = records.flatMap((record) => {
    const name = norm(record.name);
    let score = 0;
    if (name === needle) score = 100;
    else if (name.includes(needle)) score = 80;
    else if (needle.includes(name) && name.length > 4) score = 60;
    return score ? [{ record, score }] : [];
  });
  ranked.sort((a, b) => b.score - a.score || a.record.name.localeCompare(b.record.name));
  const seen = new Set<string>();
  const out: BusinessRecord[] = [];
  for (const row of ranked) {
    if (seen.has(row.record.id)) continue;
    seen.add(row.record.id);
    out.push(row.record);
    if (out.length === 3) break;
  }
  return out;
}

export function pharmacyRecords(records: BusinessRecord[]): BusinessRecord[] {
  return records.filter((record) => /pharmac|farmac/i.test(`${record.name} ${record.category}`)).slice(0, 3);
}

/** Car hire only. A quad or jet-ski rental is not a car. */
export type Stay = {
  id: string;
  name: string;
  area: string;
  phone: string;
  link: string;
  lat?: number;
  lon?: number;
};

export type OfferingCatalog = {
  experiences: Experience[];
  stays: Stay[];
  /** Experiences came from the API. A failed read keeps the bundled fixture and an empty stay list. */
  source: "api" | "fallback";
  /** False when the stay list could not be read, so an empty list is not "no stays". */
  staysRead: boolean;
};

type OfferingCache = { epoch: number; at: number; value: OfferingCatalog };
let offeringCache: OfferingCache | null = null;
let offeringEpoch = 0;
/** The last list each collection actually returned. A slow read reuses it instead of going empty. */
let lastExperiences: { epoch: number; rows: Experience[] } | null = null;
let lastStays: { epoch: number; rows: Stay[] } | null = null;

export function clearOfferingCache(): void {
  offeringEpoch += 1;
  offeringCache = null;
  lastExperiences = null;
  lastStays = null;
}

function featuresOf(payload: unknown): unknown[] {
  const body = asRecord(payload);
  return Array.isArray(body.features) ? body.features : [];
}

function pointOf(feature: unknown): { lat: number; lon: number } | null {
  const geometry = asRecord(asRecord(feature).geometry);
  const coordinates = geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lon = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function attrsOf(feature: unknown): Record<string, unknown> {
  const props = asRecord(asRecord(feature).properties);
  return asRecord(props.attributes);
}

function published(feature: unknown): boolean {
  const status = textOf(asRecord(asRecord(feature).properties).publicationStatus);
  return !status || status === "published";
}

/** API id `maio-guide-blue-ondaazul-maio` is the fixture id `blue-ondaazul-maio`. */
function fixtureId(feature: unknown): string {
  const raw = textOf(asRecord(feature).id) || textOf(attrsOf(feature).id);
  return raw.replace(/^maio-guide-/, "");
}

function descriptionOf(value: unknown, fallback: { en: string; pt: string }): { en: string; pt: string } {
  const row = asRecord(value);
  const en = textOf(row.en);
  const pt = textOf(row.pt);
  return { en: en || fallback.en, pt: pt || fallback.pt };
}

/** Fixture experience overlaid with the API name, place, and contact. Unknown API rows are dropped. */
export function experienceFromFeature(feature: unknown): Experience | null {
  if (!published(feature)) return null;
  const id = fixtureId(feature);
  const base = id ? experience(id) : undefined;
  if (!base || isExcludedExperience(id)) return null;
  const attrs = attrsOf(feature);
  const name = textOf(attrs.name) || textOf(asRecord(asRecord(feature).properties).name) || base.title;
  const phone = textOf(attrs.phone);
  const booking = textOf(attrs.booking_url) || textOf(attrs.website) || textOf(attrs.source_url);
  return {
    ...base,
    title: name,
    location: textOf(attrs.location) || base.location,
    description: descriptionOf(attrs.description, base.description),
    operator: {
      ...base.operator,
      name: name || base.operator.name,
      ...(phone ? { phone } : {}),
      ...(booking ? { bookingUrl: booking } : {}),
    },
  };
}

export function stayFromFeature(feature: unknown): Stay | null {
  if (!published(feature)) return null;
  const attrs = attrsOf(feature);
  const name = textOf(attrs.name) || textOf(asRecord(asRecord(feature).properties).name);
  if (!name) return null;
  const point = pointOf(feature);
  const link = textOf(attrs.website) || textOf(attrs.booking_url) || textOf(attrs.source_url);
  return {
    id: (textOf(asRecord(feature).id) || name).slice(0, 80),
    name,
    area: textOf(attrs.location),
    phone: textOf(attrs.phone),
    link,
    ...(point ? { lat: point.lat, lon: point.lon } : {}),
  };
}

async function readCollection(fetchImpl: typeof fetch, path: string): Promise<unknown[]> {
  const response = await fetchImpl(`${MAIO_API}/${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`Maio API ${path} HTTP ${response.status}`);
  return featuresOf(await response.json());
}

/**
 * Experiences and stays from api.maio.cv, cached for 10 minutes in this process.
 * A failed read keeps the bundled experiences and no stays.
 * `onFetch` runs only when a network read returned stays or experiences, not on a cache hit or a failed read.
 */
export async function loadOfferings(fetchImpl: typeof fetch = fetch, onFetch?: () => void): Promise<OfferingCatalog> {
  const hit = offeringCache;
  if (hit && hit.epoch === offeringEpoch && Date.now() - hit.at < TTL_MS) return hit.value;
  const epoch = offeringEpoch;
  const [experienceResult, stayResult] = await Promise.allSettled([
    readCollection(fetchImpl, "experiences"),
    readCollection(fetchImpl, "accommodation"),
  ]);
  const experienceRows = experienceResult.status === "fulfilled"
    ? experienceResult.value.flatMap((row) => {
      const item = experienceFromFeature(row);
      return item ? [item] : [];
    })
    : null;
  const stayRows = stayResult.status === "fulfilled"
    ? stayResult.value.flatMap((row) => {
      const item = stayFromFeature(row);
      return item ? [item] : [];
    })
    : null;
  if (epoch === offeringEpoch) {
    if (experienceRows?.length) lastExperiences = { epoch, rows: experienceRows };
    if (stayRows) lastStays = { epoch, rows: stayRows };
  }
  const experiences = experienceRows?.length
    ? experienceRows
    : lastExperiences?.epoch === offeringEpoch ? lastExperiences.rows : null;
  const stays = stayRows ?? (lastStays?.epoch === offeringEpoch ? lastStays.rows : null);
  if (experiences?.length || stays?.length) onFetch?.();
  const value: OfferingCatalog = {
    experiences: experiences?.length ? experiences : EXPERIENCES,
    stays: stays ?? [],
    source: experiences?.length ? "api" : "fallback",
    staysRead: stays !== null,
  };
  // Cache only a complete read. A timed-out collection must not pin an empty list for the TTL.
  if (experienceRows?.length && stayRows && epoch === offeringEpoch) {
    offeringCache = { epoch, at: Date.now(), value };
  }
  return value;
}

export function carRentalRecords(records: BusinessRecord[]): BusinessRecord[] {
  return records.filter((record) => {
    const hay = norm(`${record.name} ${record.category}`);
    if (/quad|jet ?ski|buggy|moto/.test(hay)) return false;
    return /rent-a-car|rent a car|car rental|aluguer de carro|location de voiture/.test(hay)
      || (/aluguer|rent-a-car/.test(hay) && /carro|car|voiture|auto/.test(hay));
  }).slice(0, 3);
}
