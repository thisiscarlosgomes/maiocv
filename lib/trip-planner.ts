import { z } from "zod";
import { enforcePlanRules } from "./plan-rules.ts";
import { Picker, buildDay, type DayKind } from "./full-day.ts";
import type { DailySea } from "./agora.ts";
import type { Sailing } from "./essentials.ts";
import {
  EXPERIENCES, LocaleSchema, isExcludedExperience, addDays, distanceKm, experience, place,
  type Experience, type PlanDay, type PlanItem, type SeaDay, type TripPlan,
} from "./trip.ts";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const InterestSchema = z.enum(["beach", "sea", "nature", "culture", "food", "adventure", "walking"]);

/** What the model extracts from the conversation. The planner turns it into a TripPlan using only fixture ids. */
export const TripRequestSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("First day on Maio, YYYY-MM-DD"),
  days: z.number().int().min(1).max(7),
  locale: LocaleSchema,
  adults: z.number().int().min(1).max(12).default(2),
  kids: z.number().int().min(0).max(12).default(0),
  youngestAge: z.number().int().min(0).max(17).optional().describe("Age of the youngest child, if any"),
  hasCar: z.boolean().default(false),
  boatTrips: z.number().int().min(0).max(3).default(0).describe("How many sea outings (boat, surf, jet ski) the guest wants"),
  interests: z.array(InterestSchema).max(5).default([]),
  arrival: z.object({ mode: z.enum(["ferry", "flight"]), dayIndex: z.number().int().min(0).max(6).default(0), time: time.optional() }).optional(),
  departure: z.object({ mode: z.enum(["ferry", "flight"]), time: time.optional().describe("Departure time of the ferry or flight, HH:MM") }).optional().describe("Set when the guest leaves Maio on the last day"),
  drinks: z.boolean().default(true).describe("false if the guest wants quiet evenings (no bar)"),
  include: z.array(z.string()).max(5).default([]).describe("Experience ids from search_experiences the guest asked for"),
  exclude: z.array(z.string()).max(10).default([]),
  unmet: z.array(z.string().max(80)).max(5).default([]).describe("Things the guest asked for that are not in the data, in their words"),
});
export type TripRequest = z.infer<typeof TripRequestSchema>;

const ROUGH_WAVE = 2.0, ROUGH_WIND = 35, MODERATE_WAVE = 1.4, MODERATE_WIND = 25;
const TOWN = place("cidade-porto-ingles")!;
const WALKABLE_KM = 3;

export function seaStatus(day: Pick<DailySea, "waveHeightM" | "windKmh"> | undefined): SeaDay["status"] {
  if (!day || (day.waveHeightM === null && day.windKmh === null)) return "unknown";
  const wave = day.waveHeightM ?? 0, wind = day.windKmh ?? 0;
  if (wave >= ROUGH_WAVE || wind >= ROUGH_WIND) return "rough";
  if (wave >= MODERATE_WAVE || wind >= MODERATE_WIND) return "moderate";
  return "calm";
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const toTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function reachable(exp: Experience, hasCar: boolean): boolean {
  if (hasCar || exp.example.pickup) return true;
  return distanceKm(place(exp.placeId)!, TOWN) <= WALKABLE_KM;
}

function ageOk(exp: Experience, req: TripRequest): boolean {
  if (req.kids === 0) return true;
  return exp.example.minAge <= (req.youngestAge ?? 3);
}

const titles = { pt: (n: number) => `${n} ${n === 1 ? "dia" : "dias"} no Maio`, en: (n: number) => `${n} ${n === 1 ? "day" : "days"} on Maio`, fr: (n: number) => `${n} ${n === 1 ? "jour" : "jours"} à Maio` };

export type PlannerInput = { request: z.input<typeof TripRequestSchema>; forecast: DailySea[]; sailings: Sailing[]; forecastSource?: string };

export function buildPlan({ request: raw, forecast, sailings, forecastSource = "Open-Meteo" }: PlannerInput): TripPlan {
  const req = TripRequestSchema.parse(raw);
  const unmet = [...req.unmet];
  const exclude = new Set(req.exclude);
  const kids = req.kids > 0;
  const eligible = EXPERIENCES.filter((e) => !exclude.has(e.id) && !isExcludedExperience(e.id) && ageOk(e, req) && reachable(e, req.hasCar));
  const dates = Array.from({ length: req.days }, (_, i) => addDays(req.startDate, i));
  const sea = dates.map((date) => forecast.find((f) => f.date === date));
  const status = sea.map(seaStatus);

  const kinds: DayKind[] = dates.map(() => "full");
  // Arrival: the transport row, then the day starts after the transfer.
  let arrival: PlanItem | null = null, arrivalIndex = -1, arrivalReady = toMin("14:00");
  if (req.arrival) {
    arrivalIndex = Math.min(req.arrival.dayIndex, req.days - 1);
    const sailing = req.arrival.mode === "ferry" ? sailings.find((s) => s.date === dates[arrivalIndex] && /maio/i.test(s.to)) : undefined;
    const at = req.arrival.time ?? sailing?.departure ?? "14:00";
    arrival = {
      id: `d${arrivalIndex}-arrive`, kind: "transport", refId: req.arrival.mode, start: at, durationMin: req.arrival.mode === "ferry" ? 120 : 30,
      note: sailing ? `CV Interilhas ${sailing.from} → ${sailing.to} ${sailing.departure}` : "Time not published yet. Confirm with the operator.",
    };
    arrivalReady = toMin(at) + (req.arrival.mode === "ferry" ? 150 : 60);
    kinds[arrivalIndex] = "arrival";
  }
  // Departure: the last day, when the guest leaves on it (and it isn't also the arrival day).
  const leave = req.departure && req.days > 1 && kinds[req.days - 1] === "full"
    ? { mode: req.departure.mode, time: req.departure.time ?? "16:00", note: req.departure.time ? undefined : "Time not set. Confirm with the operator." }
    : undefined;
  if (leave) kinds[req.days - 1] = "departure";
  const earlyExit = !!leave && toMin(leave.time) < toMin("12:00");

  // One tour for the whole trip, on a full day only. Requested first, then a sea outing on the calmest safe day, then a land tour.
  const fullDays = dates.map((_, i) => i).filter((i) => kinds[i] === "full");
  const safe = (i: number) => status[i] === "calm" || status[i] === "moderate";
  const calmest = [...fullDays].filter(safe).sort((a, b) => (sea[a]?.waveHeightM ?? 9) - (sea[b]?.waveHeightM ?? 9));
  const requested = req.include.map(experience).filter((e): e is Experience => !!e && eligible.includes(e));
  const seaPool = eligible.filter((e) => e.seaDependent).sort((a, b) => Number(b.boat) - Number(a.boat));
  const landPool = eligible.filter((e) => !e.seaDependent && (!kids || e.example.durationMin <= 180));
  let tour: { exp: Experience; day: number } | null = null;
  for (const exp of [...requested, ...(req.boatTrips > 0 ? seaPool : []), ...landPool]) {
    const day = exp.seaDependent ? calmest[0] : (fullDays.find((i) => status[i] === "rough") ?? fullDays[0]);
    if (day !== undefined) { tour = { exp, day }; break; }
    if (requested.includes(exp)) unmet.push(`${exp.title}: no ${exp.seaDependent ? "safe sea" : "free"} day`);
  }
  if (req.boatTrips > 1 || req.include.length > 1) unmet.push("one tour per trip");
  if (req.boatTrips > 0 && !tour?.exp.seaDependent) unmet.push("sea outing: no safe sea day");

  const pools = { hasCar: req.hasCar, locale: req.locale, drinks: req.drinks };
  const picker = new Picker(pools);
  const days: PlanDay[] = dates.map((date, i) => {
    const items = buildDay({
      index: i, kind: kinds[i], rough: status[i] === "rough", sunset: sea[i]?.sunset ?? null, picker, pools,
      arrival: i === arrivalIndex ? arrival : null, arrivalReadyMin: arrivalReady, leave,
      tour: tour?.day === i ? tour.exp : null, quietNight: earlyExit && i === req.days - 2,
    });
    const s = sea[i];
    return { date, sea: s ? { status: status[i], waveHeightM: s.waveHeightM, windKmh: s.windKmh, tempMaxC: s.tempMaxC, source: forecastSource } : null, items };
  });

  return enforcePlanRules({ version: 1, locale: req.locale, title: titles[req.locale](req.days), party: { adults: req.adults, kids: req.kids, ...(req.youngestAge !== undefined ? { youngestAge: req.youngestAge } : {}) }, hasCar: req.hasCar, days, unmet: unmet.slice(0, 5) }, { requested: req.include });
}
