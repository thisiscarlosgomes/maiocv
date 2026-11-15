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
  /** Slow is the relaxed default. Packed is only when the guest asks for a full day. */
  pace: z.enum(["slow", "packed"]).optional(),
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
  if (patch.pace) next.pace = patch.pace;
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
  return {
    ...safe,
    completed: [...completed].slice(0, 20),
    remaining: remaining.slice(0, 12),
  };
}

/** Asked once, before the first plan, when the guest has not said if they have a car. */
export const CAR_QUESTION: Record<TaskLocale, string> = {
  en: "Will you have a car?",
  pt: "Vão ter carro?",
  fr: "Vous aurez une voiture ?",
};

export const CAR_CHIPS: Record<TaskLocale, [string, string, string]> = {
  en: ["Yes, renting a car", "No car", "Not sure yet"],
  pt: ["Sim, vamos alugar", "Sem carro", "Ainda não sei"],
  fr: ["Oui, on loue", "Sans voiture", "Pas encore sûr"],
};

export function isCarPending(question: string | null | undefined): boolean {
  if (!question) return false;
  return (Object.values(CAR_QUESTION) as string[]).includes(question);
}

const VOICE: Record<TaskLocale, { days: string; party: string; partyNoCar: string; beaches: string; relax: string; boat: string; rent: string; pdf: string }> = {
  en: {
    days: "3 days, slow pace",
    party: "We're 2 adults",
    partyNoCar: "We're 2 adults, no car",
    beaches: "Best beaches?",
    relax: "Make day 2 more relaxed",
    boat: "Add a boat trip",
    rent: "Where can I rent a car?",
    pdf: "Export as PDF",
  },
  pt: {
    days: "3 dias, ritmo calmo",
    party: "Somos 2 adultos",
    partyNoCar: "Somos 2 adultos, sem carro",
    beaches: "Melhores praias?",
    relax: "Deixa o dia 2 mais calmo",
    boat: "Acrescenta um passeio de barco",
    rent: "Onde alugo um carro?",
    pdf: "Exportar em PDF",
  },
  fr: {
    days: "3 jours, rythme calme",
    party: "Nous sommes 2 adultes",
    partyNoCar: "Nous sommes 2 adultes, sans voiture",
    beaches: "Meilleures plages ?",
    relax: "Rends le jour 2 plus calme",
    boat: "Ajoute une sortie en bateau",
    rent: "Où louer une voiture ?",
    pdf: "Exporter en PDF",
  },
};

/** The bot asking the guest for their own details. Chips are the other way around. */
const BOT_TO_GUEST = /\b(when do you|who is coming|who'?s coming|will you have|how many days do you|do you arrive|do you leave|quantos dias vai|v[aã]o ter|quem vem|quando chega|quando parte|aurez-vous|qui vient|quand arrivez|combien de jours passez)\b/i;

/** A chip is something the guest would send. A question mark is only for a question to the assistant. */
export function isGuestChip(text: string): boolean {
  return !BOT_TO_GUEST.test(text.trim());
}

function questionOptions(question: string, locale: TaskLocale): string[] {
  const text = question.toLowerCase();
  if (!/ferry|flight|barco|voo|bateau|avion/.test(text)) return [];
  if (locale === "pt") return ["Barco", "Voo"];
  if (locale === "fr") return ["Ferry", "Avion"];
  return ["Ferry", "Flight"];
}

/** Clickable guest messages for this task. Never a question the assistant would ask. */
export function followUpChips(task: Task): string[] {
  const locale = task.locale;
  if (isCarPending(task.pendingQuestion)) return [...CAR_CHIPS[locale]];
  const choice = task.pendingQuestion ? questionOptions(task.pendingQuestion, locale) : [];
  if (choice.length) return choice.slice(0, 3);
  const copy = VOICE[locale];
  const c = task.constraints;
  const hasPlan = task.completed.includes("itinerary");
  const chips: string[] = [];
  if (!hasPlan) {
    if (!(c.dates?.start && c.dates?.days)) chips.push(copy.days);
    if (!c.party?.adults) chips.push(c.car === false ? copy.partyNoCar : copy.party);
    if (chips.length < 3) chips.push(copy.beaches);
    return [...new Set(chips)].slice(0, 3);
  }
  if ((c.dates?.days ?? 1) >= 2) chips.push(copy.relax);
  const boatDone = task.completed.includes("boat") || (c.boatTrips ?? 0) > 0;
  if (!boatDone) chips.push(copy.boat);
  chips.push(c.car === false ? copy.rent : copy.pdf);
  return [...new Set(chips)].slice(0, 3);
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
