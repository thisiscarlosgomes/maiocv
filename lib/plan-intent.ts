import { languageModel, modelReady } from "./ai-model.ts";
import { generateText, tool } from "ai";
import { z } from "zod";
import type { TaskLocale } from "./awareness/task.ts";
import { extractConstraints } from "./awareness/classify.ts";
import { inclusiveDays, loosen, parseDateShift, parseLengthEdit, planQuestionKind, say, wordNumber, type DateShift } from "./plan-router.ts";
import { addDays, type TripPlan } from "./trip.ts";

export const EDIT_KINDS = [
  "relax_day", "busier_day", "add_day", "remove_day", "shift_dates", "set_dates",
  "add_activity", "remove_stop", "swap_stop", "set_car", "set_party", "set_pace",
  "question", "greeting", "other",
] as const;

/** What the model emits. Day is a 1-based index or an ISO date. The server resolves either. */
export const EditIntentSchema = z.object({
  kind: z.enum(EDIT_KINDS),
  day: z.union([z.number().int().min(1).max(31), z.string().max(40)]).optional(),
  days: z.number().int().min(1).max(14).optional(),
  where: z.enum(["start", "end"]).optional(),
  start: z.string().max(32).optional(),
  end: z.string().max(32).optional(),
  shiftDays: z.number().int().min(-14).max(14).optional(),
  car: z.boolean().optional(),
  pace: z.enum(["slow", "packed"]).optional(),
  adults: z.number().int().min(0).max(12).optional(),
  kids: z.number().int().min(0).max(12).optional(),
  youngestAge: z.number().int().min(0).max(17).optional(),
  activity: z.string().max(80).optional(),
  stop: z.string().max(80).optional(),
  swapWith: z.string().max(80).optional(),
});
export type EditIntent = z.infer<typeof EditIntentSchema>;

/** A model can be called: direct OpenAI (OPENAI_API_KEY) or the AI Gateway. */
export function gatewayReady(): boolean {
  return modelReady();
}

export function intentFromToolInput(input: unknown): EditIntent | null {
  const parsed = EditIntentSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

const WEEKDAYS: { re: RegExp; day: number }[] = [
  { re: /\b(?:sunday|domingo|dimanche)\b/, day: 0 },
  { re: /\b(?:monday|segunda(?:-feira)?|lundi|seg)\b/, day: 1 },
  { re: /\b(?:tuesday|tue|tues|terca(?:-feira)?|mardi)\b/, day: 2 },
  { re: /\b(?:wednesday|wed|quarta(?:-feira)?|mercredi)\b/, day: 3 },
  { re: /\b(?:thursday|thu|thur|thurs|quinta(?:-feira)?|jeudi)\b/, day: 4 },
  { re: /\b(?:friday|fri|sexta(?:-feira)?|vendredi)\b/, day: 5 },
  { re: /\b(?:saturday|sat|sabado|samedi)\b/, day: 6 },
];

const ORDINAL: { re: RegExp; day: number | "last" }[] = [
  { re: /\b(?:first|1st|primeiro|primeira|premier|premiere)\s+(?:day|dia|jour|journee)\b|\b(?:day|dia|jour)\s+(?:one|first|um|premier)\b/, day: 1 },
  { re: /\b(?:second|2nd|segundo|deuxieme)\s+(?:day|dia|jour|journee)\b|\b(?:day|dia|jour)\s+(?:two|second|dois|deuxieme|deux)\b/, day: 2 },
  { re: /\b(?:third|3rd|terceiro|troisieme)\s+(?:day|dia|jour|journee)\b|\b(?:day|dia|jour)\s+(?:three|third|tres|troisieme|trois)\b/, day: 3 },
  { re: /\b(?:fourth|4th|quarto|quatrieme)\s+(?:day|dia|jour)\b|\b(?:day|dia|jour)\s+(?:four|quatro|quatre)\b/, day: 4 },
  { re: /\b(?:fifth|5th|quinto|cinquieme)\s+(?:day|dia|jour)\b/, day: 5 },
  { re: /\b(?:last|final|ultimo|ultima|dernier|derniere)\s+(?:day|dia|jour|journee)\b/, day: "last" },
];

function indexForWeekday(plan: TripPlan, weekday: number): number | null {
  const index = plan.days.findIndex((day) => new Date(`${day.date}T12:00:00Z`).getUTCDay() === weekday);
  return index >= 0 ? index + 1 : null;
}

function indexForMonthDay(plan: TripPlan, day: number): number | null {
  const hits = plan.days.map((item, index) => ({ index, dom: Number(item.date.slice(8, 10)) })).filter((item) => item.dom === day);
  return hits.length === 1 ? hits[0].index + 1 : null;
}

/** A spoken or model day ref → 1-based index. "ambiguous" when the trip has several days and none was named. */
export function resolveDayRef(day: number | string | undefined, plan: TripPlan, today: string, utterance = ""): number | "ambiguous" {
  const fromField = interpretDay(day === undefined ? "" : loosen(String(day)), plan, today, true);
  if (fromField) return fromField;
  const fromText = interpretDay(loosen(utterance), plan, today, false);
  if (fromText) return fromText;
  return plan.days.length === 1 ? 1 : "ambiguous";
}

function interpretDay(n: string, plan: TripPlan, today: string, field: boolean): number | null {
  if (!n) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(n)) {
    const index = plan.days.findIndex((day) => day.date === n);
    return index >= 0 ? index + 1 : null;
  }
  if (/^\d{1,2}$/.test(n)) {
    const value = Number(n);
    if (value >= 1 && value <= plan.days.length) return value;
    return indexForMonthDay(plan, value);
  }
  if (field && /^(?:second|2nd|segundo|deuxieme)$/.test(n)) return plan.days.length >= 2 ? 2 : null;
  if (field && /^(?:first|1st|primeiro|premier)$/.test(n)) return 1;
  if (field && /^(?:last|ultimo|dernier)$/.test(n)) return plan.days.length;
  for (const row of ORDINAL) {
    if (!row.re.test(n)) continue;
    return row.day === "last" ? plan.days.length : row.day <= plan.days.length ? row.day : null;
  }
  const worded = n.match(/\b(?:day|dia|jour)\s+(one|two|three|four|five|six|seven|um|dois|duas|tres|quatro|cinco|un|deux|trois|quatre|cinq)\b/);
  const spoken = wordNumber(worded?.[1]);
  if (spoken && spoken >= 1 && spoken <= plan.days.length) return spoken;
  for (const row of WEEKDAYS) {
    if (!row.re.test(n)) continue;
    const index = indexForWeekday(plan, row.day);
    if (index) return index;
  }
  if (/\b(?:middle|meio|milieu)\s+(?:day|dia|jour)\b|\b(?:the |o |le )?dia do meio\b|\bjour du milieu\b/.test(n)) {
    if (plan.days.length % 2 === 0) return null;
    return Math.ceil(plan.days.length / 2);
  }
  if (/\b(?:tomorrow|amanha|demain)\b/.test(n)) {
    const date = addDays(today, 1);
    const index = plan.days.findIndex((day) => day.date === date);
    if (index >= 0) return index + 1;
  }
  const numbered = n.match(/\b(?:day|dia|jour|journee)\s+(\d{1,2})\b/);
  if (numbered) {
    const value = Number(numbered[1]);
    if (value >= 1 && value <= plan.days.length) return value;
    return indexForMonthDay(plan, value);
  }
  for (const match of n.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\b/g)) {
    const after = n.slice((match.index ?? 0) + match[0].length);
    if (/^\s*[- ]?(?:year|anos|ans)\b/.test(after) || /^[:h]\d/.test(after)) continue;
    const value = Number(match[1]);
    const ordinal = /(?:st|nd|rd|th)$/.test(match[0]);
    const before = n.slice(Math.max(0, (match.index ?? 0) - 8), match.index ?? 0);
    const headed = /(?:\b(?:day|dia|jour|le|on|no|the)\s+)$/.test(before);
    if (!ordinal && !headed && !field) continue;
    if (headed && !ordinal && value >= 1 && value <= plan.days.length) return value;
    const byDate = indexForMonthDay(plan, value);
    if (byDate) return byDate;
    if (value >= 1 && value <= plan.days.length) return value;
  }
  return null;
}

export function whichDayQuestion(plan: TripPlan, locale: TaskLocale): string {
  const labels = plan.days.map((day) => {
    const date = new Date(`${day.date}T12:00:00Z`);
    const weekday = new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : locale === "fr" ? "fr-FR" : "en-GB", { weekday: "short", timeZone: "UTC" }).format(date).replace(/\.$/, "");
    const n = date.getUTCDate();
    if (locale === "fr") return `${weekday.toLowerCase()}. ${n}`;
    if (locale === "pt") return `${weekday.toLowerCase().slice(0, 3)} ${n}`;
    return `${weekday} ${n}`;
  });
  const or = locale === "en" ? "or" : "ou";
  const list = labels.length <= 1 ? labels[0] ?? "" : `${labels.slice(0, -1).join(", ")} ${or} ${labels.at(-1)}`;
  return say(locale, `Which day: ${list}?`, `Qual dia: ${list}?`, `Quel jour : ${list} ?`);
}

const RELAX = /\b(?:slow(?:er)?|relax\w*|eas(?:y|ier|iest)|chill|lazy|lighter|calm(?:er|e|a)?|quieter|rest(?:ful)?|descans\w*|relaxado|calmo|calma|leve|leger|tranquille|repos|lent(?:o|e)?|mais facil|plus facile)\b/;
const BUSY = /\b(?:busier|more stuff|pack it|fuller|more to do|mais cheio|mais coisas|mais intenso|mais corrido|plus charge|plus de choses|plus intense|plus rempli|enche(?:r)?|remplis|remplir)\b/;
const WHOLE_PACE = /\b(?:slow pace|relaxed pace|easy pace|packed pace|busy days|full days|ritmo calmo|ritmo lento|ritmo intenso|sem pressa|rythme lent|rythme calme|rythme soutenu|journee chargee)\b/;
const SEA = /\b(?:water|waters|sea|ondas?|waves?|mar|mer|vague)\b/;

function specificDay(n: string, plan: TripPlan, today: string): number | null {
  return interpretDay(n, plan, today, false);
}

function mentionsParty(n: string): boolean {
  return /\b(?:adults?|adultos?|adultes?|kids?|children|child|criancas?|enfants?|filho|filha|baby|bebe|toddler|family of|familia de|famille de|year-old|years? old|anos|ans|couple|casal|no kids|sem criancas|sem filhos|sans enfants)\b/.test(n);
}

function namedActivity(n: string): string | null {
  if (/\bsurf\w*/.test(n)) return "surf";
  if (/\b(?:jet ?ski|jetski)\b/.test(n)) return "jetski";
  if (/\bquads?\b/.test(n)) return "quad";
  if (/\b(?:dolphins?|golfinhos?|dauphins?)\b/.test(n)) return "dolphin";
  if (/\b(?:diving|mergulho|plongee)\b/.test(n)) return "diving";
  if (/\b(?:nightlife|nightclub|vida noturna|boite)\b/.test(n)) return "nightlife";
  if (/\b(?:boat trip|passeio de barco|sortie en bateau)\b/.test(n) || /\b(?:barco|bateau|boats?)\b/.test(n)) return "boat";
  return null;
}

/**
 * Regex fallback for the same schema the model emits.
 * Date and length phrases are included so fixtures and the fast path agree;
 * the agent still applies those through the existing date fast path when no model ran.
 */
export function parseEditIntent(text: string, plan: TripPlan | null, today: string): EditIntent | null {
  const n = loosen(text);
  if (!n) return null;
  if (planQuestionKind(text)) return { kind: "question" };
  if (/^(?:hi|hello|hey|ola|oi|bonjour|salut|thanks|thank you|obrigado|obrigada|merci|ok|okay)$/.test(n.replace(/[.!?…]+$/g, "").trim())) return { kind: "greeting" };
  const length = parseLengthEdit(text);
  if (length?.kind === "add") return { kind: "add_day", days: length.n, where: length.where };
  if (length?.kind === "drop-last") return { kind: "remove_day" };
  if (length?.kind === "set") return { kind: "set_dates", days: length.n };
  if (plan && (/\b(?:don'?t|do not|nao quero|without|ne veux pas)\b.{0,40}\b(?:boat|barco|bateau)\b/.test(n)
    || /\b(?:sem|sans|no)\s+(?:um\s+|uma\s+|o\s+|a\s+)?(?:passeio de\s+|saida de\s+|sortie en\s+)?(?:boat|barco|bateau)\b/.test(n)
    || /\b(?:boat|barco|bateau)\b.{0,24}\b(?:off|out)\b/.test(n)
    || /\b(?:remove|drop|tira\w*|remov\w*|retir\w*|enlev\w*|supprim\w*)\b.{0,48}\b(?:boat|barco|bateau)\b/.test(n))) {
    return { kind: "remove_stop", stop: "boat" };
  }
  if (plan) {
    const activity = namedActivity(n);
    if (activity && activity !== "boat") {
      const day = specificDay(n, plan, today);
      const removing = /\b(?:remove|drop|tira\w*|remov\w*|retir\w*|enlev\w*|supprim\w*|sem|sans|without)\b/.test(n);
      const adding = /\b(?:add|acrescent\w*|adicion\w*|inclu\w*|ajout\w*|mettre|mets\b|met\b|poe\w*|want|quero|je veux|fazer surf|faire du surf|go surfing)\b/.test(n);
      const moving = /\b(?:move|passa|passe|deplac\w*)\b/.test(n);
      if (/\bsurf/.test(activity) && moving && /\b(?:morning|manha|matin)\b/.test(n)) return { kind: "swap_stop", stop: "surf", swapWith: "morning" };
      if (/\bsurf/.test(activity) && moving && /\b(?:afternoon|tarde|apres-midi)\b/.test(n)) return { kind: "swap_stop", stop: "surf", swapWith: "afternoon" };
      if (removing && !adding) return { kind: "remove_stop", stop: activity, ...(day ? { day } : {}) };
      if (adding || /\b(?:another|outra|autre)\b/.test(n)) {
        const again = /\b(?:another|outra|autre)\b/.test(n);
        return { kind: "add_activity", activity: again ? `${activity}-another` : activity, ...(day ? { day } : {}) };
      }
    }
  }
  if (plan && /\b(?:afternoon|tarde|apres-midi)\b/.test(n) && /\b(?:free|livre|libre)\b/.test(n)) {
    const named = specificDay(n, plan, today);
    const day = /\b(?:last|ultimo|dernier)\b/.test(n) ? plan.days.length : named ?? plan.days.length;
    return { kind: "relax_day", day };
  }
  if (plan) {
    const day = specificDay(n, plan, today);
    const wholePace = WHOLE_PACE.test(n) && !day;
    const sea = SEA.test(n) && !day;
    // "on tuesday" / "the 17th" is a day of this trip when the guest is editing that day, not a new start.
    const busy = BUSY.test(n) || (/\bpack\b/.test(n) && /\b(?:day|dia|jour|middle|meio|milieu)\b/.test(n));
    const relax = RELAX.test(n) || (/\bquiet\b/.test(n) && /\b(?:day|dia|jour|afternoon|morning|evening|tarde|manha|matin|apres-midi|soir)\b/.test(n));
    if (!wholePace && !sea && busy) return day ? { kind: "busier_day", day } : { kind: "busier_day" };
    if (!wholePace && !sea && relax) return day ? { kind: "relax_day", day } : { kind: "relax_day" };
  }
  const anchor = plan?.days[0]?.date;
  const shift = plan ? parseDateShift(text, today, anchor) : null;
  if (shift && shift !== "ask") {
    if (shift.shiftDays) return { kind: "shift_dates", shiftDays: shift.shiftDays };
    if (shift.start && shift.end) return { kind: "set_dates", start: shift.start, end: shift.end, ...(shift.days ? { days: shift.days } : {}) };
    if (shift.start && shift.days) return { kind: "set_dates", start: shift.start, days: shift.days };
    if (shift.start) return { kind: "shift_dates", start: shift.start };
    if (shift.end) return { kind: "set_dates", end: shift.end };
  }
  if (!plan) return null;
  if (mentionsParty(n) && !/\b\d+\s*(?:days|dias|jours)\b/.test(n)) {
    const party = extractConstraints(text, today).party;
    if (party && (party.adults !== undefined || party.kids !== undefined || party.youngestAge !== undefined)) {
      return {
        kind: "set_party",
        ...(party.adults !== undefined ? { adults: party.adults } : {}),
        ...(party.kids !== undefined ? { kids: party.kids } : {}),
        ...(party.youngestAge !== undefined ? { youngestAge: party.youngestAge } : {}),
      };
    }
  }
  if (/\b(?:boat|barco|bateau)\b/.test(n) && /\b(?:add|acrescent|ajout)\b/.test(n)) {
    const day = specificDay(n, plan, today);
    return { kind: "add_activity", activity: "boat", ...(day ? { day } : {}) };
  }
  return null;
}

const LOCAL_KINDS = new Set<EditIntent["kind"]>(["relax_day", "busier_day", "set_party", "add_activity", "remove_stop", "swap_stop"]);

/** Kinds the regex applies itself when the gateway is absent. Dates stay on the date fast path. */
export function localEditIntent(text: string, plan: TripPlan, today: string): EditIntent | null {
  const intent = parseEditIntent(text, plan, today);
  if (!intent || !LOCAL_KINDS.has(intent.kind)) return null;
  return intent;
}

export function shiftFromIntent(intent: EditIntent): DateShift | "ask" | null {
  if (intent.shiftDays) return { shiftDays: intent.shiftDays };
  const start = intent.start && /^\d{4}-\d{2}-\d{2}$/.test(intent.start) ? intent.start : undefined;
  const end = intent.end && /^\d{4}-\d{2}-\d{2}$/.test(intent.end) ? intent.end : undefined;
  if (start && end) {
    const days = inclusiveDays(start, end);
    if (!days) return "ask";
    return { start, end, days: intent.days ?? days };
  }
  if (start && intent.days) return { start, days: intent.days };
  if (start) return { start };
  if (end) return { end };
  if (intent.days) return { days: intent.days };
  return "ask";
}

export function alreadyPartyReply(locale: TaskLocale, party: { adults: number; kids: number; youngestAge?: number }, baby = false): string {
  const label = partyLabel(locale, party, baby);
  return say(locale, `The plan is already for ${label}.`, `O plano já é para ${label}.`, `Le plan est déjà pour ${label}.`);
}

export function partyEditReply(locale: TaskLocale, party: { adults: number; kids: number; youngestAge?: number }, stopsChanged: boolean, baby = false): string {
  const label = partyLabel(locale, party, baby);
  if (!stopsChanged) return say(locale, `Noted: ${label}. The days stay as they are.`, `Anotado: ${label}. Os dias ficam como estão.`, `Noté : ${label}. Les jours restent comme ils sont.`);
  return say(locale,
    `${label}. I adjusted the days so they stay suitable.`,
    `${label}. Ajustei os dias para ficarem adequados.`,
    `${label}. J'ai ajusté les jours pour que ça convienne.`);
}

const COUNT = {
  en: ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"],
  pt: ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze"],
  fr: ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze"],
};

/** Spell a small count so the reply does not invent a digit the guest did not use. */
function spell(n: number, locale: TaskLocale): string {
  return COUNT[locale][n] ?? String(n);
}

function partyLabel(locale: TaskLocale, party: { adults: number; kids: number; youngestAge?: number }, baby: boolean): string {
  const adults = spell(party.adults, locale);
  if (baby && party.kids === 1) {
    return say(locale, `${adults} adults and a baby`, `${adults} adultos e um bebé`, `${adults} adultes et un bébé`);
  }
  if (party.kids === 1 && party.youngestAge !== undefined) {
    const age = spell(party.youngestAge, locale);
    return say(locale,
      `${adults} adults and a ${age}-year-old`,
      `${adults} adultos e uma criança de ${age} anos`,
      `${adults} adultes et un enfant de ${age} ans`);
  }
  if (party.kids > 1) {
    const kids = spell(party.kids, locale);
    const age = party.youngestAge !== undefined ? spell(party.youngestAge, locale) : "";
    return say(locale,
      `${adults} adults and ${kids} kids${age === "" ? "" : `, youngest ${age}`}`,
      `${adults} adultos e ${kids} crianças${age === "" ? "" : `, a mais nova com ${age}`}`,
      `${adults} adultes et ${kids} enfants${age === "" ? "" : `, le plus jeune a ${age} ans`}`);
  }
  if (party.kids === 0) return say(locale, `${adults} adults, no kids`, `${adults} adultos, sem crianças`, `${adults} adultes, sans enfants`);
  return say(locale, `${adults} adults`, `${adults} adultos`, `${adults} adultes`);
}

const editTool = tool({
  description: "Classify one guest message about the open Maio trip. Call once. Do not invent places, times, or a day that is not on the trip.",
  inputSchema: EditIntentSchema,
  execute: async (input) => input,
});

/** Intent classification stays on a small model and a short clock. Regex covers a miss or a timeout. */
export const INTENT_MODEL = "openai/gpt-5-nano";
export const INTENT_TIMEOUT_MS = 4_000;

export async function intentFromModel(text: string, plan: TripPlan, today: string): Promise<EditIntent | null> {
  const days = plan.days.map((day, index) => `${index + 1}=${day.date}`).join(", ");
  const generated = await generateText({
    model: languageModel(process.env.PLAN_INTENT_MODEL?.trim() || INTENT_MODEL),
    temperature: 0,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(INTENT_TIMEOUT_MS),
    toolChoice: { type: "tool", toolName: "edit_intent" },
    tools: { edit_intent: editTool },
    prompt: [
      `Today is ${today}. Open trip days (index=ISO): ${days}.`,
      "Emit edit_intent for the guest message.",
      "relax_day: slow, relaxed, easy, chill, lazy, lighter, calm, rest day; PT mais calmo/leve/relaxado/descansar; FR plus calme/léger/tranquille/repos.",
      "busier_day: busier, more stuff, pack it, and the PT/FR opposites.",
      "set_dates when both ends are named (arriving X leaving Y, from X to Y, X-Y). shift_dates when only the start moves. Put ISO dates in start and end.",
      "set_party: a 6 year old is kids 1 and youngestAge 6, not kids 0. two kids aged 4 and 9 is kids 2, youngestAge 4. a baby is kids 1, youngestAge 1.",
      "day is a 1-based index or an ISO date. Omit day when the guest did not name one.",
      "question, greeting, or other when the message does not edit the trip.",
      `Guest: ${JSON.stringify(text)}`,
    ].join("\n"),
  });
  const call = generated.toolCalls.find((item) => item.toolName === "edit_intent");
  return call ? intentFromToolInput(call.input) : null;
}
