import type { LastPlace, TaskLocale } from "./awareness/task.ts";
import { resolveOverlaps } from "./full-day.ts";
import { applyLength, planQuestionKind, type LengthEdit } from "./plan-router.ts";
import { humanPlanDate, itemLabel } from "./plan-reply.ts";
import { EXPERIENCES, FOOD, PLACES, food, isExcludedExperience, localizedPlaceName, type PlanItem, type TripPlan } from "./trip.ts";

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
  return {
    plan: { ...plan, days },
    removed: true,
    reply: say(locale, "I took the boat trip off the plan.", "Tirei o passeio de barco do plano.", "J'ai retiré la sortie en bateau du plan."),
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
  return {
    plan: { ...plan, days },
    added: true,
    reply: say(locale,
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
  return say(locale,
    `Moved your ${n} days to ${start} – ${end}.`,
    `Mudei os ${n} dias para ${start} – ${end}.`,
    `J'ai déplacé vos ${n} jours : ${start} – ${end}.`);
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
  return say(locale,
    `Your trip now runs ${n} ${n === 1 ? "day" : "days"}, ${start} to ${end}.`,
    `A viagem passa a ter ${n} ${n === 1 ? "dia" : "dias"}, de ${start} a ${end}.`,
    `Le voyage fait maintenant ${n} ${n === 1 ? "jour" : "jours"}, du ${start} au ${end}.`);
}

export function lengthUnchangedReply(plan: TripPlan, locale: TaskLocale): string {
  const n = plan.days.length;
  const start = humanPlanDate(plan.days[0].date, locale);
  const end = humanPlanDate(plan.days.at(-1)!.date, locale);
  return say(locale,
    `The trip is already ${n} ${n === 1 ? "day" : "days"}, ${start} to ${end}.`,
    `A viagem já tem ${n} ${n === 1 ? "dia" : "dias"}, de ${start} a ${end}.`,
    `Le voyage a déjà ${n} ${n === 1 ? "jour" : "jours"}, du ${start} au ${end}.`);
}

export function nextLength(plan: TripPlan, edit: LengthEdit): { start: string; days: number } {
  return applyLength(plan.days[0].date, plan.days.length, edit);
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
  return {
    changed: true,
    plan: { ...plan, days: plan.days.map((item, i) => i === index ? { ...day, items } : item) },
    reply: say(locale,
      `Day ${dayNumber} now includes ${spot.name}.`,
      `O dia ${dayNumber} passa a incluir ${spot.name}.`,
      `Le jour ${dayNumber} comprend maintenant ${spot.name}.`),
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
