import { isBusinessLookup, isListingsLookup, isPlaceListQuestion, isSmallTalk, isTimetableQuestion, isTravelLookup, classify } from "./awareness/classify.ts";
import { parseGuestChip, type Task, type TaskLocale } from "./awareness/task.ts";
import { beachSwapDay, looksLikePlanEdit, parseDateShift, parseLengthEdit } from "./plan-router.ts";
import type { TripPlan } from "./trip.ts";

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

export function isPlacesStatus(status: string): boolean {
  return /^checking places…?$|^a ver os lugares…?$|^je vérifie les lieux…?$/i.test(status);
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

/** One real slice of work. The client shows these, in order, only when they happen. */
export type PlanStepId = "understand" | "read" | "forecast" | "places" | "build" | "update" | "lookup" | "ferries" | "flights" | "finalize";

export type PlanStep = {
  id: PlanStepId;
  /** 1-based day, for "Updating day 2…". */
  day?: number;
  /** The edit moves the trip dates. */
  dates?: boolean;
};

export type TurnKind = "none" | "quiet" | "edit" | "build";

export type TurnPlan = {
  kind: TurnKind;
  steps: PlanStep[];
  /**
   * The client may walk these lines on a timer. True only for a local edit that does not
   * fetch the forecast (relax a day, swap a beach, add the boat). Date moves and builds wait
   * for the server, so a sea line appears only when that fetch starts.
   */
  pace: boolean;
};

const STEP: Record<TaskLocale, {
  understand: string; read: string; forecast: string; places: string; build: string; update: string;
  updateDates: string; lookup: string; ferries: string; flights: string; finalize: string;
  updateDay: (day: number) => string;
}> = {
  en: {
    understand: "Understanding your trip…",
    read: "Reading your change…",
    forecast: "Checking sea forecast and places…",
    places: "Checking places…",
    build: "Building your plan…",
    update: "Updating your plan…",
    updateDates: "Updating your dates…",
    lookup: "Looking that up…",
    ferries: "Checking ferry times…",
    flights: "Checking flight times…",
    finalize: "Finalizing…",
    updateDay: (day) => `Updating day ${day}…`,
  },
  pt: {
    understand: "A perceber o pedido…",
    read: "A ler a mudança…",
    forecast: "A ver a previsão do mar e os lugares…",
    places: "A ver os lugares…",
    build: "A montar o plano…",
    update: "A atualizar o plano…",
    updateDates: "A atualizar as datas…",
    lookup: "A procurar isso…",
    ferries: "A ver os horários do barco…",
    flights: "A ver os horários do voo…",
    finalize: "A finalizar…",
    updateDay: (day) => `A atualizar o dia ${day}…`,
  },
  fr: {
    understand: "Je lis votre demande…",
    read: "Je lis le changement…",
    forecast: "Prévision de la mer et des lieux…",
    places: "Je vérifie les lieux…",
    build: "Je compose le plan…",
    update: "Je mets le plan à jour…",
    updateDates: "Je mets les dates à jour…",
    lookup: "Je cherche ça…",
    ferries: "Je vérifie les horaires du ferry…",
    flights: "Je vérifie les horaires du vol…",
    finalize: "Je termine…",
    updateDay: (day) => `Je mets le jour ${day} à jour…`,
  },
};

export function stepText(locale: TaskLocale, step: PlanStep): string {
  const copy = STEP[locale];
  if (step.id === "update" && step.dates) return copy.updateDates;
  if (step.id === "update" && step.day) return copy.updateDay(step.day);
  if (step.id === "update") return copy.update;
  return copy[step.id];
}

export function stepTexts(locale: TaskLocale, steps: PlanStep[]): string[] {
  return steps.map((step) => stepText(locale, step));
}

/** Hold each line long enough that a fast turn does not flicker through the list. The wait is only on the client. */
export const STATUS_HOLD_MS = 400;

/** A plain POST stays one JSON body. The stream is only for a caller that asks for it. */
export function wantsPlanStream(accept: string | null | undefined, stream: boolean | undefined): boolean {
  const asked = (accept ?? "").toLowerCase().split(",").some((part) => part.split(";")[0].trim() === "application/x-ndjson");
  return asked || stream === true;
}

function editSteps(update: { day?: number; dates?: boolean }, refetch: boolean): PlanStep[] {
  const steps: PlanStep[] = [{ id: "read" }];
  if (refetch) steps.push({ id: "forecast" });
  steps.push({ id: "update", ...(update.day ? { day: update.day } : {}), ...(update.dates ? { dates: true } : {}) });
  steps.push({ id: "finalize" });
  return steps;
}

function buildSteps(refetch: boolean): PlanStep[] {
  return [
    { id: "understand" },
    refetch ? { id: "forecast" } : { id: "places" },
    { id: "build" },
    { id: "finalize" },
  ];
}

function dayMention(text: string): number | undefined {
  const match = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().match(/\b(?:day|dia|jour)\s+(\d{1,2})\b/);
  if (!match) return undefined;
  const day = Number(match[1]);
  return day >= 1 && day <= 14 ? day : undefined;
}

function transportStep(text: string): PlanStep {
  const n = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const flight = /\b(?:flight|flights|voo|voos|vol|vols|avion)\b/.test(n);
  const ferry = /\b(?:ferry|ferries|barco|barcos|bateau|bateaux)\b/.test(n);
  return { id: flight && !ferry ? "flights" : "ferries" };
}

function concreteDateShift(text: string, today: string, task: Task, plan: TripPlan | null): boolean {
  const anchor = task.constraints.dates?.start ?? plan?.days[0]?.date;
  const shift = parseDateShift(text, today, anchor);
  return Boolean(shift && shift !== "ask");
}

const none = (): TurnPlan => ({ kind: "none", steps: [], pace: false });
const quiet = (step: PlanStep): TurnPlan => ({ kind: "quiet", steps: [step], pace: false });

/**
 * The lines this turn will show. A sea-forecast step is included only when `refetchForecast`
 * is set (a build includes it unless the caller says the forecast is already cached).
 * A relax, a beach swap, or the boat chip can be paced locally. A date move cannot: it
 * refetches, and the sea line is added only for that refetch.
 */
export function planTurn(text: string, task: Task, today: string, options?: {
  hasPlan?: boolean;
  plan?: TripPlan | null;
  refetchForecast?: boolean;
}): TurnPlan {
  const plan = options?.plan ?? null;
  const hasPlan = (options?.hasPlan ?? Boolean(plan)) || task.completed.includes("itinerary");
  const refetch = options?.refetchForecast === true;

  if (parseGuestChip(text)?.kind === "pdf" || isSmallTalk(text)) return none();
  if (isTravelLookup(text) || isTimetableQuestion(text)) return quiet(transportStep(text));
  if (isListingsLookup(text) || isBusinessLookup(text) || isPlaceListQuestion(text)) return quiet({ id: "lookup" });

  if (hasPlan) {
    const chip = parseGuestChip(text);
    if (chip?.kind === "relax") return { kind: "edit", steps: editSteps({ day: chip.day }, refetch), pace: !refetch };
    if (chip?.kind === "boat") return { kind: "edit", steps: editSteps({}, refetch), pace: !refetch };
    const beach = beachSwapDay(text);
    if (beach) return { kind: "edit", steps: editSteps({ day: beach }, refetch), pace: !refetch };
    if (parseLengthEdit(text) || concreteDateShift(text, today, task, plan)) {
      return { kind: "edit", steps: editSteps({ dates: true }, refetch), pace: false };
    }
    if (looksLikePlanEdit(text)) {
      const day = dayMention(text);
      return { kind: "edit", steps: editSteps(day ? { day } : {}, refetch), pace: !refetch };
    }
  }

  const result = classify(text, task, { today });
  if (result.smallTalk || result.cancelOnly) return none();
  if (result.intent === "side_question" || result.research) return quiet({ id: "lookup" });

  const carKnown = typeof task.constraints.car === "boolean" || result.carStance !== null || typeof result.patch.car === "boolean";
  const builds = result.planShaping || result.intent === "new_objective" || result.intent === "correction";
  if (hasPlan && builds) {
    const dates = Boolean(result.patch.dates);
    return { kind: "edit", steps: editSteps(dates ? { dates: true } : {}, refetch), pace: false };
  }
  if (builds && !carKnown) return quiet({ id: "understand" });
  if (builds && carKnown) return { kind: "build", steps: buildSteps(options?.refetchForecast !== false), pace: false };
  return quiet({ id: "lookup" });
}

/** Lines the client may reveal on a timer, plus whether it must wait for the server. */
export function paceLines(locale: TaskLocale, turn: TurnPlan): { lines: string[]; blocked: boolean } {
  if (turn.kind === "none" || turn.steps.length === 0) return { lines: [], blocked: true };
  if (turn.pace) return { lines: stepTexts(locale, turn.steps.filter((step) => step.id !== "forecast")), blocked: false };
  const first = turn.steps[0];
  // The sea line is not an opening guess. It arrives when the fetch starts.
  if (first.id === "forecast") return { lines: [stepText(locale, { id: "lookup" })], blocked: true };
  return { lines: [stepText(locale, first)], blocked: true };
}

export type StatusPlay = {
  pace: string[];
  index: number;
  label: string;
  shownAt: number;
  pending: string | null;
  blocked: boolean;
};

export function startStatusPlay(pace: string[], blocked: boolean, now: number): StatusPlay {
  return { pace, index: 0, label: pace[0] ?? "", shownAt: now, pending: null, blocked };
}

function blocking(text: string): boolean {
  return isSeaForecastStatus(text) || isPlacesStatus(text);
}

/** A server line. Within the hold it waits; the newest one wins, so a fast burst does not flicker. */
export function pushStatusPlay(state: StatusPlay, text: string, now: number): StatusPlay {
  if (!text || text === state.label) return state.pending === text ? { ...state, pending: null } : state;
  const at = state.pace.indexOf(text);
  const index = at >= 0 ? at : state.index;
  if (now - state.shownAt >= STATUS_HOLD_MS) {
    return { ...state, label: text, shownAt: now, pending: null, blocked: blocking(text), index };
  }
  return { ...state, pending: text, blocked: blocking(text), index };
}

/** Reveal the newest server line, or the next paced line, once the current one has been up long enough. */
export function tickStatusPlay(state: StatusPlay, now: number): StatusPlay {
  if (now - state.shownAt < STATUS_HOLD_MS) return state;
  if (state.pending && state.pending !== state.label) {
    const at = state.pace.indexOf(state.pending);
    return {
      ...state,
      label: state.pending,
      shownAt: now,
      pending: null,
      blocked: blocking(state.pending),
      index: at >= 0 ? at : state.index,
    };
  }
  if (state.blocked) return state;
  const next = state.index + 1;
  if (next >= state.pace.length) return state;
  return { ...state, index: next, label: state.pace[next], shownAt: now, pending: null };
}

export type PlanResultBody = {
  reply?: unknown;
  plan?: unknown;
  toolEvents?: unknown;
  task?: unknown;
  chips?: unknown;
  intent?: unknown;
  status?: unknown;
  steps?: unknown;
  error?: unknown;
};

/** Read a plan response. NDJSON carries status lines as they happen; JSON is the finished body. */
export async function readPlanEvents(response: Response, onStatus: (text: string) => void): Promise<PlanResultBody> {
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!type.includes("ndjson")) {
    const data = await response.json() as PlanResultBody;
    if (!response.ok) throw new Error("plan");
    return data;
  }
  if (!response.ok || !response.body) throw new Error("plan");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: PlanResultBody | null = null;
  const take = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as { type?: string; text?: string };
    if (event.type === "status" && typeof event.text === "string") onStatus(event.text);
    else if (event.type === "result") result = event as PlanResultBody;
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) take(line);
  }
  buffer += decoder.decode();
  if (buffer.trim()) take(buffer);
  if (!result) throw new Error("plan");
  return result;
}
