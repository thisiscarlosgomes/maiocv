import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { loadSharedTrip, MAX_SHARE_BYTES, memoryTripShareStore, saveSharedTrip, shareHash, shortId, SHORT_ID_RE, type TripShareStore } from "../lib/trip-share-store.ts";
import { samplePlan } from "../lib/trip-sample.ts";
import { SITE_URL } from "../lib/seo.ts";

test("ids are 8 base62 characters and do not repeat", () => {
  const ids = new Set(Array.from({ length: 2000 }, () => shortId()));
  assert.equal(ids.size, 2000);
  for (const id of ids) assert.match(id, /^[0-9A-Za-z]{8}$/);
});

test("the share link stays short", () => {
  const link = `${SITE_URL.replace("://www.", "://")}/t/${shortId()}`;
  assert.ok(link.length <= 30, link);
});

test("a shared plan round-trips through the store", async () => {
  const store = memoryTripShareStore();
  const plan = samplePlan("pt");
  const saved = await saveSharedTrip(store, plan, "pt");
  assert.ok("id" in saved && !saved.reused);
  const loaded = await loadSharedTrip(store, saved.id);
  assert.deepEqual(loaded, { plan, locale: "pt" });
});

test("sharing the same plan twice reuses its id; another language or plan gets a new one", async () => {
  const store = memoryTripShareStore();
  const plan = samplePlan("en");
  const first = await saveSharedTrip(store, plan, "en");
  const again = await saveSharedTrip(store, structuredClone(plan), "en");
  assert.ok("id" in first && "id" in again);
  assert.equal(again.id, first.id);
  assert.equal(again.reused, true);
  const french = await saveSharedTrip(store, plan, "fr");
  const other = await saveSharedTrip(store, { ...plan, title: `${plan.title}!` }, "en");
  assert.ok("id" in french && "id" in other);
  assert.notEqual(french.id, first.id);
  assert.notEqual(other.id, first.id);
  assert.equal(store.rows.length, 3);
});

test("only the plan and its language are stored", async () => {
  const store = memoryTripShareStore();
  await saveSharedTrip(store, samplePlan("en"), "en");
  assert.deepEqual(Object.keys(store.rows[0]).sort(), ["createdAt", "hash", "id", "locale", "plan"]);
});

test("a concurrent share of the same plan ends on the winner's id", async () => {
  const base = memoryTripShareStore();
  const plan = samplePlan("en");
  let raced = false;
  const store: TripShareStore = {
    ...base,
    async byHash(hash) {
      if (!raced) { raced = true; await base.insert({ id: "Winner01", hash, plan, locale: "en", createdAt: new Date() }); return null; }
      return base.byHash(hash);
    },
  };
  const saved = await saveSharedTrip(store, plan, "en");
  assert.deepEqual(saved, { id: "Winner01", reused: true });
});

test("an id collision draws a new id", async () => {
  const base = memoryTripShareStore();
  let calls = 0;
  const store: TripShareStore = { ...base, async insert(share) { calls++; return calls === 1 ? "id" : base.insert(share); } };
  const saved = await saveSharedTrip(store, samplePlan("en"), "en");
  assert.ok("id" in saved);
  assert.equal(calls, 2);
});

test("bad input is refused before it reaches the store", async () => {
  const store = memoryTripShareStore();
  assert.deepEqual(await saveSharedTrip(store, { title: "x" }, "en"), { error: "invalid" });
  assert.deepEqual(await saveSharedTrip(store, samplePlan("en"), "de"), { error: "invalid" });
  assert.deepEqual(await saveSharedTrip(store, { junk: "x".repeat(MAX_SHARE_BYTES) }, "en"), { error: "too_large" });
  assert.equal(store.rows.length, 0);
});

test("unknown or malformed ids load nothing", async () => {
  const store = memoryTripShareStore();
  assert.equal(await loadSharedTrip(store, "Abc12345"), null);
  assert.equal(await loadSharedTrip(store, "../etc"), null);
  assert.equal(SHORT_ID_RE.test("abc"), false);
});

test("the hash is stable for the same plan and differs by language", () => {
  const plan = samplePlan("en");
  assert.equal(shareHash(plan, "en"), shareHash(structuredClone(plan), "en"));
  assert.notEqual(shareHash(plan, "en"), shareHash(plan, "pt"));
});

test("old long links still decode on the plan page, and bare short links skip the locale redirect", () => {
  const planner = readFileSync(new URL("../components/plan/planner.tsx", import.meta.url), "utf8");
  assert.match(planner, /params\.get\("trip"\)/);
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /\\\/t\\\//);
});
