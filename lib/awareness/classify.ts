import { EXPERIENCES, addDays, experience } from "../trip.ts";
import { resolveReference, type ReferenceHit } from "./context.ts";
import {
  emptyTask, isCarPending, mergeConstraints, refreshTask, rememberPlace, type Task, type TaskConstraints, type TaskLocale, type TaskScope,
} from "./task.ts";

export type Intent = "continuation" | "correction" | "side_question" | "cancel_pending" | "new_objective";

export type Classification = {
  intent: Intent;
  locale?: TaskLocale;
  objective?: string;
  scope?: TaskScope;
  patch: TaskConstraints;
  reference: ReferenceHit;
  /** The utterance is only "never mind" (or the pt/fr equivalent). */
  cancelOnly: boolean;
  /** Set when this turn answers the car question or states a car outright. "unsure" plans with a car. */
  carStance: "yes" | "no" | "unsure" | null;
  /** hi / olá / bonjour / thanks / ok. The task stays as it is. */
  smallTalk: boolean;
  /** Dates, party, car, quiet evenings, or arrival changed — the plan must be rebuilt. */
  planShaping: boolean;
  research: boolean;
};

export type ClassifyContext = { today: string };

const NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5,
};

const WEEKDAYS: { name: string; day: number }[] = [
  { name: "sunday", day: 0 }, { name: "domingo", day: 0 }, { name: "dimanche", day: 0 },
  { name: "monday", day: 1 }, { name: "segunda-feira", day: 1 }, { name: "lundi", day: 1 },
  { name: "tuesday", day: 2 }, { name: "terca-feira", day: 2 }, { name: "mardi", day: 2 },
  { name: "wednesday", day: 3 }, { name: "quarta-feira", day: 3 }, { name: "mercredi", day: 3 },
  { name: "thursday", day: 4 }, { name: "quinta-feira", day: 4 }, { name: "jeudi", day: 4 },
  { name: "friday", day: 5 }, { name: "sexta-feira", day: 5 }, { name: "sexta", day: 5 }, { name: "vendredi", day: 5 },
  { name: "saturday", day: 6 }, { name: "sabado", day: 6 }, { name: "samedi", day: 6 },
];

export function normalizeUtterance(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’]/g, "'").replace(/\s+/g, " ").trim();
}

function bare(text: string): string {
  return normalizeUtterance(text).replace(/[.!?…]+$/g, "").trim();
}

const CANCEL_EXACT = /^(?:never\s*mind|nevermind|nvm|forget it|forget that|skip(?: that)?|cancel(?: that)?|don'?t worry|no worries|esquece(?: isso)?|esqueca(?: isso)?|deixa estar|deixa pra la|nao importa|tanto faz|laisse tomber|laissez tomber|tant pis|oublie(?:z)?(?: ca| cela)?|peu importe|ce n'est pas grave|c'est pas grave)(?: please| por favor| s'il vous plait)?$/;

function wordNumber(token: string | undefined): number | undefined {
  if (!token) return undefined;
  if (/^\d+$/.test(token)) return Number(token);
  return NUMBERS[token];
}

/** Upcoming weekday, including today when today is that weekday. */
export function upcomingDate(today: string, weekday: number): string {
  const date = new Date(`${today}T12:00:00Z`);
  const delta = (weekday - date.getUTCDay() + 7) % 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function clockOf(text: string): string | undefined {
  const match = text.match(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/);
  if (!match) return undefined;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

export function detectLocale(text: string): TaskLocale | undefined {
  const n = normalizeUtterance(text);
  if (/\b(?:answer in english|in english|em ingles|en anglais)\b/.test(n)) return "en";
  if (/\b(?:answer in french|en francais|em frances|reponds en francais)\b/.test(n)) return "fr";
  if (/\b(?:em portugues|in portuguese|responde em portugues)\b/.test(n)) return "pt";
  if (/\b(?:nous|jours?|voiture|enfant|plage|sans|sommes)\b/.test(n) && /\b(?:nous|jours?|voiture|enfant|sommes)\b/.test(n)) return "fr";
  if (/\b(?:dias?|somos|sem carro|amanha|crianca|bebe|voces?)\b/.test(n)) return "pt";
  if (/\b(?:lista|listar|restaurantes|praias|na vila|quais|indique)\b/.test(n)) return "pt";
  if (/\b(?:listez|liste|plages|donnez|quels)\b/.test(n) && /\b(?:restaurant|plage|liste)\b/.test(n)) return "fr";
  return undefined;
}

function detectScope(text: string, research: boolean): TaskScope {
  const n = normalizeUtterance(text);
  if (research) return { geography: "island", mode: "research" };
  const town = /\bporto ingles\b|\bvila do maio\b|\bna vila\b|\bin town\b|\ben ville\b/.test(n);
  const onIsland = /\b(on the island|na ilha|sur l'ile|i am here|estou no maio|je suis a maio)\b/.test(n);
  return {
    geography: town ? "town" : "island",
    ...(town ? { town: "Porto Inglês" } : {}),
    mode: onIsland ? "on-island" : "planning",
  };
}

export function isResearchQuestion(text: string): boolean {
  const n = normalizeUtterance(text);
  return /\b(guest count|tourists?|visiteurs?|visitantes|population|populacao|habitantes|quantos turistas|combien de visiteurs)\b/.test(n)
    || /\b20\d{2}\b/.test(n) && /\b(guest|tourist|visiteur|visitante|population|orcamento|budget)\b/.test(n);
}

function weekdayHits(text: string): { day: number; index: number; name: string }[] {
  const hits: { day: number; index: number; name: string }[] = [];
  const skipMonday = /\bsegunda\b\s+(?:praia|beach|plage|one)\b/.test(text) || /\ba segunda\b/.test(text);
  for (const weekday of WEEKDAYS) {
    if (weekday.name === "segunda-feira" || weekday.day === 1 && weekday.name.startsWith("segunda")) {
      if (skipMonday) continue;
    }
    const at = text.indexOf(weekday.name);
    if (at >= 0) hits.push({ day: weekday.day, index: at, name: weekday.name });
  }
  return hits.sort((a, b) => a.index - b.index || b.name.length - a.name.length);
}

export function extractConstraints(text: string, today: string): TaskConstraints {
  const n = normalizeUtterance(text);
  const patch: TaskConstraints = {};
  const days = n.match(/\b(\d+)\s*(?:days?|dias?|jours?)\b/);
  if (days) patch.dates = { ...(patch.dates ?? {}), days: Number(days[1]) };
  if (/\b(?:tomorrow|amanha|demain)\b/.test(n)) patch.dates = { ...(patch.dates ?? {}), start: addDays(today, 1) };

  // "Saturday night" / "lazier" names a daypart, not a new start date.
  const quietNight = /\bquiet\b|\blazier\b|\bnoite calma\b|\bsoiree calme\b/.test(n);
  const dateContext = /\b(?:from|a partir|arrive|arriv|chega|stay|start|comeca|\bon\b|not |nao |pas )\b/.test(n)
    || (!quietNight && n.split(" ").length <= 3);
  const weekdays = dateContext
    ? weekdayHits(n).filter((hit, index, all) => all.findIndex((item) => item.day === hit.day) === index)
    : [];
  const negated = new Set<number>();
  if (/\b(?:not|nao|pas)\s+(?:on\s+|a\s+|le\s+|na\s+)?(?:friday|sexta(?:-feira)?|vendredi)\b/.test(n)) negated.add(5);
  const chosen = [...weekdays].reverse().find((hit) => !negated.has(hit.day));
  if (chosen) patch.dates = { ...(patch.dates ?? {}), start: upcomingDate(today, chosen.day) };

  const party = extractParty(n);
  if (party) patch.party = party;

  const stance = carPhrase(n);
  if (stance === "no") patch.car = false;
  else if (stance === "yes" || stance === "unsure") patch.car = true;

  if (/\bquiet\b|\bnoite calma\b|\bsoiree calme\b|\blazier\b|\bno bar\b|\bsem bar\b|\bsans bar\b/.test(n)) patch.quietEvenings = true;
  if (/\b(?:slow pace|relaxed pace|easy pace|ritmo calmo|ritmo lento|sem pressa|rythme lent|rythme calme)\b/.test(n)) patch.pace = "slow";

  const diet = n.match(/\b(vegetarian|vegan|vegetariano|vegetariana|vegetarien|vegetarienne)\b/);
  if (diet) patch.diet = diet[1];
  if (/\b(?:cheapest|mais barato|moins cher|low budget|orcamento curto)\b/.test(n)) {
    const phrase = n.match(/\b(?:cheapest|mais barato|moins cher|low budget|orcamento curto)\b/)?.[0];
    patch.budget = phrase ?? "unpriced";
  }

  const interests: string[] = [];
  const boatCount = n.match(/\b(one|two|three|1|2|3|uma|duas|deux)\s+(?:boat|barco|bateau|sea outings?)/);
  if (/\b(?:boat trip|boat|barco|bateau|sea outing|saida de barco|sortie en bateau)\b/.test(n)) {
    interests.push("boat");
    const count = wordNumber(boatCount?.[1]);
    if (count) patch.boatTrips = count;
    else if (/\bone boat\b|\buma saida\b|\bune sortie\b/.test(n)) patch.boatTrips = 1;
  }
  if (/\b(?:beach|praias?|plages?)\b/.test(n)) interests.push("beach");
  if (/\b(?:diving|mergulho|plongee)\b/.test(n)) interests.push("diving");
  if (/\b(?:nightlife|nightclub|vida noturna|boite)\b/.test(n)) interests.push("nightlife");
  if (/\b(?:dolphin|golfinho|dauphin)\b/.test(n)) interests.push("dolphin");
  if (/\bsurf\b/.test(n)) interests.push("surf");
  for (const id of experienceIdsMentioned(n)) interests.push(id);
  if (interests.length) patch.interests = interests;

  const time = clockOf(n);
  const ferry = /\b(?:ferry|barco)\b/.test(n) && /\b(?:arriv|chega|arrive)\b/.test(n);
  const flight = /\b(?:land at|aterr\w*|flight|voo|avion)\b/.test(n);
  if (ferry || flight) {
    patch.arrival = { mode: ferry && !flight ? "ferry" : flight ? "flight" : "ferry", verified: false, ...(time ? { time } : {}) };
  } else if (time && /\b(?:land|aterr|arrive at|chegamos as)\b/.test(n)) {
    patch.arrival = { mode: "flight", verified: false, time };
  }
  return patch;
}

function extractParty(text: string): TaskConstraints["party"] | undefined {
  const party: NonNullable<TaskConstraints["party"]> = {};
  const total = wordNumber(text.match(/\b(?:nous sommes|somos|we are|family of|familia de|famille de)\s+(\d+|two|three|four|five|six|dois|duas|tres|quatro|deux|trois|quatre)\b(?!\s+(?:adults?|adultos?|adultes?))/)?.[1]);
  const adults = wordNumber(text.match(/\b(\d+|two|three|four|dois|duas|tres|deux|trois|quatre)\s+(?:adults?|adultos?|adultes?)\b/)?.[1]);
  const ofUs = /\b(?:two of us|somos dois|deux personnes)\b/.test(text) ? 2 : undefined;
  const oneChild = /\b(?:dont un enfant|com uma crianca|com um filho|with one child|with a child|with one kid)\b/.test(text);
  const child = oneChild || /\b(?:kid|kids|child|children|toddler|crianca|criancas|bebe|enfant|enfants|bb|year-old|years old|anos|ans)\b/.test(text);
  const age = text.match(/\b(?:age|idade)\s+(\d+)\b|\b(\d+)\s*[- ]?(?:year-old|years old|year old|anos|ans)\b/);
  const youngest = age ? Number(age[1] ?? age[2]) : /\b(?:toddler|bebe)\b/.test(text) ? 2 : undefined;
  if (adults !== undefined) party.adults = adults;
  else if (total !== undefined && oneChild) party.adults = Math.max(1, total - 1);
  else if (total !== undefined && child) party.adults = Math.max(1, total - Math.max(1, total - 2));
  else if (ofUs !== undefined) party.adults = ofUs;
  else if (total !== undefined && !child) party.adults = total;
  if (oneChild) party.kids = 1;
  else if (total !== undefined && child && party.adults !== undefined) party.kids = Math.max(0, total - party.adults);
  else if (child && adults !== undefined) party.kids = 1;
  else if (ofUs !== undefined && !child) party.kids = 0;
  if (youngest !== undefined) party.youngestAge = youngest;
  return party.adults !== undefined || party.kids !== undefined || party.youngestAge !== undefined ? party : undefined;
}

function contradicts(task: Task, patch: TaskConstraints): boolean {
  const current = task.constraints;
  if (patch.dates?.start && current.dates?.start && patch.dates.start !== current.dates.start) return true;
  if (patch.dates?.days && current.dates?.days && patch.dates.days !== current.dates.days) return true;
  if (patch.car !== undefined && current.car !== undefined && patch.car !== current.car) return true;
  if (patch.party?.adults !== undefined && current.party?.adults !== undefined && patch.party.adults !== current.party.adults) return true;
  if (patch.party?.kids !== undefined && current.party?.kids !== undefined && patch.party.kids !== current.party.kids) return true;
  if (patch.party?.youngestAge !== undefined && current.party?.youngestAge !== undefined && patch.party.youngestAge !== current.party.youngestAge) return true;
  return false;
}

function hasPlanSignal(patch: TaskConstraints): boolean {
  return Boolean(
    patch.dates?.start || patch.dates?.days || patch.party || patch.car !== undefined
    || patch.quietEvenings || patch.arrival || patch.departure || patch.boatTrips !== undefined
    || patch.interests?.some((item) => item === "beach" || item === "boat" || experience(item)),
  );
}

function isQuestion(text: string): boolean {
  if (text.endsWith("?")) return true;
  return /^(?:is|are|what|whats|what's|where|when|how|can|do|does|why|which|qual|quais|onde|quando|como|posso|o que|est-ce|quel|quelle|ou |quand |comment |puis-je)\b/.test(text);
}

function isTimetableQuestion(text: string): boolean {
  return /\?/.test(text)
    && /\b(?:ferry|flight|voo|barco|bateau|horario|horaire|timetable|schedule)\b/.test(text)
    && /\b(?:is there|there a|ha |y a-t-il|status|horario|horaire|timetable|schedule|published)\b/.test(text)
    && !/\b(?:stay|days|dias|jours|plan)\b/.test(text);
}

export function isBusinessLookup(text: string): boolean {
  const n = normalizeUtterance(text);
  return /\b(?:phone|telefone|telephone|numero de telefone|numero de telephone)\b/.test(n)
    || /\b(?:pharmacy|pharmacies|farmacia|pharmacie)\b/.test(n);
}

function isFactualAside(text: string): boolean {
  return /\b(?:hospital|hospit|hopital|emergency|emergencia|urgence)\b/.test(text)
    || /\b(?:in the air|flight status|estado do voo|le vol est|praia flight)\b/.test(text)
    || /\b(?:what should i pack|o que levar|que mettre dans)\b/.test(text)
    || /\b(?:pay by card|posso pagar|carte bancaire|card payment)\b/.test(text)
    || /\b(?:phone|telefone|telephone|numero de telefone|numero de telephone)\b/.test(text)
    || /\b(?:pharmacy|pharmacies|farmacia|pharmacie)\b/.test(text)
    || /\b(?:directions?|como chegar|itineraire)\b/.test(text);
}

function explicitCorrection(text: string): boolean {
  return /\b(?:not friday|nao sexta|pas vendredi|i meant|actually|na verdade|en fait|rented a car|alugamos(?: um)? carro|instead)\b/.test(text);
}

const SMALL_TALK = /^(?:hi|hello|hey|hiya|yo|ola|oi|bom dia|boa tarde|boa noite|bonjour|salut|bonsoir|coucou|thanks|thank you|obrigado|obrigada|merci|ok|okay|cool|great|cheers|valeu|fixe|tudo bem|ca va)(?: there| maio)?$/;

export function isSmallTalk(text: string): boolean {
  return SMALL_TALK.test(bare(text));
}

/** "list three restaurants in Vila do Maio" / "lista três restaurantes" / "liste trois restaurants". */
export function isPlaceListQuestion(text: string): boolean {
  const n = normalizeUtterance(text);
  const subject = /\b(?:restaurants?|restaurantes?|pizzerias?|beaches|praias?|plages?)\b/.test(n);
  if (!subject) return false;
  if (/\b(?:list|lists|name|recommend|suggest|show|give|which|what are|lista|listar|liste|listez|indique|indica|recomenda|sugere|quais|montre|donnez|donne|quels|quelles)\b/.test(n)) return true;
  // "3 restaurants in Vila", not "3 days" and not "no car".
  return /\b(?:two|three|four|dois|duas|tres|quatro|deux|trois|quatre|\d+)\s+(?:restaurants?|restaurantes?|pizzerias?|praias?|beaches|plages?)\b/.test(n);
}

/** Experience ids the guest actually named (a quad, a jet ski), not ones a previous draft assumed. */
export function experienceIdsMentioned(text: string): string[] {
  const n = normalizeUtterance(text);
  const ids: string[] = [];
  for (const exp of EXPERIENCES) {
    const title = normalizeUtterance(exp.title);
    if (title.length > 4 && n.includes(title)) ids.push(exp.id);
    else if (/\bquads?\b/.test(n) && exp.id.includes("quad")) ids.push(exp.id);
    else if (/\bjet ?skis?\b/.test(n) && exp.id.includes("jetski")) ids.push(exp.id);
  }
  return ids;
}

/** Visitor questions about the island itself, not a request to build or change a plan. */
export function isGeneralIslandQuestion(text: string): boolean {
  const n = normalizeUtterance(text);
  const aboutIsland = /\b(?:maio|island|ilha|ile)\b/.test(n) && /\b(?:tell|about|what|whats|how|like|fale|fala|conta|o que|como|parle|comment|quel|quelle|c'est|qu'est|quest)\b/.test(n);
  const beaches = /\b(?:beach|beaches|praia|praias|plage|plages)\b/.test(n) && /\b(?:best|which|where|qual|quais|melhor(?:es)?|meilleures?|tell|about|sobre|what|quais sao|where are)\b/.test(n);
  const safe = /\b(?:safe|safety|seguro|segura|seguranca|securite|surete)\b/.test(n) || /\b(?:c'est|est-ce|est ce)\s+sur\b/.test(n);
  const services = /\b(?:pharmacy|pharmacies|farmacia|pharmacie|atm|atms|multibanco|caixas? automatic[oa]s?|distributeurs?)\b/.test(n);
  const eat = /\b(?:where (?:to|should|can) (?:we |i )?(?:eat|have)|onde comer|ou manger|où manger)\b/.test(n);
  const around = /\b(?:get around|getting around|desloc|deplacer|aluguer)\b/.test(n);
  return aboutIsland || beaches || safe || services || eat || around;
}

const HOW_AROUND = /\b(?:how|como|comment)\b.*\b(?:around|desloc|deplacer|car|carro|voiture)\b/;
const CAR_NO = /\b(?:no car|without a car|sem carro|sans voiture)\b/;
const CAR_YES = /\b(?:with a car|have a car|has a car|rent(?:ing|ed)?(?: a)? car|we(?:'ll| will) rent|yes we rent|com carro|de carro|vamos alugar|alug(?:ar|amos|uei)|temos carro|lou(?:er|ons|e) une voiture|avec une voiture|on a loue|on loue)\b/;
const CAR_UNSURE = /\b(?:not sure(?: yet)?|unsure|ainda nao sei|nao sei|pas encore sur|pas sur|je ne sais pas)\b/;

/** Explicit car wording. A how-to ("how do we get around without a car") is not an answer. */
function carPhrase(text: string): "yes" | "no" | "unsure" | null {
  if (HOW_AROUND.test(text)) return null;
  if (CAR_UNSURE.test(text)) return "unsure";
  if (CAR_NO.test(text)) return "no";
  if (CAR_YES.test(text)) return "yes";
  return null;
}

/**
 * Car answer for this turn. Short yes/no ("sim", "oui", "nope") count only while the car question is waiting.
 * "unsure" still plans with a car.
 */
export function resolveCarStance(text: string, pending: string | null): "yes" | "no" | "unsure" | null {
  const n = bare(text);
  const phrase = carPhrase(n);
  if (phrase) return phrase;
  if (!isCarPending(pending)) return null;
  if (/^(?:yes|yeah|yep|yup|sure|sim|oui|si)$/.test(n)) return "yes";
  if (/^(?:no|nope|nah|nao|non)$/.test(n)) return "no";
  return null;
}

function newObjectiveCue(text: string): boolean {
  return /\b(?:forget the trip|ignore (?:the )?(?:trip|food|plan)|start over|start again|new (?:plan|trip)|esquece a viagem|esquecer a viagem|comecar de novo|oublie(?:z)? le voyage|nouveau voyage|recommencer)\b/.test(text);
}

/**
 * Deterministic intent. No model call. Order: cancel-only, new objective,
 * correction of a stored constraint, factual side question, continuation.
 */
export function classify(text: string, task: Task = emptyTask(), ctx: ClassifyContext): Classification {
  const n = bare(text);
  const locale = detectLocale(text);
  const reference = resolveReference(text, task.lastPlaces);
  const research = isResearchQuestion(text);
  const patch = extractConstraints(text, ctx.today);
  const carStance = resolveCarStance(text, task.pendingQuestion);
  if (carStance === "no") patch.car = false;
  else if (carStance === "yes" || carStance === "unsure") patch.car = true;
  const referenceOnly = Boolean(reference.kind) && !patch.dates && !patch.party && patch.car === undefined && !patch.quietEvenings && !patch.arrival && patch.boatTrips === undefined;
  const asking = isGeneralIslandQuestion(text) && !patch.dates && !patch.party && patch.car === undefined && !patch.quietEvenings && !patch.arrival && patch.boatTrips === undefined && !patch.pace;
  const planShaping = hasPlanSignal(patch) && !referenceOnly && !asking;
  const dietOnly = Boolean(patch.diet || patch.budget) && !planShaping;
  const base = { locale, patch, reference, cancelOnly: false, planShaping, research, scope: detectScope(text, research), smallTalk: false, carStance };
  const side = { ...base, intent: "side_question" as const, planShaping: false, patch: {}, research: false, reference: { kind: null, place: null, from: null, to: null } as ReferenceHit };

  if (CANCEL_EXACT.test(n)) {
    return { ...base, intent: "cancel_pending", cancelOnly: true, planShaping: false, objective: task.objective ?? undefined };
  }
  if (isSmallTalk(n)) {
    return { ...side, smallTalk: true, objective: task.objective ?? undefined };
  }
  if (isBusinessLookup(text) && !patch.dates?.days && !patch.dates?.start) {
    return { ...side, patch: {}, planShaping: false, objective: task.objective ?? undefined };
  }
  if (isTimetableQuestion(text) || /\bin the air\b|\bflight status\b|\bestado do voo\b/.test(n)) {
    return { ...base, intent: "side_question", planShaping: false, patch: {}, research: false };
  }
  if (newObjectiveCue(n) || (research && task.objective)) {
    return { ...base, intent: "new_objective", planShaping: !research && planShaping, objective: clipObjective(text) };
  }
  if ((isGeneralIslandQuestion(text) || isPlaceListQuestion(text) || isBusinessLookup(text)) && !planShaping && !research) {
    return { ...side, objective: task.objective ?? undefined };
  }
  if (!task.objective) {
    if ((isPlaceListQuestion(text) || isBusinessLookup(text)) && !planShaping) return side;
    if (research || (isQuestion(n) && !planShaping)) {
      return { ...base, intent: research ? "new_objective" : "side_question", planShaping: false, objective: research ? clipObjective(text) : undefined };
    }
    return { ...base, intent: "new_objective", objective: clipObjective(text) };
  }
  if (locale && !planShaping && !dietOnly && !research && !isQuestion(n)) {
    return { ...base, intent: "continuation", planShaping: false };
  }
  if (contradicts(task, patch) || (explicitCorrection(n) && (patch.dates || patch.car !== undefined || patch.party))) {
    return { ...base, intent: "correction", planShaping: true };
  }
  if (!dietOnly && (isFactualAside(n) || (isQuestion(n) && !planShaping) || (reference.kind && !planShaping))) {
    return { ...base, intent: "side_question", planShaping: false };
  }
  return { ...base, intent: "continuation" };
}

function clipObjective(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

/** Apply an intent to the task. The transcript window never does this. */
export function applyClassification(task: Task, result: Classification): Task {
  if (result.intent === "cancel_pending") {
    return refreshTask({ ...task, pendingQuestion: null, locale: result.locale ?? task.locale });
  }
  if (result.intent === "new_objective") {
    const next = emptyTask(result.locale ?? task.locale);
    next.objective = result.objective ?? null;
    next.scope = result.scope ?? next.scope;
    next.constraints = result.patch;
    next.pendingQuestion = null;
    return refreshTask(next);
  }
  if (result.intent === "side_question") {
    const next = { ...task, locale: result.locale ?? task.locale };
    // An ordinal reads the list. Moving that place to the end would make "the second one" miss.
    if (result.reference.kind === "ordinal" || result.reference.kind === "that-one") return next;
    return result.reference.place ? rememberPlace(next, result.reference.place) : next;
  }
  const leavingResearch = result.planShaping && task.scope.mode === "research";
  const merged = refreshTask({
    ...task,
    locale: result.locale ?? task.locale,
    objective: leavingResearch ? null : (task.objective ?? result.objective ?? null),
    scope: leavingResearch ? { ...task.scope, mode: "planning" } : task.scope,
    pendingQuestion: leavingResearch ? null : task.pendingQuestion,
    constraints: mergeConstraints(task.constraints, result.patch),
  });
  return result.reference.place ? rememberPlace(merged, result.reference.place) : merged;
}
