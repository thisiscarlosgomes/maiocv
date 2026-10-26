// Shared eval fixtures: a fake fetch for Open-Meteo and portal.maio.cv, and golden scenarios.
export const NOW = new Date("2026-10-27T10:00:00Z"); // Tuesday in Cabo Verde

export function fakeFetch(waves: Record<string, number>, sailings: { date: string; from: string; to: string; departure: string }[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    const dates = Object.keys(waves).sort();
    if (url.includes("marine-api")) return json({ daily: { time: dates, wave_height_max: dates.map((d) => waves[d]) } });
    if (url.includes("api.open-meteo.com")) return json({ daily: { time: dates, wind_speed_10m_max: dates.map((d) => (waves[d] >= 2 ? 38 : 16)), temperature_2m_max: dates.map(() => 28) } });
    if (url.includes("schedules/boats")) return json({ schedules: sailings });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

export const week = (start: string, values: number[]) => Object.fromEntries(values.map((v, i) => {
  const d = new Date(`${start}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i);
  return [d.toISOString().slice(0, 10), v];
}));

export type ToolStep = { tool: string; input: Record<string, unknown> }[];
export type Scenario = {
  name: string;
  prompt: string;
  waves: Record<string, number>;
  sailings?: { date: string; from: string; to: string; departure: string }[];
  /** What a well-behaved model calls; the mocked model replays this. Live mode ignores it. */
  script: ToolStep[];
  reply: string;
};

const calm = week("2026-10-28", [1.0, 0.6, 0.9, 0.8, 0.8]);
const base = { startDate: "2026-10-28", days: 3, adults: 2, kids: 0, hasCar: false, boatTrips: 1, interests: ["beach", "sea"] };

export const SCENARIOS: Scenario[] = [
  { name: "3 days calm water one boat trip (en)", prompt: "3 days on Maio from tomorrow, calm water please, one boat trip. Two of us, no car.", waves: calm,
    script: [[{ tool: "propose_itinerary", input: { ...base, locale: "en" } }]], reply: "Here is a 3-day plan with your boat trip on the calmest day." },
  { name: "3 days calm water one boat trip (pt)", prompt: "3 dias no Maio a partir de amanhã, mar calmo, uma saída de barco. Somos dois, sem carro.", waves: calm,
    script: [[{ tool: "propose_itinerary", input: { ...base, locale: "pt" } }]], reply: "Aqui está um plano de 3 dias com a saída de barco no dia mais calmo." },
  { name: "3 days calm water one boat trip (fr)", prompt: "3 jours à Maio dès demain, mer calme, une sortie en bateau. Deux personnes, sans voiture.", waves: calm,
    script: [[{ tool: "propose_itinerary", input: { ...base, locale: "fr" } }]], reply: "Voici un plan de 3 jours avec la sortie en bateau le jour le plus calme." },
  { name: "rough sea day 2", prompt: "3 days from tomorrow, we want two sea outings. Two adults, we rent a car.", waves: week("2026-10-28", [0.7, 2.6, 0.9]),
    script: [[{ tool: "get_sea_forecast", input: { startDate: "2026-10-28", days: 3 } }], [{ tool: "propose_itinerary", input: { ...base, locale: "en", hasCar: true, boatTrips: 2 } }]],
    reply: "Day 2 looks rough, so both sea outings are on days 1 and 3." },
  { name: "arrive by ferry Friday", prompt: "We arrive by ferry on Friday and stay 2 days. Plan it.", waves: week("2026-10-30", [0.8, 0.9]),
    sailings: [{ date: "2026-10-30", from: "Praia", to: "Maio", departure: "08:30" }],
    script: [[{ tool: "get_transport", input: { date: "2026-10-30" } }], [{ tool: "propose_itinerary", input: { ...base, locale: "en", startDate: "2026-10-30", days: 2, boatTrips: 0, arrival: { mode: "ferry", dayIndex: 0 } } }]],
    reply: "Your ferry lands Friday morning, so the plan starts after you settle in." },
  { name: "family toddler no car", prompt: "Family of 4 with a 2-year-old, no car, 3 days from tomorrow. Easy days.", waves: calm,
    script: [[{ tool: "propose_itinerary", input: { ...base, locale: "en", kids: 2, youngestAge: 2, boatTrips: 0, interests: ["beach"] } }]],
    reply: "Easy days near Porto Inglês, all walkable and fine for a toddler." },
  { name: "out-of-data request", prompt: "2 days. I want a dolphin cruise and a nightclub.", waves: calm,
    script: [[{ tool: "search_experiences", input: { kind: "any", query: "dolphin cruise" } }], [{ tool: "propose_itinerary", input: { ...base, locale: "en", days: 2, boatTrips: 0, include: ["dolphin-cruise"], unmet: ["dolphin cruise", "nightclub"] } }]],
    reply: "We don't list dolphin cruises or nightclubs yet. Here is a 2-day plan with what we do have." },
];
