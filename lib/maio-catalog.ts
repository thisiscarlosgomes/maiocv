import { EXPERIENCES, FOOD } from "./trip.ts";

/** Public Maio Open API. The same host the portal chat tools call. No key. */
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
  const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
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
export function carRentalRecords(records: BusinessRecord[]): BusinessRecord[] {
  return records.filter((record) => {
    const hay = norm(`${record.name} ${record.category}`);
    if (/quad|jet ?ski|buggy|moto/.test(hay)) return false;
    return /rent-a-car|rent a car|car rental|aluguer de carro|location de voiture/.test(hay)
      || (/aluguer|rent-a-car/.test(hay) && /carro|car|voiture|auto/.test(hay));
  }).slice(0, 3);
}
