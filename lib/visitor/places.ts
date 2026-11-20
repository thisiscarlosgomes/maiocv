import { budgetFetch } from "../fetch-budget.ts";
import { MAIO_API } from "../maio-catalog.ts";
import { driveMinutes, fold, haversineKm, nearestZone, radiusKm, walkMinutes, zoneFromText, ZONES, type LatLon, type Zone } from "./geo.ts";

/**
 * Every place the visitor agent may name, read from the Maio Open API: the tourism collection
 * (Visit Maio curated places, guide food/stays/experiences) plus the businesses collection
 * (restaurants, bars, shops). Nothing is bundled: if the API is down the agent names nothing.
 */
export type PlaceKind = "food" | "bar" | "beach" | "stay" | "experience" | "sight" | "nature" | "village" | "shop";
export const PLACE_KINDS: PlaceKind[] = ["food", "bar", "beach", "stay", "experience", "sight", "nature", "village", "shop"];

export type Place = {
  id: string;
  name: string;
  namePt: string;
  kind: PlaceKind;
  category: string;
  lat: number | null;
  lon: number | null;
  /** True when the point is only the village of a text location, not the venue itself. */
  approx: boolean;
  zone: string | null;
  zoneId: string | null;
  location: string;
  description: string;
  descriptionPt: string;
  tips: string[];
  image: string | null;
  phone: string;
  website: string;
  booking: string;
};

const TTL_MS = 10 * 60 * 1000;
const STALE_MS = 60 * 60 * 1000;
const READ_MS = 4_000;

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec => (value && typeof value === "object" ? value as Rec : {});
const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
function lang(value: unknown, locale: "en" | "pt"): string {
  if (typeof value === "string") return value.trim();
  const row = rec(value);
  return str(row[locale]) || str(row.en) || str(row.pt);
}

function kindOf(attrs: Rec, id: string, name: string): PlaceKind | null {
  const category = str(attrs.category);
  const business = str(attrs.businessCategory);
  const experience = str(attrs.experience);
  const amenity = str(attrs.amenity);
  const shop = str(attrs.shop);
  if (["restaurant", "cafe", "fast_food"].includes(amenity)) return "food";
  if (["bar", "pub"].includes(amenity)) return /restaura/i.test(name) ? "food" : "bar";
  if (amenity === "marketplace" || ["supermarket", "convenience", "bakery", "greengrocer"].includes(shop)) return "shop";
  if (business === "restaurant" || experience === "food" || business === "food") return "food";
  if (business === "bar") return /restaura/i.test(name) ? "food" : "bar";
  if (business === "stay" || experience === "stay" || /^maio-guide-stay/.test(id) || attrs.tourism === "apartment" || attrs.tourism === "hotel" || attrs.tourism === "guest_house") return "stay";
  if (business === "marketplace" || /supermerc|supermarket|mercearia|mercado/i.test(name)) return "shop";
  if (experience === "activity" || ["guided_tour", "water_sports", "sports", "fishing"].includes(category) || ["guided_tour", "water_sports", "sports", "fishing", "other"].includes(business)) return "experience";
  if (category === "beach") return "beach";
  if (category === "settlement") return "village";
  if (["religious_heritage", "historical_heritage", "economic_activity", "education_center"].includes(category)) return "sight";
  if (["protected_area", "wetland", "mountain", "ribeira", "forest_area", "biosphere", "dunes", "islet"].includes(category)) return "nature";
  return null;
}

function point(feature: Rec): LatLon | null {
  const geometry = rec(feature.geometry);
  if (geometry.type !== "Point" || !Array.isArray(geometry.coordinates)) return null;
  const [lon, lat] = geometry.coordinates as unknown[];
  return typeof lat === "number" && typeof lon === "number" ? { lat, lon } : null;
}

export function placeFromFeature(input: unknown): Place | null {
  const feature = rec(input);
  const props = rec(feature.properties);
  const status = str(props.publicationStatus);
  if (status && status !== "published") return null;
  const attrs = rec(props.attributes);
  const id = str(feature.id);
  if (!id || id.startsWith("guide-offroad")) return null;
  const name = lang(attrs.name, "en") || lang(props.name, "en") || str(attrs.title);
  if (!name) return null;
  const kind = kindOf(attrs, id, name);
  if (!kind) return null;
  const location = lang(attrs.location, "en") || str(attrs.address) || str(attrs["addr:city"]);
  let at = point(feature);
  let approx = false;
  let zone: Zone | null = null;
  if (at) {
    const near = nearestZone(at);
    zone = near.zone;
  } else {
    zone = zoneFromText(`${location} ${str(attrs.address)}`);
    if (zone) { at = { lat: zone.lat, lon: zone.lon }; approx = true; }
  }
  const tips = Array.isArray(attrs.tips) ? attrs.tips.map((tip) => lang(tip, "en")).filter(Boolean) : [];
  return {
    id,
    name,
    namePt: lang(attrs.name, "pt") || name,
    kind,
    category: str(attrs.category) || str(attrs.businessCategory) || str(attrs.experience),
    lat: at?.lat ?? null,
    lon: at?.lon ?? null,
    approx,
    zone: zone?.name ?? null,
    zoneId: zone?.id ?? null,
    location,
    description: lang(attrs.description, "en") || (str(attrs.cuisine) ? `Cuisine: ${str(attrs.cuisine)}.` : ""),
    descriptionPt: lang(attrs.description, "pt"),
    tips,
    image: str(attrs.image_url) || str(attrs.image) || null,
    phone: str(attrs.phone),
    website: str(attrs.website) || str(attrs.source_url),
    booking: str(attrs.booking_url),
  };
}

function merge(a: Place, b: Place): Place {
  const pick = <T,>(x: T, y: T) => (x === "" || x === null || (Array.isArray(x) && !x.length) ? y : x);
  const located = a.lat !== null && !a.approx ? a : b.lat !== null && !b.approx ? b : a;
  return {
    ...a,
    name: a.name.length >= b.name.length ? a.name : b.name,
    lat: located.lat, lon: located.lon, approx: located.approx, zone: located.zone, zoneId: located.zoneId,
    location: pick(a.location, b.location), description: pick(a.description, b.description), descriptionPt: pick(a.descriptionPt, b.descriptionPt),
    tips: pick(a.tips, b.tips), image: pick(a.image, b.image), phone: pick(a.phone, b.phone), website: pick(a.website, b.website), booking: pick(a.booking, b.booking),
  };
}

export function buildIndex(features: unknown[]): Place[] {
  const byId = new Map<string, Place>();
  for (const feature of features) {
    const place = placeFromFeature(feature);
    if (!place) continue;
    const seen = byId.get(place.id);
    byId.set(place.id, seen ? merge(seen, place) : place);
  }
  // Two curated rows can share one name (the API repeats "Mounts Santo António to Chapéu").
  const byName = new Map<string, Place>();
  for (const place of byId.values()) {
    const key = `${place.kind}:${fold(place.name)}`;
    if (!byName.has(key)) byName.set(key, place);
  }
  return [...byName.values()];
}

async function readAll(fetchImpl: typeof fetch, collection: string): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let offset = 0; offset < 1000; offset += 500) {
    const response = await fetchImpl(`${MAIO_API}/collections/${collection}/items?limit=500&offset=${offset}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(READ_MS) });
    if (!response.ok) throw new Error(`Maio API ${collection} HTTP ${response.status}`);
    const features = rec(await response.json()).features;
    if (!Array.isArray(features)) throw new Error(`Maio API ${collection} has no features`);
    out.push(...features);
    if (features.length < 500) break;
  }
  return out;
}

let cached: { at: number; places: Place[] } | null = null;
/** One read in flight per fetch, so a stuck test double cannot hold another caller. */
const inflight = new WeakMap<object, Promise<Place[]>>();

/** For tests: put a fixed index in place, or clear it. */
export function setPlaceIndex(places: Place[] | null): void {
  cached = places ? { at: Number.POSITIVE_INFINITY, places } : null;
}

export async function loadPlaces(fetchImpl: typeof fetch = fetch): Promise<Place[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.places;
  if (cached && cached.at === Number.POSITIVE_INFINITY) return cached.places;
  let pending = inflight.get(fetchImpl);
  if (!pending) {
    // budgetFetch settles even when a fetch ignores its abort signal.
    const read = budgetFetch(fetchImpl, READ_MS + 500);
    pending = (async () => {
      try {
        const [tourism, businesses] = await Promise.all([readAll(read, "tourism"), readAll(read, "businesses").catch(() => [])]);
        const places = buildIndex([...tourism, ...businesses]);
        if (!places.length) throw new Error("no places");
        cached = { at: Date.now(), places };
        return places;
      } catch {
        if (cached && Date.now() - cached.at < STALE_MS) return cached.places;
        return [];
      } finally {
        inflight.delete(fetchImpl);
      }
    })();
    inflight.set(fetchImpl, pending);
  }
  return pending;
}

/** Best match of a free-text name to one place: exact, then contains, then shared words. */
export function findPlace(places: Place[], query: string, kinds?: PlaceKind[]): Place | null {
  const q = fold(query).replace(/\b(the|a|o|a|beach|praia|restaurant|restaurante|bar)\b/g, " ").replace(/\s+/g, " ").trim();
  const full = fold(query);
  if (!full) return null;
  const pool = kinds?.length ? places.filter((place) => kinds.includes(place.kind)) : places;
  let best: { place: Place; score: number } | null = null;
  for (const place of pool) {
    const names = [fold(place.name), fold(place.namePt)];
    let score = 0;
    for (const name of names) {
      if (name === full) score = Math.max(score, 100);
      else if (name.includes(full) && full.length >= 4) score = Math.max(score, 80);
      else if (full.includes(name) && name.length >= 5) score = Math.max(score, 70);
      else if (q.length >= 4) {
        const words = q.split(" ").filter((word) => word.length >= 4);
        const hits = words.filter((word) => name.split(" ").includes(word)).length;
        if (words.length && hits) score = Math.max(score, 30 + Math.round(40 * hits / words.length));
      }
    }
    // A village record beats a shop that only shares the village word.
    if (score && place.kind === "village") score += 1;
    if (score && (!best || score > best.score)) best = { place, score };
  }
  return best && best.score >= 50 ? best.place : null;
}

export type Anchor = { name: string; lat: number; lon: number; zone: string; zoneId: string; source: "place" | "village" | "context" };

export function resolveAnchor(places: Place[], text: string | null | undefined): Anchor | null {
  const value = text?.trim();
  if (!value) return null;
  const zone = zoneFromText(value);
  const place = findPlace(places, value);
  // "Calheta" alone is the village, not "Artisan Centre of Calheta".
  if (zone && (!place || place.kind === "village" || !fold(value).includes(fold(place.name).split(" ").slice(0, 2).join(" ")))) {
    return { name: zone.name, lat: zone.lat, lon: zone.lon, zone: zone.name, zoneId: zone.id, source: "village" };
  }
  if (place && place.lat !== null && place.lon !== null) {
    return { name: place.name, lat: place.lat, lon: place.lon, zone: place.zone ?? "", zoneId: place.zoneId ?? "", source: "place" };
  }
  return null;
}

export type NearbyRow = {
  id: string; name: string; kind: PlaceKind; area: string | null; km: number | null;
  walkMin: number | null; driveMin: number | null; approxLocation: boolean; summary: string; tip?: string; phone?: string;
};

export type NearbyResult = {
  anchor: Anchor | null;
  radiusKm: number;
  results: NearbyRow[];
  /** Nothing inside the radius; these are the nearest beyond it. */
  beyondRadius: boolean;
  note: string;
};

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(". ") + 1, cut.lastIndexOf(" ")))}…`;
}

function row(place: Place, anchor: Anchor | null, locale: "en" | "pt"): NearbyRow {
  const km = anchor && place.lat !== null && place.lon !== null ? Math.round(haversineKm(anchor, { lat: place.lat, lon: place.lon }) * 10) / 10 : null;
  return {
    id: place.id,
    name: locale === "pt" ? place.namePt : place.name,
    kind: place.kind,
    area: place.zone,
    km,
    walkMin: km === null ? null : walkMinutes(km),
    driveMin: km === null ? null : driveMinutes(km),
    approxLocation: place.approx,
    summary: clip(locale === "pt" ? place.descriptionPt || place.description : place.description, 240),
    ...(place.tips[0] ? { tip: place.tips[0] } : {}),
    ...(place.phone ? { phone: place.phone } : {}),
  };
}

export function nearby(places: Place[], options: { kinds: PlaceKind[]; anchor: Anchor | null; car?: boolean | null; limit?: number; locale?: "en" | "pt" }): NearbyResult {
  const locale = options.locale ?? "en";
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 10);
  const radius = radiusKm(options.car);
  const pool = places.filter((place) => !options.kinds.length || options.kinds.includes(place.kind));
  if (!options.anchor) {
    const rows = pool.slice(0, limit).map((place) => row(place, null, locale));
    return { anchor: null, radiusKm: radius, results: rows, beyondRadius: false, note: "No location known: not sorted by distance. Ask where they are staying only if distance matters." };
  }
  const anchor = options.anchor;
  const ranked = pool
    .map((place) => ({ place, km: place.lat === null || place.lon === null ? Infinity : haversineKm(anchor, { lat: place.lat, lon: place.lon }) }))
    .sort((a, b) => a.km - b.km || a.place.name.localeCompare(b.place.name));
  const inside = ranked.filter((item) => item.km <= radius);
  const beyond = !inside.length;
  const chosen = (beyond ? ranked.filter((item) => Number.isFinite(item.km)).slice(0, Math.min(limit, 3)) : inside.slice(0, limit));
  const unplaced = ranked.filter((item) => !Number.isFinite(item.km)).length;
  const note = [
    beyond ? `Nothing of this kind is listed within ${radius} km of ${anchor.name}; these are the nearest. Say how far they are.` : "",
    unplaced ? `${unplaced} listing(s) of this kind have no location in the API and are not ranked.` : "",
    options.car === false ? "Guest has no car: walking minutes matter; anything over ~30 min walk needs a taxi or aluguer." : "",
  ].filter(Boolean).join(" ");
  return { anchor, radiusKm: radius, results: chosen.map((item) => row(item.place, anchor, locale)), beyondRadius: beyond, note };
}

export function zoneNames(): string[] {
  return ZONES.filter((zone) => zone.id !== "airport").map((zone) => zone.name);
}
