import { budgetFetch } from "./fetch-budget.ts";
import { MAIO_API } from "./maio-catalog.ts";
import { BUNDLED_EXPERIENCES, BUNDLED_FOOD, BUNDLED_PLACES, EXPERIENCES, FOOD, PLACES } from "./trip.ts";

/**
 * The planner suggests only what api.maio.cv lists. One read of the tourism collection names
 * every place (`visit-maio-<id>`), food listing and experience (`maio-guide-<id>`) it publishes.
 * Bundled rows add images, descriptions and coordinates to those ids and nothing else.
 */
export const LIVE_TOURISM_URL = `${MAIO_API}/collections/tourism/items?limit=500`;
/** A fresh read is reused this long. */
export const LIVE_TTL_MS = 5 * 60 * 1000;
/** After this with no good read the lists are empty, so a dropped venue cannot come back. */
export const LIVE_STALE_MS = 15 * 60 * 1000;
const READ_MS = 3_000;

export type LiveListing = { name: string };
export type LiveStatus = "api" | "stale" | "unavailable";

let listed: { at: number; rows: Map<string, LiveListing>; pinned?: boolean } | null = null;
let inflight: Promise<LiveStatus> | null = null;
let epoch = 0;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function readTourism(fetchImpl: typeof fetch): Promise<Map<string, LiveListing>> {
  // budgetFetch also wins the race against a fetch that ignores its abort signal.
  const response = await budgetFetch(fetchImpl, READ_MS)(LIVE_TOURISM_URL, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Maio API tourism HTTP ${response.status}`);
  const body = asRecord(await response.json());
  if (!Array.isArray(body.features)) throw new Error("Maio API tourism payload has no features");
  const rows = new Map<string, LiveListing>();
  for (const feature of body.features) {
    const row = asRecord(feature);
    const props = asRecord(row.properties);
    const status = textOf(props.publicationStatus);
    if (status && status !== "published") continue;
    const id = textOf(row.id);
    if (!id) continue;
    rows.set(id, { name: textOf(asRecord(props.attributes).name) || textOf(props.name) });
  }
  if (!rows.size) throw new Error("Maio API tourism returned no rows");
  return rows;
}

function replace<T>(target: T[], rows: T[]) {
  target.splice(0, target.length, ...rows);
}

/** Rewrite FOOD, PLACES and EXPERIENCES to the listed ids. Food takes the API name. */
export function applyLiveListings(rows: ReadonlyMap<string, LiveListing> | null): void {
  if (!rows) {
    replace(FOOD, []);
    replace(PLACES, []);
    replace(EXPERIENCES, []);
    return;
  }
  replace(FOOD, BUNDLED_FOOD.filter((item) => rows.has(`maio-guide-${item.id}`)).map((item) => {
    const name = rows.get(`maio-guide-${item.id}`)?.name;
    if (name) item.title = name;
    return item;
  }));
  replace(PLACES, BUNDLED_PLACES.filter((item) => rows.has(`visit-maio-${item.id}`)));
  replace(EXPERIENCES, BUNDLED_EXPERIENCES.filter((item) => rows.has(`maio-guide-${item.id}`)));
}

function refresh(fetchImpl: typeof fetch): Promise<LiveStatus> {
  if (inflight) return inflight;
  const started = epoch;
  const run = (async (): Promise<LiveStatus> => {
    try {
      const rows = await readTourism(fetchImpl);
      if (started !== epoch) return "api";
      listed = { at: Date.now(), rows };
      applyLiveListings(rows);
      return "api";
    } catch {
      if (started !== epoch) return "unavailable";
      if (listed && Date.now() - listed.at < LIVE_STALE_MS) return "stale";
      listed = null;
      applyLiveListings(null);
      return "unavailable";
    } finally {
      if (started === epoch) inflight = null;
    }
  })();
  inflight = run;
  return run;
}

/**
 * Bring the suggestion lists in line with api.maio.cv. A read under 5 minutes old is used as is.
 * Up to 15 minutes old it is used while a new read runs in the background. Older, or never read,
 * the caller waits for the API, and a failed read empties the lists rather than fall back to bundled rows.
 */
export async function syncLiveCatalog(fetchImpl: typeof fetch = fetch): Promise<LiveStatus> {
  if (listed?.pinned) return "api";
  const age = listed ? Date.now() - listed.at : Infinity;
  if (age < LIVE_TTL_MS) return "api";
  if (age < LIVE_STALE_MS) {
    void refresh(fetchImpl).catch(() => {});
    return "stale";
  }
  return refresh(fetchImpl);
}

/**
 * Tests: treat `rows` as the API's answer. Pinned rows never expire, so a test file that does
 * not exercise the API sees a stable listing. Pass null to forget it and read the API again.
 */
export function primeLiveCatalog(rows: ReadonlyMap<string, LiveListing> | null, pinned = false): void {
  epoch += 1;
  inflight = null;
  listed = rows ? { at: Date.now(), rows: new Map(rows), pinned } : null;
  if (rows) applyLiveListings(rows);
}

/** Every bundled id, as if the API listed all of them. Test setup only. */
export function bundledListings(): Map<string, LiveListing> {
  const rows = new Map<string, LiveListing>();
  for (const item of BUNDLED_FOOD) rows.set(`maio-guide-${item.id}`, { name: item.title });
  for (const item of BUNDLED_PLACES) rows.set(`visit-maio-${item.id}`, { name: "" });
  for (const item of BUNDLED_EXPERIENCES) rows.set(`maio-guide-${item.id}`, { name: "" });
  return rows;
}

/** Tests: forget the last read. The lists stay as they are until the next sync. */
export function clearLiveCatalog(): void {
  epoch += 1;
  listed = null;
  inflight = null;
}
