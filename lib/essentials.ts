import type { Envelope } from "./agora.ts";
import { maioClock } from "./agora.ts";
import { t } from "./i18n.ts";
import type { Locale } from "./locale.ts";
import type { MessageKey } from "./i18n.ts";
import { MAIO_API } from "./maio-catalog.ts";
import { retrievedLabel } from "./now-view.ts";

const boatsSource = {
  id: "cv-interilhas",
  name: "CV Interilhas",
  url: "https://www.cvinterilhas.cv/routesschedules",
};
const flightsSource = {
  id: "cvsky",
  name: "CVSky",
  url: "https://booking.cvsky.cv/",
};
const paymentsSource = {
  id: "dataset-payments",
  name: "INE e SISP",
  url: "https://api.maio.cv/api/v1/sources/dataset-payments",
};

export type Sailing = { from: string; to: string; departure: string; date: string; arrival?: string };
export type PaymentCount = { year: string; value: number };

export type EssentialsBody = {
  ferry: Envelope<Sailing[]>;
  flight: Envelope<{ status: string; sourceUrls: { id: string; url: string }[] }>;
  payments: Envelope<{ atms: PaymentCount; pos: PaymentCount }>;
};

function unavailable<T>(kind: Envelope<T>["kind"], source: Envelope<T>["source"], retrievedAt: string): Envelope<T> {
  return { kind, status: "unavailable", source, sourceUpdatedAt: null, retrievedAt, caveats: [], data: null };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

const caveatKeys: Record<string, MessageKey> = {
  "Only the explicitly selected source day is parsed. Date-picker options are not confirmed sailing dates.": "ess.caveat.ferry.day",
  "No fallback, extrapolated sailings, vessel names, arrivals or live status. Confirm travel with the operator.": "ess.caveat.ferry.operator",
  "Only date-specific Praia/Santiago–Maio timetable rows shown by CV Interilhas are included. Calendar choices alone are not confirmed sailing dates.": "ess.caveat.ferry.dates",
  "Published departure times are not live status or a guarantee of operation. Vessel names and arrival times are not inferred; confirm with the operator.": "ess.caveat.ferry.published",
  "retrievedAt is retrieval time, not operator publication time. No weekly schedule is extrapolated.": "ess.caveat.ferry.retrieved",
  "This snapshot is over 48 hours old. Recheck CV Interilhas.": "ess.caveat.ferry.stale",
  "updated_at is null because operator publication time is unknown; retrievedAt is fetch time.": "ess.caveat.timeUnknown",
  "Third-party published timetable, not live operations or airline confirmation.": "ess.caveat.flight.third",
  "Only explicit weekday rows whose published validity includes today are returned. Expired, future-only and undated rows are excluded. No current records does not mean no flights.": "ess.caveat.flight.rows",
  "Unverified local cache files are not used. updated_at is null: publication time is unknown.": "ess.caveat.flight.cache",
  "Date-specific options retrieved from CVSky public booking searches for one adult. Not live flight status, seat availability or a guaranteed operating schedule.": "ess.caveat.flight.booking",
  "An empty result means no booking options were returned, not that no flight operates. Failed searches remain unavailable.": "ess.caveat.flight.empty",
  "routes contains today only; upcoming covers requested dates (next 14 days by default). Full cached coverage is available with from/to at https://api.maio.cv/api/v1/flights.": "ess.caveat.flight.window",
  "Fares and seat counts are deliberately not cached. Recheck the airline before booking.": "ess.caveat.flight.fares",
  "This snapshot is over 48 hours old; recheck CVSky.": "ess.caveat.flight.stale",
};

export function visibleCaveat(text: string, locale: Locale): string {
  return t(caveatKeys[text] ?? "ess.caveat.generic", undefined, locale);
}

const verifiedIntl: Record<Locale, string> = { pt: "pt-PT", en: "en-GB", fr: "fr-FR" };

export function verifiedDate(isoDate: string, locale: Locale): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat(verifiedIntl[locale], {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

const flightRouteKeys: Record<string, MessageKey> = {
  rai_mmo: "ess.flight.route.rai_mmo",
  mmo_rai: "ess.flight.route.mmo_rai",
};

export function flightRouteLabel(id: string, locale: Locale): string {
  const key = flightRouteKeys[id];
  return key ? t(key, undefined, locale) : id.replace(/[_-]+/g, " ");
}

export function scheduleSource(
  envelope: { kind: string; source: { name: string }; retrievedAt: string; caveats: string[] },
  locale: Locale,
): { line: string; caveats: string[] } {
  const kind = envelope.kind === "published-schedule"
    ? t("kind.published-schedule", undefined, locale)
    : envelope.kind;
  return {
    line: `${kind} · ${envelope.source.name} · ${retrievedLabel(envelope.retrievedAt, locale)}`,
    caveats: envelope.caveats,
  };
}

export function sailingsForToday(payload: unknown, today: string): Sailing[] {
  const body = asRecord(payload);
  const rows = Array.isArray(body.schedules) ? body.schedules : [];
  return rows.flatMap((row) => {
    const item = asRecord(row);
    if (item.date !== today) return [];
    if (typeof item.departure !== "string" || typeof item.from !== "string" || typeof item.to !== "string") return [];
    return [{ from: item.from, to: item.to, departure: item.departure, date: today }];
  });
}

/** The payments dataset nests the portal-shaped tables under payload. A flat fixture is used as-is. */
export function paymentDocument(raw: unknown): unknown {
  const body = asRecord(raw);
  const nested = asRecord(body.payload);
  if (Array.isArray(nested.atm_terminals_by_island) || Array.isArray(nested.pos_terminals_by_island)) return nested;
  return body;
}

export function paymentCount(payload: unknown, key: string, island: string, year: string): number | null {
  const rows = asRecord(payload)[key];
  if (!Array.isArray(rows)) return null;
  const row = rows.map(asRecord).find((item) => item.name === island);
  const values = asRecord(row?.values);
  const value = values[year];
  return typeof value === "number" ? value : null;
}

export async function loadEssentials(fetchImpl: typeof fetch, now = new Date()): Promise<EssentialsBody> {
  const retrievedAt = now.toISOString();
  const today = maioClock(now).date;
  const [ferry, flight, payments] = await Promise.all([
    loadFerry(fetchImpl, retrievedAt, today),
    loadFlight(fetchImpl, retrievedAt),
    loadPayments(fetchImpl, retrievedAt),
  ]);
  return { ferry, flight, payments };
}

async function loadFerry(fetchImpl: typeof fetch, retrievedAt: string, today: string): Promise<Envelope<Sailing[]>> {
  try {
    const payload = asRecord(await (await fetchImpl(`${MAIO_API}/boats`)).json());
    const sailings = sailingsForToday(payload, today);
    const caveats = Array.isArray(payload.caveats) ? payload.caveats.filter((item): item is string => typeof item === "string") : [];
    return {
      kind: "published-schedule",
      status: sailings.length ? "available" : "no-current-records",
      source: boatsSource,
      sourceUpdatedAt: null,
      retrievedAt: typeof payload.retrievedAt === "string" ? payload.retrievedAt : retrievedAt,
      caveats,
      data: sailings,
    };
  } catch {
    return unavailable("published-schedule", boatsSource, retrievedAt);
  }
}

async function loadFlight(fetchImpl: typeof fetch, retrievedAt: string): Promise<Envelope<{ status: string; sourceUrls: { id: string; url: string }[] }>> {
  try {
    const payload = asRecord(await (await fetchImpl(`${MAIO_API}/flights`)).json());
    const urls = asRecord(payload.sourceUrls);
    const sourceUrls = Object.entries(urls).flatMap(([id, url]) => (typeof url === "string" ? [{ id, url }] : []));
    const routes = asRecord(payload.routes);
    const hasRows = Object.values(routes).some((rows) => Array.isArray(rows) && rows.length > 0);
    return {
      kind: "published-schedule",
      status: hasRows ? "available" : "no-current-records",
      source: flightsSource,
      sourceUpdatedAt: null,
      retrievedAt: typeof payload.retrievedAt === "string" ? payload.retrievedAt : retrievedAt,
      caveats: Array.isArray(payload.caveats) ? payload.caveats.filter((item): item is string => typeof item === "string") : [],
      data: { status: typeof payload.status === "string" ? payload.status : "partial", sourceUrls },
    };
  } catch {
    return unavailable("published-schedule", flightsSource, retrievedAt);
  }
}

async function loadPayments(fetchImpl: typeof fetch, retrievedAt: string): Promise<Envelope<{ atms: PaymentCount; pos: PaymentCount }>> {
  try {
    const payload = paymentDocument(await (await fetchImpl(`${MAIO_API}/datasets/payments`)).json());
    const year = "2023";
    const atms = paymentCount(payload, "atm_terminals_by_island", "Maio", year);
    const pos = paymentCount(payload, "pos_terminals_by_island", "Maio", year);
    if (atms === null || pos === null) return unavailable("official-statistic", paymentsSource, retrievedAt);
    return {
      kind: "official-statistic",
      status: "available",
      source: paymentsSource,
      sourceUpdatedAt: null,
      retrievedAt,
      caveats: [],
      data: { atms: { year, value: atms }, pos: { year, value: pos } },
    };
  } catch {
    return unavailable("official-statistic", paymentsSource, retrievedAt);
  }
}

/** Published sailings for every date in the Maio API snapshot. */
export async function loadBoatSchedule(fetchImpl: typeof fetch, now = new Date()): Promise<Envelope<Sailing[]>> {
  const retrievedAt = now.toISOString();
  try {
    const payload = asRecord(await (await fetchImpl(`${MAIO_API}/boats`)).json());
    const sailings = await loadSailings(async () => new Response(JSON.stringify(payload)));
    const caveats = Array.isArray(payload.caveats) ? payload.caveats.filter((item): item is string => typeof item === "string") : [];
    return {
      kind: "published-schedule",
      status: sailings.length ? "available" : "no-current-records",
      source: boatsSource,
      sourceUpdatedAt: null,
      retrievedAt: typeof payload.retrievedAt === "string" ? payload.retrievedAt : retrievedAt,
      caveats,
      data: sailings,
    };
  } catch {
    return unavailable("published-schedule", boatsSource, retrievedAt);
  }
}

/** Published CVSky envelope. Status is the timetable, never a live position. */
export async function loadFlightSchedule(fetchImpl: typeof fetch, now = new Date()) {
  return loadFlight(fetchImpl, now.toISOString());
}

/** Every published sailing in the Maio API snapshot. A stale snapshot still counts; it is not a guessed timetable. */
export async function loadSailings(fetchImpl: typeof fetch): Promise<Sailing[]> {
  try {
    const body = asRecord(await (await fetchImpl(`${MAIO_API}/boats`)).json());
    const rows = Array.isArray(body.schedules) ? body.schedules : [];
    return rows.flatMap((row) => {
      const item = asRecord(row);
      if (typeof item.date !== "string" || typeof item.departure !== "string" || typeof item.from !== "string" || typeof item.to !== "string") return [];
      const arrival = typeof item.arrival === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(item.arrival) ? item.arrival : undefined;
      return [{ from: item.from, to: item.to, departure: item.departure, date: item.date, ...(arrival ? { arrival } : {}) }];
    });
  } catch {
    return [];
  }
}
