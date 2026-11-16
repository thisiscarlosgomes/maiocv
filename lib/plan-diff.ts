import type { TaskLocale } from "./awareness/task.ts";
import { toMin } from "./full-day.ts";
import { partyEditReply } from "./plan-intent.ts";
import { closeSentence, humanPlanDate, itemLabel, looksLikeItineraryDump, looksLikeSchedule } from "./plan-reply.ts";
import { experience, localizedPlaceName, place, type PlanItem, type TripPlan } from "./trip.ts";

function say(locale: TaskLocale, en: string, pt: string, fr: string): string {
  return locale === "pt" ? pt : locale === "fr" ? fr : en;
}

const SLOT: Record<TaskLocale, Record<string, string>> = {
  en: { breakfast: "breakfast", morning: "morning", lunch: "lunch", dinner: "dinner", sunset: "sunset", activity: "activity", drinks: "drinks" },
  pt: { breakfast: "pequeno-almoço", morning: "manhã", lunch: "almoço", dinner: "jantar", sunset: "pôr do sol", activity: "atividade", drinks: "bebida" },
  fr: { breakfast: "petit-déjeuner", morning: "matin", lunch: "déjeuner", dinner: "dîner", sunset: "coucher du soleil", activity: "activité", drinks: "verre" },
};

/** A rebuilt plan's stock summary. An edit reply must not be this. */
export function isGenericPlanReply(text: string): boolean {
  const line = text.trim();
  if (!line) return true;
  if (/Tap the card|Toque no cartão|Touchez la carte/i.test(line)) return true;
  if (/^(?:Slow |Packed |Calmo,|Cheio,|Tranquille,|Chargé,)/.test(line)) return true;
  return looksLikeItineraryDump(line) || looksLikeSchedule(line);
}

function isSurfItem(item: PlanItem): boolean {
  const exp = item.kind === "experience" ? experience(item.refId) : undefined;
  return Boolean(exp && /surf|ondaazul/i.test(`${exp.id} ${exp.title}`));
}

function isBoatItem(item: PlanItem): boolean {
  return item.kind === "experience" && Boolean(experience(item.refId)?.boat);
}

function placeOf(item: PlanItem, locale: TaskLocale): string | null {
  if (item.kind === "experience") {
    const exp = experience(item.refId);
    const spot = exp ? place(exp.placeId) : undefined;
    if (spot) return localizedPlaceName(spot.name, locale);
    return exp?.location ?? null;
  }
  if (item.kind === "place") {
    const spot = place(item.refId);
    return spot ? localizedPlaceName(spot.name, locale) : null;
  }
  return null;
}

type Stop = { key: string; item: PlanItem; day: number; date: string };

function guestStops(plan: TripPlan): Stop[] {
  const stops: Stop[] = [];
  plan.days.forEach((day, index) => {
    for (const item of day.items) {
      if (item.kind !== "place" && item.kind !== "food" && item.kind !== "experience") continue;
      stops.push({ key: `${item.kind}:${item.refId}`, item, day: index + 1, date: day.date });
    }
  });
  return stops;
}

function pairStops(before: Stop[], after: Stop[]): { pairs: [Stop, Stop][]; added: Stop[]; removed: Stop[] } {
  const usedBefore = new Set<number>();
  const usedAfter = new Set<number>();
  const pairs: [Stop, Stop][] = [];
  const take = (sameDay: boolean) => {
    for (let i = 0; i < after.length; i += 1) {
      if (usedAfter.has(i)) continue;
      const match = before.findIndex((stop, index) => !usedBefore.has(index) && stop.key === after[i].key && (!sameDay || stop.day === after[i].day));
      if (match < 0 || (sameDay && before[match].day !== after[i].day)) continue;
      usedBefore.add(match);
      usedAfter.add(i);
      pairs.push([before[match], after[i]]);
    }
  };
  take(true);
  take(false);
  return {
    pairs,
    added: after.filter((_, index) => !usedAfter.has(index)),
    removed: before.filter((_, index) => !usedBefore.has(index)),
  };
}

function addedSentence(stop: Stop, locale: TaskLocale): string {
  const n = stop.day;
  const when = humanPlanDate(stop.date, locale);
  const time = stop.item.start ?? "";
  const clock = time ? `, ${time}` : "";
  if (isSurfItem(stop.item)) {
    const where = placeOf(stop.item, locale) ?? say(locale, "the beach", "a praia", "la plage");
    return say(locale,
      `Added surf at ${where} on day ${n} (${when})${clock}`,
      `Acrescentei surf na ${where} no dia ${n} (${when})${clock}`,
      `J'ai ajouté le surf à ${where} le jour ${n} (${when})${clock}`);
  }
  if (isBoatItem(stop.item)) {
    const title = itemLabel(stop.item, locale);
    return say(locale,
      `Added ${title} on day ${n} (${when})${clock}`,
      `Acrescentei ${title} no dia ${n} (${when})${clock}`,
      `J'ai ajouté ${title} au jour ${n} (${when})${clock}`);
  }
  const name = itemLabel(stop.item, locale);
  const where = stop.item.kind === "place" ? "" : placeOf(stop.item, locale);
  const at = where && where !== name ? ` ${say(locale, "at", "em", "à")} ${where}` : "";
  return say(locale,
    `Added ${name}${at} on day ${n} (${when})${clock}`,
    `Acrescentei ${name}${at} no dia ${n} (${when})${clock}`,
    `J'ai ajouté ${name}${at} au jour ${n} (${when})${clock}`);
}

function removedSentence(stop: Stop, locale: TaskLocale): string {
  const n = stop.day;
  if (isBoatItem(stop.item)) {
    return say(locale,
      `Removed the boat trip from day ${n}`,
      `Tirei o passeio de barco do dia ${n}`,
      `J'ai retiré la sortie en bateau du jour ${n}`);
  }
  if (isSurfItem(stop.item)) {
    return say(locale,
      `Removed surf from day ${n}`,
      `Tirei o surf do dia ${n}`,
      `J'ai retiré le surf du jour ${n}`);
  }
  const name = itemLabel(stop.item, locale);
  return say(locale,
    `Removed ${name} from day ${n}`,
    `Tirei ${name} do dia ${n}`,
    `J'ai retiré ${name} du jour ${n}`);
}

function movedSlotSentence(from: Stop, to: Stop, locale: TaskLocale): string {
  const slot = SLOT[locale][to.item.slot ?? ""] ?? say(locale, "the stop", "a paragem", "l'arrêt");
  const name = itemLabel(to.item, locale);
  const time = to.item.start ? `, ${to.item.start}` : "";
  const ptSlot = slot === "manhã" ? "a manhã" : `o ${slot}`;
  return say(locale,
    `Moved ${slot} on day ${to.day} to ${name}${time}`,
    `Mudei ${ptSlot} do dia ${to.day} para ${name}${time}`,
    `J'ai déplacé le ${slot} du jour ${to.day} à ${name}${time}`);
}

function movedTimeSentence(from: Stop, to: Stop, locale: TaskLocale): string {
  const time = to.item.start ?? "";
  const morning = time && toMin(time) < 12 * 60;
  const afternoon = time && toMin(time) >= 12 * 60;
  const wasMorning = from.item.start ? toMin(from.item.start) < 12 * 60 : false;
  if (isSurfItem(to.item) && morning && !wasMorning) {
    return say(locale,
      `Moved surf on day ${to.day} to the morning, ${time}`,
      `Passei o surf do dia ${to.day} para a manhã, ${time}`,
      `J'ai déplacé le surf du jour ${to.day} au matin, ${time}`);
  }
  if (isSurfItem(to.item) && afternoon && wasMorning) {
    return say(locale,
      `Moved surf on day ${to.day} to the afternoon, ${time}`,
      `Passei o surf do dia ${to.day} para a tarde, ${time}`,
      `J'ai déplacé le surf du jour ${to.day} à l'après-midi, ${time}`);
  }
  const name = isSurfItem(to.item) ? "surf" : isBoatItem(to.item)
    ? say(locale, "the boat trip", "o passeio de barco", "la sortie en bateau")
    : itemLabel(to.item, locale);
  if (from.day !== to.day) {
    return say(locale,
      `Moved ${name} from day ${from.day} to day ${to.day}${time ? `, ${time}` : ""}`,
      `Mudei ${name} do dia ${from.day} para o dia ${to.day}${time ? `, ${time}` : ""}`,
      `J'ai déplacé ${name} du jour ${from.day} au jour ${to.day}${time ? `, ${time}` : ""}`);
  }
  return say(locale,
    `Moved ${name} on day ${to.day} to ${time}`,
    `Mudei ${name} no dia ${to.day} para as ${time}`,
    `J'ai déplacé ${name} du jour ${to.day} à ${time}`);
}

function experienceDelta(before: TripPlan, after: TripPlan): boolean {
  const ids = (plan: TripPlan) => plan.days.flatMap((day) => day.items.filter((item) => item.kind === "experience").map((item) => item.refId)).sort().join(",");
  return ids(before) !== ids(after);
}

function dayGuestSig(plan: TripPlan, index: number): string {
  const day = plan.days[index];
  if (!day) return "";
  return JSON.stringify(day.items.filter((item) => item.kind === "place" || item.kind === "food" || item.kind === "experience").map((item) => `${item.kind}:${item.refId}:${item.start ?? ""}`));
}

function singleDayIndex(before: TripPlan, after: TripPlan): number | null {
  if (before.days.length !== after.days.length) return null;
  const changed: number[] = [];
  for (let index = 0; index < before.days.length; index += 1) {
    if (dayGuestSig(before, index) !== dayGuestSig(after, index)) changed.push(index);
  }
  return changed.length === 1 ? changed[0] : null;
}

function visible(items: PlanItem[]): number {
  return items.filter((item) => item.kind === "food" || item.kind === "place" || item.kind === "experience").length;
}

function relaxSentence(before: TripPlan, after: TripPlan, locale: TaskLocale): string | null {
  const index = singleDayIndex(before, after);
  if (index === null || experienceDelta(before, after)) return null;
  const from = before.days[index];
  const to = after.days[index];
  if (!from || !to || visible(to.items) >= visible(from.items)) return null;
  const free = to.items.some((item) => item.kind === "free" && item.durationMin >= 180);
  if (!free) return null;
  const morning = to.items.find((item) => item.kind === "place" && item.slot === "morning") ?? to.items.find((item) => item.kind === "place");
  const sunset = to.items.find((item) => item.kind === "place" && item.slot === "sunset" && item !== morning);
  const morningName = morning ? itemLabel(morning, locale) : say(locale, "a morning beach", "a praia da manhã", "la plage du matin");
  const sunsetName = sunset ? itemLabel(sunset, locale) : null;
  const tail = sunsetName
    ? say(locale, `, then sunset at ${sunsetName}`, `, e depois o pôr do sol em ${sunsetName}`, `, puis le coucher du soleil à ${sunsetName}`)
    : say(locale, ", then sunset", ", e depois o pôr do sol", ", puis le coucher du soleil");
  const day = index + 1;
  return say(locale,
    `Day ${day} is lighter now: ${morningName} in the morning, a long afternoon free${tail}.`,
    `O dia ${day} ficou mais leve: ${morningName} de manhã, uma tarde longa livre${tail}.`,
    `Le jour ${day} est plus léger : ${morningName} le matin, un long après-midi libre${tail}.`);
}

function busySentence(before: TripPlan, after: TripPlan, locale: TaskLocale): string | null {
  const index = singleDayIndex(before, after);
  if (index === null || experienceDelta(before, after)) return null;
  const from = before.days[index];
  const to = after.days[index];
  if (!from || !to || visible(to.items) <= visible(from.items)) return null;
  const when = humanPlanDate(to.date, locale);
  const added = to.items.find((item) => item.kind === "place" && !from.items.some((prev) => prev.refId === item.refId))
    ?? to.items.find((item) => item.kind === "food" && !from.items.some((prev) => prev.refId === item.refId));
  const name = added ? itemLabel(added, locale) : say(locale, "another stop", "outra paragem", "un autre arrêt");
  const count = visible(to.items);
  return say(locale,
    `${when} is busier now: ${count} stops, including ${name}.`,
    `${when} ficou mais cheio: ${count} paragens, incluindo ${name}.`,
    `${when} est plus chargé : ${count} arrêts, dont ${name}.`);
}

function spanSentence(before: TripPlan, after: TripPlan, locale: TaskLocale): string | null {
  const same = before.days.length === after.days.length
    && before.days[0]?.date === after.days[0]?.date
    && before.days.at(-1)?.date === after.days.at(-1)?.date;
  if (same || !after.days.length) return null;
  const n = after.days.length;
  const start = humanPlanDate(after.days[0].date, locale);
  const end = humanPlanDate(after.days.at(-1)!.date, locale);
  if (before.days.length !== after.days.length) {
    return closeSentence(say(locale,
      `Your trip now runs ${n} ${n === 1 ? "day" : "days"}, ${start} to ${end}`,
      `A viagem passa a ter ${n} ${n === 1 ? "dia" : "dias"}, de ${start} a ${end}`,
      `Le voyage fait maintenant ${n} ${n === 1 ? "jour" : "jours"}, du ${start} au ${end}`));
  }
  return closeSentence(say(locale,
    `Moved your ${n} days to ${start} – ${end}`,
    `Mudei os ${n} dias para ${start} – ${end}`,
    `J'ai déplacé vos ${n} jours : ${start} – ${end}`));
}

function partyChanged(before: TripPlan, after: TripPlan): boolean {
  return before.party.adults !== after.party.adults
    || before.party.kids !== after.party.kids
    || before.party.youngestAge !== after.party.youngestAge;
}

function stopsSig(plan: TripPlan): string {
  return JSON.stringify(plan.days.map((day) => day.items.map((item) => `${item.kind}:${item.refId}:${item.slot ?? ""}:${item.start ?? ""}`)));
}

function departureStart(plan: TripPlan): string | undefined {
  return plan.days.at(-1)?.items.find((item) => item.slot === "departure" || item.refId.startsWith("depart-"))?.start;
}

function rank(text: string, ask: string): number {
  const folded = ask.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (/\bsurf/.test(folded) && /surf/i.test(text)) return 0;
  if (/\b(?:boat|barco|bateau)\b/.test(folded) && /boat|barco|bateau|fishing/i.test(text)) return 0;
  if (/^Added |^Acrescentei |^J'ai ajouté /i.test(text)) return 1;
  if (/^Moved |^Mudei |^Passei |^J'ai déplacé /i.test(text)) return 2;
  if (/^Removed |^Tirei |^J'ai retiré /i.test(text)) return 3;
  return 4;
}

function formatChanges(parts: string[], locale: TaskLocale): string {
  const shown = parts.slice(0, 3);
  const extra = parts.length - shown.length;
  const line = shown.map((part) => closeSentence(part.replace(/[.!\s]+$/g, ""))).join(" ");
  if (extra <= 0) return line;
  const more = closeSentence(say(locale,
    `Also ${extra} other ${extra === 1 ? "change" : "changes"}`,
    `Mais ${extra} ${extra === 1 ? "mudança" : "mudanças"}`,
    `Et ${extra} autre${extra === 1 ? "" : "s"} changement${extra === 1 ? "" : "s"}`));
  return `${line}\n${more}`;
}

function itemSentences(before: TripPlan, after: TripPlan, locale: TaskLocale): string[] {
  const { pairs, added, removed } = pairStops(guestStops(before), guestStops(after));
  const sentences: string[] = [];
  const consumedAdd = new Set<Stop>();
  const consumedRemove = new Set<Stop>();
  for (const rem of removed) {
    const swap = added.find((item) => !consumedAdd.has(item)
      && item.day === rem.day
      && item.item.kind === rem.item.kind
      && item.item.slot
      && item.item.slot === rem.item.slot
      && (item.item.kind === "food" || item.item.kind === "place"));
    if (!swap) continue;
    consumedAdd.add(swap);
    consumedRemove.add(rem);
    sentences.push(movedSlotSentence(rem, swap, locale));
  }
  for (const [from, to] of pairs) {
    if (from.item.start === to.item.start && from.day === to.day) continue;
    sentences.push(movedTimeSentence(from, to, locale));
  }
  for (const stop of added) {
    if (consumedAdd.has(stop)) continue;
    if (stop.item.kind === "experience") {
      const exp = experience(stop.item.refId);
      const beach = removed.find((item) => !consumedRemove.has(item) && item.day === stop.day && item.item.kind === "place" && item.item.refId === exp?.placeId);
      if (beach) consumedRemove.add(beach);
    }
    sentences.push(addedSentence(stop, locale));
  }
  for (const stop of removed) {
    if (consumedRemove.has(stop)) continue;
    sentences.push(removedSentence(stop, locale));
  }
  const departBefore = departureStart(before);
  const departAfter = departureStart(after);
  if (departAfter && departAfter !== departBefore) {
    sentences.push(say(locale,
      `The last day now leaves at ${departAfter}`,
      `O último dia passa a sair às ${departAfter}`,
      `Le dernier jour part maintenant à ${departAfter}`));
  }
  const arriveBefore = before.days[0]?.items.find((item) => item.kind === "transport")?.start;
  const arriveAfter = after.days[0]?.items.find((item) => item.kind === "transport")?.start;
  if (arriveAfter && arriveAfter !== arriveBefore) {
    sentences.push(say(locale,
      `Day 1 now starts after ${arriveAfter}`,
      `O dia 1 passa a começar depois das ${arriveAfter}`,
      `Le jour 1 commence maintenant après ${arriveAfter}`));
  }
  return sentences;
}

/**
 * What changed between two plans, in one or two lines.
 * Null when the guest-facing stops, dates and party are the same.
 */
export function editDiffReply(before: TripPlan, after: TripPlan, locale: TaskLocale, ask = ""): string | null {
  const span = spanSentence(before, after, locale);
  if (span) return span;
  if (partyChanged(before, after)) {
    return partyEditReply(locale, after.party, stopsSig(before) !== stopsSig(after), false);
  }
  const lighter = relaxSentence(before, after, locale);
  if (lighter) return lighter;
  const busier = busySentence(before, after, locale);
  if (busier) return busier;
  let sentences = itemSentences(before, after, locale);
  sentences.sort((a, b) => rank(a, ask) - rank(b, ask));
  if (before.hasCar !== after.hasCar) {
    const lead = say(locale,
      after.hasCar ? "Updated: with a car" : "Updated: no car",
      after.hasCar ? "Atualizado: de carro" : "Atualizado: sem carro",
      after.hasCar ? "Mis à jour : avec une voiture" : "Mis à jour : sans voiture");
    sentences = [lead, ...sentences];
  }
  if (!sentences.length && before.pace !== after.pace) {
    const slow = (after.pace ?? "slow") !== "normal";
    return say(locale,
      slow ? "The days are slower now." : "The days are fuller now.",
      slow ? "Os dias ficaram mais calmos." : "Os dias ficaram mais cheios.",
      slow ? "Les jours sont plus calmes." : "Les jours sont plus chargés.");
  }
  if (!sentences.length) return null;
  return formatChanges(sentences, locale);
}
