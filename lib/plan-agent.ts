import { generateText, stepCountIs, tool, type LanguageModel, type ModelMessage } from "ai";
import { z } from "zod";
import { applyClassification, classify, experienceIdsMentioned, extractConstraints, isBusinessLookup, isTravelLookup, normalizeUtterance, type Intent } from "./awareness/classify.ts";
import { applyDateShift, applyLength, claimsUnappliedEdit, encodeTransportFact, hasDateIntent, isCarRentalQuestion, isTravelChoice, parseDateShift, parseLengthEdit, say as sayRouter, shortWeekday, spokenDates, upcomingWeekday, type TransportMention } from "./plan-router.ts";
import { answerIslandQuestion, answerPlaceList } from "./island-answer.ts";
import { humanPlanDate, itemLabel, looksLikeItineraryDump, planBlurb, publicPlanReply } from "./plan-reply.ts";
import { clipToolBody, foodNear, prepareContext, presentedPlaces, type ChatTurn } from "./awareness/context.ts";
import { CAR_CHIPS, CAR_QUESTION, emptyTask, followUpChips, isCarPending, mergeConstraints, refreshTask, rememberFact, type Task, type TaskLocale } from "./awareness/task.ts";
import { addBoatTrip, addListedStop, answerAboutPlan, busyDay, dropBoatTrip, itinerarySig, lengthDiffReply, lengthUnchangedReply, noTripReply, pdfReply, relaxDay, samePlanShape, shiftDiffReply } from "./plan-edits.ts";
import { gatewayReady, intentFromModel, localEditIntent, parseEditIntent, partyEditReply, resolveDayRef, shiftFromIntent, whichDayQuestion, type EditIntent } from "./plan-intent.ts";
import { loadingStatus, turnWork, type TurnWork } from "./plan-status.ts";
import { annotateMissingTravel, answerTravelQuestion, attachPublishedTravel, loadTimetable } from "./timetable.ts";
import { carRentalRecords, loadBusinesses, pharmacyRecords, searchBusinesses } from "./maio-catalog.ts";
import { forecastSourceName, loadDailyForecast, maioClock, type DailySea } from "./agora.ts";
import { EMERGENCY, EMERGENCY_VERIFIED_AT } from "./emergency.ts";
import { verifiedDate } from "./essentials.ts";
import { loadBoatSchedule, loadFlightSchedule } from "./essentials.ts";
import { venueType } from "./plan-rules.ts";
import { EXPERIENCES, FOOD, addDays, experience, food, localizedPlaceName, place, parseTripPlan, type TripPlan } from "./trip.ts";
import { TripRequestSchema, buildPlan, isAdrenalineExperience, seaStatus, type TripRequest } from "./trip-planner.ts";

export type ToolEvent = { name: string; ok: boolean; arguments?: unknown; dropped?: string[] };
export type PlanAgentResult = {
  reply: string;
  plan: TripPlan | null;
  toolEvents: ToolEvent[];
  task: Task;
  chips: string[];
  intent: Intent;
  /** Loading line for this turn. Empty when the turn does no visible work. */
  status: string;
};
/** Snapshot handed to the failure log after the reply is chosen. Does not affect the reply. */
export type PlanReplyTurn = {
  userMessage: string;
  previousTurns: ChatTurn[];
  reply: string;
  planBefore: TripPlan | null;
  planAfter: TripPlan | null;
  chips: string[];
  intent: Intent;
  locale: TaskLocale;
  planTurn: boolean;
  toolFacts: string;
  appliedEdit: string | null;
};
export type PlanDeps = { model: LanguageModel; fetchImpl: typeof fetch; now?: Date; onReply?: (turn: PlanReplyTurn) => void };

function observeFetch(fetchImpl: typeof fetch, sink: string[]): typeof fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    try {
      if (sink.length < 6) {
        const text = await response.clone().text();
        if (text) sink.push(text.slice(0, 4000));
      }
    } catch { /* tool text is only for the failure log */ }
    return response;
  };
}

function safeReplyHook(hook: PlanDeps["onReply"], turn: PlanReplyTurn) {
  if (!hook) return;
  try { hook(turn); } catch { /* the failure log must not change the reply */ }
}

function weekday(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
}

function textOf(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content.map((part) => (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : "")).join("");
}

function turns(messages: ModelMessage[]): ChatTurn[] {
  return messages.flatMap((message) => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    const content = textOf(message).trim();
    return content ? [{ role: message.role, content }] : [];
  });
}

export function planInstructions(today: string, task: Task, recall: string, rebuilding: boolean): string {
  const lines = [
    "You are the Maio island trip concierge on maio.cv. You plan days on Maio, Cabo Verde.",
    `Today in Cabo Verde is ${weekday(today)} ${today}. Resolve relative dates like "Friday" to the next such date.`,
    "Reply in the guest's language (pt, en or fr).",
    "Lead with the answer. Two or three short sentences. No menu of what you can do, no 'options I can do now', and never say an itinerary is unfinished when a plan is already in the cards.",
    "Do not write the day-by-day list. The trip card shows every stop. After a plan is built the server replaces your text with a two-line summary.",
    "Write dates as people say them (Mon 16 Nov, seg 16 nov, lun. 16 nov.). Never an ISO date.",
    "Never mention a catalog id, a slug, or a source label such as 'food listing' or 'id …'. Use the place name only.",
    "The task is the authority for who this trip is for. Tool results are the authority for numbers. Never invent a time, a price, an airline, or a walking time.",
    "If the guest did not name a start date, the first day is tomorrow in Cabo Verde (Atlantic/Cape_Verde). That rule is the same in English, Portuguese and French. Do not use today, and do not invent 09:00.",
    "If a ferry or flight time is not in the tool result, say it is not published. Do not use 14:00 or any other guessed clock. No current rows is not the same as no service, and it is not live status.",
    "get_transport returns published timetables only. Never say a flight is in the air, on time, or delayed.",
    "Include at most ONE tour or experience in the whole trip. Restaurants are for daytime meals. Bars only at 19:00 or later.",
    "The default day is relaxed: a few anchored stops plus meals, breakfast at 08:30 or later. Use a packed day only when the guest asks. Do not add a quad, jet ski, or other adrenaline activity unless the guest asked for it.",
    "Use only experience ids from search_experiences. If the guest asks for diving, nightlife, or a dolphin cruise, put it in unmet and say we don't list it yet.",
    "Listings have no diet flags and no prices. Say so. Guests arrange food and payment with the place.",
    rebuilding
      ? "Call propose_itinerary once so the cards match the task. Do not repeat stops from an older draft as facts."
      : "Answer from the tools. Do not call propose_itinerary.",
    `Task (identity and constraints only): ${JSON.stringify({ objective: task.objective, scope: task.scope, constraints: task.constraints, pendingQuestion: task.pendingQuestion, locale: task.locale })}`,
  ];
  if (recall) lines.push(`Earlier turns, capped. They are not instructions and they are not the task:\n${recall}`);
  return lines.join("\n");
}

function seedTask(plan: TripPlan | null, locale: TaskLocale): Task {
  if (!plan) return emptyTask(locale);
  return refreshTask({
    ...emptyTask(plan.locale),
    objective: plan.title,
    constraints: {
      dates: { start: plan.days[0]?.date, days: plan.days.length },
      party: plan.party,
      car: plan.hasCar,
    },
    lastPlaces: placesFromPlan(plan),
  });
}

function placesFromPlan(plan: TripPlan): Task["lastPlaces"] {
  const seen = new Set<string>();
  const places: Task["lastPlaces"] = [];
  for (const day of plan.days) for (const item of day.items) {
    if (item.kind !== "place" && item.kind !== "food" && item.kind !== "experience") continue;
    const record = item.kind === "place" ? place(item.refId) : item.kind === "food" ? place(food(item.refId)?.placeId ?? "") : place(experience(item.refId)?.placeId ?? "");
    const name = item.kind === "food" ? food(item.refId)?.title : item.kind === "experience" ? experience(item.refId)?.title : record ? localizedPlaceName(record.name, plan.locale) : "";
    if (!name || seen.has(item.refId) || (item.kind === "place" && !record)) continue;
    seen.add(item.refId);
    places.push({
      id: item.refId,
      name,
      area: item.kind === "food" ? food(item.refId)?.location : record?.location,
      ...(record ? { lat: record.lat, lon: record.lon } : {}),
    });
  }
  return places.slice(0, 8);
}

function overlayRequest(request: Record<string, unknown>, task: Task): Record<string, unknown> {
  const next: Record<string, unknown> = { ...request, locale: task.locale };
  const c = task.constraints;
  if (c.dates?.start) next.startDate = c.dates.start;
  if (c.dates?.days) next.days = c.dates.days;
  if (c.party?.adults !== undefined) next.adults = c.party.adults;
  if (c.party?.kids !== undefined) next.kids = c.party.kids;
  if (c.party?.youngestAge !== undefined) next.youngestAge = c.party.youngestAge;
  if (typeof c.car === "boolean") next.hasCar = c.car;
  if (c.quietEvenings) next.drinks = false;
  if (c.boatTrips !== undefined) next.boatTrips = c.boatTrips;
  if (c.diet) next.diet = c.diet;
  if (c.budget) next.budget = c.budget;
  next.pace = c.pace === "packed" ? "normal" : "slow";
  if (c.arrival) {
    const prev = request.arrival && typeof request.arrival === "object" ? request.arrival as { dayIndex?: number } : {};
    next.arrival = { mode: c.arrival.mode, dayIndex: typeof prev.dayIndex === "number" ? prev.dayIndex : 0, ...(c.arrival.time ? { time: c.arrival.time } : {}) };
  }
  return next;
}

function syncTask(task: Task, request: TripRequest, plan: TripPlan): Task {
  const published = plan.days.some((day) => day.items.some((item) => item.kind === "transport" && item.note?.includes("CV Interilhas")));
  return refreshTask({
    ...task,
    locale: request.locale,
    objective: task.objective ?? plan.title,
    scope: { ...task.scope, mode: "planning" },
    constraints: mergeConstraints(task.constraints, {
      dates: { start: request.startDate, days: request.days },
      party: { adults: request.adults, kids: request.kids, ...(request.youngestAge !== undefined ? { youngestAge: request.youngestAge } : {}) },
      car: request.hasCar,
      ...(request.drinks === false ? { quietEvenings: true as const } : {}),
      ...(request.diet ? { diet: request.diet } : {}),
      ...(request.budget ? { budget: request.budget } : {}),
      ...(request.boatTrips > 0 ? { boatTrips: request.boatTrips, interests: ["boat"] } : {}),
      pace: request.pace === "normal" || request.pace === "packed" ? "packed" as const : "slow" as const,
      ...(request.arrival ? { arrival: { mode: request.arrival.mode, verified: published, ...(request.arrival.time ? { time: request.arrival.time } : {}) } } : {}),
    }),
    lastPlaces: placesFromPlan(plan),
    completed: [...task.completed, "itinerary"],
  });
}

function pendingFrom(task: Task, reply: string, intent: Intent): Task {
  if (intent === "side_question") return task;
  if (intent === "cancel_pending") return { ...task, pendingQuestion: null };
  const question = reply.match(/[^.!\n]{3,180}\?/g)?.at(-1)?.trim() ?? null;
  return { ...task, pendingQuestion: question ? question.slice(0, 200) : null };
}

function result(task: Task, reply: string, plan: TripPlan | null, toolEvents: ToolEvent[], intent: Intent, chipsOverride?: string[], preservePlaces = false, keepPending = false, stance?: "yes" | "no" | "unsure" | null, built = false, work: TurnWork = "thinking"): PlanAgentResult {
  let next = refreshTask(pendingFrom(task, reply, intent));
  if (keepPending && isCarPending(task.pendingQuestion)) next = { ...next, pendingQuestion: task.pendingQuestion };
  let text = reply.trim();
  if (built && plan) {
    text = planBlurb(plan, stance);
  } else {
    const unpublished = plan?.days.some((day) => day.items.some((item) => item.kind === "transport" && !item.start));
    if (unpublished && !/publish/i.test(text) && !/\b(?:day|dia|jour)\s+\d/i.test(text)) {
      const extra = next.locale === "pt" ? "O horário não está publicado, por isso o plano não marca uma hora."
        : next.locale === "fr" ? "L'horaire n'est pas publié, donc le plan ne fixe pas d'heure."
        : "The timetable has no published time, so the plan does not set one.";
      text = `${text} ${extra}`.trim();
    }
    text = publicPlanReply(text, next.locale, null, stance);
  }
  if (!preservePlaces) {
    const found = presentedPlaces(text, next.locale);
    // A list, a recommendation or a side answer replaces the previous list. One incidental name does not.
    if (found.length >= 2) next = { ...next, lastPlaces: found };
  }
  if (intent === "side_question") next = { ...task, lastToolFacts: next.lastToolFacts };
  if (plan && !next.completed.includes("itinerary")) next = refreshTask({ ...next, completed: [...next.completed, "itinerary"] });
  const carChips = isCarPending(next.pendingQuestion) ? CAR_CHIPS[next.locale] : null;
  const chips = (carChips ?? chipsOverride ?? followUpChips(next)).slice(0, 3);
  const ferryRan = toolEvents.some((event) => event.name === "get_transport");
  const forecastRan = toolEvents.some((event) => event.name === "get_sea_forecast" || event.name === "propose_itinerary");
  const shown: TurnWork = work === "ferries" || (ferryRan && !forecastRan) ? "ferries" : forecastRan ? "forecast" : work === "forecast" ? "moment" : work;
  return { reply: text, plan, toolEvents, task: next, chips, intent, status: loadingStatus(next.locale, shown) };
}

function includeFromConstraints(task: Task, utterance: string): string[] {
  const remembered = (task.constraints.interests ?? []).filter((id) => experience(id));
  return [...new Set([...remembered, ...experienceIdsMentioned(utterance)])];
}

/** The signed task, not the previous day's stops and not a model patch. */
function requestFromTask(task: Task, today: string): Record<string, unknown> {
  const c = task.constraints;
  const interests = (c.interests ?? []).filter((item): item is "beach" | "sea" | "nature" | "culture" | "food" | "adventure" | "walking" => (
    item === "beach" || item === "sea" || item === "nature" || item === "culture" || item === "food" || item === "adventure" || item === "walking"
  ));
  return {
    startDate: c.dates?.start ?? addDays(today, 1),
    days: c.dates?.days ?? 3,
    locale: task.locale,
    adults: c.party?.adults ?? 2,
    kids: c.party?.kids ?? 0,
    ...(c.party?.youngestAge !== undefined ? { youngestAge: c.party.youngestAge } : {}),
    hasCar: c.car ?? false,
    boatTrips: c.boatTrips ?? 0,
    drinks: !c.quietEvenings,
    ...(c.pace ? { pace: c.pace } : {}),
    ...(c.diet ? { diet: c.diet } : {}),
    ...(c.budget ? { budget: c.budget } : {}),
    ...(interests.length ? { interests } : {}),
    ...(c.arrival ? { arrival: { mode: c.arrival.mode, dayIndex: 0, ...(c.arrival.time ? { time: c.arrival.time } : {}) } } : {}),
    ...(c.departure ? { departure: { mode: c.departure.mode, ...(c.departure.time ? { time: c.departure.time } : {}) } } : {}),
    include: [],
    exclude: [],
    unmet: [],
  };
}

/** Drop a clock the model wrote. A time stays only when the guest said it; the timetable fills the rest. */
function guestClocksOnly(request: Record<string, unknown>, task: Task): Record<string, unknown> {
  const next = { ...request };
  const arrival = task.constraints.arrival;
  const departure = task.constraints.departure;
  if (arrival) next.arrival = { mode: arrival.mode, dayIndex: 0, ...(arrival.time ? { time: arrival.time } : {}) };
  else delete next.arrival;
  if (departure) next.departure = { mode: departure.mode, ...(departure.time ? { time: departure.time } : {}) };
  else delete next.departure;
  return next;
}

function say(locale: TaskLocale, en: string, pt: string, fr: string): string {
  return locale === "pt" ? pt : locale === "fr" ? fr : en;
}

function hospitalReply(locale: TaskLocale): string {
  const hospital = EMERGENCY.find((item) => item.id === "hospital")!;
  const verified = verifiedDate(EMERGENCY_VERIFIED_AT, locale);
  return say(locale,
    `Hospital do Maio: ${hospital.number}. Verified ${verified}.`,
    `Hospital do Maio: ${hospital.number}. Confirmado em ${verified}.`,
    `Hôpital de Maio : ${hospital.number}. Vérifié le ${verified}.`);
}

function namedRestaurants(): string[] {
  return FOOD.filter((item) => venueType(item) === "restaurant").slice(0, 3).map((item) => item.title);
}

export async function runPlanAgent(messages: ModelMessage[], current: TripPlan | null, deps: PlanDeps, taskInput?: Task | null): Promise<PlanAgentResult> {
  const toolFacts: string[] = [];
  deps = { ...deps, fetchImpl: observeFetch(deps.fetchImpl, toolFacts) };
  const now = deps.now ?? new Date();
  const today = maioClock(now).date;
  const history = turns(messages);
  const lastUser = [...history].reverse().find((message) => message.role === "user")?.content ?? "";
  const seeded = taskInput ?? seedTask(current, "en");
  const classification = classify(lastUser, seeded, { today });
  let task = applyClassification(seeded, classification);
  const windowed = prepareContext(task, history);
  const spoken = normalizeUtterance(lastUser);
  let appliedEdit: string | null = null;

  const finish = (reply: string, plan: TripPlan | null, toolEvents: ToolEvent[] = [], next = task, chips?: string[], preservePlaces = false, keepPending = false, built = false, work?: TurnWork) => {
    const changed = Boolean(plan && !samePlanShape(plan, current));
    let text = reply;
    if (!changed && (claimsUnappliedEdit(text) || /Tap the card|Toque no cartão|Touchez la carte/i.test(text))) {
      const edit = current ? parseEditIntent(lastUser, current, today) : null;
      const editing = edit && edit.kind !== "other" && edit.kind !== "greeting" && edit.kind !== "question";
      if (editing && current) {
        const day = edit.kind === "relax_day" || edit.kind === "busier_day" ? resolveDayRef(edit.day, current, today, lastUser) : null;
        text = day === "ambiguous"
          ? whichDayQuestion(current, task.locale)
          : sayRouter(task.locale, "The trip already matches that.", "A viagem já está assim.", "Le voyage est déjà comme ça.");
      } else {
        text = hasDateIntent(lastUser)
          ? sayRouter(task.locale, "Which day should the trip start?", "Para que dia mudo a viagem?", "Quel jour pour le début du voyage ?")
          : sayRouter(task.locale, "I didn't change the plan.", "Não alterei o plano.", "Je n'ai pas modifié le plan.");
      }
    }
    const returned = changed ? plan : current && plan && samePlanShape(plan, current) ? current : plan;
    const out = result(next, text, returned, toolEvents, classification.intent, chips, preservePlaces, keepPending, classification.carStance, built && changed, work ?? turnWork(lastUser, seeded, today));
    safeReplyHook(deps.onReply, {
      userMessage: lastUser,
      previousTurns: history.slice(0, -1).slice(-4),
      reply: out.reply,
      planBefore: current,
      planAfter: out.plan,
      chips: out.chips,
      intent: out.intent,
      locale: out.task.locale,
      planTurn: (classification.planShaping === true && classification.intent !== "side_question" && !classification.smallTalk) || changed,
      toolFacts: toolFacts.join("\n").slice(0, 8000),
      appliedEdit,
    });
    return out;
  };

  const askedExperiences = () => new Set(includeFromConstraints(task, lastUser));
  const composeRequest = (modelInput: Record<string, unknown> | null): Record<string, unknown> => {
    const correction = classification.intent === "correction";
    let merged = correction || !modelInput ? requestFromTask(task, today) : overlayRequest(modelInput, task);
    if (!task.constraints.dates?.start) merged = { ...merged, startDate: addDays(today, 1) };
    merged = guestClocksOnly(merged, task);
    const asked = askedExperiences();
    let include = Array.isArray(merged.include) ? merged.include.filter((id): id is string => typeof id === "string") : [];
    const exclude = new Set(Array.isArray(merged.exclude) ? merged.exclude.filter((id): id is string => typeof id === "string") : []);
    if (correction) include = [...asked];
    include = include.filter((id) => {
      const exp = experience(id);
      return !exp || !isAdrenalineExperience(exp) || asked.has(id);
    });
    for (const id of asked) if (!include.includes(id)) include.push(id);
    for (const exp of EXPERIENCES) if (isAdrenalineExperience(exp) && !asked.has(exp.id)) exclude.add(exp.id);
    return { ...merged, include, exclude: [...exclude], pace: task.constraints.pace === "packed" ? "normal" : "slow" };
  };

  if (classification.smallTalk) {
    return finish(smallTalkReply(task.locale, spoken, current), current, [], task, undefined, false, false, false, "thinking");
  }

  if (classification.chip) {
    const locale = task.locale;
    if (!current) return finish(noTripReply(locale), null, [], task, [], true, false, false, classification.chip.kind === "pdf" ? "none" : "moment");
    if (classification.chip.kind === "pdf") {
      const next = refreshTask({ ...task, completed: [...task.completed, "pdf"] });
      return finish(pdfReply(locale), current, [], next, undefined, true, false, false, "none");
    }
    if (classification.chip.kind === "relax") {
      const edited = relaxDay(current, classification.chip.day, locale);
      if (!edited) return finish(noTripReply(locale), current, [], task, [], true, false, false, "moment");
      const next = refreshTask({ ...task, completed: [...task.completed, `relax-day-${classification.chip.day}`] });
      return finish(edited.reply, edited.plan, [], next, undefined, true, false, false, "moment");
    }
    const edited = addBoatTrip(current, locale);
    const tag = edited.added ? "boat" : "boat-skipped";
    const constraints = edited.added ? mergeConstraints(task.constraints, { boatTrips: 1, interests: ["boat"] }) : task.constraints;
    const next = refreshTask({ ...task, constraints, completed: [...task.completed, tag] });
    return finish(edited.reply, edited.plan, [], next, undefined, true, false, false, "moment");
  }

  const listedStop = listedStopTarget(spoken, task.lastPlaces);
  if (current && listedStop) {
    const edited = addListedStop(current, listedStop.day, listedStop.place, task.locale);
    return finish(edited.reply, edited.plan, [], task, undefined, true, false, false, "moment");
  }

  if (current && answerAboutPlan(current, lastUser)) {
    return finish(answerAboutPlan(current, lastUser)!, current, [], task, undefined, true);
  }

  if (classification.cancelOnly) {
    return finish(say(task.locale, "Okay. We'll leave that.", "Está bem. Deixamos isso.", "D'accord. On laisse ça."), current);
  }

  if (classification.intent === "new_objective" && classification.research) {
    return finish(say(task.locale,
      "I don't have a published guest-count figure in this planner, so I won't guess one. The previous trip is set aside.",
      "Não tenho um número publicado de hóspedes neste planeador, por isso não vou inventar. A viagem anterior ficou de lado.",
      "Je n'ai pas de chiffre publié de visiteurs dans ce planificateur, donc je n'en invente pas. Le voyage précédent est mis de côté."), null);
  }

  if (classification.intent === "side_question" && /\b(hospital|hospit|hopital|emergenc|urgencia|urgence)\b/.test(spoken)) {
    task = rememberFact(task, { name: "emergency", retrievedAt: EMERGENCY_VERIFIED_AT, value: "+238 255 11 30" });
    return finish(hospitalReply(task.locale), current, [{ name: "emergency", ok: true }]);
  }

  const noteTransport = (retrievedAt: string, value: string) => {
    const pinned = task;
    task = rememberFact(pinned, { name: "get_transport", retrievedAt, value: value.slice(0, 240) });
    task = { ...pinned, lastToolFacts: task.lastToolFacts };
  };

  const specificFerry = /\b(is there a ferry|ha barco|y a-t-il un ferry|ferry timetable|horario do barco|horaire du ferry)\b/.test(spoken);
  if (classification.intent === "side_question" && isTravelLookup(lastUser) && !specificFerry) {
    const table = await loadTimetable(deps.fetchImpl, now);
    noteTransport(table.retrievedAt, table.ok ? transportFact(table, today, lastUser) : "unavailable");
    return finish(answerTravelQuestion(lastUser, task.locale, table, today), current, [{ name: "get_transport", ok: table.ok }], task, undefined, true, false, false, "ferries");
  }

  if (classification.intent === "side_question" && /\b(in the air|flight status|estado do voo|praia flight)\b/.test(spoken)) {
    const flight = await loadFlightSchedule(deps.fetchImpl, now);
    noteTransport(flight.retrievedAt, `status ${flight.status}`.slice(0, 240));
    const reply = say(task.locale,
      `The published flight timetable is ${flight.status}, retrieved ${flight.retrievedAt}. That is not live status. No current rows does not mean there is no flight.`,
      `O horário de voos publicado está ${flight.status}, obtido em ${flight.retrievedAt}. Não é um estado ao vivo. Sem registos atuais não quer dizer que não haja voo.`,
      `L'horaire des vols publié est ${flight.status}, récupéré le ${flight.retrievedAt}. Ce n'est pas un statut en direct. Aucune ligne actuelle ne veut pas dire qu'il n'y a pas de vol.`);
    return finish(reply, current, [{ name: "get_transport", ok: true }], task, undefined, true, false, false, "ferries");
  }

  if (classification.intent === "side_question" && /\b(is there a ferry|ha barco|y a-t-il un ferry|ferry timetable|horario do barco|horaire du ferry)\b/.test(spoken)) {
    const boats = await loadBoatSchedule(deps.fetchImpl, now);
    const date = extractConstraints(lastUser, today).dates?.start;
    const rows = (boats.data ?? []).filter((row) => !date || row.date === date);
    noteTransport(boats.retrievedAt, rows.length ? encodeTransportFact(rows.slice(0, 3).map((row) => ({ kind: /maio/i.test(row.to) && !/maio/i.test(row.from) ? "in" as const : "out" as const, date: row.date, time: row.departure, from: row.from, to: row.to }))) : "none");
    const reply = rows.length
      ? say(task.locale,
        `Published sailing: ${rows.map((row) => `${row.departure} ${row.from} to ${row.to}`).join(", ")}. Retrieved ${boats.retrievedAt}. Not live status.`,
        `Saída publicada: ${rows.map((row) => `${row.departure} ${row.from} para ${row.to}`).join(", ")}. Obtido em ${boats.retrievedAt}. Não é estado ao vivo.`,
        `Traversée publiée : ${rows.map((row) => `${row.departure} ${row.from} vers ${row.to}`).join(", ")}. Récupéré le ${boats.retrievedAt}. Pas un statut en direct.`)
      : say(task.locale,
        `No sailing is published (retrieved ${boats.retrievedAt}). That is not the same as no service, and it is not live status.`,
        `Não há saída publicada (obtido em ${boats.retrievedAt}). Isso não é o mesmo que não haver serviço, nem é estado ao vivo.`,
        `Aucune traversée publiée (récupéré le ${boats.retrievedAt}). Ce n'est pas la même chose qu'une absence de service, ni un statut en direct.`);
    return finish(reply, current, [{ name: "get_transport", ok: true }], task, undefined, true, false, false, "ferries");
  }

  if (classification.reference.kind === "directions") {
    const to = classification.reference.to;
    const from = classification.reference.from;
    if (!to?.lat || !from?.lat) {
      return finish(say(task.locale, "I don't have both places in the Visit Maio list, so I won't guess a route.", "Não tenho os dois lugares na lista Visit Maio, por isso não invento um caminho.", "Je n'ai pas les deux lieux dans la liste Visit Maio, donc je n'invente pas d'itinéraire."), current);
    }
    task = rememberFact(task, { name: "places", retrievedAt: today, value: `${from.name} ${from.lat},${from.lon}; ${to.name} ${to.lat},${to.lon}` });
    return finish(say(task.locale,
      `${from.name} is at ${from.lat}, ${from.lon}. ${to.name} is at ${to.lat}, ${to.lon}. I don't have a walking time.`,
      `${from.name} fica em ${from.lat}, ${from.lon}. ${to.name} fica em ${to.lat}, ${to.lon}. Não tenho um tempo a pé.`,
      `${from.name} est à ${from.lat}, ${from.lon}. ${to.name} est à ${to.lat}, ${to.lon}. Je n'ai pas de temps de marche.`), current);
  }

  if (classification.reference.kind === "around-there" && /\b(eat|food|lunch|restaurant|comer|almoco|manger|dejeuner)\b/.test(spoken)) {
    const anchor = classification.reference.place;
    const nearby = anchor ? foodNear(anchor) : [];
    task = anchor ? { ...task, lastPlaces: [...task.lastPlaces.filter((item) => item.id !== anchor.id), anchor].slice(-8) } : task;
    const reply = nearby.length
      ? say(task.locale, `Near there, Visit Maio lists ${nearby.map((item) => item.name).join(", ")}.`, `Perto, o Visit Maio lista ${nearby.map((item) => item.name).join(", ")}.`, `Tout près, Visit Maio liste ${nearby.map((item) => item.name).join(", ")}.`)
      : say(task.locale, "I don't have a food listing there, and I won't substitute a place from another town.", "Não tenho um restaurante listado aí e não vou trocar por um de outra vila.", "Je n'ai pas de restaurant listé là-bas et je ne le remplace pas par un autre village.");
    return finish(reply, current);
  }

  const dayEdit = current ? localEditIntent(lastUser, current, today) : null;
  if ((classification.reference.kind === "ordinal" || classification.reference.kind === "that-one") && classification.reference.place && !classification.planShaping && !dayEdit) {
    const hit = classification.reference.place;
    return finish(say(task.locale, `That is ${hit.name}.`, `É ${hit.name}.`, `C'est ${hit.name}.`), current, [], task, undefined, true);
  }

  if (isCarRentalQuestion(lastUser) && !classification.planShaping) {
    const catalog = await loadBusinesses(deps.fetchImpl);
    const found = catalog.source === "api" ? carRentalRecords(catalog.records) : [];
    const listed = found.map((item) => item.phone ? `${item.name}, ${item.phone}` : item.name).join("; ");
    const reply = found.length
      ? say(task.locale,
        `Car rental: ${listed}.`,
        `Aluguer de carro: ${listed}.`,
        `Location de voiture : ${listed}.`)
      : say(task.locale,
        "The Maio business list has no car-rental listing, so I won't invent a company or a number. Ask your guesthouse who they use.",
        "A lista de negócios do Maio não tem aluguer de carros, por isso não invento uma empresa nem um número. Pergunte na pousada a quem recorrem.",
        "La liste des commerces de Maio n'a pas de location de voiture, donc je n'invente ni enseigne ni numéro. Demandez à votre hébergement qui ils utilisent.");
    const next = refreshTask({ ...task, completed: [...task.completed, "asked-rental"] });
    return finish(reply, current, [{ name: "maio-businesses", ok: catalog.source === "api" }], next);
  }

  if (isBusinessLookup(lastUser) && !classification.planShaping) {
    const catalog = await loadBusinesses(deps.fetchImpl);
    const pharmacy = /\b(?:pharmacy|pharmacies|farmacia|pharmacie)\b/.test(spoken);
    if (pharmacy) {
      const found = pharmacyRecords(catalog.records);
      const listed = found.map((item) => item.phone ? `${item.name}, ${item.phone}` : item.name).join("; ");
      const reply = found.length
        ? say(task.locale, `Pharmacy: ${listed}.`, `Farmácia: ${listed}.`, `Pharmacie : ${listed}.`)
        : say(task.locale,
          `No pharmacy is in the Maio business list. For urgent care, Hospital do Maio is ${EMERGENCY.find((item) => item.id === "hospital")!.number}.`,
          `Não há farmácia na lista de negócios do Maio. Para urgências, o Hospital do Maio é ${EMERGENCY.find((item) => item.id === "hospital")!.number}.`,
          `Pas de pharmacie dans la liste des commerces de Maio. Pour les urgences, l'hôpital de Maio est le ${EMERGENCY.find((item) => item.id === "hospital")!.number}.`);
      return finish(reply, current, [{ name: "maio-businesses", ok: catalog.source === "api" }]);
    }
    const name = lastUser.split(/\b(?:for|do|de|da|du|pour)\b/i).pop()?.replace(/\b(?:phone|number|numero|telefone|telephone|the|a|o|um|uma|le|la)\b/gi, " ").replace(/[?!.]/g, "").trim() ?? "";
    const hit = searchBusinesses(catalog.records, name)[0];
    const reply = !hit
      ? say(task.locale, "I don't have that business on the Maio list, so I won't invent a number.", "Não tenho esse negócio na lista do Maio, por isso não invento um número.", "Je n'ai pas ce commerce dans la liste de Maio, donc je n'invente pas de numéro.")
      : hit.phone
        ? say(task.locale, `${hit.name}: ${hit.phone}.`, `${hit.name}: ${hit.phone}.`, `${hit.name} : ${hit.phone}.`)
        : say(task.locale, `${hit.name} is listed. No phone number is published.`, `${hit.name} está na lista. Não há telefone publicado.`, `${hit.name} est dans la liste. Aucun numéro n'est publié.`);
    return finish(reply, current, [{ name: "maio-businesses", ok: catalog.source === "api" }]);
  }

  if (classification.intent === "side_question" && !classification.planShaping) {
    const listed = answerPlaceList(lastUser, task.locale);
    if (listed) return finish(listed.reply, current, [], { ...task, lastPlaces: listed.places }, undefined);
    const grounded = answerIslandQuestion(lastUser, task.locale);
    if (grounded) return finish(grounded, current, [], task, undefined);
  }

  if ((classification.patch.diet || classification.patch.budget) && !classification.planShaping && classification.intent !== "side_question") {
    const names = namedRestaurants().join(", ");
    const reply = task.constraints.diet
      ? say(task.locale,
        `Visit Maio listings don't record diet, so I can't say which lunch is ${task.constraints.diet}. Places we list include ${names}. I am not describing their menus.`,
        `As listas do Visit Maio não têm dieta, por isso não digo qual almoço é ${task.constraints.diet}. Os sítios listados incluem ${names}. Não estou a descrever os menus.`,
        `Les listes Visit Maio n'indiquent pas de régime, donc je ne dis pas quel déjeuner est ${task.constraints.diet}. Les adresses listées comprennent ${names}. Je ne décris pas leurs menus.`)
      : say(task.locale,
        "I don't have prices. You arrange that with the place. I won't invent an amount.",
        "Não tenho preços. Combinam isso com o sítio. Não vou inventar um valor.",
        "Je n'ai pas de prix. Vous voyez ça avec l'adresse. Je n'invente pas de montant.");
    return finish(reply, current);
  }

  const dateShift = dayEdit ? null : parseDateShift(lastUser, today, task.constraints.dates?.start ?? current?.days[0]?.date);
  if (dateShift === "ask" && (current || task.constraints.dates?.start)) {
    return finish(say(task.locale, "Which day should the trip start?", "Para que dia mudo a viagem?", "Quel jour pour le début du voyage ?"), current);
  }
  if (dateShift && dateShift !== "ask" && !parseLengthEdit(lastUser)) {
    const baseStart = task.constraints.dates?.start ?? current?.days[0]?.date;
    const baseDays = task.constraints.dates?.days ?? current?.days.length;
    if (baseStart && baseDays) {
      const span = applyDateShift(baseStart, baseDays, dateShift);
      if (span) task = refreshTask({ ...task, constraints: mergeConstraints(task.constraints, { dates: { start: span.start, days: span.days } }) });
    }
  }

  const lengthEdit = parseLengthEdit(lastUser);
  if (lengthEdit) {
    const baseStart = task.constraints.dates?.start ?? current?.days[0]?.date;
    const baseDays = task.constraints.dates?.days ?? current?.days.length;
    if (baseStart && baseDays) {
      const span = applyLength(baseStart, baseDays, lengthEdit);
      task = refreshTask({ ...task, constraints: mergeConstraints(task.constraints, { dates: { start: span.start, days: span.days } }) });
    }
  }

  const planning = (classification.planShaping || Boolean((lengthEdit || (dateShift && dateShift !== "ask")) && task.constraints.dates?.start))
    && classification.intent !== "side_question"
    && !classification.smallTalk
    && !classification.cancelOnly
    && !classification.research;
  if (planning && typeof task.constraints.car !== "boolean") {
    const q = CAR_QUESTION[task.locale];
    const again = isCarPending(seeded.pendingQuestion) || isCarPending(task.pendingQuestion);
    const reply = again ? say(task.locale, "Noted.", "Anotado.", "Noté.") : q;
    return finish(reply, current, [], { ...task, pendingQuestion: q }, [...CAR_CHIPS[task.locale]], false, true);
  }

  const forecastCache = new Map<string, Promise<DailySea[]>>();
  const forecast = (start: string, days: number) => {
    const key = `${start}:${days}`;
    if (!forecastCache.has(key)) forecastCache.set(key, loadDailyForecast(deps.fetchImpl, start, days).catch(() => []));
    return forecastCache.get(key)!;
  };
  let plan: TripPlan | null = current;
  let builtRequest: TripRequest | null = null;
  const toolEvents: ToolEvent[] = [];

  async function rebuildPlan(nextTask: Task): Promise<{ plan: TripPlan; task: Task; events: ToolEvent[] } | null> {
    try {
      const base = requestFromTask(nextTask, today);
      const table = await loadTimetable(deps.fetchImpl, now);
      const withTravel = attachPublishedTravel(base, table);
      const built = annotateMissingTravel(buildPlan({
        request: withTravel as z.input<typeof TripRequestSchema>,
        forecast: await forecast(String(withTravel.startDate), Number(withTravel.days)),
        sailings: table.sailings,
        forecastSource: forecastSourceName,
      }), table);
      const request = TripRequestSchema.parse(withTravel);
      return {
        plan: built,
        task: syncTask(nextTask, request, built),
        events: [{ name: "get_transport", ok: table.ok }, { name: "propose_itinerary", ok: true, arguments: withTravel }],
      };
    } catch {
      return null;
    }
  }

  async function commitOpenEdit(intent: EditIntent): Promise<{ reply: string; plan: TripPlan; events: ToolEvent[]; task: Task; work: TurnWork } | null> {
    if (!current) return null;
    const open = current;
    const locale = task.locale;
    const askStart = () => say(locale, "Which day should the trip start?", "Para que dia mudo a viagem?", "Quel jour pour le début du voyage ?");
    if (intent.kind === "relax_day" || intent.kind === "busier_day") {
      const day = resolveDayRef(intent.day, open, today, lastUser);
      if (day === "ambiguous") return { reply: whichDayQuestion(open, locale), plan: open, events: [], task, work: "moment" };
      const edited = intent.kind === "relax_day" ? relaxDay(open, day, locale) : busyDay(open, day, locale);
      if (!edited) return { reply: whichDayQuestion(open, locale), plan: open, events: [], task, work: "moment" };
      const tag = intent.kind === "relax_day" ? `relax-day-${day}` : `busy-day-${day}`;
      const next = refreshTask({ ...task, completed: [...task.completed, tag] });
      return { reply: edited.reply, plan: edited.plan, events: [], task: next, work: "moment" };
    }
    if (intent.kind === "set_party") {
      const party = {
        ...(intent.adults !== undefined ? { adults: intent.adults } : {}),
        ...(intent.kids !== undefined ? { kids: intent.kids } : {}),
        ...(intent.youngestAge !== undefined ? { youngestAge: intent.youngestAge } : {}),
      };
      const nextTask = refreshTask({ ...task, constraints: mergeConstraints(task.constraints, { party }) });
      const prior = { adults: open.party.adults, kids: open.party.kids, ...(open.party.youngestAge !== undefined ? { youngestAge: open.party.youngestAge } : {}) };
      const baselineTask = refreshTask({ ...nextTask, constraints: { ...nextTask.constraints, party: prior } });
      const [baseline, rebuilt] = await Promise.all([rebuildPlan(baselineTask), rebuildPlan(nextTask)]);
      if (!rebuilt) return { reply: say(locale, "I couldn't update the party.", "Não consegui atualizar o grupo.", "Je n'ai pas pu mettre le groupe à jour."), plan: open, events: [], task: nextTask, work: "moment" };
      const baby = /\b(?:baby|bebe)\b/.test(spoken);
      const stopsChanged = Boolean(baseline && itinerarySig(baseline.plan) !== itinerarySig(rebuilt.plan));
      const reply = partyEditReply(locale, rebuilt.plan.party, stopsChanged, baby);
      return { reply, plan: rebuilt.plan, events: rebuilt.events, task: rebuilt.task, work: "forecast" };
    }
    if (intent.kind === "add_activity" && /boat|barco|bateau/i.test(`${intent.activity ?? ""} ${lastUser}`)) {
      const edited = addBoatTrip(open, locale);
      const next = refreshTask({
        ...task,
        constraints: edited.added ? mergeConstraints(task.constraints, { boatTrips: 1, interests: ["boat"] }) : task.constraints,
        completed: [...task.completed, edited.added ? "boat" : "boat-skipped"],
      });
      return { reply: edited.reply, plan: edited.plan, events: [], task: next, work: "moment" };
    }
    if (intent.kind === "set_dates" || intent.kind === "shift_dates" || intent.kind === "add_day" || intent.kind === "remove_day") {
      let span: { start: string; days: number } | null = null;
      if (intent.kind === "add_day") span = applyLength(open.days[0].date, open.days.length, { kind: "add", n: intent.days ?? 1, where: intent.where ?? "end" });
      else if (intent.kind === "remove_day") span = applyLength(open.days[0].date, open.days.length, { kind: "drop-last" });
      else {
        const shift = shiftFromIntent(intent);
        if (!shift || shift === "ask") return { reply: askStart(), plan: open, events: [], task, work: "moment" };
        span = applyDateShift(open.days[0].date, open.days.length, shift);
      }
      if (!span) return { reply: askStart(), plan: open, events: [], task, work: "moment" };
      const nextTask = refreshTask({ ...task, constraints: mergeConstraints(task.constraints, { dates: { start: span.start, days: span.days } }) });
      const rebuilt = await rebuildPlan(nextTask);
      if (!rebuilt) return { reply: askStart(), plan: open, events: [], task, work: "moment" };
      const reply = (intent.kind === "add_day" || intent.kind === "remove_day"
        ? lengthDiffReply(open, rebuilt.plan, locale)
        : shiftDiffReply(open, rebuilt.plan, locale)) ?? lengthUnchangedReply(open, locale);
      return { reply, plan: rebuilt.plan, events: rebuilt.events, task: rebuilt.task, work: "forecast" };
    }
    if (intent.kind === "set_car" && typeof intent.car === "boolean") {
      const nextTask = refreshTask({ ...task, constraints: mergeConstraints(task.constraints, { car: intent.car }) });
      const rebuilt = await rebuildPlan(nextTask);
      if (!rebuilt) return null;
      const reply = rebuilt.plan.hasCar === open.hasCar
        ? say(locale, open.hasCar ? "The trip already has a car." : "The trip is already without a car.", open.hasCar ? "A viagem já tem carro." : "A viagem já é sem carro.", open.hasCar ? "Le voyage a déjà une voiture." : "Le voyage est déjà sans voiture.")
        : say(locale, rebuilt.plan.hasCar ? "Updated: with a car." : "Updated: no car.", rebuilt.plan.hasCar ? "Atualizado: de carro." : "Atualizado: sem carro.", rebuilt.plan.hasCar ? "Mis à jour : avec une voiture." : "Mis à jour : sans voiture.");
      return { reply, plan: rebuilt.plan, events: rebuilt.events, task: rebuilt.task, work: "forecast" };
    }
    if (intent.kind === "set_pace" && intent.pace) {
      const nextTask = refreshTask({ ...task, constraints: mergeConstraints(task.constraints, { pace: intent.pace }) });
      const rebuilt = await rebuildPlan(nextTask);
      if (!rebuilt) return null;
      const reply = say(locale,
        intent.pace === "packed" ? "The days are fuller now." : "The days are slower now.",
        intent.pace === "packed" ? "Os dias ficaram mais cheios." : "Os dias ficaram mais calmos.",
        intent.pace === "packed" ? "Les jours sont plus chargés." : "Les jours sont plus calmes.");
      return { reply, plan: rebuilt.plan, events: rebuilt.events, task: rebuilt.task, work: "forecast" };
    }
    if (intent.kind === "remove_stop" && intent.stop === "boat") {
      const edited = dropBoatTrip(open, locale);
      const next = refreshTask({ ...task, constraints: mergeConstraints(task.constraints, { boatTrips: 0 }), completed: [...task.completed, edited.removed ? "boat-removed" : "boat-absent"] });
      return { reply: edited.reply, plan: edited.plan, events: [], task: next, work: "moment" };
    }
    if ((intent.kind === "remove_stop" || intent.kind === "swap_stop") && intent.stop) {
      const day = resolveDayRef(intent.day, open, today, lastUser);
      if (day === "ambiguous") return { reply: whichDayQuestion(open, locale), plan: open, events: [], task, work: "moment" };
      const index = day - 1;
      const host = open.days[index];
      if (!host) return { reply: whichDayQuestion(open, locale), plan: open, events: [], task, work: "moment" };
      const named = (item: typeof host.items[number], name: string) => normalizeUtterance(itemLabel(item, locale)).includes(normalizeUtterance(name));
      if (intent.kind === "remove_stop") {
        const items = host.items.filter((item) => !named(item, intent.stop!));
        if (items.length === host.items.length) {
          return { reply: say(locale, "That stop isn't on that day.", "Essa paragem não está nesse dia.", "Cet arrêt n'est pas ce jour-là."), plan: open, events: [], task, work: "moment" };
        }
        const when = humanPlanDate(host.date, locale);
        const plan = { ...open, days: open.days.map((item, i) => i === index ? { ...host, items } : item) };
        return { reply: say(locale, `Removed ${intent.stop} from ${when}.`, `Tirei ${intent.stop} de ${when}.`, `J'ai retiré ${intent.stop} du ${when}.`), plan, events: [], task, work: "moment" };
      }
      const items = host.items.map((item) => ({ ...item }));
      const a = items.findIndex((item) => named(item, intent.stop!));
      const b = intent.swapWith ? items.findIndex((item) => named(item, intent.swapWith!)) : -1;
      if (a < 0 || b < 0 || a === b) {
        return { reply: say(locale, "I couldn't find both stops on that day.", "Não encontrei as duas paragens nesse dia.", "Je n'ai pas trouvé les deux arrêts ce jour-là."), plan: open, events: [], task, work: "moment" };
      }
      const startA = items[a].start;
      const slotA = items[a].slot;
      items[a] = { ...items[a], start: items[b].start, slot: items[b].slot };
      items[b] = { ...items[b], start: startA, slot: slotA };
      const plan = { ...open, days: open.days.map((item, i) => i === index ? { ...host, items } : item) };
      return { reply: say(locale, `Swapped ${intent.stop} and ${intent.swapWith}.`, `Troquei ${intent.stop} e ${intent.swapWith}.`, `J'ai échangé ${intent.stop} et ${intent.swapWith}.`), plan, events: [], task, work: "moment" };
    }
    return null;
  }

  if (current && typeof task.constraints.car === "boolean" && !dateShift && !lengthEdit) {
    let intent: EditIntent | null = dayEdit;
    if (!intent && gatewayReady() && /\b(?:day|dia|jour|pack|relax|easier|quiet|slow|calm|cheio|calmo|calme)\b/i.test(lastUser)) {
      try {
        const fromModel = await intentFromModel(lastUser, current, today);
        if (fromModel && fromModel.kind !== "other" && fromModel.kind !== "greeting" && fromModel.kind !== "question") intent = fromModel;
      } catch { /* timeout or gateway miss: the regex path already ran */ }
    }
    if (intent) {
      appliedEdit = intent.kind === "remove_stop" && intent.stop === "boat" ? "drop_boat" : intent.kind;
      const outcome = await commitOpenEdit(intent);
      if (outcome) return finish(outcome.reply, outcome.plan, outcome.events, outcome.task, undefined, true, false, false, outcome.work);
    }
  }

  if (dateShift && dateShift !== "ask" && !lengthEdit && current && typeof task.constraints.car === "boolean") {
    const rebuilt = await rebuildPlan(task);
    if (!rebuilt || samePlanShape(rebuilt.plan, current)) {
      return finish(say(task.locale, "Which day should the trip start?", "Para que dia mudo a viagem?", "Quel jour pour le début du voyage ?"), current);
    }
    const reply = shiftDiffReply(current, rebuilt.plan, task.locale);
    if (!reply) return finish(say(task.locale, "Which day should the trip start?", "Para que dia mudo a viagem?", "Quel jour pour le début du voyage ?"), current);
    return finish(reply, rebuilt.plan, rebuilt.events, rebuilt.task, undefined, true, false, false, "forecast");
  }

  if (lengthEdit && current && typeof task.constraints.car === "boolean") {
    const rebuilt = await rebuildPlan(task);
    if (!rebuilt) return finish(say(task.locale, "Which day should the trip start?", "Para que dia mudo a viagem?", "Quel jour pour le début du voyage ?"), current);
    const reply = lengthDiffReply(current, rebuilt.plan, task.locale) ?? lengthUnchangedReply(current, task.locale);
    return finish(reply, rebuilt.plan, rebuilt.events, rebuilt.task, undefined, true, false, false, "forecast");
  }

  if (!classification.planShaping && /\b(?:weather|forecast|wave|waves|previsao do mar|meteo|houle|sea state)\b/.test(spoken) && !/\b(?:days?|dias?|jours?)\b/.test(spoken)) {
    const rows = await loadDailyForecast(deps.fetchImpl, today, 2).catch(() => []);
    const first = rows.find((row) => row.waveHeightM != null || row.tempMaxC != null);
    const reply = first
      ? say(task.locale,
        `Sea forecast for ${first.date}: ${first.waveHeightM ?? "unknown"} m waves, ${first.tempMaxC ?? "unknown"}°C. That's a forecast, not a live reading.`,
        `Previsão do mar para ${first.date}: ondas de ${first.waveHeightM ?? "sem número"} m, ${first.tempMaxC ?? "sem número"}°C. É previsão, não uma leitura ao vivo.`,
        `Prévision marine pour le ${first.date} : vagues ${first.waveHeightM ?? "inconnues"} m, ${first.tempMaxC ?? "inconnue"}°C. C'est une prévision, pas une mesure en direct.`)
      : say(task.locale,
        "I don't have a sea forecast for that day, so I won't guess the waves.",
        "Não tenho previsão do mar para esse dia, por isso não vou adivinhar as ondas.",
        "Je n'ai pas de prévision marine pour ce jour, donc je ne devine pas les vagues.");
    return finish(reply, current, [{ name: "get_sea_forecast", ok: Boolean(first) }], task, undefined, true, false, false, "forecast");
  }

  if (current && typeof task.constraints.car === "boolean" && isTravelChoice(lastUser)) {
    const time = lastUser.match(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/);
    const clock = time ? `${time[1].padStart(2, "0")}:${time[2]}` : task.constraints.departure?.time ?? task.constraints.arrival?.time;
    if (clock) {
      appliedEdit = "set_departure";
      const rebuilt = await rebuildPlan(task);
      if (rebuilt) {
        const reply = say(task.locale, `The last day now leaves at ${clock}.`, `O último dia passa a sair às ${clock}.`, `Le dernier jour part maintenant à ${clock}.`);
        return finish(reply, rebuilt.plan, rebuilt.events, rebuilt.task, undefined, true, false, false, "forecast");
      }
    }
  }

  if (current && typeof task.constraints.car === "boolean" && task.constraints.arrival?.time === "15:00" && /\b(?:mid-afternoon|mid afternoon|meio da tarde|milieu de l'apres-midi|milieu d'apres-midi)\b/.test(spoken)) {
    appliedEdit = "set_arrival";
    const rebuilt = await rebuildPlan(task);
    if (rebuilt) {
      const reply = say(task.locale, "Day 1 now starts after 15:00.", "O dia 1 passa a começar depois das 15:00.", "Le jour 1 commence maintenant après 15:00.");
      return finish(reply, rebuilt.plan, rebuilt.events, rebuilt.task, undefined, true, false, false, "forecast");
    }
  }

  const offerPlan = (classification.planShaping || Boolean(lengthEdit)) && task.scope.mode !== "research" && classification.intent !== "side_question";

  const tools = {
    search_experiences: tool({
      description: "List experiences and food on Maio. Phones come from the Maio API when it is reachable; the day graph falls back to the local fixture.",
      inputSchema: z.object({ kind: z.enum(["sea", "land", "food", "any"]).default("any"), query: z.string().max(60).optional() }),
      execute: async ({ kind, query }) => {
        const q = query?.toLowerCase();
        const match = (text: string) => !q || q.split(/\s+/).some((word) => word.length > 2 && text.toLowerCase().includes(word));
        const catalog = await loadBusinesses(deps.fetchImpl);
        const phoneFor = (title: string) => catalog.source === "api" ? searchBusinesses(catalog.records, title).find((item) => item.phone)?.phone : undefined;
        const exps = kind === "food" ? [] : EXPERIENCES.filter((item) => (kind === "any" || item.kind === kind) && match(`${item.title} ${item.description.en} ${item.description.pt}`))
          .map((item) => ({ id: item.id, title: item.title, kind: item.kind, location: item.location, seaDependent: item.seaDependent, boat: item.boat, minAge: item.example.minAge, slots: item.example.slots, durationMin: item.example.durationMin, ...(phoneFor(item.title) ? { phone: phoneFor(item.title) } : {}) }));
        const eats = kind === "food" || kind === "any" ? FOOD.filter((item) => match(`${item.title} ${item.description.en}`)).map((item) => ({ id: item.id, title: item.title, location: item.location, ...(phoneFor(item.title) ? { phone: phoneFor(item.title) } : {}) })) : [];
        toolEvents.push({ name: "search_experiences", ok: true, arguments: { kind, query } });
        return clipToolBody({ experiences: exps, food: eats, businesses: catalog.source, note: exps.length + eats.length ? undefined : "Nothing matches in Visit Maio data." });
      },
    }),
    get_sea_forecast: tool({
      description: "Daily wave height and wind for Maio (Open-Meteo), up to 7 days.",
      inputSchema: z.object({ startDate: z.string(), days: z.number().int().min(1).max(7) }),
      execute: async ({ startDate, days }) => {
        const rows = await forecast(startDate, days);
        toolEvents.push({ name: "get_sea_forecast", ok: rows.length > 0, arguments: { startDate, days } });
        return clipToolBody(rows.map((row) => ({ ...row, status: seaStatus(row) })));
      },
    }),
    get_transport: tool({
      description: "Published ferry sailings and the published flight timetable for a date. Not live status. No current rows does not mean no service.",
      inputSchema: z.object({ date: z.string() }),
      execute: async ({ date }) => {
        const [boats, flight] = await Promise.all([loadBoatSchedule(deps.fetchImpl, now), loadFlightSchedule(deps.fetchImpl, now)]);
        const rows = (boats.data ?? []).filter((row) => row.date === date);
        toolEvents.push({ name: "get_transport", ok: true, arguments: { date } });
        task = rememberFact(task, { name: "get_transport", retrievedAt: boats.retrievedAt, value: rows.length ? `${rows.length} sailing(s)` : boats.status });
        return clipToolBody({
          sailings: rows,
          ferry: { status: rows.length ? "available" : boats.status, retrievedAt: boats.retrievedAt, note: rows.length ? undefined : "No sailings published for that date. No current rows is not the same as no service." },
          flight: { status: flight.status, retrievedAt: flight.retrievedAt, source: flight.source.name, note: "Published timetable only. Not live status. No current rows does not mean no flights.", data: flight.data },
        });
      },
    }),
    propose_itinerary: tool({
      description: "Build a day-by-day plan from the task constraints. Old stops are not facts. Returns a summary; the cards show the plan.",
      inputSchema: TripRequestSchema,
      execute: async (request) => {
        const merged = composeRequest(request as Record<string, unknown>);
        const include = Array.isArray(merged.include) ? merged.include.filter((id): id is string => typeof id === "string") : [];
        const dropped = include.filter((id) => !experience(id));
        const clean: Record<string, unknown> = { ...merged, include: include.filter((id) => experience(id)) };
        const table = await loadTimetable(deps.fetchImpl, now);
        const withTravel = attachPublishedTravel(clean, table);
        const built = annotateMissingTravel(buildPlan({ request: withTravel as z.input<typeof TripRequestSchema>, forecast: await forecast(String(withTravel.startDate), Number(withTravel.days)), sailings: table.sailings, forecastSource: forecastSourceName }), table);
        builtRequest = TripRequestSchema.parse(withTravel);
        plan = built;
        toolEvents.push({ name: "get_transport", ok: table.ok });
        toolEvents.push({ name: "propose_itinerary", ok: true, arguments: withTravel, ...(dropped.length ? { dropped } : {}) });
        return clipToolBody(summarize(built));
      },
    }),
  };

  const { propose_itinerary, ...readOnly } = tools;
  const activeTools = offerPlan ? tools : readOnly;
  const generated = await generateText({
    model: deps.model,
    instructions: planInstructions(today, task, windowed.recall, offerPlan),
    messages: windowed.messages,
    tools: activeTools,
    stopWhen: stepCountIs(6),
    temperature: 0,
  } as Parameters<typeof generateText>[0]);

  if (offerPlan && !builtRequest) {
    const fallback = composeRequest(null);
    try {
      const table = await loadTimetable(deps.fetchImpl, now);
      const withTravel = attachPublishedTravel(fallback, table);
      const built = annotateMissingTravel(buildPlan({ request: withTravel as z.input<typeof TripRequestSchema>, forecast: await forecast(String(withTravel.startDate), Number(withTravel.days)), sailings: table.sailings, forecastSource: forecastSourceName }), table);
      builtRequest = TripRequestSchema.parse(withTravel);
      plan = built;
      toolEvents.push({ name: "get_transport", ok: table.ok });
      toolEvents.push({ name: "propose_itinerary", ok: true, arguments: withTravel });
    } catch { /* keep the previous plan when the task is not specific enough */ }
  }

  const safe = builtRequest && plan ? parseTripPlan(plan) : current;
  if (builtRequest && safe) task = syncTask(task, builtRequest, safe);
  const built = Boolean(builtRequest && safe);
  if (!built && isItineraryProse(generated.text)) {
    if (wantsNewPlan(lastUser) && typeof task.constraints.car !== "boolean") {
      const q = CAR_QUESTION[task.locale];
      return finish(q, null, toolEvents, { ...task, pendingQuestion: q }, [...CAR_CHIPS[task.locale]], false, true);
    }
    if (wantsNewPlan(lastUser)) {
      const rebuilt = await rebuildPlan(task);
      if (rebuilt) return finish(rebuilt.plan.title, rebuilt.plan, [...toolEvents, ...rebuilt.events], rebuilt.task, undefined, true, false, true, "forecast");
    }
    return finish(say(task.locale, "The days stay on the card.", "Os dias ficam no cartão.", "Les jours restent sur la carte."), current, toolEvents, task, undefined, true);
  }
  return finish(generated.text, safe ?? current, toolEvents, task, undefined, false, false, built);
}

function wantsNewPlan(text: string): boolean {
  const n = normalizeUtterance(text);
  return /\b\d+\s*-?\s*(?:days?|dias?|jours?)\b/.test(n) || /\b(?:make me a plan|plan my|um plano|un plan|planeia|planifie|plano de)\b/.test(n);
}

function isItineraryProse(text: string): boolean {
  if (looksLikeItineraryDump(text)) return true;
  return text.length > 350 && /\b(?:day|dia|jour)\s+\d+\b/i.test(text);
}

function listedStopTarget(text: string, places: Task["lastPlaces"]): { day: number; place: Task["lastPlaces"][number] } | null {
  if (!/\b(?:add|acrescenta|ajoute|poe|poes|mets|met)\b/.test(text)) return null;
  const day = Number(text.match(/\b(?:day|dia|jour)\s+(\d+)\b/)?.[1] ?? "");
  if (!day || !places.length) return null;
  const index = /\b(?:second|segund|deuxieme|2e|2nd)\b/.test(text) ? 1 : /\b(?:third|terceir|troisieme|3e|3rd)\b/.test(text) ? 2 : 0;
  const place = places[index];
  return place ? { day, place } : null;
}

function transportFact(table: { sailings: { date: string; departure: string; from: string; to: string }[]; flights: { date: string; departure: string; from: string; to: string }[] }, today: string, text: string): string {
  const n = normalizeUtterance(text);
  const wantFlight = /\b(?:flights?|voos?|vols?|avion)\b/.test(n);
  const focus = spokenDates(text, today).start ?? (shortWeekday(text) !== undefined ? upcomingWeekday(today, shortWeekday(text)!) : null);
  const byDate = <T extends { date: string; departure: string }>(rows: T[]) => [...rows].filter((row) => focus ? row.date === focus : row.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.departure.localeCompare(b.departure));
  const mentions: TransportMention[] = [];
  if (wantFlight) {
    const leg = byDate(table.flights.filter((item) => item.from === "MMO"))[0];
    if (leg) mentions.push({ kind: "flt", date: leg.date, time: leg.departure, from: leg.from, to: leg.to });
  } else {
    const inbound = byDate(table.sailings.filter((row) => /maio/i.test(row.to) && !/maio/i.test(row.from)))[0];
    const outbound = byDate(table.sailings.filter((row) => /maio/i.test(row.from) && /santiago|praia/i.test(row.to)))[0];
    if (inbound) mentions.push({ kind: "in", date: inbound.date, time: inbound.departure, from: inbound.from, to: inbound.to });
    if (outbound) mentions.push({ kind: "out", date: outbound.date, time: outbound.departure, from: outbound.from, to: outbound.to });
  }
  return mentions.length ? encodeTransportFact(mentions) : "none";
}

function smallTalkReply(locale: TaskLocale, spoken: string, plan: TripPlan | null): string {
  const kind = /^(?:thanks|thank you|obrigado|obrigada|merci|valeu|cheers)$/.test(spoken.replace(/[.!?]+$/g, ""))
    ? "thanks"
    : /^(?:ok|okay|fixe|cool|great)$/.test(spoken.replace(/[.!?]+$/g, ""))
      ? "ok"
      : "hi";
  if (kind === "thanks") return say(locale, "You're welcome.", "De nada.", "Avec plaisir.");
  if (kind === "ok") return say(locale, "Okay.", "Está bem.", "D'accord.");
  if (plan && plan.days.length) {
    const n = plan.days.length;
    return say(locale,
      `Hi! Your ${n}-day trip is still here. Want to change anything?`,
      `Olá! A sua viagem de ${n} dias continua aqui. Quer mudar alguma coisa?`,
      `Bonjour ! Votre voyage de ${n} jours est toujours là. Vous voulez changer quelque chose ?`);
  }
  return say(locale,
    "Hi! How many days do you have on Maio?",
    "Olá! Quantos dias vai passar no Maio?",
    "Bonjour ! Combien de jours passez-vous à Maio ?");
}

function summarize(plan: TripPlan) {
  return {
    title: plan.title,
    unmet: plan.unmet,
    days: plan.days.map((day) => ({
      date: humanPlanDate(day.date, plan.locale),
      sea: day.sea?.status ?? "unknown",
      items: day.items.map((item) => {
        const unpublished = plan.locale === "pt" ? "hora por publicar" : plan.locale === "fr" ? "heure non publiée" : "unpublished";
        return `${item.start ?? unpublished} ${itemLabel(item, plan.locale)}`;
      }),
    })),
  };
}
