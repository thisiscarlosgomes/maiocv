import { generateText, stepCountIs, tool, type LanguageModel, type ModelMessage } from "ai";
import { z } from "zod";
import { applyClassification, classify, experienceIdsMentioned, extractConstraints, isBusinessLookup, normalizeUtterance, type Intent } from "./awareness/classify.ts";
import { answerIslandQuestion, answerPlaceList } from "./island-answer.ts";
import { humanPlanDate, itemLabel, publicPlanReply } from "./plan-reply.ts";
import { clipToolBody, foodNear, prepareContext, presentedPlaces, type ChatTurn } from "./awareness/context.ts";
import { CAR_CHIPS, CAR_QUESTION, emptyTask, followUpChips, isCarPending, mergeConstraints, refreshTask, rememberFact, type Task, type TaskLocale } from "./awareness/task.ts";
import { loadBusinesses, pharmacyRecords, searchBusinesses } from "./maio-catalog.ts";
import { forecastSourceName, loadDailyForecast, maioClock, type DailySea } from "./agora.ts";
import { EMERGENCY, EMERGENCY_VERIFIED_AT } from "./emergency.ts";
import { verifiedDate } from "./essentials.ts";
import { loadBoatSchedule, loadFlightSchedule, loadSailings, type Sailing } from "./essentials.ts";
import { venueType } from "./plan-rules.ts";
import { EXPERIENCES, FOOD, experience, food, place, parseTripPlan, type TripPlan } from "./trip.ts";
import { TripRequestSchema, buildPlan, isAdrenalineExperience, seaStatus, type TripRequest } from "./trip-planner.ts";

export type ToolEvent = { name: string; ok: boolean; arguments?: unknown; dropped?: string[] };
export type PlanAgentResult = {
  reply: string;
  plan: TripPlan | null;
  toolEvents: ToolEvent[];
  task: Task;
  chips: string[];
  intent: Intent;
};
export type PlanDeps = { model: LanguageModel; fetchImpl: typeof fetch; now?: Date };

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
    "When you describe the days, use Markdown: a one-line intro, then a heading per day and one bullet per stop, then a short notes line. Put a real newline between them. Never one long line.",
    "Write dates as people say them (Mon 16 Nov, seg 16 nov, lun. 16 nov.). Never an ISO date.",
    "Never mention a catalog id, a slug, or a source label such as 'food listing' or 'id …'. Use the place name only.",
    "The task is the authority for who this trip is for. Tool results are the authority for numbers. Never invent a time, a price, an airline, or a walking time.",
    "If a ferry or flight time is not in the tool result, say it is not published. Do not use 14:00 or any other guessed clock. No current rows is not the same as no service, and it is not live status.",
    "get_transport returns published timetables only. Never say a flight is in the air, on time, or delayed.",
    "Include at most ONE tour or experience in the whole trip. Restaurants are for daytime meals. Bars only at 19:00 or later.",
    "A slow pace is a few anchored stops plus meals, with long gaps. Do not add a quad, jet ski, or other adrenaline activity unless the guest asked for it.",
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
    const name = item.kind === "food" ? food(item.refId)?.title : item.kind === "experience" ? experience(item.refId)?.title : record ? (plan.locale === "pt" ? record.name.pt : record.name.en) : "";
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
  if (c.pace === "slow") next.pace = "slow";
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

function result(task: Task, reply: string, plan: TripPlan | null, toolEvents: ToolEvent[], intent: Intent, chipsOverride?: string[], preservePlaces = false, keepPending = false, stance?: "yes" | "no" | "unsure" | null): PlanAgentResult {
  let next = refreshTask(pendingFrom(task, reply, intent));
  if (keepPending && isCarPending(task.pendingQuestion)) next = { ...next, pendingQuestion: task.pendingQuestion };
  let text = reply.trim();
  const unpublished = plan?.days.some((day) => day.items.some((item) => item.kind === "transport" && !item.start));
  if (unpublished && !/publish/i.test(text) && !/\b(?:day|dia|jour)\s+\d/i.test(text)) {
    const extra = next.locale === "pt" ? "O horário não está publicado, por isso o plano não marca uma hora."
      : next.locale === "fr" ? "L'horaire n'est pas publié, donc le plan ne fixe pas d'heure."
      : "The timetable has no published time, so the plan does not set one.";
    text = `${text} ${extra}`.trim();
  }
  text = publicPlanReply(text, next.locale, plan, stance);
  if (!preservePlaces) {
    const found = presentedPlaces(text, next.locale);
    // A list, a recommendation or a side answer replaces the previous list. One incidental name does not.
    if (found.length >= 2) next = { ...next, lastPlaces: found };
  }
  const carChips = isCarPending(next.pendingQuestion) ? CAR_CHIPS[next.locale] : null;
  const chips = (carChips ?? chipsOverride ?? followUpChips(next)).slice(0, carChips ? 3 : 2);
  return { reply: text, plan, toolEvents, task: next, chips, intent };
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
    startDate: c.dates?.start ?? today,
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
  const now = deps.now ?? new Date();
  const today = maioClock(now).date;
  const history = turns(messages);
  const lastUser = [...history].reverse().find((message) => message.role === "user")?.content ?? "";
  const seeded = taskInput ?? seedTask(current, "en");
  const classification = classify(lastUser, seeded, { today });
  let task = applyClassification(seeded, classification);
  const windowed = prepareContext(task, history);
  const spoken = normalizeUtterance(lastUser);

  const finish = (reply: string, plan: TripPlan | null, toolEvents: ToolEvent[] = [], next = task, chips?: string[], preservePlaces = false, keepPending = false) => result(next, reply, plan, toolEvents, classification.intent, chips, preservePlaces, keepPending, classification.carStance);

  const askedExperiences = () => new Set(includeFromConstraints(task, lastUser));
  const composeRequest = (modelInput: Record<string, unknown> | null): Record<string, unknown> => {
    const correction = classification.intent === "correction";
    const merged = correction || !modelInput ? requestFromTask(task, today) : overlayRequest(modelInput, task);
    const asked = askedExperiences();
    let include = Array.isArray(merged.include) ? merged.include.filter((id): id is string => typeof id === "string") : [];
    const slow = task.constraints.pace === "slow" || merged.pace === "slow";
    const exclude = new Set(Array.isArray(merged.exclude) ? merged.exclude.filter((id): id is string => typeof id === "string") : []);
    if (correction) include = [...asked];
    else if (slow) include = include.filter((id) => {
      const exp = experience(id);
      return !exp || !isAdrenalineExperience(exp) || asked.has(id);
    });
    if (slow || correction) for (const id of asked) if (!include.includes(id)) include.push(id);
    // A correction rebuilds every day. An unrequested quad from the previous draft is not a constraint.
    if (correction || slow) {
      for (const exp of EXPERIENCES) if (isAdrenalineExperience(exp) && !asked.has(exp.id)) exclude.add(exp.id);
    }
    return { ...merged, include, exclude: [...exclude] };
  };

  if (classification.smallTalk) {
    return finish(smallTalkReply(task.locale, spoken, current), current, [], task, []);
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

  if (classification.intent === "side_question" && /\b(in the air|flight status|estado do voo|praia flight)\b/.test(spoken)) {
    const flight = await loadFlightSchedule(deps.fetchImpl, now);
    task = rememberFact(task, { name: "get_transport", retrievedAt: flight.retrievedAt, value: `flight ${flight.status}` });
    const reply = say(task.locale,
      `The published flight timetable is ${flight.status}, retrieved ${flight.retrievedAt}. That is not live status. No current rows does not mean there is no flight.`,
      `O horário de voos publicado está ${flight.status}, obtido em ${flight.retrievedAt}. Não é um estado ao vivo. Sem registos atuais não quer dizer que não haja voo.`,
      `L'horaire des vols publié est ${flight.status}, récupéré le ${flight.retrievedAt}. Ce n'est pas un statut en direct. Aucune ligne actuelle ne veut pas dire qu'il n'y a pas de vol.`);
    return finish(reply, current, [{ name: "get_transport", ok: true }]);
  }

  if (classification.intent === "side_question" && /\b(is there a ferry|ha barco|y a-t-il un ferry|ferry timetable|horario do barco|horaire du ferry)\b/.test(spoken)) {
    const boats = await loadBoatSchedule(deps.fetchImpl, now);
    const date = extractConstraints(lastUser, today).dates?.start;
    const rows = (boats.data ?? []).filter((row) => !date || row.date === date);
    task = rememberFact(task, { name: "get_transport", retrievedAt: boats.retrievedAt, value: boats.status });
    const reply = rows.length
      ? say(task.locale,
        `Published sailing: ${rows.map((row) => `${row.departure} ${row.from} to ${row.to}`).join(", ")}. Retrieved ${boats.retrievedAt}. Not live status.`,
        `Saída publicada: ${rows.map((row) => `${row.departure} ${row.from} para ${row.to}`).join(", ")}. Obtido em ${boats.retrievedAt}. Não é estado ao vivo.`,
        `Traversée publiée : ${rows.map((row) => `${row.departure} ${row.from} vers ${row.to}`).join(", ")}. Récupéré le ${boats.retrievedAt}. Pas un statut en direct.`)
      : say(task.locale,
        `No sailing is published (retrieved ${boats.retrievedAt}). That is not the same as no service, and it is not live status.`,
        `Não há saída publicada (obtido em ${boats.retrievedAt}). Isso não é o mesmo que não haver serviço, nem é estado ao vivo.`,
        `Aucune traversée publiée (récupéré le ${boats.retrievedAt}). Ce n'est pas la même chose qu'une absence de service, ni un statut en direct.`);
    return finish(reply, current, [{ name: "get_transport", ok: true }]);
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

  if ((classification.reference.kind === "ordinal" || classification.reference.kind === "that-one") && classification.reference.place && !classification.planShaping) {
    const hit = classification.reference.place;
    return finish(say(task.locale, `That is ${hit.name}.`, `É ${hit.name}.`, `C'est ${hit.name}.`), current, [], task, undefined, true);
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
    if (listed) return finish(listed.reply, current, [], { ...task, lastPlaces: listed.places }, []);
    const grounded = answerIslandQuestion(lastUser, task.locale);
    if (grounded) return finish(grounded, current, [], task, []);
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

  const planning = classification.planShaping
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
  let sailings: Promise<Sailing[]> | null = null;
  const getSailings = () => (sailings ??= loadSailings(deps.fetchImpl));
  let plan: TripPlan | null = current;
  let builtRequest: TripRequest | null = null;
  const toolEvents: ToolEvent[] = [];
  const offerPlan = classification.planShaping && task.scope.mode !== "research" && classification.intent !== "side_question";

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
        const built = buildPlan({ request: clean as z.input<typeof TripRequestSchema>, forecast: await forecast(String(clean.startDate), Number(clean.days)), sailings: await getSailings(), forecastSource: forecastSourceName });
        builtRequest = TripRequestSchema.parse(clean);
        plan = built;
        toolEvents.push({ name: "propose_itinerary", ok: true, arguments: clean, ...(dropped.length ? { dropped } : {}) });
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
      const built = buildPlan({ request: fallback as z.input<typeof TripRequestSchema>, forecast: await forecast(String(fallback.startDate), Number(fallback.days)), sailings: await getSailings(), forecastSource: forecastSourceName });
      builtRequest = TripRequestSchema.parse(fallback);
      plan = built;
      toolEvents.push({ name: "propose_itinerary", ok: true, arguments: fallback });
    } catch { /* keep the previous plan when the task is not specific enough */ }
  }

  const safe = builtRequest && plan ? parseTripPlan(plan) : current;
  if (builtRequest && safe) task = syncTask(task, builtRequest, safe);
  return finish(generated.text, safe ?? current, toolEvents);
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
