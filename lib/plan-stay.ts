import type { TaskLocale } from "./awareness/task.ts";
import type { Stay } from "./maio-catalog.ts";
import { formatCapeVerdePhone } from "./phone.ts";
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

const LOCALITIES: { re: RegExp; name: string }[] = [
  { re: /\b(?:porto ingles|vila do maio|cidade do porto ingles)\b/, name: "Porto Inglês" },
  { re: /\bcalheta\b/, name: "Calheta" },
  { re: /\bmorro\b/, name: "Morro" },
];

/** The words after "staying at" / "ficamos em" / "on loge à", or "an Airbnb in Calheta". */
export function stayPhrase(text: string): string | null {
  const n = fold(text);
  const match = n.match(/\b(?:we(?:'re| are) staying at|staying at|stay at|ficamos (?:no|na|em|num|numa)|estamos (?:no|na|em|num|numa)|vamos ficar (?:no|na|em|num|numa)|on loge (?:a|dans)|nous logeons (?:a|dans)|on est (?:a|dans))\s+(.+)$/)
    ?? n.match(/\b((?:an|a|um|uma|un|une)\s+airbnb(?:\s+(?:in|em|na|no|a|dans)\s+\S+)?|airbnb\s+(?:in|em|na|no|a|dans)\s+\S+)\b/);
  if (!match) return null;
  const name = match[1].replace(/\b(?:for|com|with|avec)\b[\s\S]*$/, "").replace(/[,.].*$/, "").trim();
  return name.length >= 3 ? name : null;
}

function knownArea(phrase: string): string | undefined {
  const n = fold(phrase);
  return LOCALITIES.find((place) => place.re.test(n))?.name;
}

function titleStay(raw: string): string {
  return raw.split(/\s+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/** A guest-named stay. Area only when they named Calheta, Morro, or Porto Inglês. No phone or pin. */
export function freeStay(phrase: string): Stay {
  const area = knownArea(phrase);
  const n = fold(phrase);
  let name = n
    .replace(/\b(?:in|em|na|no|a|dans|at|the)\s+(?:porto ingles|vila do maio|cidade do porto ingles|calheta|morro)\b/g, " ")
    .replace(/^(?:an|a|um|uma|un|une|the)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/\bairbnb\b/.test(n)) name = "Airbnb";
  if (name.length < 3) name = area ? "Stay" : n;
  const label = titleStay(name);
  const slug = fold(label).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "stay";
  return { id: `guest-${slug}`.slice(0, 80), name: label, area: area ?? "", phone: "", link: "" };
}

/** Phone, address, or contact for a lodging. Not the "where can we stay?" list. */
export function isStayDetailQuestion(text: string, savedName?: string): boolean {
  if (isStayQuestion(text) || stayPhrase(text)) return false;
  const n = fold(text);
  const asks = /\b(?:address|morada|adresse|phone|telefone|telephone|contacto|contato|contact)\b/.test(n);
  if (!asks) return false;
  if (/\b(?:stay|staying|hotel|airbnb|alojamento|estadia|hebergement|logement|pousada)\b/.test(n)) return true;
  return Boolean(savedName && savedName.length >= 3 && n.includes(fold(savedName)));
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

function linkHost(link: string): string | null {
  try { return new URL(link).host.replace(/^www\./, ""); } catch { return null; }
}

function stayLabel(stay: Stay): string {
  if (stay.phone) return `${stay.name} (${formatCapeVerdePhone(stay.phone)})`;
  const host = stay.link ? linkHost(stay.link) : null;
  return host ? `${stay.name} (${host})` : stay.name;
}

/** Every published stay, up to 8, grouped by area. Chips stay at three. */
export function stayListReply(locale: TaskLocale, stays: Stay[], read = true): { reply: string; chips: string[] } {
  const shown = stays.slice(0, 8);
  const chips = shown.slice(0, 3).map((stay) => stayChip(locale, stay.name));
  if (!shown.length && !read) {
    const reply = locale === "pt"
      ? "Não consegui abrir a lista de alojamento do Maio agora. Tenta outra vez daqui a pouco."
      : locale === "fr"
        ? "Je n'arrive pas à ouvrir la liste d'hébergement de Maio pour l'instant. Réessaie dans un moment."
        : "I couldn't open the Maio stays list just now. Try again in a moment.";
    return { reply, chips: [] };
  }
  if (!shown.length) {
    const reply = locale === "pt"
      ? "Não tenho alojamento na lista do Maio, por isso não invento um sítio."
      : locale === "fr"
        ? "Je n'ai pas d'hébergement dans la liste de Maio, donc je n'en invente pas."
        : "I don't have stays in the Maio list, so I won't guess one.";
    return { reply, chips: [] };
  }
  const groups = new Map<string, Stay[]>();
  for (const stay of shown) {
    const area = stay.area || "Maio";
    groups.set(area, [...(groups.get(area) ?? []), stay]);
  }
  const lines = [...groups].map(([area, rows]) => `${area}: ${rows.map(stayLabel).join(", ")}`).join(". ");
  const reply = locale === "pt"
    ? `Onde ficar. ${lines}. Disponibilidade e preços não estão ao vivo.`
    : locale === "fr"
      ? `Où loger. ${lines}. La disponibilité et les prix ne sont pas en direct.`
      : `Places to stay. ${lines}. Availability and prices aren't live.`;
  return { reply, chips };
}

export function staySavedReply(locale: TaskLocale, stay: Stay, listed = true): string {
  const place = where(stay);
  if (!listed) {
    if (locale === "pt") return `Guardei a estadia como ${place}.`;
    if (locale === "fr") return `Séjour enregistré : ${place}.`;
    return `Saved your stay as ${place}.`;
  }
  if (locale === "pt") return `Ficam em ${place}. O pequeno-almoço e o início e o fim do dia usam esse alojamento.`;
  if (locale === "fr") return `Vous logez à ${place}. Le petit-déjeuner, le début et la fin de la journée utilisent cet hébergement.`;
  return `You're staying at ${place}. Breakfast and the start and end of the day use that stay.`;
}

/** Published details, or a plain "not in the directory". Never an invented address or phone. */
export function stayDetailReply(locale: TaskLocale, name: string, listed: Stay | null): string {
  if (!listed) {
    const who = name.trim() || (locale === "pt" ? "Esse alojamento" : locale === "fr" ? "Ce logement" : "That stay");
    if (locale === "pt") return `${who} não está na lista de alojamento, por isso não tenho morada nem telefone.`;
    if (locale === "fr") return `${who} n'est pas dans l'annuaire des hébergements, donc je n'ai ni adresse ni téléphone.`;
    return `${who} isn't in the stay directory, so I don't have an address or a phone.`;
  }
  const bits = [listed.name];
  if (listed.area) bits.push(listed.area);
  if (listed.phone) bits.push(formatCapeVerdePhone(listed.phone));
  else {
    const host = listed.link ? linkHost(listed.link) : null;
    if (host) bits.push(host);
  }
  const line = bits.join(", ");
  if (locale === "pt") return `${line}. Disponibilidade e preços não estão ao vivo.`;
  if (locale === "fr") return `${line}. La disponibilité et les prix ne sont pas en direct.`;
  return `${line}. Availability and prices aren't live.`;
}
