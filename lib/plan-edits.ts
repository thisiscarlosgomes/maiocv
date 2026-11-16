import type { LastPlace, TaskLocale } from "./awareness/task.ts";
import { anchoredCount, resolveOverlaps, toMin } from "./full-day.ts";
import { editDiffReply } from "./plan-diff.ts";
import { applyLength, MAX_TRIP_DAYS, planQuestionKind, type EndShiftProblem, type LengthEdit } from "./plan-router.ts";
import { closeSentence, humanPlanDate, itemLabel } from "./plan-reply.ts";
import { addDays, EXPERIENCES, FOOD, PLACES, distanceKm, experience, food, isExcludedExperience, localizedPlaceName, place, type Experience, type PlanItem, type TripPlan } from "./trip.ts";

/** Meals and anchored places. Free rows and the arrival header are not stops. */
export function visibleStops(items: PlanItem[]): number {
  return items.filter((item) => item.kind === "food" || item.kind === "place" || item.kind === "experience").length;
}

export function visibleStopCount(plan: TripPlan): number {
  return plan.days.reduce((total, day) => total + visibleStops(day.items), 0);
}

function say(locale: TaskLocale, en: string, pt: string, fr: string): string {
  return locale === "pt" ? pt : locale === "fr" ? fr : en;
}

function placeName(item: PlanItem | undefined, locale: TaskLocale): string | null {
  if (!item || item.kind === "free" || item.kind === "transport") return null;
  const name = itemLabel(item, locale).trim();
  return name || null;
}

/** Rebuild one day with a morning place, a long free afternoon, and sunset. Other days stay. */
export function relaxDay(plan: TripPlan, dayNumber: number, locale: TaskLocale = plan.locale): { plan: TripPlan; reply: string; reduced: boolean } | null {
  const index = dayNumber - 1;
  const day = plan.days[index];
  if (!day) return null;
  const morning = day.items.find((item) => item.kind === "place" && item.slot === "morning") ?? day.items.find((item) => item.kind === "place");
  const sunset = day.items.find((item) => item.kind === "place" && item.slot === "sunset" && item !== morning);
  const structural = day.items.filter((item) => item.kind === "transport" || item.slot === "departure" || (item.kind === "free" && item.refId.startsWith("depart-")));
  const items: PlanItem[] = structural.map((item) => ({ ...item }));
  if (morning) items.push({ ...morning, id: `d${index}-morning`, slot: "morning", start: morning.start ?? "10:30", durationMin: Math.min(morning.durationMin || 90, 120), note: undefined });
  items.push({ id: `d${index}-afternoon`, kind: "free", refId: "free-time", slot: "rest", start: "12:30", durationMin: 240 });
  if (sunset) items.push({ ...sunset, id: `d${index}-sunset`, slot: "sunset", start: sunset.start ?? "17:45", durationMin: Math.min(sunset.durationMin || 45, 60), note: undefined });
  const nextItems = resolveOverlaps(items).slice(0, 9);
  const changed = JSON.stringify(day.items) !== JSON.stringify(nextItems);
  const described = changed ? nextItems : day.items;
  const morningName = placeName(described.find((item) => item.kind === "place" && item.slot === "morning") ?? described.find((item) => item.kind === "place"), locale) ?? say(locale, "a morning beach", "a praia da manhã", "la plage du matin");
  const sunsetItem = described.find((item) => item.kind === "place" && item.slot === "sunset");
  const sunsetName = placeName(sunsetItem, locale);
  const reply = relaxReply(locale, dayNumber, morningName, sunsetName, changed);
  if (!changed) return { plan, reply, reduced: false };
  return {
    plan: { ...plan, days: plan.days.map((item, i) => i === index ? { ...day, items: nextItems } : item) },
    reply,
    reduced: true,
  };
}

/** One or two extra stops on a day that should feel fuller, still inside a slow day. Other days stay. */
export function busyDay(plan: TripPlan, dayNumber: number, locale: TaskLocale = plan.locale): { plan: TripPlan; reply: string; changed: boolean } | null {
  const index = dayNumber - 1;
  const day = plan.days[index];
  if (!day) return null;
  const before = visibleStops(day.items);
  const when = humanPlanDate(day.date, locale);
  const full = {
    plan,
    changed: false,
    reply: say(locale, `${when} is already a full day.`, `${when} já está cheio.`, `${when} est déjà bien rempli.`),
  };
  if (before >= 6) return full;
  const used = new Set(plan.days.flatMap((item) => item.items.map((stop) => stop.refId)));
  const room = Math.min(2, 6 - before);
  const additions: PlanItem[] = [];
  const beach = PLACES.find((item) => item.category === "beach" && !used.has(item.id));
  if (beach && additions.length < room) {
    additions.push({ id: `d${index}-busy`, kind: "place", refId: beach.id, slot: "activity", start: "15:30", durationMin: 75 });
    used.add(beach.id);
  }
  const meal = FOOD.find((item) => !used.has(item.id));
  if (meal && additions.length < room && !day.items.some((item) => item.slot === "lunch" && item.kind === "food")) {
    additions.push({ id: `d${index}-busy-lunch`, kind: "food", refId: meal.id, slot: "lunch", start: "13:00", durationMin: 75 });
  }
  if (!additions.length) return full;
  const dropFree = additions.length;
  let dropped = 0;
  const kept = day.items.filter((item) => {
    if (dropped < dropFree && item.kind === "free" && (item.refId === "free-time" || item.slot === "rest") && item.durationMin >= 90) {
      dropped += 1;
      return false;
    }
    return true;
  });
  const nextItems = resolveOverlaps([...kept, ...additions]).slice(0, 9);
  const after = visibleStops(nextItems);
  if (after <= before) return full;
  const name = beach ? localizedPlaceName(beach.name, locale) : meal?.title ?? "";
  return {
    changed: true,
    plan: { ...plan, days: plan.days.map((item, i) => i === index ? { ...day, items: nextItems } : item) },
    reply: say(locale,
      `${when} is busier now: ${after} stops, including ${name}.`,
      `${when} ficou mais cheio: ${after} paragens, incluindo ${name}.`,
      `${when} est plus chargé : ${after} arrêts, dont ${name}.`),
  };
}

function relaxReply(locale: TaskLocale, day: number, morning: string, sunset: string | null, reduced: boolean): string {
  const tail = sunset
    ? say(locale, `, then sunset at ${sunset}`, `, e depois o pôr do sol em ${sunset}`, `, puis le coucher du soleil à ${sunset}`)
    : say(locale, ", then sunset", ", e depois o pôr do sol", ", puis le coucher du soleil");
  if (!reduced) {
    return say(locale,
      `Day ${day} is already the lighter version: ${morning} in the morning, a long afternoon free${tail}.`,
      `O dia ${day} já está mais leve: ${morning} de manhã, uma tarde longa livre${tail}.`,
      `Le jour ${day} est déjà plus léger : ${morning} le matin, un long après-midi libre${tail}.`);
  }
  return say(locale,
    `Day ${day} is lighter now: ${morning} in the morning, a long afternoon free${tail}.`,
    `O dia ${day} ficou mais leve: ${morning} de manhã, uma tarde longa livre${tail}.`,
    `Le jour ${day} est plus léger : ${morning} le matin, un long après-midi libre${tail}.`);
}

const BOAT = () => EXPERIENCES.find((item) => item.boat && !isExcludedExperience(item.id));

/** Take every boat experience off the open plan. Other stops stay. */
export function dropBoatTrip(plan: TripPlan, locale: TaskLocale = plan.locale): { plan: TripPlan; reply: string; removed: boolean } {
  const boats = new Set(EXPERIENCES.filter((item) => item.boat).map((item) => item.id));
  let removed = false;
  const days = plan.days.map((day) => {
    const items = day.items.filter((item) => {
      if (item.kind === "experience" && boats.has(item.refId)) {
        removed = true;
        return false;
      }
      return true;
    });
    return items.length === day.items.length ? day : { ...day, items };
  });
  if (!removed) {
    return {
      plan,
      removed: false,
      reply: say(locale, "There isn't a boat trip on the plan.", "Não há um passeio de barco no plano.", "Il n'y a pas de sortie en bateau dans le plan."),
    };
  }
  const next = { ...plan, days };
  return {
    plan: next,
    removed: true,
    reply: editDiffReply(plan, next, locale) ?? say(locale, "I took the boat trip off the plan.", "Tirei o passeio de barco do plano.", "J'ai retiré la sortie en bateau du plan."),
  };
}

/** Add the boat listing on one open day, or say plainly when the listings or the sea won't allow it. */
export function addBoatTrip(plan: TripPlan, locale: TaskLocale = plan.locale): { plan: TripPlan; reply: string; added: boolean } {
  const boat = BOAT();
  if (!boat) {
    return {
      plan,
      added: false,
      reply: say(locale,
        "A boat trip isn't in the listings. A beach morning is the closest alternative.",
        "Não há um passeio de barco nas listas. A alternativa mais próxima é uma manhã de praia.",
        "Une sortie en bateau n'est pas dans les listes. La plage le matin est l'alternative la plus proche."),
    };
  }
  const already = plan.days.findIndex((day) => day.items.some((item) => item.refId === boat.id));
  if (already >= 0) {
    return {
      plan,
      added: true,
      reply: say(locale,
        `${boat.title} is already on day ${already + 1}.`,
        `${boat.title} já está no dia ${already + 1}.`,
        `${boat.title} est déjà au jour ${already + 1}.`),
    };
  }
  const open = plan.days.map((day, index) => ({ day, index })).filter(({ day }) => day.sea?.status !== "rough");
  if (!open.length) {
    return {
      plan,
      added: false,
      reply: say(locale,
        `${boat.title} is the boat we list, but the sea is rough on the open days, so I didn't add it. A beach afternoon is the alternative.`,
        `${boat.title} é o barco que temos, mas o mar está agitado nos dias livres, por isso não o acrescentei. A alternativa é uma tarde de praia.`,
        `${boat.title} est le bateau que nous listons, mais la mer est agitée les jours libres, donc je ne l'ai pas ajouté. L'alternative est une après-midi à la plage.`),
    };
  }
  const host = open.find((item) => item.index > 0 && item.index < plan.days.length - 1) ?? open[0];
  const experienceItem: PlanItem = {
    id: `d${host.index}-boat`,
    kind: "experience",
    refId: boat.id,
    slot: "activity",
    start: "15:00",
    durationMin: Math.min(120, boat.example.durationMin),
  };
  const kept = host.day.items.filter((item) => item.kind !== "experience");
  const freeAt = kept.findIndex((item) => item.kind === "free" && (item.slot === "rest" || item.refId === "free-time"));
  const nextItems = [...kept];
  if (freeAt >= 0) nextItems.splice(freeAt, 1, experienceItem);
  else nextItems.push(experienceItem);
  const days = plan.days.map((day, index) => {
    if (index === host.index) return { ...day, items: resolveOverlaps(nextItems).slice(0, 9) };
    if (!day.items.some((item) => item.kind === "experience")) return day;
    return { ...day, items: day.items.filter((item) => item.kind !== "experience") };
  });
  const next = { ...plan, days };
  return {
    plan: next,
    added: true,
    reply: editDiffReply(plan, next, locale) ?? say(locale,
      `I added ${boat.title} on day ${host.index + 1}. That's the boat trip in the listings.`,
      `Acrescentei ${boat.title} no dia ${host.index + 1}. É o passeio de barco que temos na lista.`,
      `J'ai ajouté ${boat.title} au jour ${host.index + 1}. C'est la sortie en bateau de nos listes.`),
  };
}

export function pdfReply(locale: TaskLocale): string {
  return say(locale,
    "The print dialog is open. Save the trip as a PDF from there.",
    "A janela de impressão está aberta. Guarde a viagem como PDF.",
    "La fenêtre d'impression est ouverte. Enregistrez le voyage en PDF.");
}

export function noTripReply(locale: TaskLocale): string {
  return say(locale,
    "There's no trip to change yet.",
    "Ainda não há viagem para mudar.",
    "Il n'y a pas encore de voyage à modifier.");
}

/** Stops and dates, without the party line. A kid note is earned only when this changes. */
export function itinerarySig(plan: TripPlan): string {
  return JSON.stringify(plan.days.map((day) => ({
    date: day.date,
    items: day.items.map((item) => ({ kind: item.kind, refId: item.refId, slot: item.slot ?? null, start: item.start ?? null })),
  })));
}

export function samePlanShape(a: TripPlan | null, b: TripPlan | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const sig = (plan: TripPlan) => JSON.stringify({
    hasCar: plan.hasCar,
    pace: plan.pace ?? null,
    party: plan.party,
    days: plan.days.map((day) => ({
      date: day.date,
      items: day.items.map((item) => ({ kind: item.kind, refId: item.refId, slot: item.slot ?? null, start: item.start ?? null })),
    })),
  });
  return sig(a) === sig(b);
}

/** Start moved, length kept. Null when the span did not change, so the caller must not claim a move. */
export function shiftDiffReply(before: TripPlan, after: TripPlan, locale: TaskLocale): string | null {
  const sameSpan = before.days.length === after.days.length
    && before.days[0]?.date === after.days[0]?.date
    && before.days.at(-1)?.date === after.days.at(-1)?.date;
  if (sameSpan) return null;
  if (before.days.length !== after.days.length) return lengthDiffReply(before, after, locale);
  const n = after.days.length;
  const start = humanPlanDate(after.days[0].date, locale);
  const end = humanPlanDate(after.days.at(-1)!.date, locale);
  return closeSentence(say(locale,
    `Moved your ${n} days to ${start} – ${end}`,
    `Mudei os ${n} dias para ${start} – ${end}`,
    `J'ai déplacé vos ${n} jours : ${start} – ${end}`));
}

/** Sentence from the dates that actually changed. Null when the span is the same. */
export function lengthDiffReply(before: TripPlan, after: TripPlan, locale: TaskLocale): string | null {
  const sameSpan = before.days.length === after.days.length
    && before.days[0]?.date === after.days[0]?.date
    && before.days.at(-1)?.date === after.days.at(-1)?.date;
  if (sameSpan) return null;
  const n = after.days.length;
  const start = humanPlanDate(after.days[0].date, locale);
  const end = humanPlanDate(after.days.at(-1)!.date, locale);
  return closeSentence(say(locale,
    `Your trip now runs ${n} ${n === 1 ? "day" : "days"}, ${start} to ${end}`,
    `A viagem passa a ter ${n} ${n === 1 ? "dia" : "dias"}, de ${start} a ${end}`,
    `Le voyage fait maintenant ${n} ${n === 1 ? "jour" : "jours"}, du ${start} au ${end}`));
}

export function lengthUnchangedReply(plan: TripPlan, locale: TaskLocale): string {
  const n = plan.days.length;
  const start = humanPlanDate(plan.days[0].date, locale);
  const end = humanPlanDate(plan.days.at(-1)!.date, locale);
  return closeSentence(say(locale,
    `The trip is already ${n} ${n === 1 ? "day" : "days"}, ${start} to ${end}`,
    `A viagem já tem ${n} ${n === 1 ? "dia" : "dias"}, de ${start} a ${end}`,
    `Le voyage a déjà ${n} ${n === 1 ? "jour" : "jours"}, du ${start} au ${end}`));
}

function ordinal(day: number): string {
  const teen = day % 100;
  if (teen >= 11 && teen <= 13) return `${day}th`;
  if (day % 10 === 1) return `${day}st`;
  if (day % 10 === 2) return `${day}nd`;
  if (day % 10 === 3) return `${day}rd`;
  return `${day}th`;
}

/** The leaving day is not applied. The two reasons do not share a sentence. */
export function unfitLeavingReply(locale: TaskLocale, start: string, end: string, problem: EndShiftProblem): string {
  const startLabel = humanPlanDate(start, locale);
  if (problem === "before-start") {
    const dayNum = Number(end.slice(8, 10));
    const day = locale === "en" ? ordinal(dayNum) : locale === "fr" && dayNum === 1 ? "1er" : String(dayNum);
    return say(locale,
      `The ${day} is before your start on ${startLabel}. Which later day are you leaving?`,
      `O dia ${day} é antes do início em ${startLabel}. Em que dia mais tarde sai?`,
      `Le ${day} est avant votre début, le ${startLabel}. Quel jour plus tard partez-vous ?`);
  }
  const latest = humanPlanDate(addDays(start, MAX_TRIP_DAYS - 1), locale);
  return say(locale,
    `The planner can do up to ${MAX_TRIP_DAYS} days, so the latest leaving day from ${startLabel} is ${latest}. Which earlier day are you leaving?`,
    `O planeador faz até ${MAX_TRIP_DAYS} dias, por isso o último dia de saída desde ${startLabel} é ${latest}. Em que dia mais cedo sai?`,
    `Le planificateur va jusqu'à ${MAX_TRIP_DAYS} jours, donc le dernier jour de départ depuis le ${startLabel} est le ${latest}. Quel jour plus tôt partez-vous ?`);
}

export function nextLength(plan: TripPlan, edit: LengthEdit): { start: string; days: number } {
  return applyLength(plan.days[0].date, plan.days.length, edit);
}

/** Swap the beach on one day for a different listed beach. One line, no rebuild of the other days. */
export function swapDayBeach(plan: TripPlan, dayNumber: number, locale: TaskLocale = plan.locale): { plan: TripPlan; reply: string; changed: boolean } | null {
  const index = dayNumber - 1;
  const day = plan.days[index];
  if (!day) return null;
  const beaches = day.items
    .map((item, itemIndex) => ({ item, itemIndex }))
    .filter(({ item }) => item.kind === "place" && place(item.refId)?.category === "beach");
  if (!beaches.length) {
    return {
      plan,
      changed: false,
      reply: say(locale, `Day ${dayNumber} has no beach to replace.`, `O dia ${dayNumber} não tem praia para trocar.`, `Le jour ${dayNumber} n'a pas de plage à remplacer.`),
    };
  }
  const target = beaches.find(({ item }) => item.slot === "morning") ?? beaches[0];
  const current = place(target.item.refId);
  const used = new Set(plan.days.flatMap((item) => item.items.map((stop) => stop.refId)));
  const town = place("cidade-porto-ingles");
  const candidates = PLACES.filter((spot) => {
    if (spot.category !== "beach" || spot.id === target.item.refId) return false;
    if (!plan.hasCar && town && distanceKm(spot, town) > 3) return false;
    return true;
  });
  const next = candidates.find((spot) => !used.has(spot.id)) ?? candidates[0];
  if (!next || !current) {
    return {
      plan,
      changed: false,
      reply: say(locale,
        `Day ${dayNumber} already uses the only beach I can swap in.`,
        `O dia ${dayNumber} já usa a única praia que posso trocar.`,
        `Le jour ${dayNumber} utilise déjà la seule plage que je peux échanger.`),
    };
  }
  const oldName = localizedPlaceName(current.name, locale);
  const newName = localizedPlaceName(next.name, locale);
  const items = day.items.map((item, itemIndex) => itemIndex === target.itemIndex ? { ...item, refId: next.id } : item);
  const swapped = { ...plan, days: plan.days.map((item, itemIndex) => itemIndex === index ? { ...day, items } : item) };
  return {
    changed: true,
    plan: swapped,
    reply: editDiffReply(plan, swapped, locale) ?? say(locale,
      `Day ${dayNumber}: ${oldName} is now ${newName}.`,
      `Dia ${dayNumber}: ${oldName} passa a ${newName}.`,
      `Jour ${dayNumber} : ${oldName} devient ${newName}.`),
  };
}

/** Put a listed place or restaurant onto one day. No change when it is already there. */
export function addListedStop(plan: TripPlan, dayNumber: number, spot: LastPlace, locale: TaskLocale = plan.locale): { plan: TripPlan; reply: string; changed: boolean } {
  const index = dayNumber - 1;
  const day = plan.days[index];
  if (!day) {
    return {
      plan,
      changed: false,
      reply: say(locale, "That day isn't on the plan.", "Esse dia não está no plano.", "Ce jour n'est pas dans le plan."),
    };
  }
  const meal = Boolean(food(spot.id));
  if (day.items.some((item) => item.refId === spot.id)) {
    return {
      plan,
      changed: false,
      reply: say(locale,
        `${spot.name} is already on day ${dayNumber}.`,
        `${spot.name} já está no dia ${dayNumber}.`,
        `${spot.name} est déjà au jour ${dayNumber}.`),
    };
  }
  const added: PlanItem = {
    id: `d${index}-added`,
    kind: meal ? "food" : "place",
    refId: spot.id,
    slot: meal ? "lunch" : "morning",
    start: meal ? "13:00" : "10:30",
    durationMin: meal ? 90 : 120,
  };
  const without = day.items.filter((item) => !(meal && item.slot === "lunch" && item.kind === "free"));
  const items = resolveOverlaps([...without, added]).slice(0, 9);
  const changed = JSON.stringify(items) !== JSON.stringify(day.items);
  if (!changed) {
    return {
      plan,
      changed: false,
      reply: say(locale, `Day ${dayNumber} already includes ${spot.name}.`, `O dia ${dayNumber} já inclui ${spot.name}.`, `Le jour ${dayNumber} comprend déjà ${spot.name}.`),
    };
  }
  const next = { ...plan, days: plan.days.map((item, i) => i === index ? { ...day, items } : item) };
  return {
    changed: true,
    plan: next,
    reply: editDiffReply(plan, next, locale) ?? say(locale,
      `Day ${dayNumber} now includes ${spot.name}.`,
      `O dia ${dayNumber} passa a incluir ${spot.name}.`,
      `Le jour ${dayNumber} comprend maintenant ${spot.name}.`),
  };
}

const TOWN_ID = "cidade-porto-ingles";
const WALK_KM = 3;

function activityExperiences(activity: string): Experience[] {
  const n = activity.toLowerCase();
  if (/surf/.test(n)) return EXPERIENCES.filter((item) => /surf|ondaazul/i.test(`${item.id} ${item.title}`));
  if (/jet/.test(n)) return EXPERIENCES.filter((item) => /jetski|jet-ski/i.test(item.id));
  if (/quad/.test(n)) return EXPERIENCES.filter((item) => item.id.includes("quad") && !isExcludedExperience(item.id));
  const named = experience(activity);
  if (named && !isExcludedExperience(named.id)) return [named];
  return [];
}

function activityLabel(activity: string, locale: TaskLocale): string {
  if (/surf/.test(activity)) return "surf";
  if (/dolphin|golfinho|dauphin/.test(activity)) return say(locale, "A dolphin cruise", "Um cruzeiro com golfinhos", "Une sortie dauphins");
  if (/div/.test(activity) || /mergulho|plongee/.test(activity)) return say(locale, "Diving", "O mergulho", "La plongée");
  if (/nightlife|noturna|boite/.test(activity)) return say(locale, "Nightlife", "A vida noturna", "La vie nocturne");
  if (/jet/.test(activity)) return say(locale, "A jet ski", "O jet ski", "Le jet ski");
  if (/quad/.test(activity)) return say(locale, "A quad", "O quad", "Le quad");
  return say(locale, "That", "Isso", "Ça");
}

function reachableExperience(exp: Experience, hasCar: boolean): boolean {
  if (hasCar || exp.example.pickup) return true;
  const spot = place(exp.placeId);
  const town = place(TOWN_ID);
  if (!spot || !town) return false;
  return distanceKm(spot, town) <= WALK_KM;
}

function beachName(plan: TripPlan, locale: TaskLocale): string {
  const town = place(TOWN_ID);
  const beaches = PLACES.filter((item) => item.category === "beach" && (plan.hasCar || !town || distanceKm(item, town) <= WALK_KM));
  const used = new Set(plan.days.flatMap((day) => day.items.map((item) => item.refId)));
  const pick = beaches.find((item) => !used.has(item.id)) ?? beaches[0];
  return pick ? localizedPlaceName(pick.name, locale) : say(locale, "the beach in town", "a praia na vila", "la plage en ville");
}

function experiencePlaceName(exp: Experience, locale: TaskLocale): string {
  const spot = place(exp.placeId);
  return spot ? localizedPlaceName(spot.name, locale) : exp.location;
}

type Located = { day: number; item: PlanItem; exp: Experience };

function locateExperiences(plan: TripPlan, list: Experience[]): Located | null {
  const ids = new Set(list.map((item) => item.id));
  for (let index = 0; index < plan.days.length; index += 1) {
    const item = plan.days[index].items.find((stop) => stop.kind === "experience" && ids.has(stop.refId));
    const exp = item ? experience(item.refId) : undefined;
    if (item && exp) return { day: index + 1, item, exp };
  }
  return null;
}

function alreadySentence(located: Located, locale: TaskLocale, another: boolean): string {
  const placeName = experiencePlaceName(located.exp, locale);
  const time = located.item.start ?? say(locale, "the listed time", "a hora da lista", "l'heure de la liste");
  const surf = /surf|ondaazul/i.test(`${located.exp.id} ${located.exp.title}`);
  if (surf && another) {
    return say(locale,
      `A second surf session doesn't fit a slow day. Surf is already on day ${located.day} at ${placeName}, ${time}.`,
      `Uma segunda sessão de surf não cabe num dia calmo. O surf já está no dia ${located.day} na ${placeName}, ${time}.`,
      `Une deuxième session de surf ne tient pas dans une journée calme. Le surf est déjà au jour ${located.day} à ${placeName}, ${time}.`);
  }
  if (surf) {
    return say(locale,
      `Surf is already on day ${located.day} at ${placeName}, ${time}. Want another session?`,
      `O surf já está no dia ${located.day} na ${placeName}, ${time}. Quer outra sessão?`,
      `Le surf est déjà au jour ${located.day} à ${placeName}, ${time}. Vous voulez une autre session ?`);
  }
  return say(locale,
    `${located.exp.title} is already on day ${located.day} at ${time}.`,
    `${located.exp.title} já está no dia ${located.day}, às ${time}.`,
    `${located.exp.title} est déjà au jour ${located.day}, à ${time}.`);
}

function blockedSentence(plan: TripPlan, activity: string, locale: TaskLocale, why: "missing" | "age" | "rough" | "car" | "pace" | "day", exp?: Experience): string {
  const label = activityLabel(activity, locale);
  const beach = beachName(plan, locale);
  if (why === "missing") {
    return say(locale,
      `${label} isn't in the listings. The closest is a morning at ${beach}.`,
      `${label} não está nas listas. O mais próximo é uma manhã na ${beach}.`,
      `${label} n'est pas dans les listes. Le plus proche est une matinée à ${beach}.`);
  }
  if (why === "age" && exp) {
    return say(locale,
      `${label === "surf" ? "Surf" : exp.title} is listed from age ${exp.example.minAge}, so it stays off this trip. The closest is a morning at ${beach}.`,
      `${label === "surf" ? "O surf" : exp.title} é a partir dos ${exp.example.minAge} anos, por isso fica de fora. O mais próximo é uma manhã na ${beach}.`,
      `${label === "surf" ? "Le surf" : exp.title} est indiqué à partir de ${exp.example.minAge} ans, donc il reste en dehors. Le plus proche est une matinée à ${beach}.`);
  }
  if (why === "rough") {
    return say(locale,
      `The sea is rough on the open days, so ${label === "surf" ? "surf" : label.toLowerCase()} stays off this plan. The closest is an afternoon at ${beach}.`,
      `O mar está agitado nos dias livres, por isso ${label === "surf" ? "o surf" : label.toLowerCase()} fica de fora. O mais próximo é uma tarde na ${beach}.`,
      `La mer est agitée les jours libres, donc ${label === "surf" ? "le surf" : label.toLowerCase()} reste en dehors. Le plus proche est une après-midi à ${beach}.`);
  }
  if (why === "car" && exp) {
    const where = experiencePlaceName(exp, locale);
    return say(locale,
      `${where} isn't reachable without a car. The closest is a morning at ${beach}.`,
      `${where} não fica ao alcance sem carro. O mais próximo é uma manhã na ${beach}.`,
      `${where} n'est pas accessible sans voiture. Le plus proche est une matinée à ${beach}.`);
  }
  if (why === "day") {
    return say(locale, "That day isn't on the plan.", "Esse dia não está no plano.", "Ce jour n'est pas dans le plan.");
  }
  return say(locale,
    `${label === "surf" ? "Surf" : label} doesn't fit this slow day. The closest is keeping the morning at ${beach}.`,
    `${label === "surf" ? "O surf" : label} não cabe neste dia calmo. O mais próximo é manter a manhã na ${beach}.`,
    `${label === "surf" ? "Le surf" : label} ne tient pas dans cette journée calme. Le plus proche est de garder le matin à ${beach}.`);
}

function seaAllows(day: TripPlan["days"][number], exp: Experience): boolean {
  if (!exp.seaDependent) return true;
  return day.sea?.status !== "rough";
}

function pickActivityDay(plan: TripPlan, exp: Experience, dayNumber?: number): number | "rough" | "missing" {
  if (dayNumber) {
    const day = plan.days[dayNumber - 1];
    if (!day) return "missing";
    if (seaAllows(day, exp)) return dayNumber - 1;
  }
  const open = plan.days.map((day, index) => ({ day, index })).filter(({ day }) => seaAllows(day, exp));
  const middle = open.find((item) => item.index > 0 && item.index < plan.days.length - 1);
  if (middle) return middle.index;
  if (open[0]) return open[0].index;
  return exp.seaDependent ? "rough" : "missing";
}

function placeActivity(plan: TripPlan, index: number, exp: Experience): TripPlan | null {
  const afternoon = exp.example.slots.find((slot) => toMin(slot) >= 12 * 60);
  const start = afternoon ?? exp.example.slots[0] ?? "15:00";
  const added: PlanItem = {
    id: `d${index}-added-exp`,
    kind: "experience",
    refId: exp.id,
    slot: toMin(start) < 12 * 60 ? "morning" : "activity",
    start,
    durationMin: Math.min(exp.example.durationMin || 90, 150),
  };
  const days = plan.days.map((day, dayIndex) => {
    let items = day.items.filter((item) => item.kind !== "experience" || item.refId === exp.id);
    if (dayIndex !== index) return items.length === day.items.length ? day : { ...day, items };
    let dropped = false;
    items = items.filter((item) => {
      if (!dropped && item.kind === "free" && (item.refId === "free-time" || item.slot === "rest") && item.durationMin >= 60) {
        dropped = true;
        return false;
      }
      return true;
    });
    items = [...items, added];
    if ((plan.pace ?? "slow") !== "normal") {
      while (anchoredCount(items) > 4) {
        const dropAt = items.findIndex((item) => item.kind === "place" && item.slot !== "sunset");
        if (dropAt < 0) break;
        items = items.filter((_, itemIndex) => itemIndex !== dropAt);
      }
    }
    return { ...day, items: resolveOverlaps(items).slice(0, 9) };
  });
  const next = { ...plan, days };
  return next.days[index]?.items.some((item) => item.refId === exp.id) ? next : null;
}

/** Put a listed activity on the open plan, or say why it cannot go on. The same plan object comes back when nothing changes. */
export function addListedActivity(plan: TripPlan, activity: string, locale: TaskLocale = plan.locale, dayNumber?: number, fixture?: Experience): { plan: TripPlan; reply: string; changed: boolean } {
  const another = /another|outra|autre/.test(activity.toLowerCase());
  const list = fixture ? [fixture] : activityExperiences(activity);
  if (!list.length) {
    return { plan, changed: false, reply: blockedSentence(plan, activity, locale, "missing") };
  }
  const exp = list[0];
  const found = locateExperiences(plan, list);
  if (found) return { plan, changed: false, reply: alreadySentence(found, locale, another) };
  if (plan.party.kids > 0 && exp.example.minAge > (plan.party.youngestAge ?? 3)) {
    return { plan, changed: false, reply: blockedSentence(plan, activity, locale, "age", exp) };
  }
  if (!reachableExperience(exp, plan.hasCar)) {
    return { plan, changed: false, reply: blockedSentence(plan, activity, locale, "car", exp) };
  }
  const host = pickActivityDay(plan, exp, dayNumber);
  if (host === "missing") return { plan, changed: false, reply: blockedSentence(plan, activity, locale, "day", exp) };
  if (host === "rough") return { plan, changed: false, reply: blockedSentence(plan, activity, locale, "rough", exp) };
  const next = placeActivity(plan, host, exp);
  if (!next) return { plan, changed: false, reply: blockedSentence(plan, activity, locale, "pace", exp) };
  return {
    plan: next,
    changed: true,
    reply: editDiffReply(plan, next, locale, activity) ?? blockedSentence(plan, activity, locale, "pace", exp),
  };
}

/** Move a listed activity that is already on the plan to the morning or the afternoon. */
export function moveListedActivity(plan: TripPlan, activity: string, when: "morning" | "afternoon", locale: TaskLocale = plan.locale): { plan: TripPlan; reply: string; changed: boolean } {
  const list = activityExperiences(activity);
  const found = list.length ? locateExperiences(plan, list) : null;
  if (!found) {
    return {
      plan,
      changed: false,
      reply: say(locale, "Surf isn't on the plan.", "Não há surf no plano.", "Il n'y a pas de surf dans le plan."),
    };
  }
  const start = found.item.start ?? "15:00";
  const morningNow = toMin(start) < 12 * 60;
  if ((when === "morning" && morningNow) || (when === "afternoon" && !morningNow)) {
    const placeName = experiencePlaceName(found.exp, locale);
    return {
      plan,
      changed: false,
      reply: say(locale,
        `Surf is already ${when === "morning" ? "in the morning" : "in the afternoon"} on day ${found.day} at ${placeName}, ${start}.`,
        `O surf já está no dia ${found.day} ${when === "morning" ? "de manhã" : "à tarde"}, na ${placeName}, ${start}.`,
        `Le surf est déjà au jour ${found.day} ${when === "morning" ? "le matin" : "l'après-midi"}, à ${placeName}, ${start}.`),
    };
  }
  const slot = found.exp.example.slots.find((item) => (when === "morning" ? toMin(item) < 12 * 60 : toMin(item) >= 12 * 60))
    ?? (when === "morning" ? "09:00" : "15:00");
  const days = plan.days.map((day, index) => {
    if (index !== found.day - 1) return day;
    const items = resolveOverlaps(day.items.map((item) => item.refId === found.item.refId ? { ...item, start: slot, slot: when === "morning" ? "morning" as const : "activity" as const } : item));
    return { ...day, items };
  });
  const next = { ...plan, days };
  return {
    plan: next,
    changed: true,
    reply: editDiffReply(plan, next, locale, activity) ?? say(locale,
      `Moved surf on day ${found.day} to the ${when}, ${slot}.`,
      `Passei o surf do dia ${found.day} para ${when === "morning" ? "a manhã" : "a tarde"}, ${slot}.`,
      `J'ai déplacé le surf du jour ${found.day} ${when === "morning" ? "au matin" : "à l'après-midi"}, ${slot}.`),
  };
}

/** Take a listed activity off every day. */
export function removeListedActivity(plan: TripPlan, activity: string, locale: TaskLocale = plan.locale): { plan: TripPlan; reply: string; changed: boolean } {
  const list = activityExperiences(activity);
  const ids = new Set(list.map((item) => item.id));
  let removed = false;
  const days = plan.days.map((day) => {
    const items = day.items.filter((item) => {
      if (item.kind === "experience" && ids.has(item.refId)) {
        removed = true;
        return false;
      }
      return true;
    });
    return items.length === day.items.length ? day : { ...day, items };
  });
  if (!removed) {
    const label = activityLabel(activity, locale);
    return {
      plan,
      changed: false,
      reply: say(locale,
        `${label === "surf" ? "Surf" : label} isn't on the plan.`,
        `${label === "surf" ? "Não há surf" : `${label} não está`} no plano.`,
        `${label === "surf" ? "Il n'y a pas de surf" : `${label} n'est pas`} dans le plan.`),
    };
  }
  const next = { ...plan, days };
  return {
    plan: next,
    changed: true,
    reply: editDiffReply(plan, next, locale, activity) ?? say(locale, "I took that off the plan.", "Tirei isso do plano.", "Je l'ai retiré du plan."),
  };
}

/** Read a day, the departure, or lunch off the open plan. */
export function answerAboutPlan(plan: TripPlan, text: string): string | null {
  const kind = planQuestionKind(text);
  if (!kind) return null;
  const locale = plan.locale;
  const asked = Number(loosenDay(text));
  const index = Math.max(0, (asked || (kind === "leave" ? plan.days.length : 1)) - 1);
  const day = plan.days[index];
  if (kind === "leave") {
    const last = plan.days.at(-1)!;
    const depart = last.items.find((item) => item.slot === "departure" || item.refId.startsWith("depart-"));
    const when = humanPlanDate(last.date, locale);
    if (depart?.start) {
      return say(locale,
        `You leave on ${when} at ${depart.start}.`,
        `A partida é ${when} às ${depart.start}.`,
        `Vous partez le ${when} à ${depart.start}.`);
    }
    return say(locale,
      `The last day is ${when}. No departure time is on the plan.`,
      `O último dia é ${when}. O plano não tem hora de partida.`,
      `Le dernier jour est le ${when}. Le plan n'a pas d'heure de départ.`);
  }
  if (!day) {
    return say(locale, "That day isn't on the plan.", "Esse dia não está no plano.", "Ce jour n'est pas dans le plan.");
  }
  if (kind === "lunch") {
    const lunch = day.items.find((item) => item.slot === "lunch");
    if (!lunch) return say(locale, `Day ${index + 1} has no lunch stop.`, `O dia ${index + 1} não tem almoço.`, `Le jour ${index + 1} n'a pas de déjeuner.`);
    const at = lunch.start ? ` ${say(locale, "at", "às", "à")} ${lunch.start}` : "";
    return say(locale,
      `Lunch on day ${index + 1} is ${itemLabel(lunch, locale)}${at}.`,
      `O almoço do dia ${index + 1} é ${itemLabel(lunch, locale)}${at}.`,
      `Le déjeuner du jour ${index + 1} est ${itemLabel(lunch, locale)}${at}.`);
  }
  const names = day.items
    .filter((item) => item.kind === "place" || item.kind === "food" || item.kind === "experience")
    .slice(0, 4)
    .map((item) => itemLabel(item, locale));
  const when = humanPlanDate(day.date, locale);
  return say(locale,
    names.length ? `Day ${index + 1} (${when}): ${names.join(", ")}.` : `Day ${index + 1} (${when}) has no listed stops.`,
    names.length ? `Dia ${index + 1} (${when}): ${names.join(", ")}.` : `O dia ${index + 1} (${when}) não tem paragens listadas.`,
    names.length ? `Jour ${index + 1} (${when}) : ${names.join(", ")}.` : `Le jour ${index + 1} (${when}) n'a pas d'arrêts listés.`);
}

function loosenDay(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().match(/\b(?:day|dia|jour)\s+(\d+)\b/)?.[1] ?? "";
}

const PLAN_SUMMARY = /^(?:Slow |Packed |Calmo,|Cheio,|Tranquille,|Chargé,)|Tap the card|Toque no cartão|Touchez la carte/;

/** True when this reply should be a new bubble. An unchanged plan does not get a second copy of its summary. */
export function keepAssistantReply(previous: string | null, reply: string, planChanged: boolean): boolean {
  if (planChanged) return true;
  if (previous && previous.trim() === reply.trim() && PLAN_SUMMARY.test(reply.trim())) return false;
  return true;
}
