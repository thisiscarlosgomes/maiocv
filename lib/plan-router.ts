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

/** A reply that tells the guest the trip changed. PT and FR included. An honest "already" line does not. */
export function claimsUnappliedEdit(text: string): boolean {
  if (/\b(?:already the lighter|already a full|já está mais leve|já está cheio|ja esta mais leve|ja esta cheio|déjà plus léger|déjà bien rempli|deja plus leger|deja bien rempli)\b/i.test(text)) return false;
  if (/\b(?:done\b|all set|i(?:'ve| have)? (?:moved|added|updated|removed|extended|packed)|moved your|updated the (?:plan|trip)|i made it|day is packed|packed with|acrescentei|adicionei|mudei|alterei|atualizei|pronto|já está|ja esta|c'est fait|tout est (?:bon|regle)|j'ai (?:ajout|deplac|modifi|mis a jour|rendu|all[eé]g))\b/i.test(text)) return true;
  return /\b(?:day|dia|jour)\s+\d+\b[\s\S]{0,160}\b(?:packed|busier|lighter|easier|quieter|relaxed|fuller|cheio|mais leve|plus l[eé]ger|plus charg)\b/i.test(text);
}

/** A real arrival. A hedge ("actually", "finalement") is not one of these. */
const HARD_START = /\b(?:going on|go on|arriv(?:e|ing|ons)?|land on|we land|chego|vou(?: a| no| dia)?|j'arrive|j arrive|start(?:ing)? on|a partir)\b/;
const HEDGE_START = /\b(?:actually|finalement|en fait|na verdade)\b/;
/** Leaving, departing, until. "saio no dia 22" and "je pars le 22" name the end. */
const END_CUE = /\b(?:until|till|through|ate dia|ate o dia|jusqu(?:'au| au)?|depart(?:ing)?(?: on)?|leaving(?: on)?|leave on|end(?:ing)? on|fim dia|partir le|pars le|je pars|saio|saimos|parto|partimos|partons)\b/;

function bareDay(text: string, allowA = false): number | undefined {
  const n = loosen(text);
  const prefix = allowA ? "the|dia|le|a|no dia" : "the|dia|le|no dia";
  const match = n.match(new RegExp(`\\b(?:${prefix})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`)) ?? n.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/);
  if (match && /^\s*[- ]?(?:year|ano|ans)\b/.test(n.slice((match.index ?? 0) + match[0].length))) return undefined;
  const day = match ? Number(match[1]) : undefined;
  return day && day >= 1 && day <= 31 ? day : undefined;
}

/** Place a day-of-month on or after today, preferring the open trip's month. */
export function resolveDayOfMonth(today: string, day: number, anchor?: string): string | null {
  if (anchor && /^\d{4}-\d{2}-\d{2}$/.test(anchor)) {
    const year = Number(anchor.slice(0, 4));
    const month = Number(anchor.slice(5, 7));
    const same = isoInYear(year, month, day);
    if (same && same >= today) return same;
  }
  const cursor = new Date(`${today}T12:00:00Z`);
  for (let i = 0; i < 14; i += 1) {
    const iso = isoInYear(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, day);
    if (iso && iso >= today) return iso;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
  }
  return null;
}

const ARRIVE_CUE = /\b(?:arriv\w*|chego|chegamos|arrivee|j'arrive|j arrive|land(?:ing|s)?|start(?:ing)?|a partir)\b/;
const LEAVE_CUE = /\b(?:leav\w*|depart\w*|saio|saimos|partimos|partons|partir|until|till|ate|jusqu\w*|end(?:ing)?|fim)\b/;

function monthMentioned(text: string): number | undefined {
  const names = Object.keys(MONTHS).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (new RegExp(`\\b${name}\\b`).test(text)) return MONTHS[name];
  }
  return undefined;
}

function firstDayNumber(rest: string): number | undefined {
  for (const match of rest.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\b/g)) {
    const after = rest.slice((match.index ?? 0) + match[0].length);
    if (/^[:h]\d/.test(after)) continue;
    if (/^\s*[- ]?(?:year|anos|ans|days|dias|jours)\b/.test(after)) continue;
    const value = Number(match[1]);
    if (value >= 1 && value <= 31) return value;
  }
  return undefined;
}

function placeStayDay(today: string, day: number, month: number | undefined, anchor?: string): string | null {
  return month ? monthDay(today, month, day) : resolveDayOfMonth(today, day, anchor);
}

/**
 * Both ends of a stay: "arriving 18, leaving 20 Nov", "from 18 to 20",
 * "chego 18 e saio 20", "arrivée le 18, départ le 20".
 * A month named on only one side applies to both. The open trip's month fills the rest.
 */
export function pairedStay(text: string, today: string, anchor?: string): { start: string; end: string; days: number } | null {
  const n = loosen(text);
  let startDay: number | undefined;
  let endDay: number | undefined;
  const arrive = ARRIVE_CUE.exec(n);
  const leave = LEAVE_CUE.exec(n);
  if (arrive && leave && arrive.index !== leave.index) {
    const first = arrive.index < leave.index ? arrive : leave;
    const second = first === arrive ? leave : arrive;
    const early = firstDayNumber(n.slice(first.index + first[0].length, second.index));
    const late = firstDayNumber(n.slice(second.index + second[0].length));
    if (first === arrive) {
      startDay = early;
      endDay = late;
    } else {
      endDay = early;
      startDay = late;
    }
  }
  if (!startDay || !endDay) {
    const range = n.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:-|–|—|to|ate|au)\s*(?:the\s+|o\s+|dia\s+|le\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (range) {
      const tail = n.slice((range.index ?? 0) + range[0].length, (range.index ?? 0) + range[0].length + 8);
      const small = Number(range[1]) <= 14 && Number(range[2]) <= 14;
      if (!(small && /\b(?:days|dias|jours)\b/.test(tail) && !monthMentioned(n))) {
        startDay = Number(range[1]);
        endDay = Number(range[2]);
      }
    }
  }
  if (!startDay || !endDay || startDay > 31 || endDay > 31 || endDay < startDay) return null;
  const month = monthMentioned(n);
  const start = placeStayDay(today, startDay, month, anchor);
  const end = placeStayDay(today, endDay, month, anchor);
  if (!start || !end || end < start) return null;
  const days = inclusiveDays(start, end);
  if (!days) return null;
  return { start, end, days };
}

export type DateShift = { start?: string; end?: string; days?: number; shiftDays?: number };

/** "replace the beach on day 1" / "troca a praia do dia 1" / "remplace la plage du jour 1". */
export function beachSwapDay(text: string): number | null {
  const n = loosen(text);
  if (!/\b(?:replace|swap|troca|trocar|substitui|remplace|remplacer)\b/.test(n)) return null;
  if (!/\b(?:beach|praia|plage)\b/.test(n)) return null;
  const match = n.match(/\b(?:day|dia|jour)\s+(\d{1,2})\b/);
  if (!match) return null;
  const day = Number(match[1]);
  return day >= 1 && day <= 14 ? day : null;
}

const BARE_REPLACE = /^(?:replace|swap|change|troca|trocar|substitui|remplace|remplacer|muda|mudar)$/;
const SHORT_YES = /^(?:yes|yeah|yep|yup|sure|sim|oui|si|claro)$/;

function pendingKind(pending: string | null): "start" | "end" | "changes" | null {
  if (!pending) return null;
  const n = loosen(pending);
  if (/which day should the trip start|para que dia mudo|quel jour pour le debut/.test(n)) return "start";
  if (/which day are you leaving|em que dia sai|quel jour partez/.test(n)) return "end";
  if (/want changes|quer mudanc|changer quelque chose|voulez changer/.test(n)) return "changes";
  return null;
}

export type FollowUp =
  | { kind: "ask-replace" }
  | { kind: "ask-change" }
  | { kind: "start-day"; day: number }
  | { kind: "end-day"; day: number };

/**
 * A short reply to the question we just asked.
 * A bare day after "which day should the trip start?", yes after "want changes?",
 * or "replace" on its own when a plan is open.
 */
export function resolveFollowUp(text: string, pending: string | null, hasPlan: boolean): FollowUp | null {
  const n = loosen(text).replace(/[.!?…]+$/g, "").trim();
  if (!n || n.length > 48) return null;
  const asked = pendingKind(pending);
  if (asked === "changes" && SHORT_YES.test(n)) return { kind: "ask-change" };
  if (asked === "start" || asked === "end") {
    const day = n.match(/^(?:the |dia |le |o )?(\d{1,2})(?:st|nd|rd|th)?$/);
    if (day) {
      const value = Number(day[1]);
      if (value >= 1 && value <= 31) return { kind: asked === "end" ? "end-day" : "start-day", day: value };
    }
  }
  if (hasPlan && BARE_REPLACE.test(n)) return { kind: "ask-replace" };
  return null;
}

/** An edit we should clarify, not hand to the island fallback, when the model misses. */
export function looksLikePlanEdit(text: string): boolean {
  const n = loosen(text);
  const bare = n.replace(/[.!?…]+$/g, "").trim();
  if (BARE_REPLACE.test(bare) || SHORT_YES.test(bare) || /^\d{1,2}$/.test(bare)) return true;
  if (beachSwapDay(text)) return true;
  if (parseLengthEdit(text)) return true;
  return /\b(?:replace|swap|troca|trocar|remplace|remplacer|change|muda|mudar|altera|laisse|laisser|remplis|remplir)\b/.test(n)
    && /\b(?:day|dia|jour|beach|praia|plage|afternoon|tarde|apres-midi|stop|paragem|matin|manha|morning|libre|livre|free)\b/.test(n);
}

export function parseDateShift(text: string, today: string, anchor?: string): DateShift | "ask" | null {
  if (isTravelQuestion(text) || isTravelChoice(text) || planQuestionKind(text) || beachSwapDay(text)) return null;
  const n = loosen(text);
  if (/\b(?:next week|proxima semana|semaine prochaine)\b/.test(n)) return { shiftDays: 7 };
  const later = n.match(/\b(?:a|one|um|un) day later\b|\b(?:um dia mais tarde|un jour plus tard|decale(?:r| de)? (?:d')?un jour)\b/);
  if (later) return { shiftDays: 1 };
  const earlier = n.match(/\b(?:a|one) day earlier\b|\b(?:um dia mais cedo|un jour plus tot)\b/);
  if (earlier) return { shiftDays: -1 };
  const pushed = n.match(/\b(?:push|move|shift|adiar|decale(?:r)?) (?:it |o |le |de )?(?:by |d')?(\d+|two|dois|deux) (?:days?|dias|jours)\b/);
  if (pushed) {
    const count = wordNumber(pushed[1]);
    if (count) return { shiftDays: /\bearlier|mais cedo|plus tot|back\b/.test(n) ? -count : count };
  }
  const stay = pairedStay(n, today, anchor);
  if (stay) return stay;
  const spelled = spokenDates(text, today);
  const stated = wordNumber(n.match(/\b(\d+|two|three|four|five|six|seven|dois|tres|quatro|dois|deux|trois|quatre)\s*(?:days|dias|jours)\b/)?.[1]);
  // "leaving 20 Nov" names the end. The month glued to that day is not a new start.
  if (spelled.start && spelled.end && spelled.start === spelled.end && LEAVE_CUE.test(n) && !ARRIVE_CUE.test(n)) return { end: spelled.end };
  if (spelled.start && spelled.end && spelled.days) return { start: spelled.start, end: spelled.end, days: spelled.days };
  if (spelled.start && stated) return { start: spelled.start, days: stated };
  if (spelled.start) return { start: spelled.start };
  if (spelled.end) return { end: spelled.end };
  const hardStart = HARD_START.test(n);
  const hedge = HEDGE_START.test(n);
  const endCue = END_CUE.test(n);
  const day = bareDay(n, hardStart || hedge);
  if (!day) return null;
  const placed = resolveDayOfMonth(today, day, anchor);
  if (!placed) return "ask";
  // "actually… leaving on the 22nd" is an end. A hedge alone ("actually the 18th") stays a start.
  if (hardStart && endCue) return "ask";
  if (endCue) return { end: placed };
  if (hardStart || hedge) return { start: placed };
  return "ask";
}

/** Apply a shift to the open span. Start alone keeps the length. End alone keeps the start. */
export function applyDateShift(start: string, days: number, shift: DateShift): { start: string; days: number } | null {
  let nextStart = start;
  let nextDays = days;
  if (shift.shiftDays) nextStart = addDays(start, shift.shiftDays);
  if (shift.start) nextStart = shift.start;
  if (shift.end) {
    const counted = inclusiveDays(shift.start ?? nextStart, shift.end);
    // An end before the start, or a stay longer than the trip max, is not applied.
    if (!counted || counted > 7) return null;
    nextDays = counted;
  } else if (shift.days) nextDays = Math.min(7, Math.max(1, shift.days));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextStart) || nextDays < 1) return null;
  return { start: nextStart, days: nextDays };
}

export function hasDateIntent(text: string): boolean {
  if (isTravelQuestion(text) || isTravelChoice(text) || planQuestionKind(text)) return false;
  if (parseLengthEdit(text)) return true;
  return parseDateShift(text, "2000-01-01") !== null;
}

export function say(locale: TaskLocale, en: string, pt: string, fr: string): string {
  return locale === "pt" ? pt : locale === "fr" ? fr : en;
}
