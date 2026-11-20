/**
 * Outside-the-listings lookup, used only when the Maio API has nothing that fits.
 * Order: Google Places (on Maio only), then Parallel web search with citations.
 * Each step is a no-op without its key, has its own time cap, and never throws.
 */
import { driveMinutes, haversineKm, nearestZone, walkMinutes, type LatLon } from "./geo.ts";

export type FallbackSource = "google" | "web";
export type FallbackHit = {
  name: string;
  source: FallbackSource;
  /** Shown to the guest: "Google Maps" or the web site's domain. */
  sourceLabel: string;
  url: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  area: string | null;
  km: number | null;
  walkMin: number | null;
  driveMin: number | null;
  snippet: string | null;
};
export type FallbackResult = { source: FallbackSource | "none"; hits: FallbackHit[]; tried: string[]; note: string };
export type FallbackEnv = { GOOGLE_PLACES_API_KEY?: string; PARALLEL_API_KEY?: string };
export type FallbackOptions = { fetchImpl: typeof fetch; near?: LatLon | null; deadline: number; env?: FallbackEnv; now?: () => number };

/** Maio island, with a little sea around it. */
export const MAIO_BOX = { south: 15.1, north: 15.36, west: -23.3, east: -23.07 };
export const GOOGLE_TIMEOUT_MS = 3_000;
export const PARALLEL_TIMEOUT_MS = 4_500;
/** Time the model still needs to write the reply after a lookup. */
const REPLY_RESERVE_MS = 2_500;

export function fallbackConfig(env: FallbackEnv = process.env as FallbackEnv): { google: boolean; parallel: boolean } {
  return { google: Boolean(env.GOOGLE_PLACES_API_KEY?.trim()), parallel: Boolean(env.PARALLEL_API_KEY?.trim()) };
}

export function onMaio(point: { lat: number; lon: number }): boolean {
  return point.lat >= MAIO_BOX.south && point.lat <= MAIO_BOX.north && point.lon >= MAIO_BOX.west && point.lon <= MAIO_BOX.east;
}

function cap(options: FallbackOptions, max: number): number {
  const now = options.now ? options.now() : Date.now();
  return Math.min(max, options.deadline - now - REPLY_RESERVE_MS);
}

function distances(point: LatLon | null, near: LatLon | null | undefined): Pick<FallbackHit, "km" | "walkMin" | "driveMin" | "area"> {
  if (!point) return { km: null, walkMin: null, driveMin: null, area: null };
  const zone = nearestZone(point);
  const area = zone.km <= 3 ? zone.zone.name : null;
  if (!near) return { km: null, walkMin: null, driveMin: null, area };
  const km = Math.round(haversineKm(near, point) * 10) / 10;
  return { km, walkMin: walkMinutes(km), driveMin: driveMinutes(km), area };
}

export async function googlePlaces(query: string, options: FallbackOptions): Promise<FallbackHit[] | null> {
  const key = (options.env ?? (process.env as FallbackEnv)).GOOGLE_PLACES_API_KEY?.trim();
  const timeout = cap(options, GOOGLE_TIMEOUT_MS);
  if (!key || timeout < 800) return null;
  try {
    const response = await options.fetchImpl("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key,
        "x-goog-fieldmask": "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.businessStatus",
      },
      body: JSON.stringify({
        textQuery: `${query}, Maio, Cabo Verde`,
        pageSize: 5,
        locationRestriction: { rectangle: { low: { latitude: MAIO_BOX.south, longitude: MAIO_BOX.west }, high: { latitude: MAIO_BOX.north, longitude: MAIO_BOX.east } } },
      }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) return null;
    const body = await response.json() as { places?: { id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number }; googleMapsUri?: string; businessStatus?: string }[] };
    const hits: FallbackHit[] = [];
    for (const row of body.places ?? []) {
      const name = row.displayName?.text?.trim();
      const lat = row.location?.latitude, lon = row.location?.longitude;
      if (!name || typeof lat !== "number" || typeof lon !== "number" || !onMaio({ lat, lon })) continue;
      if (row.businessStatus && row.businessStatus !== "OPERATIONAL") continue;
      hits.push({ name: name.slice(0, 120), source: "google", sourceLabel: "Google Maps", url: row.googleMapsUri ?? null, address: row.formattedAddress?.slice(0, 160) ?? null, lat, lon, snippet: null, ...distances({ lat, lon }, options.near) });
    }
    return hits.slice(0, 4);
  } catch {
    return null;
  }
}

function domain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "web"; }
}

/** "Yoga Cabo Verde | classes in Sal | Studio…" → "Yoga Cabo Verde". */
function titleName(title: string): string {
  return title.split(/\s+[|·–—-]\s+/)[0].trim().slice(0, 120);
}

export async function parallelSearch(query: string, options: FallbackOptions): Promise<FallbackHit[] | null> {
  const key = (options.env ?? (process.env as FallbackEnv)).PARALLEL_API_KEY?.trim();
  const timeout = cap(options, PARALLEL_TIMEOUT_MS);
  if (!key || timeout < 800) return null;
  try {
    const response = await options.fetchImpl("https://api.parallel.ai/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({
        objective: `Find current, specific information for a visitor on Maio island, Cabo Verde: ${query}. Only results about Maio island itself.`,
        search_queries: [`${query} Maio Cabo Verde`, `${query} Vila do Maio`],
        mode: "fast",
        advanced_settings: { max_results: 6 },
      }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) return null;
    const body = await response.json() as { results?: { url?: string; title?: string; excerpts?: string[] }[] };
    const hits: FallbackHit[] = [];
    for (const row of body.results ?? []) {
      if (!row.url || !row.title) continue;
      const text = `${row.title} ${(row.excerpts ?? []).join(" ")}`;
      // Search returns the whole archipelago (Sal, Boa Vista…); keep pages that are about Maio.
      if (!/\bmaio\b/i.test(text)) continue;
      const excerpt = (row.excerpts ?? []).find((item) => /\bmaio\b/i.test(item)) ?? row.excerpts?.[0] ?? "";
      const at = excerpt.search(/\bmaio\b/i);
      const snippet = excerpt.slice(Math.max(0, at - 160), Math.max(0, at - 160) + 420).replace(/\s+/g, " ").trim();
      hits.push({ name: titleName(row.title), source: "web", sourceLabel: domain(row.url), url: row.url, address: null, lat: null, lon: null, area: null, km: null, walkMin: null, driveMin: null, snippet: snippet || null });
    }
    return hits.slice(0, 3);
  } catch {
    return null;
  }
}

/** Google first, then the web; an honest empty result when neither has anything. */
export async function searchBeyondListings(query: string, options: FallbackOptions): Promise<FallbackResult> {
  const config = fallbackConfig(options.env ?? (process.env as FallbackEnv));
  const tried: string[] = [];
  if (config.google) {
    tried.push("google");
    const hits = await googlePlaces(query, options);
    if (hits?.length) return { source: "google", hits, tried, note: "Found on Google Maps, not in the Maio listings. Say so: name the place with \"(Google Maps)\" after it. Opening hours and prices are not known." };
  }
  if (config.parallel) {
    tried.push("web");
    const hits = await parallelSearch(query, options);
    if (hits?.length) return { source: "web", hits, tried, note: "Found on the web, not in the Maio listings. Use only what the snippets say about Maio, and cite the site in the reply as \"(source: <sourceLabel>)\". If the snippets are not clearly about Maio, say you could not find it." };
  }
  return { source: "none", hits: [], tried, note: "Nothing found outside the listings either. Say plainly that you don't have it and suggest asking the stay or locals. Do not guess a name." };
}
