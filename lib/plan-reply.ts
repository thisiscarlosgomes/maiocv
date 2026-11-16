import type { PlanItem, TripPlan } from "./trip.ts";
import { PLACES, experience, food, localizedPlaceName, place } from "./trip.ts";
import type { TaskLocale } from "./awareness/task.ts";

const intl: Record<TaskLocale, string> = { en: "en-GB", pt: "pt-PT", fr: "fr-FR" };

/** "Mon 16 Nov" / "seg 16 nov" / "lun. 16 nov." */
export function humanPlanDate(iso: string, locale: TaskLocale): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  const weekday = new Intl.DateTimeFormat(intl[locale], { weekday: "short", timeZone: "UTC" }).format(date).replace(/\.$/, "");
  const day = new Intl.DateTimeFormat(intl[locale], { day: "numeric", timeZone: "UTC" }).format(date);
  const month = new Intl.DateTimeFormat(intl[locale], { month: "short", timeZone: "UTC" }).format(date).replace(/\.$/, "");
  if (locale === "pt") return `${weekday.toLowerCase().slice(0, 3)} ${day} ${month.toLowerCase()}`;
  // Weekday keeps its abbreviation mark ("mer."). The date itself does not end with a period, so a sentence can close it.
  if (locale === "fr") return `${weekday.toLowerCase()}. ${day} ${month.toLowerCase()}`;
  return `${weekday} ${day} ${month}`;
}

/** One closing period, even when the last token is already an abbreviation. */
export function closeSentence(text: string): string {
  return `${text.replace(/[.!\s]+$/g, "").trim()}.`;
}

const SLOT: Record<TaskLocale, Record<string, string>> = {
  en: { breakfast: "Breakfast", morning: "Morning", lunch: "Lunch", rest: "Rest", activity: "Activity", sunset: "Sunset", dinner: "Dinner", drinks: "Drinks", arrival: "Arrival", transfer: "Transfer", departure: "Departure" },
  pt: { breakfast: "Pequeno-almoço", morning: "Manhã", lunch: "Almoço", rest: "Descanso", activity: "Atividade", sunset: "Pôr do sol", dinner: "Jantar", drinks: "Bebida", arrival: "Chegada", transfer: "Transfer", departure: "Partida" },
  fr: { breakfast: "Petit-déjeuner", morning: "Matin", lunch: "Déjeuner", rest: "Repos", activity: "Activité", sunset: "Coucher du soleil", dinner: "Dîner", drinks: "Verre", arrival: "Arrivée", transfer: "Transfert", departure: "Départ" },
};

const FREE: Record<TaskLocale, Record<string, string>> = {
  en: { "breakfast-stay": "Breakfast at your stay", "lunch-free": "Lunch near your stay", "dinner-free": "Dinner near your stay", rest: "Free time", "free-time": "Free time", transfer: "Transfer and check-in", "depart-airport": "Depart", "depart-port": "Depart" },
  pt: { "breakfast-stay": "Pequeno-almoço no alojamento", "lunch-free": "Almoço perto do alojamento", "dinner-free": "Jantar perto do alojamento", rest: "Tempo livre", "free-time": "Tempo livre", transfer: "Transfer e check-in", "depart-airport": "Partida", "depart-port": "Partida" },
  fr: { "breakfast-stay": "Petit-déjeuner à l'hébergement", "lunch-free": "Déjeuner près de l'hébergement", "dinner-free": "Dîner près de l'hébergement", rest: "Temps libre", "free-time": "Temps libre", transfer: "Transfert et check-in", "depart-airport": "Départ", "depart-port": "Départ" },
};

/** Guest-facing name. Catalog ids stay out of the sentence. */
export function itemLabel(item: PlanItem, locale: TaskLocale): string {
  if (item.kind === "experience") return (item.note && item.note.length <= 80 ? item.note : undefined) ?? experience(item.refId)?.title ?? SLOT[locale].activity;
  if (item.kind === "food") return food(item.refId)?.title ?? SLOT[locale].lunch;
  if (item.kind === "place") {
    const record = place(item.refId);
    return record ? localizedPlaceName(record.name, locale) : SLOT[locale].activity;
  }
  if (item.kind === "free" && item.refId === "breakfast-stay" && item.note) return item.note;
  if (item.kind === "free") return FREE[locale][item.refId] ?? SLOT[locale][item.slot ?? ""] ?? FREE[locale]["free-time"];
  if (item.kind === "transport") return item.refId === "ferry" ? (locale === "fr" ? "Ferry" : locale === "pt" ? "Barco" : "Ferry") : (locale === "fr" ? "Vol" : locale === "pt" ? "Voo" : "Flight");
  return SLOT[locale].activity;
}

const CATALOG_ID = /\b(?:blue|praia|praias|cidade|food|place|experiences)-[a-z0-9]+(?:-[a-z0-9]+)+\b/gi;
const PROVENANCE = /verif|confirm|récup|recuper|obtido|retrieved|publié|publicado|published/i;

/** Drop ids, slugs and source-type labels the model copies out of tool JSON. */
export function stripPlanLeaks(text: string): string {
  return text
    .replace(/\s*\((?:food|experience|place|transport|free)\s+listing\)/gi, "")
    .replace(/\s*\(id\s+[^)]+\)/gi, "")
    .replace(/\b(?:we list that by id|listed by id|list(?:ed)? by id|catalog id|source type)\s*:\s*[a-z0-9-]+/gi, "")
    .replace(/\b(?:food|experience|place|transport)\s+listing\b/gi, "")
    .replace(CATALOG_ID, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,;:])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .trim();
}

export function humanizePlanDates(text: string, locale: TaskLocale): string {
  return text.replace(/\b(20\d{2}-\d{2}-\d{2})\b/g, (iso, _day, offset: number, whole: string) => {
    const before = whole.slice(Math.max(0, offset - 48), offset);
    if (PROVENANCE.test(before)) return iso;
    return humanPlanDate(iso, locale);
  });
}

/** A model that glued "Day 1 — date - 08:10 — …" onto one line. */
const DAY_HEADING = /\b(?:day|dia|jour)\s+\d+\b\s*[—–-]/i;

export function looksLikeItineraryDump(text: string): boolean {
  const clocks = text.match(/\b\d{1,2}:\d{2}\b/g)?.length ?? 0;
  const heading = DAY_HEADING.test(text);
  const overview = /\boverview\b|\blength\s*:|\bpace\s*:/i.test(text);
  const oneLine = !text.includes("\n");
  return (heading && clocks >= 1) || (overview && (clocks >= 1 || heading)) || (oneLine && clocks >= 3) || (oneLine && heading && text.length > 140);
}

/** Split a glued itinerary. "on day 2" / "o dia 2" / "au jour 2" stay inside the sentence. */
export function expandRunOn(text: string): string {
  if (text.includes("\n") || text.length < 80) return text;
  let next = text.replace(/\s+(?=(?:#{1,3}\s*)?(?:day|dia|jour)\s+\d+\b\s*[—–-])/gi, "\n\n");
  next = next.replace(/\s+[-–—]\s+(?=\d{1,2}:\d{2}\b)/g, "\n- ");
  next = next.replace(/\s+(?=\d{1,2}:\d{2}\s+[—–-])/g, "\n");
  if (!next.includes("\n") && (next.match(/\s+[-–—]\s+/g)?.length ?? 0) >= 3) {
    next = next.replace(/\s+[-–—]\s+/g, "\n- ");
  }
  return next;
}

function intro(plan: TripPlan): string {
  const n = plan.days.length;
  if (plan.locale === "pt") return `Aqui está o plano de ${n} ${n === 1 ? "dia" : "dias"}.`;
  if (plan.locale === "fr") return `Voici le plan de ${n} ${n === 1 ? "jour" : "jours"}.`;
  return `Here is the ${n}-day plan.`;
}

function notes(plan: TripPlan): string {
  const locale = plan.locale;
  const lines: string[] = [];
  const unmet = plan.unmet.map((item) => stripPlanLeaks(item)).filter((item) => item && !/^[a-z0-9-]+$/i.test(item));
  if (unmet.length) {
    const label = locale === "pt" ? "Ainda não temos" : locale === "fr" ? "Pas encore dans les listes" : "Not in the listings yet";
    lines.push(`${label}: ${unmet.join(", ")}.`);
  }
  lines.push(locale === "pt" ? "Os horários são sugestões." : locale === "fr" ? "Les horaires sont des suggestions." : "Times are suggestions.");
  return lines.join(" ");
}

/** Short intro, one heading per day, one line per stop, then notes. */
export function formatItinerary(plan: TripPlan): string {
  const locale = plan.locale;
  const dayWord = locale === "pt" ? "Dia" : locale === "fr" ? "Jour" : "Day";
  const blocks = plan.days.map((day, index) => {
    const rows = day.items.map((item) => {
      const slot = SLOT[locale][item.slot ?? ""] ?? "";
      const name = itemLabel(item, locale);
      const clock = item.start ?? (locale === "pt" ? "hora por publicar" : locale === "fr" ? "heure non publiée" : "time not published");
      const what = slot && !name.toLowerCase().startsWith(slot.toLowerCase()) ? `${slot}: ${name}` : name;
      return `- ${clock} ${what}`;
    });
    return `## ${dayWord} ${index + 1} — ${humanPlanDate(day.date, locale)}\n\n${rows.join("\n")}`;
  });
  return `${intro(plan)}\n\n${blocks.join("\n\n")}\n\n## ${locale === "pt" ? "Notas" : locale === "fr" ? "Notes" : "Notes"}\n\n${notes(plan)}`;
}

const MENU = /options i can|finish the full day-by-day|which of these|i can do now/i;
const UNFINISHED = /itinerary (?:is|i) (?:unfinished|started)|i started the itinerary|finish the full/i;

const EN_LABELS: { en: string; pt: string; fr: string }[] = [
  { en: "Free time · shade & rest", pt: "Tempo livre · sombra e descanso", fr: "Temps libre · ombre et repos" },
  { en: "Breakfast at your stay", pt: "Pequeno-almoço no alojamento", fr: "Petit-déjeuner à l'hébergement" },
  { en: "Lunch near your stay", pt: "Almoço perto do alojamento", fr: "Déjeuner près de l'hébergement" },
  { en: "Dinner near your stay", pt: "Jantar perto do alojamento", fr: "Dîner près de l'hébergement" },
  { en: "Transfer and check-in", pt: "Transfer e check-in", fr: "Transfert et check-in" },
  { en: "Transfer & check-in", pt: "Transfer e check-in", fr: "Transfert et check-in" },
  { en: "Head to the airport", pt: "Ir para o aeroporto", fr: "Direction l'aéroport" },
  { en: "Head to the port", pt: "Ir para o porto", fr: "Direction le port" },
  { en: "Free time", pt: "Tempo livre", fr: "Temps libre" },
];

function replaceTerm(text: string, from: string, to: string): string {
  if (!from || from === to) return text;
  return text.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), to);
}

/** UI phrases and place names. French has no names in the dataset, so it uses Portuguese. */
export function localizeGuestLabels(text: string, locale: TaskLocale): string {
  if (locale === "en") return text;
  let next = text;
  for (const row of EN_LABELS) next = replaceTerm(next, row.en, locale === "pt" ? row.pt : row.fr);
  if (locale === "pt" || locale === "fr") {
    const names = PLACES
      .map((item) => ({ en: item.name.en.trim(), pt: item.name.pt.trim() }))
      .filter((item) => item.en && item.en !== item.pt)
      .sort((a, b) => b.en.length - a.en.length);
    for (const item of names) next = replaceTerm(next, item.en, item.pt);
  }
  return next;
}

function shortDaySentence(plan: TripPlan): string {
  const note = plan.days.at(-1)?.items.find((item) => item.slot === "departure")?.note ?? "";
  return /^(?:Short day|Dia curto|Journée courte)\b/.test(note) ? ` ${note}` : "";
}

/** Two lines under the trip card. The card holds the stops. */
export function planBlurb(plan: TripPlan, stance?: "yes" | "no" | "unsure" | null): string {
  const n = plan.days.length;
  const relaxed = plan.pace !== "normal";
  const locale = plan.locale;
  const short = shortDaySentence(plan);
  if (locale === "pt") {
    const pace = relaxed ? "Calmo, " : "Cheio, ";
    const car = plan.hasCar ? "de carro" : "sem carro";
    const line = short ? `${pace}${n} ${n === 1 ? "dia" : "dias"} ${car} — ${short.trim()}` : `${pace}${n} ${n === 1 ? "dia" : "dias"} ${car}.`;
    const second = stance === "unsure"
      ? "Assumo um carro alugado. Diga se não for o caso."
      : "Toque no cartão para cada dia. Quer mudanças?";
    return `${line}\n${second}`;
  }
  if (locale === "fr") {
    const pace = relaxed ? "Tranquille, " : "Chargé, ";
    const car = plan.hasCar ? "avec une voiture" : "sans voiture";
    const line = short ? `${pace}${n} ${n === 1 ? "jour" : "jours"} ${car} — ${short.trim()}` : `${pace}${n} ${n === 1 ? "jour" : "jours"} ${car}.`;
    const second = stance === "unsure"
      ? "Je pars sur une voiture de location. Dites-le si ce n'est pas le cas."
      : "Touchez la carte pour chaque jour. Vous voulez changer quelque chose ?";
    return `${line}\n${second}`;
  }
  const pace = relaxed ? "Slow " : "Packed ";
  const car = plan.hasCar ? "with a car" : "without a car";
  const line = short ? `${pace}${n} ${n === 1 ? "day" : "days"} ${car} — ${short.trim()}` : `${pace}${n} ${n === 1 ? "day" : "days"} ${car}.`;
  const second = stance === "unsure"
    ? "I'm assuming a rental car. Say if you won't have one."
    : "Tap the card for each day. Want changes?";
  return `${line}\n${second}`;
}

/** A formatted day list the dump detector misses: headings, clocks, many lines. */
export function looksLikeSchedule(text: string): boolean {
  const clocks = text.match(/\b\d{1,2}:\d{2}\b/g)?.length ?? 0;
  const lines = text.split("\n").filter((line) => line.trim()).length;
  return clocks >= 4 || (lines >= 8 && clocks >= 2);
}

/**
 * Last step before a reply reaches the chat. A plan the guest can open as a card
 * stays a line or two. Short answers pass through. Ids and ISO dates do not.
 */
export function publicPlanReply(reply: string, locale: TaskLocale, plan: TripPlan | null, stance?: "yes" | "no" | "unsure" | null): string {
  const cleaned = humanizePlanDates(stripPlanLeaks(reply), locale).replace(/\n{3,}/g, "\n\n").trim();
  if (plan && (looksLikeItineraryDump(reply) || looksLikeItineraryDump(cleaned) || looksLikeSchedule(reply) || looksLikeSchedule(cleaned) || (UNFINISHED.test(cleaned) && plan.days.length > 0 && cleaned.length > 180))) {
    return planBlurb(plan, stance);
  }
  if (MENU.test(cleaned) || (plan && UNFINISHED.test(cleaned))) {
    const first = cleaned.split(/(?<=[.!?])\s+/)[0]?.trim() ?? cleaned;
    return localizeGuestLabels(first, locale);
  }
  return localizeGuestLabels(expandRunOn(cleaned).trim(), locale);
}
