import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { emptyTask, refreshTask } from "../lib/awareness/task.ts";
import { clearOfferingCache, experienceFromFeature, loadOfferings, stayFromFeature } from "../lib/maio-catalog.ts";
import { runPlanAgent } from "../lib/plan-agent.ts";
import { buildPlan } from "../lib/trip-planner.ts";
import type { TripPlan } from "../lib/trip.ts";

const TODAY = new Date("2026-11-15T12:00:00Z");

function bomb(): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: async () => { throw new Error("model should not be called"); },
  }) as unknown as LanguageModel;
}

function experienceFeature(id: string, name: string) {
  return {
    type: "Feature",
    id,
    geometry: null,
    properties: {
      name,
      publicationStatus: "published",
      attributes: { name, location: "Maio", phone: "", description: { en: name, pt: name } },
    },
  };
}

function stayFeature(id: string, name: string, location: string, phone = "", link = "", coordinates?: [number, number]) {
  return {
    type: "Feature",
    id,
    geometry: coordinates ? { type: "Point", coordinates } : null,
    properties: {
      name,
      publicationStatus: "published",
      attributes: { name, location, phone, website: link, booking_url: "", description: { en: name, pt: name } },
    },
  };
}

const EXPERIENCE_ROWS = [
  experienceFeature("maio-guide-blue-maioazul-jetski", "Jet Ski"),
  experienceFeature("maio-guide-blue-ondaazul-maio", "Onda Azul Maio"),
  experienceFeature("maio-guide-blue-rental-quad-big-game", "Big Game Rental Quad"),
  experienceFeature("maio-guide-blue-sport-fishing-big-game", "Big Game Sport Fishing"),
  experienceFeature("maio-guide-guia-001", "J&Tour"),
  experienceFeature("maio-guide-trek-001", "Eco Tour"),
];

const STAY_ROWS = [
  stayFeature("maio-guide-stay-azul", "Villa Azul", "Cidade do Porto Inglês", "5974467", "https://www.airbnb.com/rooms/828", [-23.2074115, 15.1328178]),
  stayFeature("maio-guide-stay-mar", "Casa do Mar", "Calheta", "", "https://www.airbnb.com/rooms/145"),
  stayFeature("maio-guide-stay-morro", "Home in Morro", "Morro", "+238 595 00 00", "", [-23.2232101, 15.182318]),
];

function worldFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/experiences")) return Response.json({ type: "FeatureCollection", features: EXPERIENCE_ROWS });
    if (url.endsWith("/accommodation")) return Response.json({ type: "FeatureCollection", features: STAY_ROWS });
    if (url.includes("marine-api")) return Response.json({ daily: { time: ["2026-11-18", "2026-11-19", "2026-11-20"], wave_height_max: [0.8, 0.8, 0.8] } });
    if (url.includes("api.open-meteo.com")) {
      const dates = ["2026-11-18", "2026-11-19", "2026-11-20"];
      return Response.json({ daily: { time: dates, wind_speed_10m_max: dates.map(() => 16), temperature_2m_max: dates.map(() => 28), sunset: dates.map((date) => `${date}T18:10`) } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function openPlan(locale: "en" | "pt" | "fr"): TripPlan {
  return buildPlan({
    request: { startDate: "2026-11-18", days: 3, locale, adults: 2, kids: 0, hasCar: true, boatTrips: 0, pace: "slow" },
    forecast: [],
    sailings: [],
  });
}

test("offerings map API experiences onto fixture ids and fall back when the API is down", async () => {
  clearOfferingCache();
  const eco = experienceFromFeature(experienceFeature("maio-guide-trek-001", "Eco Tour"));
  assert.equal(eco?.id, "trek-001");
  assert.equal(eco?.title, "Eco Tour");
  const villa = stayFromFeature(STAY_ROWS[0]);
  assert.equal(villa?.name, "Villa Azul");
  assert.equal(villa?.lat, 15.1328178);
  assert.equal(villa?.lon, -23.2074115);
  assert.equal(stayFromFeature(STAY_ROWS[1])?.lat, undefined);

  let reads = 0;
  const fetchImpl: typeof fetch = (async (input: RequestInfo | URL) => {
    reads += 1;
    return worldFetch()(input);
  }) as typeof fetch;
  const live = await loadOfferings(fetchImpl);
  assert.equal(live.source, "api");
  assert.deepEqual(live.experiences.map((item) => item.id).sort(), [
    "blue-maioazul-jetski",
    "blue-ondaazul-maio",
    "blue-rental-quad-big-game",
    "blue-sport-fishing-big-game",
    "guia-001",
    "trek-001",
  ].sort());
  assert.equal(live.experiences.some((item) => item.id === "guia-002"), false);
  assert.equal(live.experiences.find((item) => item.id === "trek-001")?.title, "Eco Tour");
  assert.equal(live.stays.length, 3);
  const again = await loadOfferings(fetchImpl);
  assert.equal(again, live);
  assert.equal(reads, 2);

  clearOfferingCache();
  const offline = await loadOfferings((async () => { throw new Error("offline"); }) as typeof fetch);
  assert.equal(offline.source, "fallback");
  assert.equal(offline.stays.length, 0);
  assert.ok(offline.experiences.some((item) => item.id === "guia-002"));
});

test("where to stay lists the API stays in EN, PT and FR and does not rebuild a plan", async () => {
  const asks = [
    ["en", "where can we stay?", /Cidade do Porto Inglês: Villa Azul \(\+238 597 44 67\)/, /Availability and prices aren't live/, "We're staying at Villa Azul"],
    ["pt", "onde ficar?", /Calheta: Casa do Mar \(airbnb.com\)/, /não estão ao vivo/, "Ficamos em Villa Azul"],
    ["fr", "où loger ?", /Morro: Home in Morro \(\+238 595 00 00\)/, /ne sont pas en direct/, "On loge à Villa Azul"],
    ["en", "hotels near the beach", /Villa Azul/, /aren't live/, "We're staying at Casa do Mar"],
  ] as const;
  for (const [locale, ask, list, caveat, chip] of asks) {
    clearOfferingCache();
    const plan = openPlan(locale);
    const task = refreshTask({
      ...emptyTask(locale),
      objective: plan.title,
      constraints: { dates: { start: "2026-11-18", days: 3 }, party: { adults: 2 }, car: true, pace: "slow" },
      completed: ["itinerary"],
    });
    const result = await runPlanAgent(
      [{ role: "user", content: ask }],
      plan,
      { model: bomb(), fetchImpl: worldFetch(), now: TODAY },
      task,
    );
    assert.equal(result.plan, plan, result.reply);
    assert.match(result.reply, list, result.reply);
    assert.match(result.reply, caveat, result.reply);
    assert.ok(result.chips.includes(chip), result.chips.join(" | "));
    assert.doesNotMatch(result.reply, /Atlantis|invent a hotel|Hotel Imaginary/);
  }
});

test("naming a listed stay updates breakfast and the day ends in EN, PT and FR", async () => {
  const cases = [
    ["en", "we're staying at Villa Azul", /You're staying at Villa Azul, Cidade do Porto Inglês/, /Breakfast at Villa Azul, Cidade do Porto Inglês/, /Day starts at Villa Azul/, /Day ends at Villa Azul/],
    ["pt", "ficamos em Villa Azul", /Ficam em Villa Azul, Cidade do Porto Inglês/, /Pequeno-almoço em Villa Azul/, /O dia começa em Villa Azul/, /O dia acaba em Villa Azul/],
    ["fr", "on loge à Villa Azul", /Vous logez à Villa Azul, Cidade do Porto Inglês/, /Petit-déjeuner à Villa Azul/, /La journée commence à Villa Azul/, /La journée se termine à Villa Azul/],
  ] as const;
  for (const [locale, ask, saved, breakfast, start, end] of cases) {
    clearOfferingCache();
    const plan = openPlan(locale);
    const task = refreshTask({
      ...emptyTask(locale),
      objective: plan.title,
      constraints: { dates: { start: "2026-11-18", days: 3 }, party: { adults: 2 }, car: true, pace: "slow" },
      completed: ["itinerary"],
    });
    const result = await runPlanAgent(
      [{ role: "user", content: ask }],
      plan,
      { model: bomb(), fetchImpl: worldFetch(), now: TODAY },
      task,
    );
    assert.match(result.reply, saved, result.reply);
    assert.equal(result.task.constraints.stay?.name, "Villa Azul");
    assert.equal(result.task.constraints.stay?.lat, 15.1328178);
    const breakfastItem = result.plan?.days[0]?.items.find((item) => item.refId === "breakfast-stay");
    assert.ok(breakfastItem, result.reply);
    assert.match(breakfastItem?.note ?? "", breakfast);
    const notes = result.plan?.days.flatMap((day) => day.items).map((item) => item.note ?? "").join("\n") ?? "";
    assert.match(notes, start);
    assert.match(notes, end);
    assert.equal(result.plan?.days.length, plan.days.length);
  }
});

test("an unlisted stay is saved as free text in EN, PT and FR", async () => {
  const cases = [
    ["en", "We're staying at Atlantis Resort", "Atlantis Resort", undefined, /Saved your stay as Atlantis Resort/],
    ["pt", "ficamos em Atlantis Resort", "Atlantis Resort", undefined, /Guardei a estadia como Atlantis Resort/],
    ["fr", "on loge à Atlantis Resort", "Atlantis Resort", undefined, /Séjour enregistré ?: Atlantis Resort/],
    ["en", "an Airbnb in Calheta", "Airbnb", "Calheta", /Saved your stay as Airbnb, Calheta/],
    ["pt", "um airbnb na Calheta", "Airbnb", "Calheta", /Guardei a estadia como Airbnb, Calheta/],
    ["fr", "un airbnb à Calheta", "Airbnb", "Calheta", /Séjour enregistré ?: Airbnb, Calheta/],
  ] as const;
  for (const [locale, ask, name, area, saved] of cases) {
    clearOfferingCache();
    const plan = openPlan(locale);
    const task = refreshTask({
      ...emptyTask(locale),
      objective: plan.title,
      constraints: { dates: { start: "2026-11-18", days: 3 }, party: { adults: 2 }, car: true, pace: "slow" },
      completed: ["itinerary"],
    });
    const result = await runPlanAgent(
      [{ role: "user", content: ask }],
      plan,
      { model: bomb(), fetchImpl: worldFetch(), now: TODAY },
      task,
    );
    assert.match(result.reply, saved, result.reply);
    assert.equal(result.task.constraints.stay?.name, name);
    assert.equal(result.task.constraints.stay?.area, area);
    assert.equal(result.task.constraints.stay?.lat, undefined);
    assert.doesNotMatch(result.reply, /\+238|597|address|morada|adresse/i);
    const breakfast = result.plan?.days[0]?.items.find((item) => item.refId === "breakfast-stay");
    assert.match(breakfast?.note ?? "", new RegExp(name), result.reply);
  }
});

test("asking for an unlisted stay's details does not invent a phone or address", async () => {
  clearOfferingCache();
  const plan = openPlan("en");
  const saved = refreshTask({
    ...emptyTask("en"),
    objective: plan.title,
    constraints: {
      dates: { start: "2026-11-18", days: 3 },
      party: { adults: 2 },
      car: true,
      pace: "slow",
      stay: { id: "guest-atlantis-resort", name: "Atlantis Resort" },
    },
    completed: ["itinerary"],
  });
  const result = await runPlanAgent(
    [{ role: "user", content: "what's the address of our stay" }],
    plan,
    { model: bomb(), fetchImpl: worldFetch(), now: TODAY },
    saved,
  );
  assert.equal(result.plan, plan);
  assert.match(result.reply, /isn't in the stay directory/);
  assert.doesNotMatch(result.reply, /\+238|\d{7}/);
});

test("where to stay lists every published stay and keeps three chips", async () => {
  clearOfferingCache();
  const many = [
    ...STAY_ROWS,
    stayFeature("s4", "Wave Maze", "Cidade do Porto Inglês", "", "https://www.wavemaze.com"),
    stayFeature("s5", "Hotel Big Game Maio", "Cidade do Porto Inglês", "002385977305"),
    stayFeature("s6", "Casa Evora", "Cidade do Porto Inglês"),
    stayFeature("s7", "Dacosta Apartamentos", "Cidade do Porto Inglês", "9756696"),
    stayFeature("s8", "Villa Maris Eco Village", "Morro", "+2385957968"),
  ];
  const fetchImpl: typeof fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/accommodation")) return Response.json({ features: many });
    return worldFetch()(input);
  }) as typeof fetch;
  const result = await runPlanAgent(
    [{ role: "user", content: "where can we stay?" }],
    null,
    { model: bomb(), fetchImpl, now: TODAY },
  );
  for (const name of ["Villa Azul", "Casa do Mar", "Home in Morro", "Wave Maze", "Hotel Big Game Maio", "Casa Evora", "Dacosta Apartamentos", "Villa Maris Eco Village"]) {
    assert.match(result.reply, new RegExp(name), result.reply);
  }
  assert.match(result.reply, /Porto Inglês:|Cidade do Porto Inglês:/);
  assert.match(result.reply, /\+238 597 44 67/);
  assert.match(result.reply, /\+238 975 66 96/);
  assert.equal(result.chips.length, 3);
  assert.equal(result.plan, null);
});

test("a boat plan uses the API fishing trip, and the catalog line is only on a real load", async () => {
  clearOfferingCache();
  const fetchImpl = worldFetch();
  const lines: string[] = [];
  const built = await runPlanAgent(
    [{ role: "user", content: "3 days, slow pace, renting a car, one boat trip, from 18 to 20 November" }],
    null,
    { model: bomb(), fetchImpl, now: TODAY, onStatus: (text) => lines.push(text) },
  );
  const experienceIds = built.plan?.days.flatMap((day) => day.items).filter((item) => item.kind === "experience").map((item) => item.refId) ?? [];
  assert.deepEqual(experienceIds, ["blue-sport-fishing-big-game"], `${built.reply} ${experienceIds.join(",")}`);
  assert.equal(built.plan?.days.some((day) => day.items.some((item) => item.refId === "guia-002")), false);
  assert.ok(lines.includes("Checking stays and experiences…"), lines.join(" | "));
  assert.ok(built.steps.includes("Checking stays and experiences…"), built.steps.join(" | "));

  const againLines: string[] = [];
  const again = await runPlanAgent(
    [{ role: "user", content: "3 days, slow pace, renting a car, one boat trip, from 18 to 20 November" }],
    null,
    { model: bomb(), fetchImpl, now: TODAY, onStatus: (text) => againLines.push(text) },
  );
  assert.equal(again.plan?.days.flatMap((day) => day.items).some((item) => item.refId === "guia-002"), false);
  assert.equal(againLines.includes("Checking stays and experiences…"), false, againLines.join(" | "));
  assert.equal(again.steps.includes("Checking stays and experiences…"), false, again.steps.join(" | "));
});

function slowStaysFetch(state: { staysDown: boolean; experiencesDown?: boolean }): typeof fetch {
  const world = worldFetch();
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (state.staysDown && url.endsWith("/accommodation")) throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    if (state.experiencesDown && url.endsWith("/experiences")) throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    return world(input, init);
  }) as typeof fetch;
}

test("a timed-out stays read is not cached as an empty list, in EN and PT", async () => {
  const asks = [
    ["en", "where can we stay?", /couldn't open the Maio stays list/, /Cidade do Porto Inglês: Villa Azul \(\+238 597 44 67\)/],
    ["pt", "onde ficar?", /Não consegui abrir a lista de alojamento/, /Calheta: Casa do Mar \(airbnb.com\)/],
  ] as const;
  for (const [locale, ask, down, listed] of asks) {
    clearOfferingCache();
    const state = { staysDown: true };
    const fetchImpl = slowStaysFetch(state);
    const task = refreshTask({ ...emptyTask(locale), constraints: { dates: { start: "2026-11-18", days: 3 } } });
    const first = await runPlanAgent([{ role: "user", content: ask }], null, { model: bomb(), fetchImpl, now: TODAY }, task);
    assert.match(first.reply, down, first.reply);
    assert.doesNotMatch(first.reply, /don't have stays|Não tenho alojamento/, first.reply);

    state.staysDown = false;
    const second = await runPlanAgent([{ role: "user", content: ask }], null, { model: bomb(), fetchImpl, now: TODAY }, task);
    assert.match(second.reply, listed, second.reply);
  }
});

test("a timed-out stays read reuses the last stays the API returned", async () => {
  clearOfferingCache();
  const state = { staysDown: false, experiencesDown: true };
  const fetchImpl = slowStaysFetch(state);
  const first = await loadOfferings(fetchImpl);
  assert.equal(first.stays.length, 3);
  state.staysDown = true;
  state.experiencesDown = false;
  const second = await loadOfferings(fetchImpl);
  assert.equal(second.source, "api");
  assert.equal(second.staysRead, true);
  assert.deepEqual(second.stays.map((stay) => stay.name), first.stays.map((stay) => stay.name));
});
