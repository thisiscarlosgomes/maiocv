import { z } from "zod";

/** Server-owned trip task. Identity, constraints and pointers only — tool results stay the authority for numbers. */
export const TaskLocaleSchema = z.enum(["pt", "en", "fr"]);
export type TaskLocale = z.infer<typeof TaskLocaleSchema>;

export const TaskScopeSchema = z.object({
  geography: z.enum(["town", "island"]),
  town: z.string().max(80).optional(),
  mode: z.enum(["on-island", "planning", "research"]),
});
export type TaskScope = z.infer<typeof TaskScopeSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const TaskConstraintsSchema = z.object({
  dates: z.object({
    start: isoDate.optional(),
    days: z.number().int().min(1).max(14).optional(),
  }).optional(),
  party: z.object({
    adults: z.number().int().min(0).max(20).optional(),
    kids: z.number().int().min(0).max(20).optional(),
    youngestAge: z.number().int().min(0).max(17).optional(),
  }).optional(),
  car: z.boolean().optional(),
  diet: z.string().max(60).nullable().optional(),
  budget: z.string().max(60).nullable().optional(),
  quietEvenings: z.boolean().optional(),
  interests: z.array(z.string().max(40)).max(8).optional(),
  boatTrips: z.number().int().min(0).max(3).optional(),
  arrival: z.object({
    mode: z.enum(["ferry", "flight"]),
    time: clock.optional(),
    /** False when the guest stated a time the timetable has not confirmed. */
    verified: z.boolean(),
  }).optional(),
  departure: z.object({
    mode: z.enum(["ferry", "flight"]),
    time: clock.optional(),
  }).optional(),
});
export type TaskConstraints = z.infer<typeof TaskConstraintsSchema>;

export const LastPlaceSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  area: z.string().max(120).optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
});
export type LastPlace = z.infer<typeof LastPlaceSchema>;

export const ToolFactSchema = z.object({
  name: z.string().min(1).max(60),
  retrievedAt: z.string().max(40),
  value: z.string().max(240),
});
export type ToolFact = z.infer<typeof ToolFactSchema>;

export const TaskSchema = z.object({
  version: z.literal(1),
  objective: z.string().max(240).nullable(),
  scope: TaskScopeSchema,
  constraints: TaskConstraintsSchema,
  completed: z.array(z.string().max(160)).max(20),
  remaining: z.array(z.string().max(160)).max(12),
  lastPlaces: z.array(LastPlaceSchema).max(8),
  pendingQuestion: z.string().max(200).nullable(),
  lastToolFacts: z.array(ToolFactSchema).max(12),
  locale: TaskLocaleSchema,
});
export type Task = z.infer<typeof TaskSchema>;

const CHIP = {
  en: {
    dates: "When do you arrive, and for how many days?",
    party: "Who is coming?",
    car: "Will you have a car?",
    departure: "When do you leave?",
  },
  pt: {
    dates: "Quando chega e quantos dias?",
    party: "Quem vem?",
    car: "Vão de carro?",
    departure: "Quando partem?",
  },
  fr: {
    dates: "Quand arrivez-vous, et pour combien de jours ?",
    party: "Qui vient ?",
    car: "Aurez-vous une voiture ?",
    departure: "Quand partez-vous ?",
  },
} as const;

export function emptyTask(locale: TaskLocale = "en"): Task {
  return {
    version: 1,
    objective: null,
    scope: { geography: "island", mode: "planning" },
    constraints: {},
    completed: [],
    remaining: [],
    lastPlaces: [],
    pendingQuestion: null,
    lastToolFacts: [],
    locale,
  };
}

export function parseTask(value: unknown): Task | null {
  const parsed = TaskSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function mergeConstraints(base: TaskConstraints, patch: TaskConstraints): TaskConstraints {
  const next: TaskConstraints = { ...base };
  if (patch.dates) next.dates = { ...base.dates, ...patch.dates };
  if (patch.party) next.party = { ...base.party, ...patch.party };
  if (patch.car !== undefined) next.car = patch.car;
  if (patch.diet !== undefined) next.diet = patch.diet;
  if (patch.budget !== undefined) next.budget = patch.budget;
  if (patch.quietEvenings !== undefined) next.quietEvenings = patch.quietEvenings;
  if (patch.interests?.length) {
    next.interests = [...new Set([...(base.interests ?? []), ...patch.interests])].slice(0, 8);
  }
  if (patch.boatTrips !== undefined) next.boatTrips = patch.boatTrips;
  if (patch.arrival) next.arrival = patch.arrival;
  if (patch.departure) next.departure = patch.departure;
  return next;
}

/** Recompute completed/remaining from constraints. A finished intent is not offered again. */
export function refreshTask(task: Task): Task {
  const parsed = parseTask(task);
  const safe = parsed ?? emptyTask(task.locale);
  const c = safe.constraints;
  const completed = new Set(safe.completed);
  const copy = CHIP[safe.locale];
  const remaining: string[] = [];
  if (c.dates?.start && c.dates.days) completed.add("dates");
  else remaining.push(copy.dates);
  if (c.party?.adults) completed.add("party");
  else remaining.push(copy.party);
  if (typeof c.car === "boolean") completed.add("car");
  else remaining.push(copy.car);
  if (c.boatTrips !== undefined || c.interests?.some((item) => /boat|barco|bateau/.test(item))) completed.add("boat");
  if (c.diet) completed.add("diet");
  if (c.budget) completed.add("budget");
  if (c.quietEvenings) completed.add("quiet");
  if (c.arrival) completed.add("arrival");
  if (c.departure) completed.add("departure");
  else if (completed.has("dates") && safe.scope.mode === "planning" && safe.objective) remaining.push(copy.departure);
  return {
    ...safe,
    completed: [...completed].slice(0, 20),
    remaining: remaining.slice(0, 12),
  };
}

const BOAT_CHIP = /boat|barco|bateau/i;

function questionOptions(question: string, locale: TaskLocale): string[] {
  const text = question.toLowerCase();
  if (!/ferry|flight|barco|voo|bateau|avion/.test(text)) return [];
  if (locale === "pt") return ["Barco", "Voo"];
  if (locale === "fr") return ["Ferry", "Avion"];
  return ["Ferry", "Flight"];
}

/** Chips from remaining work and the pending question. Never re-offers a finished intent. */
export function followUpChips(task: Task): string[] {
  const boatDone = task.completed.some((item) => item === "boat" || BOAT_CHIP.test(item));
  const pending = task.pendingQuestion ? questionOptions(task.pendingQuestion, task.locale) : [];
  const open = task.remaining.filter((item) => {
    if (boatDone && BOAT_CHIP.test(item)) return false;
    return !task.completed.includes(item);
  });
  const chips = (pending.length ? pending : open.length ? open : task.pendingQuestion ? [task.pendingQuestion] : []);
  return [...new Set(chips.filter((item) => !(boatDone && BOAT_CHIP.test(item))))].slice(0, 3);
}

export function rememberFact(task: Task, fact: ToolFact): Task {
  const lastToolFacts = [...task.lastToolFacts.filter((item) => item.name !== fact.name), fact].slice(-12);
  const parsed = parseTask({ ...task, lastToolFacts });
  return parsed ?? { ...task, lastToolFacts };
}

export function rememberPlace(task: Task, place: LastPlace): Task {
  const lastPlaces = [...task.lastPlaces.filter((item) => item.id !== place.id), place].slice(-8);
  return { ...task, lastPlaces };
}
