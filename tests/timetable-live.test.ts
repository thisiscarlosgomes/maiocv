import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MAIO_API } from "../lib/maio-catalog.ts";
import { loadEssentials } from "../lib/essentials.ts";
import { loadTimetable } from "../lib/timetable.ts";

test("live boats, flights, and payments come from api.maio.cv", { timeout: 30_000 }, async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    urls.push(String(input));
    return fetch(input, init);
  };
  const now = new Date();
  const [table, essentials, boats, flights, payments] = await Promise.all([
    loadTimetable(fetchImpl, now),
    loadEssentials(fetchImpl, now),
    fetch(`${MAIO_API}/boats`).then((response) => response.json()) as Promise<{ stale?: boolean; schedules?: { date: string; from: string; to: string; departure: string }[] }>,
    fetch(`${MAIO_API}/flights`).then((response) => response.json()) as Promise<{ upcoming?: Record<string, { date: string; departure: string; flight?: string }[]> }>,
    fetch(`${MAIO_API}/datasets/payments`).then((response) => response.json()) as Promise<{ payload?: { atm_terminals_by_island?: { name: string; values: Record<string, number> }[]; pos_terminals_by_island?: { name: string; values: Record<string, number> }[] } }>,
  ]);

  assert.ok(urls.length > 0);
  assert.ok(urls.every((url) => url.startsWith("https://api.maio.cv/api/v1/")));
  assert.equal(urls.some((url) => url.includes("portal.maio.cv")), false);
  assert.equal(table.ok, true);
  assert.equal(table.stale, boats.stale === true);
  const published = (boats.schedules ?? []).filter((row) => row.date && row.departure && row.from && row.to);
  assert.ok(published.length > 0);
  for (const row of published) {
    assert.ok(table.sailings.some((sailing) => sailing.date === row.date && sailing.departure === row.departure && sailing.from === row.from && sailing.to === row.to));
  }
  const upcoming = Object.values(flights.upcoming ?? {}).flat();
  assert.ok(upcoming.length > 0);
  assert.ok(table.flights.some((leg) => leg.date === upcoming[0].date && leg.departure === upcoming[0].departure));
  const maioAtms = payments.payload?.atm_terminals_by_island?.find((row) => row.name === "Maio")?.values["2023"];
  const maioPos = payments.payload?.pos_terminals_by_island?.find((row) => row.name === "Maio")?.values["2023"];
  assert.equal(essentials.payments.data?.atms.value, maioAtms);
  assert.equal(essentials.payments.data?.pos.value, maioPos);
  assert.equal(essentials.flight.source.name, "CVSky");
  assert.equal(essentials.ferry.source.name, "CV Interilhas");
});
