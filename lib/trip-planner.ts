import { z } from "zod";
import type { DailySea } from "./agora.ts";
import type { Sailing } from "./essentials.ts";
import {
  EXPERIENCES, FOOD, PLACES, LocaleSchema, addDays, distanceKm, experience, place,
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

export type PlannerInput = { request: TripRequest; forecast: DailySea[]; sailings: Sailing[]; forecastSource?: string };

export function buildPlan({ request: raw, forecast, sailings, forecastSource = "Open-Meteo" }: PlannerInput): TripPlan {
  const req = TripRequestSchema.parse(raw);
  const unmet = [...req.unmet];
  const exclude = new Set(req.exclude);
  const kids = req.kids > 0;
  const eligible = EXPERIENCES.filter((e) => !exclude.has(e.id) && ageOk(e, req) && reachable(e, req.hasCar));
  const dates = Array.from({ length: req.days }, (_, i) => addDays(req.startDate, i));
  const sea = dates.map((date) => forecast.find((f) => f.date === date));
  const status = sea.map(seaStatus);

  // Day start: arrival pushes the first day's plans to after the ferry or flight.
  const dayStart = dates.map(() => toMin("07:00"));
  const transport: (PlanItem | null)[] = dates.map(() => null);
  if (req.arrival) {
    const i = Math.min(req.arrival.dayIndex, req.days - 1);
    const sailing = req.arrival.mode === "ferry" ? sailings.find((s) => s.date === dates[i] && /maio/i.test(s.to)) : undefined;
    const at = req.arrival.time ?? sailing?.departure ?? "14:00";
    transport[i] = {
      id: `d${i}-arrive`, kind: "transport", refId: req.arrival.mode, start: at, durationMin: req.arrival.mode === "ferry" ? 120 : 30,
      note: sailing ? `CV Interilhas ${sailing.from} → ${sailing.to} ${sailing.departure}` : "Time not published yet. Confirm with the operator.",
    };
    dayStart[i] = toMin(at) + (req.arrival.mode === "ferry" ? 150 : 60);
  }

  // Sea outings go on the calmest safe days, one per day.
  const seaPicks = new Map<number, Experience>();
  const seaPool = [
    ...req.include.map(experience).filter((e): e is Experience => !!e && e.seaDependent && eligible.includes(e)),
    ...eligible.filter((e) => e.seaDependent).sort((a, b) => Number(b.boat) - Number(a.boat)),
  ].filter((e, i, list) => list.indexOf(e) === i);
  const safeDays = dates.map((_, i) => i)
    .filter((i) => status[i] === "calm" || status[i] === "moderate")
    .sort((a, b) => (sea[a]?.waveHeightM ?? 9) - (sea[b]?.waveHeightM ?? 9));
  for (let n = 0; n < req.boatTrips; n += 1) {
    const exp = seaPool[n];
    const day = safeDays.find((d) => !seaPicks.has(d) && exp && exp.example.slots.some((s) => toMin(s) >= dayStart[d]));
    if (!exp) { unmet.push("more sea outings than we list"); break; }
    if (day === undefined) { unmet.push(`${exp.title}: no safe sea day`); continue; }
    seaPicks.set(day, exp);
  }

  const landPool = [
    ...req.include.map(experience).filter((e): e is Experience => !!e && !e.seaDependent && eligible.includes(e)),
    ...eligible.filter((e) => !e.seaDependent && (!kids || e.example.durationMin <= 180)),
  ].filter((e, i, list) => list.indexOf(e) === i);
  const foodPool = FOOD.filter((f) => req.hasCar || distanceKm(place(f.placeId)!, TOWN) <= WALKABLE_KM);
  const wantsNature = req.interests.includes("nature") || req.interests.includes("walking");
  const placePool = PLACES.filter((p) => (p.category === "beach" || (!kids && wantsNature && p.category === "protected_area"))
    && (req.hasCar || distanceKm(p, TOWN) <= WALKABLE_KM));
  let land = 0, meal = 0, spot = 0;

  const days: PlanDay[] = dates.map((date, i) => {
    const items: PlanItem[] = [];
    if (transport[i]) items.push(transport[i]!);
    let clock = dayStart[i];
    const exp = seaPicks.get(i) ?? (land < landPool.length ? landPool[land] : undefined);
    const morning = exp?.example.slots.find((s) => toMin(s) >= clock && toMin(s) <= toMin("11:00"));
    const afternoon = exp?.example.slots.find((s) => toMin(s) >= Math.max(clock, toMin("14:30")));
    const book = (slot: string) => {
      if (!exp!.seaDependent) land += 1;
      items.push({ id: `d${i}-exp`, kind: "experience", refId: exp!.id, start: slot, durationMin: exp!.example.durationMin, request: { state: "none", slot, guests: req.adults + req.kids } });
    };
    if (exp && morning) { book(morning); clock = toMin(morning) + exp.example.durationMin; }
    if (foodPool.length && clock <= toMin("15:00")) {
      const lunch = Math.max(clock + 15, toMin("13:00"));
      const f = foodPool[meal++ % foodPool.length];
      items.push({ id: `d${i}-food`, kind: "food", refId: f.id, start: toTime(lunch), durationMin: 75 });
      clock = lunch + 75;
    }
    const late = exp && !morning ? exp.example.slots.find((s) => toMin(s) >= clock + 15) ?? afternoon : undefined;
    if (exp && !morning && late && toMin(late) >= clock) { book(late); clock = toMin(late) + exp.example.durationMin; }
    else if (placePool.length && clock <= toMin("17:00")) {
      const p = placePool[spot++ % placePool.length];
      items.push({ id: `d${i}-place`, kind: "place", refId: p.id, start: toTime(clock + 30), durationMin: 120 });
    }
    items.sort((a, b) => toMin(a.start) - toMin(b.start));
    const s = sea[i];
    return { date, sea: s ? { status: status[i], waveHeightM: s.waveHeightM, windKmh: s.windKmh, tempMaxC: s.tempMaxC, source: forecastSource } : null, items };
  });

  return { version: 1, locale: req.locale, title: titles[req.locale](req.days), party: { adults: req.adults, kids: req.kids, ...(req.youngestAge !== undefined ? { youngestAge: req.youngestAge } : {}) }, hasCar: req.hasCar, days, unmet: unmet.slice(0, 5) };
}
