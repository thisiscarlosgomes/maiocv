import type { Task, TaskLocale } from "./awareness/task.ts";
import { addDays } from "./trip.ts";

/** Typos and shorthand a visitor actually types. */
export function loosen(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "'")
    .replace(/\bwhens\b/g, "when")
    .replace(/\bwheres\b/g, "where")
    .replace(/\bwhats\b/g, "what")
    .replace(/\bhows\b/g, "how")
    .replace(/\btmrw\b|\btmr\b|\btommorow\b|\btomorow\b/g, "tomorrow")
    .replace(/\btonite\b/g, "tonight")
    .replace(/\bferrys\b/g, "ferries")
    .replace(/\s+/g, " ")
    .trim();
}

const WORD_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5,
};

export function wordNumber(token: string | undefined): number | undefined {
  if (!token) return undefined;
  if (/^\d+$/.test(token)) return Number(token);
  return WORD_NUM[token];
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, janeiro: 1, janvier: 1,
  february: 2, feb: 2, fevereiro: 2, fevrier: 2,
  march: 3, marco: 3, mars: 3,
  april: 4, abr: 4, abril: 4, avril: 4,
  may: 5, maio: 5, mai: 5,
  june: 6, jun: 6, junho: 6, juin: 6,
  july: 7, jul: 7, julho: 7, juillet: 7,
  august: 8, aug: 8, agosto: 8, aout: 8,
  september: 9, sep: 9, setembro: 9, septembre: 9,
  october: 10, oct: 10, outubro: 10, octobre: 10,
  november: 11, nov: 11, novembro: 11, novembre: 11,
  december: 12, dec: 12, dezembro: 12, decembre: 12,
};

const WEEKDAY_RE: { re: RegExp; day: number }[] = [
  { re: /\b(?:sun|sunday|dom|domingo|dim|dimanche)\b/, day: 0 },
  { re: /\b(?:mon|monday|seg|segunda(?:-feira)?|lun|lundi)\b/, day: 1 },
  { re: /\b(?:tue|tues|tuesday|ter|terca(?:-feira)?|mar|mardi)\b/, day: 2 },
  { re: /\b(?:wed|wednesday|qua|quarta(?:-feira)?|mer|mercredi)\b/, day: 3 },
  { re: /\b(?:thu|thur|thurs|thursday|qui|quinta(?:-feira)?|jeu|jeudi)\b/, day: 4 },
  { re: /\b(?:fri|friday|sex|sexta(?:-feira)?|ven|vendredi)\b/, day: 5 },
  { re: /\b(?:sat|saturday|sab|sabado|sam|samedi)\b/, day: 6 },
];

export function inclusiveDays(start: string, end: string): number | undefined {
  const a = Date.parse(`${start}T12:00:00Z`);
  const b = Date.parse(`${end}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return undefined;
  const days = Math.round((b - a) / 86_400_000) + 1;
  return days >= 1 && days <= 14 ? days : undefined;
}

function isoInYear(year: number, month: number, day: number): string | null {
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = new Date(`${iso}T12:00:00Z`);
  if (date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return iso;
}

/** Next date on or after today with this month and day. */
export function monthDay(today: string, month: number, day: number): string | null {
  const year = Number(today.slice(0, 4));
  const thisYear = isoInYear(year, month, day);
  if (thisYear && thisYear >= today) return thisYear;
  return isoInYear(year + 1, month, day);
}

/** Next date that is both that weekday and that day-of-month. */
export function weekdayAndDay(today: string, weekday: number, day: number): string | null {
  const cursor = new Date(`${today}T12:00:00Z`);
  for (let i = 0; i < 400; i += 1) {
    if (cursor.getUTCDate() === day && cursor.getUTCDay() === weekday) return cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return null;
}

export function upcomingWeekday(today: string, weekday: number): string {
  const date = new Date(`${today}T12:00:00Z`);
  const delta = (weekday - date.getUTCDay() + 7) % 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** A short weekday token ("wed", "quarta", "mer") when the full name is absent. */
export function shortWeekday(text: string): number | undefined {
  const n = loosen(text);
  for (const row of WEEKDAY_RE) if (row.re.test(n)) return row.day;
  return undefined;
}

export type SpokenDates = { start?: string; end?: string; days?: number };

/**
 * Calendar language: "wed 18", "18-20 Nov", "18 November",
 * "a partir de quarta 18", "à partir du mercredi 18".
 */
export function spokenDates(text: string, today: string): SpokenDates {
  const n = loosen(text);
  const out: SpokenDates = {};
  const range = n.match(/\b(\d{1,2})\s*(?:-|–|—|to|a|au|ate)\s*(\d{1,2})\s+(?:de\s+|d')?(jan(?:uary|eiro)?|fev(?:eruary|ereiro|rier)?|mar(?:ch|co|s)?|abr(?:il)?|avril|april|may|maio|mai|jun(?:e|ho|in)?|jul(?:y|ho|illet)?|aug(?:ust|osto|out)?|sep(?:tember|tembro|tembre)?|oct(?:ober|ubro|obre)?|nov(?:ember|embro|embre)?|dec(?:ember|embro|embre)?)\b/);
  if (range) {
    const month = MONTHS[range[3]];
    const startDay = Number(range[1]);
    const endDay = Number(range[2]);
    if (month) {
      const start = monthDay(today, month, startDay);
      const end = monthDay(today, month, endDay);
      if (start) out.start = start;
      if (start && end && end >= start) {
        out.end = end;
        const days = inclusiveDays(start, end);
        if (days) out.days = days;
      }
    }
  }
  if (!out.start) {
    const single = n.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:de\s+|d')?(january|jan|janeiro|janvier|february|feb|fevereiro|fevrier|march|marco|mars|april|abr|abril|avril|may|maio|mai|june|jun|junho|juin|july|jul|julho|juillet|august|aug|agosto|aout|september|sep|setembro|septembre|october|oct|outubro|octobre|november|nov|novembro|novembre|december|dec|dezembro|decembre)\b/);
    if (single) {
      const month = MONTHS[single[2]];
      const start = month ? monthDay(today, month, Number(single[1])) : null;
      if (start) out.start = start;
    }
  }
  const weekdayHit = WEEKDAY_RE.find((row) => row.re.test(n));
  const beside = n.match(/\b(?:sun|sunday|mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|dom|domingo|seg|segunda(?:-feira)?|ter|terca(?:-feira)?|qua|quarta(?:-feira)?|qui|quinta(?:-feira)?|sex|sexta(?:-feira)?|sab|sabado|dim|dimanche|lun|lundi|mar|mardi|mer|mercredi|jeu|jeudi|ven|vendredi|sam|samedi)\s+(\d{1,2})\b/);
  if (weekdayHit && beside) {
    const dated = weekdayAndDay(today, weekdayHit.day, Number(beside[1]));
    if (dated) out.start = dated;
  } else if (!out.start && weekdayHit && /\b(?:from|a partir|partir du|partir de|on|no|le|du)\b/.test(n)) {
    out.start = upcomingWeekday(today, weekdayHit.day);
  }
  const endCue = n.match(/\b(?:depart(?:ing)?|leaving|end(?:ing)? on|until|ate|jusqu(?:'au| au)?|partimos|partons|fim)\b[\s\S]{0,24}?(\d{1,2})(?:st|nd|rd|th)?(?:\s+(?:de\s+)?(nov(?:ember|embro|embre)?|jan(?:uary)?|fev(?:ereiro)?|mar(?:ch|s)?|abr(?:il)?|may|maio|mai|jun(?:ho|e)?|jul(?:ho|y)?|aug(?:ust|osto)?|sep(?:tembro)?|oct(?:ober|ubro)?|dec(?:ember|embro)?))?/);
  if (endCue && out.start) {
    const month = endCue[2] ? MONTHS[endCue[2]] : Number(out.start.slice(5, 7));
    const end = month ? monthDay(today, month, Number(endCue[1])) : null;
    if (end && end >= out.start) {
      out.end = end;
      const days = inclusiveDays(out.start, end);
      if (days) out.days = days;
    }
  }
  return out;
}

const RENTAL = /\b(?:rent(?:al|ing)?(?: a)? car|car rental|hire a car|alug(?:ar|uer|o)(?: um)? carro|aluguer(?: de carros?)?|louer(?: une)? voiture|location(?: de voiture)?)\b/;

/** A question about hiring a car, not a statement that the guest has one. */
export function isCarRentalQuestion(text: string): boolean {
  const n = loosen(text).replace(/[.!?…]+$/g, "").trim();
  const price = /\b(?:how much|quanto(?: custa)?|combien)\b/.test(n) && /\b(?:rental|rent|aluguer|location|carro|voiture|car)\b/.test(n);
  const about = RENTAL.test(n) || price;
  if (!about) return false;
  const asking = /\?/.test(text)
    || /^(?:where|how|what|which|can|do|is|any|onde|como|quanto|qual|quais|ou |comment|combien|quel|est-ce)\b/.test(n)
    || /\b(?:where can|onde posso|onde alug|ou louer|how much|quanto custa|combien coute|car rental)\b/.test(n);
  if (!asking) return false;
  if (/\b(?:we(?:'ll| will) rent|yes,? we rent|yes,? renting|sim,? vamos|oui,? on loue|temos carro|we have a car)\b/.test(n)) return false;
  return true;
}

/** "we'll take the 20:00 ferry" states a choice. A "when is" question does not. */
export function isTravelChoice(text: string): boolean {
  const n = loosen(text);
  if (/\?/.test(text) && /^(?:when|where|what|how|is|any|onde|quando|qual|comment|quel|a que)\b/.test(n)) return false;
  const ride = /\b(?:ferrys?|ferries|barcos?|bateaux?|flights?|voos?|vols?|avion)\b/.test(n);
  const commit = /\b(?:we(?:'ll| will)|we take|vamos|apanhamos|on prend|on prendra|prendre le|tomar o|take the|departing|leaving at|partimos|partons)\b/.test(n);
  return ride && commit;
}

export function isTravelQuestion(text: string): boolean {
  const n = loosen(text);
  if (isTravelChoice(text)) return false;
  const ride = /\b(?:ferrys?|ferries|barcos?|bateaux?|flights?|voos?|vols?|avion)\b/.test(n);
  const ask = /\b(?:when|next|any|from|horario|horaire|what time|que horas|a que horas|quelle heure|tomorrow|demain|amanha|prochain|proximo|proxima|qual|quel|wednesday|quarta|mercredi)\b/.test(n) || /\?/.test(text);
  const short = /\b(?:next|prochain|proximo|proxima)\s+(?:flights?|vols?|voos?|ferrys?|ferries|barcos?|bateaux?)\b/.test(n)
    || /\b(?:any|algum|quelque)\s+(?:ferrys?|ferries|flights?|barcos?|vols?)\b/.test(n);
  if (!(ride && ask) && !short) return false;
  if (/\b\d+\s*(?:days?|dias?|jours?)\b/.test(n) && !ask && !short) return false;
  return true;
}

export type TransportMention = {
  kind: "in" | "out" | "flt";
  date: string;
  time: string;
  from: string;
  to: string;
};

/** Compact last-answer rows, under the task fact limit. */
export function encodeTransportFact(rows: TransportMention[]): string {
  return rows
    .map((row) => `${row.kind} ${row.date} ${row.time} ${row.from}>${row.to}`)
    .join("; ")
    .slice(0, 240);
}

export function decodeTransportFact(value: string | undefined): TransportMention[] {
  if (!value) return [];
  const rows: TransportMention[] = [];
  for (const part of value.split(";")) {
    const match = part.trim().match(/^(in|out|flt)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+([^>]+)>(.+)$/);
    if (!match) continue;
    rows.push({ kind: match[1] as TransportMention["kind"], date: match[2], time: match[3], from: match[4], to: match[5] });
  }
  return rows;
}

export function latestTransport(task: Task): TransportMention[] {
  const fact = [...task.lastToolFacts].reverse().find((item) => item.name === "get_transport" || item.name === "transport");
  return decodeTransportFact(fact?.value);
}

/** "that date" / "on that day" / "a partir dessa data" reads the last transport answer. */
export function deicticDate(text: string, task: Task): string | null {
  const n = loosen(text);
  const points = /\b(?:that date|that day|on that day|from that|this date|essa data|esse dia|nessa data|nesta data|cette date|ce jour-la|ce jour|a partir dessa|a partir desta|a partir de cette)\b/.test(n)
    || (/\b(?:then|depois|ensuite)\b/.test(n) && /\b(?:plan|plano|voyage|viagem|from|partir)\b/.test(n));
  if (!points) return null;
  return latestTransport(task)[0]?.date ?? null;
}

export function refersToFerry(text: string): boolean {
  const n = loosen(text);
  return /\b(?:that ferry|esse barco|esse ferry|ce ferry|autour de ce ferry|around that ferry|plan around that ferry|take that ferry|apanhar esse barco|prendre ce ferry)\b/.test(n);
}

export function refersToFlight(text: string): boolean {
  const n = loosen(text);
  return /\b(?:that flight|esse voo|ce vol|around that flight|book around that flight|take that flight)\b/.test(n);
}

export type LengthEdit =
  | { kind: "add"; n: number; where: "end" | "start" }
  | { kind: "drop-last" }
  | { kind: "set"; n: number };

/** Add, drop or set the number of days. Not a fresh "3 days, slow pace". */
export function parseLengthEdit(text: string): LengthEdit | null {
  const n = loosen(text).replace(/[.!?…]+$/g, "").trim();
  if (/\b(?:at the (?:start|beginning)|no inicio|au debut|au commencement)\b/.test(n) && /\b(?:day|dia|jour|days|dias|jours)\b/.test(n)) {
    const count = wordNumber(n.match(/\b(\d+|two|dois|deux)\b/)?.[1]) ?? 1;
    return { kind: "add", n: Math.min(6, count), where: "start" };
  }
  if (/\b(?:remove|drop|tira|tirar|remover|enlever|enleve|supprime|supprimer)\b/.test(n) && /\b(?:last|ultimo|dernier)\b/.test(n)) return { kind: "drop-last" };
  const set = n.match(/\b(?:make it|deixa(?: em)?|deixa com|faz|passa(?: a)?|passe a|mets)\s+(\d+|two|three|four|five|six|seven|dois|tres|quatro|cinco|deux|trois|quatre|cinq)\s*(?:days|dias|jours)\b/);
  if (set) {
    const count = wordNumber(set[1]);
    if (count && count >= 1) return { kind: "set", n: Math.min(7, count) };
  }
  if (/\b(?:another day|one more day|mais um dia|um dia a mais|un jour de plus|encore un jour|add a day|add another day|one extra day)\b/.test(n)) {
    return { kind: "add", n: 1, where: "end" };
  }
  const extra = n.match(/\b(?:add|mais|plus d'|encore)\s+(\d+|two|dois|duas|deux)\s+(?:more\s+|de\s+)?(?:days|dias|jours)\b/);
  if (extra) {
    const count = wordNumber(extra[1]);
    if (count) return { kind: "add", n: Math.min(6, count), where: "end" };
  }
  return null;
}

export function applyLength(start: string, days: number, edit: LengthEdit): { start: string; days: number } {
  if (edit.kind === "set") return { start, days: Math.min(7, Math.max(1, edit.n)) };
  if (edit.kind === "drop-last") return { start, days: Math.max(1, days - 1) };
  const n = Math.max(1, edit.n);
  if (edit.where === "start") return { start: addDays(start, -n), days: Math.min(7, days + n) };
  return { start, days: Math.min(7, days + n) };
}

/** Questions about the open plan, not a request to change it. */
export function planQuestionKind(text: string): "day" | "leave" | "lunch" | null {
  const n = loosen(text);
  if (/\b(?:when do i leave|when do we leave|when are we leaving|quando (?:saio|partimos|parto|partem|partes)|quand (?:est-ce que )?(?:je|on|nous) pars?|a que horas (?:saio|parto|partimos))\b/.test(n)) return "leave";
  if (/\b(?:lunch|almoco|dejeuner)\b/.test(n) && /\b(?:where|day|dia|jour|onde|ou )\b/.test(n)) return "lunch";
  if (/\b(?:what(?:'s| is) on|whats on|o que (?:ha|tem)|que ha no|qu'est-ce qu'il y a|programme)\b/.test(n) && /\b(?:day|dia|jour)\s+\d+\b/.test(n)) return "day";
  if (/^(?:day|dia|jour)\s+\d+\??$/.test(n.replace(/[.!?…]+$/g, "").trim())) return "day";
  return null;
}

export function claimsUnappliedEdit(text: string): boolean {
  return /\b(?:done\b|i added|i've added|i have added|acrescentei|adicionei|j'ai ajout|atualizei o plano|i removed|i made it|i extended)\b/i.test(text);
}

export function say(locale: TaskLocale, en: string, pt: string, fr: string): string {
  return locale === "pt" ? pt : locale === "fr" ? fr : en;
}
