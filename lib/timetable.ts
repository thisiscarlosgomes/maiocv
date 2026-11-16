import { upcomingDate } from "./awareness/classify.ts";
import type { TaskLocale } from "./awareness/task.ts";
import type { Sailing } from "./essentials.ts";
import { humanPlanDate } from "./plan-reply.ts";
import { loosen, spokenDates, type TransportMention } from "./plan-router.ts";
import { addDays, type TripPlan } from "./trip.ts";

const PORTAL = "https://portal.maio.cv";
const TTL_MS = 10 * 60 * 1000;

export type FlightLeg = { date: string; from: string; to: string; departure: string; flight?: string };

export type Timetable = {
  ok: boolean;
  retrievedAt: string;
  sailings: Sailing[];
  flights: FlightLeg[];
};

type CacheEntry = { at: number; data: Timetable };
const cache = new WeakMap<object, CacheEntry>();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function clock(value: unknown): string | null {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

/** Minutes on the water when the timetable publishes a departure and no arrival. */
const ROUTE_CROSSING_MINUTES: { from: RegExp; to: RegExp; minutes: number }[] = [
  { from: /santiago|praia/i, to: /maio/i, minutes: 120 },
];

export function crossingMinutes(from: string, to: string): number | null {
  const row = ROUTE_CROSSING_MINUTES.find((route) => (route.from.test(from) && route.to.test(to)) || (route.from.test(to) && route.to.test(from)));
  return row?.minutes ?? null;
}

export function addClock(hhmm: string, minutes: number): string {
  const [hour, minute] = hhmm.split(":").map(Number);
  const total = ((hour * 60 + minute + minutes) % (24 * 60) + (24 * 60)) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Published arrival, or departure plus the route crossing when the payload has none. */
export function landingClock(row: { from: string; to: string; departure: string; arrival?: string }): { time: string; estimated: boolean } {
  if (row.arrival && row.arrival !== row.departure) return { time: row.arrival, estimated: false };
  const inbound = /maio/i.test(row.to) && !/maio/i.test(row.from);
  const minutes = inbound ? crossingMinutes(row.from, row.to) : null;
  if (minutes == null) return { time: row.departure, estimated: false };
  return { time: addClock(row.departure, minutes), estimated: true };
}

function sailingRows(payload: unknown): Sailing[] {
  const rows = Array.isArray(asRecord(payload).schedules) ? asRecord(payload).schedules as unknown[] : [];
  return rows.flatMap((row) => {
    const item = asRecord(row);
    const departure = clock(item.departure);
    if (typeof item.date !== "string" || !departure || typeof item.from !== "string" || typeof item.to !== "string") return [];
    const arrival = clock(item.arrival);
    return [{ from: item.from, to: item.to, departure, date: item.date, ...(arrival ? { arrival } : {}) }];
  });
}

function flightRows(payload: unknown): FlightLeg[] {
  const body = asRecord(payload);
  const bags = [body.routes, body.upcoming].flatMap((bag) => Object.values(asRecord(bag)));
  const seen = new Set<string>();
  const legs: FlightLeg[] = [];
  for (const rows of bags) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const item = asRecord(row);
      const departure = clock(item.departure);
      if (typeof item.date !== "string" || !departure || typeof item.from !== "string" || typeof item.to !== "string") continue;
      const key = `${item.date}|${item.from}|${item.to}|${departure}|${typeof item.flight === "string" ? item.flight : ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      legs.push({ date: item.date, from: item.from, to: item.to, departure, ...(typeof item.flight === "string" ? { flight: item.flight } : {}) });
    }
  }
  return legs;
}

async function readJson(fetchImpl: typeof fetch, url: string): Promise<unknown | null> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/** Published boats and flights from portal.maio.cv. Successes are cached for 10 minutes per fetch. */
export async function loadTimetable(fetchImpl: typeof fetch, now = new Date()): Promise<Timetable> {
  const hit = cache.get(fetchImpl);
  if (hit && hit.data.ok && now.getTime() - hit.at < TTL_MS) return hit.data;
  const retrievedAt = now.toISOString();
  try {
    const [boats, flights] = await Promise.all([
      readJson(fetchImpl, `${PORTAL}/api/schedules/boats`),
      readJson(fetchImpl, `${PORTAL}/api/schedules/flights`),
    ]);
    if (boats == null && flights == null) return { ok: false, retrievedAt, sailings: [], flights: [] };
    const boatBody = asRecord(boats);
    const data: Timetable = {
      ok: true,
      retrievedAt: typeof boatBody.retrievedAt === "string" ? boatBody.retrievedAt : retrievedAt,
      sailings: boats == null ? [] : sailingRows(boats),
      flights: flights == null ? [] : flightRows(flights),
    };
    cache.set(fetchImpl, { at: now.getTime(), data });
    return data;
  } catch {
    return { ok: false, retrievedAt, sailings: [], flights: [] };
  }
}

const toIsland = (row: Sailing) => /maio/i.test(row.to) && !/maio/i.test(row.from);
const fromIsland = (row: Sailing) => /maio/i.test(row.from) && /santiago|praia/i.test(row.to);
function dayNumber(date: string): number {
  return Date.parse(`${date}T12:00:00Z`);
}

/** The next published row after a named day. A past row is only used when nothing later exists. */
function nextPublished<T extends { date: string; departure: string }>(rows: T[], date: string): T | null {
  const later = byClock(rows.filter((row) => row.date > date));
  return later[0] ?? nearest(rows, date);
}

function nearest<T extends { date: string }>(rows: T[], date: string): T | null {
  const target = dayNumber(date);
  if (!Number.isFinite(target)) return null;
  return [...rows].filter((row) => row.date !== date).sort((a, b) => {
    const da = dayNumber(a.date) - target;
    const db = dayNumber(b.date) - target;
    const rank = (delta: number) => (delta >= 0 ? delta : -delta + 86_400_000);
    return rank(da) - rank(db) || a.date.localeCompare(b.date);
  })[0] ?? null;
}

function say(locale: TaskLocale, en: string, pt: string, fr: string): string {
  return locale === "pt" ? pt : locale === "fr" ? fr : en;
}

function downReply(locale: TaskLocale): string {
  return say(locale,
    "The ferry and flight timetable isn't available right now, so I won't guess a time.",
    "O horário de barcos e voos não está disponível agora, por isso não vou inventar uma hora.",
    "L'horaire des ferries et des vols n'est pas disponible, donc je n'invente pas d'heure.");
}

const WEEKDAYS: { name: string; day: number }[] = [
  { name: "sunday", day: 0 }, { name: "domingo", day: 0 }, { name: "dimanche", day: 0 },
  { name: "monday", day: 1 }, { name: "segunda", day: 1 }, { name: "lundi", day: 1 },
  { name: "tuesday", day: 2 }, { name: "terca", day: 2 }, { name: "mardi", day: 2 },
  { name: "wednesday", day: 3 }, { name: "quarta", day: 3 }, { name: "mercredi", day: 3 },
  { name: "thursday", day: 4 }, { name: "quinta", day: 4 }, { name: "jeudi", day: 4 },
  { name: "friday", day: 5 }, { name: "sexta", day: 5 }, { name: "vendredi", day: 5 },
  { name: "saturday", day: 6 }, { name: "sabado", day: 6 }, { name: "samedi", day: 6 },
];

function mentionedDate(text: string, today: string): string | null {
  const n = loosen(text);
  if (/\b(?:today|hoje|aujourd'hui|aujourdhui)\b/.test(n)) return today;
  if (/\b(?:tomorrow|amanha|demain)\b/.test(n)) return addDays(today, 1);
  const iso = n.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const spelled = spokenDates(text, today);
  if (spelled.start) return spelled.start;
  const hit = WEEKDAYS.find((weekday) => n.includes(weekday.name));
  return hit ? upcomingDate(today, hit.day) : null;
}

function wantsFlight(text: string): boolean {
  return /\b(?:flights?|voos?|vols?|avion)\b/i.test(text.normalize("NFD").replace(/\p{M}/gu, ""));
}

export type TravelContext = { time?: string; planEnd?: string | null };

function byClock<T extends { date: string; departure: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.departure.localeCompare(b.departure));
}

/** Still ahead of "now" in Atlantic/Cape_Verde. A missing clock keeps the whole day. */
function stillAhead(date: string, departure: string, today: string, time?: string): boolean {
  if (date > today) return true;
  if (date < today) return false;
  return !time || departure > time;
}

function flightLabel(leg: FlightLeg): string {
  return `${leg.departure}${leg.flight ? ` (${leg.flight})` : ""}`;
}

/** French weekday abbreviations carry periods ("dim.") that are not sentence ends. */
function travelDate(iso: string, locale: TaskLocale): string {
  const label = humanPlanDate(iso, locale);
  return locale === "fr" ? label.replace(/\./g, "").replace(/\s+/g, " ").trim() : label;
}

function directedSailings(text: string, table: Timetable): Sailing[] {
  const folded = text.normalize("NFD").replace(/\p{M}/gu, "");
  const pool = table.sailings.filter((row) => /\bpraia|santiago\b/i.test(text) || /praia|santiago/i.test(text) ? fromIsland(row) : toIsland(row) || fromIsland(row));
  if (/\b(?:to praia|para a praia|para praia|vers praia|to santiago|para santiago)\b/i.test(folded)) return table.sailings.filter(fromIsland);
  if (/\b(?:to maio|para o maio|vers maio)\b/i.test(folded)) return table.sailings.filter(toIsland);
  return pool;
}

function flightPool(text: string, table: Timetable): FlightLeg[] {
  const folded = text.normalize("NFD").replace(/\p{M}/gu, "");
  const fromMaio = /\b(?:from maio|do maio|de maio|depuis maio|depuis)\b/i.test(folded) || !/\b(?:to maio|para o maio|vers maio)\b/i.test(folded);
  return byClock(table.flights.filter((leg) => fromMaio ? leg.from === "MMO" : leg.to === "MMO"));
}

/** The sailing or flight the reply names, so a later "around that" uses the same row. */
export function citedTransport(text: string, table: Timetable, today: string, time?: string): TransportMention[] {
  if (!table.ok) return [];
  const when = mentionedDate(text, today);
  if (wantsFlight(text)) {
    const pool = flightPool(text, table);
    const onDay = when ? pool.filter((leg) => leg.date === when) : byClock(pool.filter((leg) => stillAhead(leg.date, leg.departure, today, time)));
    const day = onDay[0]?.date;
    const shown = (day ? onDay.filter((leg) => leg.date === day) : [])[0] ?? (when ? nextPublished(pool, when) : nearest(pool, today));
    return shown ? [{ kind: "flt", date: shown.date, time: shown.departure, from: shown.from, to: shown.to }] : [];
  }
  const directed = directedSailings(text, table);
  const upcoming = byClock(directed.filter((row) => when ? row.date === when : stillAhead(row.date, row.departure, today, time)));
  const hit = upcoming[0] ?? (when ? nextPublished(directed, when) : nearest(directed, today));
  if (!hit) return [];
  const kind: TransportMention["kind"] = toIsland(hit) ? "in" : "out";
  return [{ kind, date: hit.date, time: landingClock(hit).time, from: hit.from, to: hit.to }];
}

/** Short answer for a ferry or flight question. Times come only from the payload. */
export function answerTravelQuestion(text: string, locale: TaskLocale, table: Timetable, today: string, context: TravelContext = {}): string {
  if (!table.ok) return downReply(locale);
  const when = mentionedDate(text, today);
  const flight = wantsFlight(text);
  const published = say(locale, "Published timetable, not live status.", "Horário publicado, não é estado ao vivo.", "Horaire publié, pas un statut en direct.");
  if (flight) {
    const pool = flightPool(text, table);
    const onDay = when
      ? pool.filter((leg) => leg.date === when)
      : byClock(pool.filter((leg) => stillAhead(leg.date, leg.departure, today, context.time)));
    const nextDay = onDay[0]?.date;
    const shown = nextDay ? onDay.filter((leg) => leg.date === nextDay) : [];
    if (shown.length) {
      const day = travelDate(shown[0].date, locale);
      const rows = shown.map(flightLabel).join(", ");
      const last = context.planEnd && context.planEnd > today && context.planEnd !== shown[0].date
        ? pool.filter((leg) => leg.date === context.planEnd)
        : [];
      const extra = last.length
        ? say(locale,
          ` On your last day, ${travelDate(last[0].date, locale)}: ${last.map(flightLabel).join(", ")}.`,
          ` No seu último dia, ${travelDate(last[0].date, locale)}: ${last.map(flightLabel).join(", ")}.`,
          ` Votre dernier jour, ${travelDate(last[0].date, locale)} : ${last.map(flightLabel).join(", ")}.`)
        : "";
      const lead = when
        ? say(locale, `Flights from Maio on ${day}: ${rows} to Praia.`, `Voos do Maio em ${day}: ${rows} para a Praia.`, `Vols depuis Maio le ${day} : ${rows} vers Praia.`)
        : say(locale, `Next flights from Maio: ${day} at ${rows} to Praia.`, `Próximos voos do Maio: ${day} às ${rows} para a Praia.`, `Prochains vols depuis Maio : ${day} à ${rows} vers Praia.`);
      return `${lead}${extra} ${published}`;
    }
    const near = when ? nextPublished(pool, when) : nearest(pool, today);
    if (!near) return say(locale,
      `No flight from Maio is in the published timetable. ${published}`,
      `Não há voo do Maio no horário publicado. ${published}`,
      `Aucun vol depuis Maio dans l'horaire publié. ${published}`);
    return say(locale,
      `No flight from Maio is published${when ? ` on ${travelDate(when, locale)}` : ""}. The nearest is ${travelDate(near.date, locale)} at ${near.departure}. ${published}`,
      `Não há voo do Maio publicado${when ? ` em ${travelDate(when, locale)}` : ""}. O mais próximo é ${travelDate(near.date, locale)} às ${near.departure}. ${published}`,
      `Aucun vol depuis Maio n'est publié${when ? ` le ${travelDate(when, locale)}` : ""}. Le plus proche est le ${travelDate(near.date, locale)} à ${near.departure}. ${published}`);
  }
  const directed = directedSailings(text, table);
  const upcoming = byClock(directed.filter((row) => when ? row.date === when : stillAhead(row.date, row.departure, today, context.time)));
  const hit = upcoming[0] ?? null;
  if (hit) return ferryHitReply(hit, locale, published);
  const near = when ? nextPublished(directed, when) : nearest(directed, today);
  if (!near) return say(locale,
    `No ferry is in the published timetable. That is not the same as no service. ${published}`,
    `Não há barco no horário publicado. Isso não é o mesmo que não haver serviço. ${published}`,
    `Aucun ferry dans l'horaire publié. Ce n'est pas la même chose qu'une absence de service. ${published}`);
  return say(locale,
    `No ferry is published${when ? ` on ${travelDate(when, locale)}` : ""}. The nearest is ${travelDate(near.date, locale)} at ${near.departure}, ${near.from} to ${near.to}. ${published}`,
    `Não há barco publicado${when ? ` em ${travelDate(when, locale)}` : ""}. O mais próximo é ${travelDate(near.date, locale)} às ${near.departure}, ${near.from} para ${near.to}. ${published}`,
    `Aucun ferry n'est publié${when ? ` le ${travelDate(when, locale)}` : ""}. Le plus proche est le ${travelDate(near.date, locale)} à ${near.departure}, ${near.from} vers ${near.to}. ${published}`);
}

function ferryHitReply(hit: Sailing, locale: TaskLocale, published: string): string {
  const land = landingClock(hit);
  const when = travelDate(hit.date, locale);
  if (land.estimated) {
    return say(locale,
      `Next ferry: ${when}, departs ${hit.departure} from ${hit.from}, arrives around ${land.time} in ${hit.to}. ${published}`,
      `Próximo barco: ${when}, sai às ${hit.departure} de ${hit.from}, chega por volta das ${land.time} a ${hit.to}. ${published}`,
      `Prochain ferry : ${when}, part à ${hit.departure} de ${hit.from}, arrive vers ${land.time} à ${hit.to}. ${published}`);
  }
  if (hit.arrival && hit.arrival !== hit.departure) {
    return say(locale,
      `Next ferry: ${when}, departs ${hit.departure} from ${hit.from}, arrives ${hit.arrival} in ${hit.to}. ${published}`,
      `Próximo barco: ${when}, sai às ${hit.departure} de ${hit.from}, chega às ${hit.arrival} a ${hit.to}. ${published}`,
      `Prochain ferry : ${when}, part à ${hit.departure} de ${hit.from}, arrive à ${hit.arrival} à ${hit.to}. ${published}`);
  }
  return say(locale,
    `Next ferry: ${when} at ${hit.departure}, ${hit.from} to ${hit.to}. ${published}`,
    `Próximo barco: ${when} às ${hit.departure}, ${hit.from} para ${hit.to}. ${published}`,
    `Prochain ferry : ${when} à ${hit.departure}, ${hit.from} vers ${hit.to}. ${published}`);
}

type Arrival = { mode?: string; dayIndex?: number; time?: string };
type Departure = { mode?: string; time?: string };

function arrivalOf(value: unknown): Arrival | null {
  const item = asRecord(value);
  if (!item.mode && !item.time) return null;
  return { ...(typeof item.mode === "string" ? { mode: item.mode } : {}), ...(typeof item.dayIndex === "number" ? { dayIndex: item.dayIndex } : {}), ...(clock(item.time) ? { time: clock(item.time)! } : {}) };
}

function departureOf(value: unknown): Departure | null {
  const item = asRecord(value);
  if (!item.mode && !item.time) return null;
  return { ...(typeof item.mode === "string" ? { mode: item.mode } : {}), ...(clock(item.time) ? { time: clock(item.time)! } : {}) };
}

/**
 * Fill a missing arrival or departure clock from the published timetable.
 * A time the guest already gave is left as they said it.
 */
export function attachPublishedTravel(request: Record<string, unknown>, table: Timetable): Record<string, unknown> {
  if (!table.ok) return request;
  const start = typeof request.startDate === "string" ? request.startDate : "";
  const days = typeof request.days === "number" ? request.days : 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || days < 1) return request;
  const next = { ...request };
  const last = addDays(start, Math.max(0, days - 1));
  const arrival = arrivalOf(request.arrival);
  const departure = departureOf(request.departure);
  if (!arrival?.time) {
    const ferry = table.sailings.find((row) => row.date === start && toIsland(row));
    const flight = table.flights.find((leg) => leg.date === start && leg.to === "MMO");
    const mode = arrival?.mode ?? (ferry ? "ferry" : flight ? "flight" : null);
    if (mode === "ferry" && ferry) next.arrival = { mode: "ferry", dayIndex: arrival?.dayIndex ?? 0, time: ferry.departure };
    else if (mode === "flight" && flight) next.arrival = { mode: "flight", dayIndex: arrival?.dayIndex ?? 0, time: flight.departure };
  }
  if (days > 1 && !departure?.time) {
    const ferry = table.sailings.find((row) => row.date === last && fromIsland(row));
    const flight = table.flights.find((leg) => leg.date === last && leg.from === "MMO");
    const mode = departure?.mode ?? (ferry ? "ferry" : flight ? "flight" : "ferry");
    if (mode === "ferry" && ferry) next.departure = { mode: "ferry", time: ferry.departure };
    else if (mode === "flight" && flight) next.departure = { mode: "flight", time: flight.departure };
    else next.departure = { mode };
  }
  return next;
}

/** Add the nearest published trip onto an arrival row that has no clock. */
export function annotateMissingTravel(plan: TripPlan, table: Timetable): TripPlan {
  if (!table.ok) return plan;
  let changed = false;
  const days = plan.days.map((day, index) => ({
    ...day,
    items: day.items.map((item) => {
      if (item.kind !== "transport" || item.start) return item;
      const extra = nearestTravelNote(day.date, table, plan.locale, index === 0 ? "in" : "out");
      if (!extra || (item.note ?? "").includes(extra)) return item;
      changed = true;
      const note = `${item.note ? `${item.note} ` : ""}${extra}`.slice(0, 200);
      return { ...item, note };
    }),
  }));
  return changed ? { ...plan, days } : plan;
}

export function nearestTravelNote(date: string, table: Timetable, locale: TaskLocale, direction: "in" | "out"): string | null {
  if (!table.ok) return null;
  const ferry = nearest(table.sailings.filter(direction === "in" ? toIsland : fromIsland), date);
  const flight = nearest(table.flights.filter((leg) => direction === "in" ? leg.to === "MMO" : leg.from === "MMO"), date);
  const ferryFirst = ferry && (!flight || dayNumber(ferry.date) <= dayNumber(flight.date));
  if (ferryFirst && ferry) {
    const when = humanPlanDate(ferry.date, locale);
    return say(locale,
      `Time not published. Nearest ferry: ${when}, ${ferry.departure}, ${ferry.from} to ${ferry.to}.`,
      `Hora por publicar. Barco mais próximo: ${when}, ${ferry.departure}, ${ferry.from} para ${ferry.to}.`,
      `Heure non publiée. Ferry le plus proche : ${when}, ${ferry.departure}, ${ferry.from} vers ${ferry.to}.`);
  }
  if (!flight) return null;
  const when = humanPlanDate(flight.date, locale);
  return say(locale,
    `Time not published. Nearest flight: ${when}, ${flight.departure}.`,
    `Hora por publicar. Voo mais próximo: ${when}, ${flight.departure}.`,
    `Heure non publiée. Vol le plus proche : ${when}, ${flight.departure}.`);
}
