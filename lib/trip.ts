import { z } from "zod";
import data from "./trip-data.json" with { type: "json" };

export const LocaleSchema = z.enum(["pt", "en", "fr"]);
export const SeaStatusSchema = z.enum(["calm", "moderate", "rough", "unknown"]);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const SeaDaySchema = z.object({
  status: SeaStatusSchema,
  waveHeightM: z.number().nullable(),
  windKmh: z.number().nullable(),
  tempMaxC: z.number().nullable(),
  source: z.string(),
});

export const ItemKindSchema = z.enum(["experience", "place", "food", "transport"]);
export const PlanItemSchema = z.object({
  id: z.string().min(1).max(40),
  kind: ItemKindSchema,
  /** experience, food or place id from lib/trip-data.json; for transport the sailing/flight label */
  refId: z.string().min(1).max(80),
  start: time,
  durationMin: z.number().int().min(0).max(720),
  note: z.string().max(200).optional(),
});

export const PlanDaySchema = z.object({
  date: isoDate,
  sea: SeaDaySchema.nullable(),
  items: z.array(PlanItemSchema).max(8),
});

export const TripPlanSchema = z.object({
  version: z.literal(1),
  locale: LocaleSchema,
  title: z.string().max(80),
  party: z.object({ adults: z.number().int().min(1).max(12), kids: z.number().int().min(0).max(12), youngestAge: z.number().int().min(0).max(17).optional() }),
  hasCar: z.boolean(),
  days: z.array(PlanDaySchema).min(1).max(7),
  unmet: z.array(z.string().max(80)).max(5),
});

export type TripPlan = z.infer<typeof TripPlanSchema>;
export type PlanDay = z.infer<typeof PlanDaySchema>;
export type PlanItem = z.infer<typeof PlanItemSchema>;
export type SeaDay = z.infer<typeof SeaDaySchema>;

export type Experience = (typeof data.experiences)[number];
export type Food = (typeof data.food)[number];
export type Place = (typeof data.places)[number];

export const EXPERIENCES: Experience[] = data.experiences;
export const FOOD: Food[] = data.food;
export const PLACES: Place[] = data.places;
export const DATA_SOURCE = data.source;

const experienceById = new Map(EXPERIENCES.map((item) => [item.id, item]));
const foodById = new Map(FOOD.map((item) => [item.id, item]));
const placeById = new Map(PLACES.map((item) => [item.id, item]));

export const experience = (id: string) => experienceById.get(id);
export const food = (id: string) => foodById.get(id);
export const place = (id: string) => placeById.get(id);

/** Ids in a plan that do not exist in the fixture. A valid plan returns []. */
export function unknownRefs(plan: TripPlan): string[] {
  const missing: string[] = [];
  for (const day of plan.days) for (const item of day.items) {
    const known = item.kind === "experience" ? experienceById.has(item.refId)
      : item.kind === "food" ? foodById.has(item.refId)
      : item.kind === "place" ? placeById.has(item.refId)
      : true;
    if (!known) missing.push(item.refId);
  }
  return missing;
}

/** Parse untrusted input into a plan with only known ids, or null. */
export function parseTripPlan(value: unknown): TripPlan | null {
  const parsed = TripPlanSchema.safeParse(value);
  if (!parsed.success) return null;
  return unknownRefs(parsed.data).length ? null : parsed.data;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Kilometres between two places (haversine). */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}
