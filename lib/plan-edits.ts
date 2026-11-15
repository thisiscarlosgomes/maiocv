import type { TaskLocale } from "./awareness/task.ts";
import { resolveOverlaps } from "./full-day.ts";
import { itemLabel } from "./plan-reply.ts";
import { EXPERIENCES, isExcludedExperience, type PlanItem, type TripPlan } from "./trip.ts";

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
  const reduced = visibleStops(nextItems) < visibleStops(day.items);
  const morningName = placeName(morning, locale) ?? say(locale, "a morning beach", "a praia da manhã", "la plage du matin");
  const sunsetName = placeName(sunset, locale);
  const reply = relaxReply(locale, dayNumber, morningName, sunsetName, reduced);
  if (!reduced) return { plan, reply, reduced: false };
  return {
    plan: { ...plan, days: plan.days.map((item, i) => i === index ? { ...day, items: nextItems } : item) },
    reply,
    reduced: true,
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

/** True when this reply should be a new bubble. An unchanged card does not get a second copy of the same text. */
export function keepAssistantReply(previous: string | null, reply: string, planChanged: boolean): boolean {
  if (planChanged) return true;
  if (previous && previous.trim() === reply.trim()) return false;
  return true;
}
