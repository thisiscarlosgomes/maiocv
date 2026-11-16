import { createHash, randomInt } from "node:crypto";
import { isLocale, type Locale } from "./locale.ts";
import { parseTripPlan, type TripPlan } from "./trip.ts";

// Short share links: maio.cv/t/<id>. The plan is stored as-is, the same JSON the long ?trip= link
// carried. No IP, user agent, or contact details are stored.

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const SHORT_ID_LENGTH = 8;
export const SHORT_ID_RE = /^[0-9A-Za-z]{6,8}$/;
/** A real plan is a few KB. Anything far larger is not a plan. */
export const MAX_SHARE_BYTES = 64_000;

export type TripShare = { id: string; hash: string; plan: TripPlan; locale: Locale; createdAt: Date };

export type TripShareStore = {
  byHash(hash: string): Promise<TripShare | null>;
  byId(id: string): Promise<TripShare | null>;
  /** "id" or "hash" when that unique key is taken; null when stored. */
  insert(share: TripShare): Promise<"id" | "hash" | null>;
};

/** 8 base62 characters from the CSPRNG: about 47.6 bits, so ids can't be enumerated. */
export function shortId(length = SHORT_ID_LENGTH): string {
  let id = "";
  for (let i = 0; i < length; i++) id += ALPHABET[randomInt(ALPHABET.length)];
  return id;
}

/** Same plan and language, same hash, so sharing twice reuses one id. */
export function shareHash(plan: TripPlan, locale: Locale): string {
  return createHash("sha256").update(`${locale}\n${JSON.stringify(plan)}`).digest("base64url");
}

export type SaveResult = { id: string; reused: boolean } | { error: "invalid" | "too_large" };

export async function saveSharedTrip(store: TripShareStore, input: unknown, locale: unknown, now = new Date()): Promise<SaveResult> {
  if (JSON.stringify(input ?? null).length > MAX_SHARE_BYTES) return { error: "too_large" };
  const plan = parseTripPlan(input);
  if (!plan || typeof locale !== "string" || !isLocale(locale)) return { error: "invalid" };
  const hash = shareHash(plan, locale);
  const existing = await store.byHash(hash);
  if (existing) return { id: existing.id, reused: true };
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = shortId();
    const clash = await store.insert({ id, hash, plan, locale, createdAt: now });
    if (clash === null) return { id, reused: false };
    if (clash === "hash") {
      // A concurrent share of the same plan won the race: use its id.
      const winner = await store.byHash(hash);
      if (winner) return { id: winner.id, reused: true };
    }
  }
  throw new Error("could not allocate a share id");
}

export async function loadSharedTrip(store: TripShareStore, id: string): Promise<{ plan: TripPlan; locale: Locale } | null> {
  if (!SHORT_ID_RE.test(id)) return null;
  const share = await store.byId(id);
  if (!share) return null;
  const plan = parseTripPlan(share.plan);
  return plan ? { plan, locale: share.locale } : null;
}

export function memoryTripShareStore(): TripShareStore & { rows: TripShare[] } {
  const rows: TripShare[] = [];
  return {
    rows,
    async byHash(hash) { return rows.find((row) => row.hash === hash) ?? null; },
    async byId(id) { return rows.find((row) => row.id === id) ?? null; },
    async insert(share) {
      if (rows.some((row) => row.id === share.id)) return "id";
      if (rows.some((row) => row.hash === share.hash)) return "hash";
      rows.push(share);
      return null;
    },
  };
}

let override: TripShareStore | null = null;
const devHolder = globalThis as { maioTripShares?: TripShareStore };
export function setTripShareStore(store: TripShareStore | null) { override = store; }

export async function tripShareStore(): Promise<TripShareStore> {
  if (override) return override;
  if (!process.env.ANALYTICS_MONGODB_URI) {
    // Local dev and e2e (next dev without Mongo) keep shares in this process. Production needs Mongo.
    // On globalThis: next dev bundles the API route and the page separately.
    if (process.env.NODE_ENV !== "production") return (devHolder.maioTripShares ??= memoryTripShareStore());
    throw new Error("unconfigured");
  }
  const mongo = await import("./trip-share-mongo.ts");
  return mongo.mongoTripShareStore();
}
