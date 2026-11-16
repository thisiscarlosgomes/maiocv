import type { TaskLocale } from "./awareness/task.ts";
import type { Stay } from "./maio-catalog.ts";
import type { PlanItem, TripPlan } from "./trip.ts";

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[.?!]+$/g, "").trim();
}

/** "Where can we stay?" / "onde ficar" / "où loger". A list, not a new plan. */
export function isStayQuestion(text: string): boolean {
  const n = fold(text);
  if (stayPhrase(text)) return false;
  return /\b(?:where (?:can|do|should) (?:we|i) stay|where to stay|places? to stay|hotels?|accommodation|guesthouses?|guest houses?|onde ficar|onde (?:podemos|posso) ficar|alojamento|onde nos hosped|ou (?:dormir|loger|se loger)|hebergement)\b/.test(n);
}

/** The words after "staying at" / "ficamos em" / "on loge à". Null when this is not a stay claim. */
export function stayPhrase(text: string): string | null {
  const n = fold(text);
  const match = n.match(/\b(?:we(?:'re| are) staying at|staying at|stay at|ficamos (?:no|na|em)|estamos (?:no|na|em)|vamos ficar (?:no|na|em)|on loge a|nous logeons a|on est a)\s+(.+)$/);
  if (!match) return null;
  const name = match[1].replace(/\b(?:for|com|with|avec)\b[\s\S]*$/, "").replace(/[,.].*$/, "").trim();
  return name.length >= 3 ? name : null;
}

/** Longest published stay named in the phrase. Never a stay that is not in the list. */
export function matchStay(phrase: string, stays: Stay[]): Stay | null {
  const needle = fold(phrase);
  const hits = stays.filter((stay) => {
    const name = fold(stay.name);
    return name.length >= 3 && (needle.includes(name) || name.includes(needle));
  });
  hits.sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name));
  return hits[0] ?? null;
}

export function stayChip(locale: TaskLocale, name: string): string {
  if (locale === "pt") return `Ficamos em ${name}`;
  if (locale === "fr") return `On loge à ${name}`;
  return `We're staying at ${name}`;
}

function where(stay: Stay): string {
  return stay.area ? `${stay.name}, ${stay.area}` : stay.name;
}

function breakfastNote(locale: TaskLocale, stay: Stay): string {
  const place = where(stay);
  if (locale === "pt") return `Pequeno-almoço em ${place}`;
  if (locale === "fr") return `Petit-déjeuner à ${place}`;
  return `Breakfast at ${place}`;
}

function startNote(locale: TaskLocale, stay: Stay): string {
  const place = where(stay);
  if (locale === "pt") return `O dia começa em ${place}`;
  if (locale === "fr") return `La journée commence à ${place}`;
  return `Day starts at ${place}`;
}

function endNote(locale: TaskLocale, stay: Stay): string {
  const place = where(stay);
  if (locale === "pt") return `O dia acaba em ${place}`;
  if (locale === "fr") return `La journée se termine à ${place}`;
  return `Day ends at ${place}`;
}

function withNote(item: PlanItem, note: string): PlanItem {
  if (item.note?.includes(note)) return item;
  const joined = item.note ? `${item.note} ${note}` : note;
  return { ...item, note: joined.slice(0, 200) };
}

/** Breakfast, the arrival transfer, and the departure name the stay. Other stops stay put. */
export function withStay(plan: TripPlan, stay: Stay, locale: TaskLocale): TripPlan {
  const breakfast = breakfastNote(locale, stay);
  const start = startNote(locale, stay);
  const end = endNote(locale, stay);
  const days = plan.days.map((day, index) => {
    const leaving = day.items.some((item) => item.slot === "departure" || item.refId.startsWith("depart-"));
    const last = index === plan.days.length - 1;
    let sawStart = false;
    const items = day.items.map((item) => {
      if (item.slot === "breakfast" || item.refId === "breakfast-stay") {
        return { ...item, kind: "free" as const, refId: "breakfast-stay", note: breakfast };
      }
      if (item.slot === "transfer" || item.refId === "transfer") {
        sawStart = true;
        return withNote(item, start);
      }
      if (item.slot === "departure" || item.refId.startsWith("depart-")) return withNote(item, end);
      if (index === 0 && !sawStart && item.kind !== "transport" && item.kind !== "experience") {
        sawStart = true;
        return withNote(item, start);
      }
      if (last && !leaving && item === day.items[day.items.length - 1]) return withNote(item, end);
      return item;
    });
    return { ...day, items };
  });
  return { ...plan, days };
}

export function stayListReply(locale: TaskLocale, stays: Stay[]): { reply: string; chips: string[] } {
  const chips = stays.slice(0, 3).map((stay) => stayChip(locale, stay.name));
  if (!stays.length) {
    const reply = locale === "pt"
      ? "Não tenho alojamento na lista do Maio, por isso não invento um sítio."
      : locale === "fr"
        ? "Je n'ai pas d'hébergement dans la liste de Maio, donc je n'en invente pas."
        : "I don't have stays in the Maio list, so I won't guess one.";
    return { reply, chips: [] };
  }
  const lines = stays.map((stay) => {
    const bits = [stay.name];
    if (stay.area) bits.push(stay.area);
    if (stay.phone) bits.push(stay.phone);
    else if (stay.link) {
      try { bits.push(new URL(stay.link).host.replace(/^www\./, "")); } catch { /* skip a bad link */ }
    }
    return bits.join(", ");
  }).join("; ");
  const reply = locale === "pt"
    ? `Onde ficar: ${lines}. Disponibilidade e preços não estão ao vivo.`
    : locale === "fr"
      ? `Où loger : ${lines}. La disponibilité et les prix ne sont pas en direct.`
      : `Places to stay: ${lines}. Availability and prices aren't live.`;
  return { reply, chips };
}

export function staySavedReply(locale: TaskLocale, stay: Stay): string {
  const place = where(stay);
  if (locale === "pt") return `Ficam em ${place}. O pequeno-almoço e o início e o fim do dia usam esse alojamento.`;
  if (locale === "fr") return `Vous logez à ${place}. Le petit-déjeuner, le début et la fin de la journée utilisent cet hébergement.`;
  return `You're staying at ${place}. Breakfast and the start and end of the day use that stay.`;
}

export function stayUnknownReply(locale: TaskLocale, phrase: string): string {
  if (locale === "pt") return `Não tenho «${phrase}» na lista de alojamento, por isso não o acrescento.`;
  if (locale === "fr") return `Je n'ai pas « ${phrase} » dans la liste des hébergements, donc je ne l'ajoute pas.`;
  return `I don't have "${phrase}" in the stay list, so I won't add it.`;
}
