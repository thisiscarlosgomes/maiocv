import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ADSB_API_KEY_ENV,
  CABO_VERDE_RADIUS_NM,
  FLIGHT_CACHE_TTL_MS,
  MAIO_LATITUDE,
  MAIO_LONGITUDE,
  cacheControlFor,
  caboVerdeFlightsUrl,
  createAdsbCache,
  loadCaboVerdeFlights,
  nauticalMilesBetween,
  normalizeAircraft,
  normalizeAircraftList,
  parseRetryAfterSeconds,
  readAdsbApiKey,
} from "../lib/adsb/flights.ts";

const FIXTURE_KEY = "test-adsb-key";
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/adsb-sample.json", import.meta.url), "utf8"),
) as { ac: unknown[] };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("the Maio circle covers Cabo Verde and stays inside the API cap", () => {
  assert.equal(Number.isInteger(CABO_VERDE_RADIUS_NM), true);
  assert.ok(CABO_VERDE_RADIUS_NM >= 1 && CABO_VERDE_RADIUS_NM <= 250);
  const inside: [string, number, number][] = [
    ["Praia", 14.9245, -23.4935],
    ["Sal", 16.7414, -22.9494],
    ["Boa Vista", 16.1365, -22.8889],
    ["São Vicente", 16.8332, -25.0544],
    ["Santo Antão", 17.116, -25.172],
    ["Fogo", 14.945, -24.381],
    ["Brava", 14.865, -24.703],
  ];
  for (const [name, latitude, longitude] of inside) {
    const distance = nauticalMilesBetween(MAIO_LATITUDE, MAIO_LONGITUDE, latitude, longitude);
    assert.ok(distance < CABO_VERDE_RADIUS_NM, `${name} is ${distance.toFixed(1)} nm from Maio`);
  }
  assert.ok(nauticalMilesBetween(MAIO_LATITUDE, MAIO_LONGITUDE, 38.774, -9.134) > CABO_VERDE_RADIUS_NM);
  assert.equal(caboVerdeFlightsUrl(), "https://api.adsb.lol/v2/lat/15.25/lon/-23.15/dist/180");
});

test("parsing keeps transmitted fields and drops rows that cannot be placed", () => {
  const aircraft = normalizeAircraftList(fixture);
  assert.ok(aircraft);
  assert.deepEqual(aircraft.map((plane) => plane.hex), ["near01", "far01", "min01"]);
  assert.equal(aircraft[0].callsign, "VR4071");
  assert.equal(aircraft[0].registration, "D4-CCV");
  assert.equal(aircraft[0].aircraftType, "AT76");
  assert.equal(aircraft[0].altitudeFeet, 12000);
  assert.equal(aircraft[0].onGround, false);
  assert.equal(aircraft[0].groundSpeedKnots, 210.4);
  assert.equal(aircraft[0].trackDegrees, 35);
  assert.equal(aircraft[0].seenSeconds, 1);
  assert.equal(aircraft[0].emergency, "general");
  assert.equal(aircraft[1].callsign, null);
  assert.equal(aircraft[1].onGround, true);
  assert.equal(aircraft[1].altitudeFeet, null);
  assert.equal(aircraft[1].registration, "D4-TEST");
  assert.equal(aircraft[1].groundSpeedKnots, 0);
  assert.equal(aircraft[2].callsign, null);
  assert.equal(aircraft[2].registration, null);
  assert.equal(aircraft[2].aircraftType, null);
  assert.equal(aircraft[2].altitudeFeet, null);
  assert.equal(aircraft[2].groundSpeedKnots, null);
  assert.equal(aircraft[2].trackDegrees, null);
  assert.equal(aircraft[2].seenSeconds, null);
  assert.equal(aircraft[2].onGround, false);
  assert.equal(aircraft.length, 3);
  assert.equal(normalizeAircraft({ hex: "abc", lat: 91, lon: 0 }), null);
  assert.equal(normalizeAircraft({ flight: "PADDED" }), null);
  assert.equal(normalizeAircraftList({ msg: "No error" }), null);
});

test("a missing or blank key never calls adsb.lol", async () => {
  for (const env of [
    {},
    { [ADSB_API_KEY_ENV]: "" },
    { [ADSB_API_KEY_ENV]: "  " },
    { [ADSB_API_KEY_ENV]: "bad\r\nX-Injected: 1" },
  ]) {
    let called = false;
    const payload = await loadCaboVerdeFlights({
      now: 1_000,
      env,
      cache: createAdsbCache(),
      fetchImpl: async () => {
        called = true;
        return jsonResponse(fixture);
      },
    });
    assert.equal(called, false);
    assert.equal(payload.status, "unconfigured");
    assert.deepEqual(payload.aircraft, []);
    assert.equal(cacheControlFor(payload), "no-store");
    assert.equal(JSON.stringify(payload).includes(FIXTURE_KEY), false);
  }
  assert.equal(readAdsbApiKey({ [ADSB_API_KEY_ENV]: "  secret  " }), "secret");
});

test("positions are requested with the key header and the key is not returned", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const payload = await loadCaboVerdeFlights({
    now: Date.parse("2026-11-15T12:00:00Z"),
    env: { [ADSB_API_KEY_ENV]: FIXTURE_KEY },
    cache: createAdsbCache(),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(fixture);
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, caboVerdeFlightsUrl());
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers["x-api-key"], FIXTURE_KEY);
  assert.equal(calls[0].url.includes(FIXTURE_KEY), false);
  assert.equal(payload.status, "available");
  assert.equal(payload.stale, false);
  assert.equal(payload.aircraft.length, 3);
  assert.equal(JSON.stringify(payload).includes(FIXTURE_KEY), false);
  assert.equal(cacheControlFor(payload), "public, max-age=180, s-maxage=180, stale-while-revalidate=60");

  const removed = await loadCaboVerdeFlights({
    now: Date.parse("2026-11-15T12:00:00Z"),
    env: {},
    cache: createAdsbCache(),
    fetchImpl: async () => jsonResponse(fixture),
  });
  assert.equal(removed.status, "unconfigured");
  assert.deepEqual(removed.aircraft, []);
});

test("a warm cache and an in-flight request share one upstream call", async () => {
  let calls = 0;
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cache = createAdsbCache();
  const env = { [ADSB_API_KEY_ENV]: FIXTURE_KEY };
  const fetchImpl = async () => {
    calls += 1;
    await pending;
    return jsonResponse(fixture);
  };

  const first = loadCaboVerdeFlights({ now: 10_000, env, cache, fetchImpl });
  const second = loadCaboVerdeFlights({ now: 10_000, env, cache, fetchImpl });
  assert.equal(calls, 1);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.aircraft.length, 3);
  assert.equal(b.aircraft.length, 3);

  const third = await loadCaboVerdeFlights({
    now: 10_000 + FLIGHT_CACHE_TTL_MS - 1,
    env,
    cache,
    fetchImpl,
  });
  assert.equal(calls, 1);
  assert.equal(third.stale, false);
  assert.equal(third.retrievedAt, a.retrievedAt);
});

test("429 honors Retry-After and serves the last positions instead of calling again", async () => {
  const cache = createAdsbCache();
  const env = { [ADSB_API_KEY_ENV]: FIXTURE_KEY };
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return jsonResponse(fixture);
    return jsonResponse("rate limit exceeded", 429, { "Retry-After": "40" });
  };

  const fresh = await loadCaboVerdeFlights({ now: 50_000, env, cache, fetchImpl });
  assert.equal(fresh.status, "available");

  const limited = await loadCaboVerdeFlights({
    now: 50_000 + FLIGHT_CACHE_TTL_MS,
    env,
    cache,
    fetchImpl,
  });
  assert.equal(calls, 2);
  assert.equal(limited.status, "available");
  assert.equal(limited.stale, true);
  assert.equal(limited.aircraft.length, 3);
  assert.equal(limited.retryAfterSeconds, 40);
  assert.equal(limited.retrievedAt, fresh.retrievedAt);

  const duringBackoff = await loadCaboVerdeFlights({
    now: 50_000 + FLIGHT_CACHE_TTL_MS + 1_000,
    env,
    cache,
    fetchImpl,
  });
  assert.equal(calls, 2);
  assert.equal(duringBackoff.stale, true);
  assert.equal(duringBackoff.retryAfterSeconds, 39);
  assert.equal(cacheControlFor(duringBackoff), "public, max-age=39, s-maxage=39");
});

test("a rate limit with no cached positions stays empty", async () => {
  const payload = await loadCaboVerdeFlights({
    now: Date.parse("2026-11-15T00:00:30Z"),
    env: { [ADSB_API_KEY_ENV]: FIXTURE_KEY },
    cache: createAdsbCache(),
    fetchImpl: async () =>
      jsonResponse("rate limit exceeded", 429, {
        "Retry-After": "Sun, 15 Nov 2026 00:01:00 GMT",
      }),
  });
  assert.equal(payload.status, "unavailable");
  assert.deepEqual(payload.aircraft, []);
  assert.equal(payload.retryAfterSeconds, 30);
  assert.equal(parseRetryAfterSeconds(null, 0), 30);
  assert.equal(parseRetryAfterSeconds("0", 0), 1);
});

test("upstream failures and unusable bodies do not throw, pad flights, or send the key back", async () => {
  for (const fetchImpl of [
    async () => jsonResponse({ msg: "No error" }, 200),
    async () => new Response("nope", { status: 200 }),
    async () => jsonResponse({ error: "down" }, 502),
    async () => {
      throw new Error("network");
    },
  ]) {
    const payload = await loadCaboVerdeFlights({
      now: 5_000,
      env: { [ADSB_API_KEY_ENV]: FIXTURE_KEY },
      cache: createAdsbCache(),
      fetchImpl,
    });
    assert.equal(payload.status, "unavailable");
    assert.equal(payload.aircraft.length, 0);
    assert.equal(JSON.stringify(payload).includes(FIXTURE_KEY), false);
  }

  let calls = 0;
  const cache = createAdsbCache();
  const env = { [ADSB_API_KEY_ENV]: FIXTURE_KEY };
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse({ error: "down" }, 502);
  };
  const first = await loadCaboVerdeFlights({ now: 8_000, env, cache, fetchImpl });
  const second = await loadCaboVerdeFlights({ now: 8_000 + 10_000, env, cache, fetchImpl });
  assert.equal(first.status, "unavailable");
  assert.equal(second.status, "unavailable");
  assert.deepEqual(second.aircraft, []);
  assert.equal(calls, 1);
});

test("the browser path does not read the API key", () => {
  const client = readFileSync(new URL("../components/live-flights.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/essentials/page.tsx", import.meta.url), "utf8");
  assert.equal(client.includes("ADSB_LOL_API_KEY"), false);
  assert.equal(client.includes("x-api-key"), false);
  assert.equal(client.includes("api.adsb.lol"), false);
  assert.equal(page.includes("ADSB_LOL_API_KEY"), false);
  assert.equal(page.includes("x-api-key"), false);
  assert.match(client, /Data: /);
  assert.match(client, /adsb\.lol/);
  assert.match(client, /ODbL/);
});
