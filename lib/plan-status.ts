import { isBusinessLookup, isSmallTalk, isTimetableQuestion, isTravelLookup, classify } from "./awareness/classify.ts";
import { parseGuestChip, type Task, type TaskLocale } from "./awareness/task.ts";

/** What this turn is actually doing, so the loading line can match it. */
export type TurnWork = "none" | "thinking" | "moment" | "places" | "forecast" | "ferries";

const COPY: Record<TaskLocale, Record<Exclude<TurnWork, "none">, string>> = {
  en: {
    thinking: "Thinking…",
    moment: "One moment…",
    places: "Looking up places…",
    forecast: "Checking sea forecast and places…",
    ferries: "Checking ferries and flights…",
  },
  pt: {
    thinking: "A pensar…",
    moment: "Um momento…",
    places: "A procurar lugares…",
    forecast: "A ver a previsão do mar e os lugares…",
    ferries: "A ver barcos e voos…",
  },
  fr: {
    thinking: "Je réfléchis…",
    moment: "Un moment…",
    places: "Recherche de lieux…",
    forecast: "Prévision de la mer et lieux…",
    ferries: "Vérification des ferries et des vols…",
  },
};

export function loadingStatus(locale: TaskLocale, work: TurnWork): string {
  if (work === "none") return "";
  return COPY[locale][work];
}

export function isSeaForecastStatus(status: string): boolean {
  return /checking sea forecast|previs[aã]o do mar|pr[eé]vision de la mer/i.test(status);
}

/**
 * Predict the work from the utterance. A sea-forecast line is only for a turn that will
 * build or rebuild a plan. Greetings, lookups, and one-day edits stay off that line.
 */
export function turnWork(text: string, task: Task, today: string): TurnWork {
  const chip = parseGuestChip(text);
  if (chip?.kind === "pdf") return "none";
  if (chip) return "moment";
  if (isSmallTalk(text)) return "thinking";
  if (isTravelLookup(text) || isTimetableQuestion(text)) return "ferries";
  if (isBusinessLookup(text)) return "places";
  const result = classify(text, task, { today });
  if (result.smallTalk || result.intent === "side_question" || result.cancelOnly || result.research) return "thinking";
  const carKnown = typeof task.constraints.car === "boolean" || result.carStance !== null || typeof result.patch.car === "boolean";
  const builds = result.planShaping || result.intent === "new_objective" || result.intent === "correction";
  if (builds && !carKnown) return "moment";
  if (builds) return "forecast";
  return "thinking";
}
