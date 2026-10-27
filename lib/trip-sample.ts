import { buildPlan } from "./trip-planner.ts";
import type { Locale } from "./locale.ts";

/** Example trip for /plan?demo=1 and screenshots. The sea forecast here is invented. */
export function samplePlan(locale: Locale = "en") {
  return buildPlan({
    request: { startDate: "2026-10-29", days: 3, locale, adults: 2, kids: 0, hasCar: false, boatTrips: 1, interests: ["beach", "sea"], include: [], exclude: [], unmet: [],
      arrival: { mode: "ferry", dayIndex: 0, time: "07:30" } },
    forecast: [
      { date: "2026-10-29", waveHeightM: 1.1, windKmh: 22, tempMaxC: 28 },
      { date: "2026-10-30", waveHeightM: 2.4, windKmh: 37, tempMaxC: 27 },
      { date: "2026-10-31", waveHeightM: 0.7, windKmh: 14, tempMaxC: 28 },
    ],
    sailings: [],
    forecastSource: "example forecast",
  });
}
