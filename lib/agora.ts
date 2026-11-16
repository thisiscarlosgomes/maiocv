export type DataKind =
  | "model-estimate"
  | "calculated"
  | "published-schedule"
  | "official-statistic"
  | "community-map"
  | "editorial"
  | "measured";

export type DataStatus =
  | "available"
  | "partial"
  | "unavailable"
  | "no-current-records"
  | "planned";

export type Envelope<T> = {
  kind: DataKind;
  status: DataStatus;
  source: { id: string; name: string; url?: string; licence?: string };
  validAt?: string;
  observedAt?: string;
  sourceUpdatedAt?: string | null;
  retrievedAt: string;
  caveats: string[];
  data: T | null;
};

export type AgoraBody = {
  weather: Envelope<WeatherData>;
  sea: Envelope<SeaData>;
  wind: Envelope<WindData>;
  sky: Envelope<SkyData>;
};

type WeatherData = {
  temperature: number | null;
  humidity: number | null;
  precipitation: number | null;
  weather_code: number | null;
  temperature_min: number | null;
  temperature_max: number | null;
  daily: { date: string; temperature_min: number | null; temperature_max: number | null; weather_code: number | null }[];
};

type SeaData = { wave_height: number | null; temperature: number | null };
type WindData = { speed: number | null; direction: number | null; unit: string };
type SkyData = {
  solarEvents: unknown;
  moon: unknown;
  isAstronomicalDarkness: boolean | null;
  model: { id?: string; attribution?: string; url?: string } | null;
};

const lat = 15.25;
const lon = -23.15;

const openMeteo = { id: "open-meteo-weather", name: "Open-Meteo", url: "https://open-meteo.com/" };
const openMeteoMarine = { id: "open-meteo-marine", name: "Open-Meteo", url: "https://open-meteo.com/" };
const astronomy = { id: "astronomy-engine", name: "Astronomy Engine", url: "https://github.com/cosinekitty/astronomy" };

const seaCaveat = "Current-condition reading, not a beach-specific surf forecast.";

export function maioClock(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Atlantic/Cape_Verde",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${read("year")}-${read("month")}-${read("day")}`, time: `${read("hour")}:${read("minute")}` };
}

function unavailable<T>(kind: DataKind, source: Envelope<T>["source"], retrievedAt: string, caveats: string[] = []): Envelope<T> {
  return { kind, status: "unavailable", source, sourceUpdatedAt: null, retrievedAt, caveats, data: null };
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export async function loadAgora(fetchImpl: typeof fetch, now = new Date()): Promise<AgoraBody> {
  const retrievedAt = now.toISOString();
  const clock = maioClock(now);
  const [weather, sea, wind, sky] = await Promise.all([
    loadWeather(fetchImpl, retrievedAt),
    loadSea(fetchImpl, retrievedAt),
    loadWind(fetchImpl, retrievedAt),
    loadSky(fetchImpl, retrievedAt, clock),
  ]);
  return { weather, sea, wind, sky };
}

async function loadWeather(fetchImpl: typeof fetch, retrievedAt: string): Promise<Envelope<WeatherData>> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,weathercode&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=auto`;
    const data = asRecord(await readJson(await fetchImpl(url, { signal: AbortSignal.timeout(4000), next: { revalidate: 600 } })));
    const current = asRecord(data.current);
    const daily = asRecord(data.daily);
    const dates = Array.isArray(daily.time) ? daily.time as string[] : [];
    return {
      kind: "model-estimate",
      status: "available",
      source: openMeteo,
      sourceUpdatedAt: null,
      retrievedAt,
      caveats: [],
      data: {
        temperature: numberOrNull(current.temperature_2m),
        humidity: numberOrNull(current.relative_humidity_2m),
        precipitation: numberOrNull(current.precipitation),
        weather_code: numberOrNull(current.weathercode),
        temperature_min: numberOrNull(Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[0] : null),
        temperature_max: numberOrNull(Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[0] : null),
        daily: dates.map((date, index) => ({
          date,
          temperature_min: numberOrNull(Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[index] : null),
          temperature_max: numberOrNull(Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[index] : null),
          weather_code: numberOrNull(Array.isArray(daily.weathercode) ? daily.weathercode[index] : null),
        })),
      },
    };
  } catch {
    return unavailable("model-estimate", openMeteo, retrievedAt);
  }
}

async function loadSea(fetchImpl: typeof fetch, retrievedAt: string): Promise<Envelope<SeaData>> {
  try {
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=wave_height,sea_surface_temperature`;
    const data = asRecord(await readJson(await fetchImpl(url, { signal: AbortSignal.timeout(4000), next: { revalidate: 600 } })));
    const current = asRecord(data.current);
    return {
      kind: "model-estimate",
      status: "available",
      source: openMeteoMarine,
      sourceUpdatedAt: null,
      retrievedAt,
      caveats: [seaCaveat],
      data: {
        wave_height: numberOrNull(current.wave_height),
        temperature: numberOrNull(current.sea_surface_temperature),
      },
    };
  } catch {
    return unavailable("model-estimate", openMeteoMarine, retrievedAt, [seaCaveat]);
  }
}

async function loadWind(fetchImpl: typeof fetch, retrievedAt: string): Promise<Envelope<WindData>> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh`;
    const data = asRecord(await readJson(await fetchImpl(url, { signal: AbortSignal.timeout(4000), next: { revalidate: 600 } })));
    const current = asRecord(data.current);
    const units = asRecord(data.current_units);
    const unit = typeof units.wind_speed_10m === "string" ? units.wind_speed_10m : "";
    if (!unit) throw new Error("missing wind unit");
    return {
      kind: "model-estimate",
      status: "available",
      source: openMeteo,
      sourceUpdatedAt: null,
      retrievedAt,
      caveats: [],
      data: {
        speed: numberOrNull(current.wind_speed_10m),
        direction: numberOrNull(current.wind_direction_10m),
        unit,
      },
    };
  } catch {
    return unavailable("model-estimate", openMeteo, retrievedAt);
  }
}

async function loadSky(
  fetchImpl: typeof fetch,
  retrievedAt: string,
  clock: { date: string; time: string },
): Promise<Envelope<SkyData>> {
  const skyUrl = `https://api.maio.cv/api/v1/astronomy/sky?date=${clock.date}&time=${clock.time}`;
  const moonUrl = `https://api.maio.cv/api/v1/astronomy/moon?date=${clock.date}`;
  try {
    const skyResponse = await fetchImpl(skyUrl, { signal: AbortSignal.timeout(4000), next: { revalidate: 600 } });
    const sky = asRecord(await readJson(skyResponse));
    let moonPayload: Record<string, unknown> | null = null;
    let moonFailed = false;
    try {
      moonPayload = asRecord(await readJson(await fetchImpl(moonUrl, { signal: AbortSignal.timeout(4000), next: { revalidate: 600 } })));
    } catch {
      moonFailed = true;
    }
    const caveats = [...stringList(sky.caveats), ...stringList(moonPayload?.caveats)];
    const model = asRecord(sky.model);
    return {
      kind: "calculated",
      status: moonFailed ? "partial" : "available",
      source: {
        ...astronomy,
        url: typeof model.url === "string" ? model.url : astronomy.url,
      },
      validAt: typeof sky.at === "string" ? sky.at : undefined,
      sourceUpdatedAt: sky.sourceUpdatedAt === null || typeof sky.sourceUpdatedAt === "string" ? sky.sourceUpdatedAt : null,
      retrievedAt,
      caveats,
      data: {
        solarEvents: sky.solarEvents ?? null,
        moon: sky.moon ?? moonPayload?.moon ?? null,
        isAstronomicalDarkness: typeof sky.isAstronomicalDarkness === "boolean" ? sky.isAstronomicalDarkness : null,
        model: {
          id: typeof model.id === "string" ? model.id : undefined,
          attribution: typeof model.attribution === "string" ? model.attribution : undefined,
          url: typeof model.url === "string" ? model.url : undefined,
        },
      },
    };
  } catch {
    return unavailable("calculated", astronomy, retrievedAt);
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export type DailySea = { date: string; waveHeightM: number | null; windKmh: number | null; tempMaxC: number | null; sunset?: string | null };

const FORECAST_TTL_MS = 10 * 60 * 1000;
const forecastCache = new WeakMap<object, Map<string, { at: number; rows: DailySea[] }>>();
/** A logging wrapper shares the inner fetch's bucket, so a hit is still a hit. */
const forecastAlias = new WeakMap<object, object>();

export function shareForecastCache(wrapper: object, inner: object): void {
  forecastAlias.set(wrapper, forecastAlias.get(inner) ?? inner);
}

function forecastRoot(fetchImpl: object): object {
  return forecastAlias.get(fetchImpl) ?? fetchImpl;
}

function forecastBucket(fetchImpl: object): Map<string, { at: number; rows: DailySea[] }> {
  const root = forecastRoot(fetchImpl);
  const bucket = forecastCache.get(root) ?? new Map<string, { at: number; rows: DailySea[] }>();
  if (!forecastCache.has(root)) forecastCache.set(root, bucket);
  return bucket;
}

/** True when this start and length are already in the 10-minute forecast cache. A map lookup, not a fetch. */
export function dailyForecastCached(fetchImpl: typeof fetch, startDate: string, days: number, now = Date.now()): boolean {
  const hit = forecastBucket(fetchImpl).get(`${startDate}:${days}`);
  return Boolean(hit && now - hit.at < FORECAST_TTL_MS && hit.rows.length);
}

/** Daily marine and wind forecast for trip planning (Open-Meteo, up to 7 days). Cached 10 minutes per fetch. */
export async function loadDailyForecast(fetchImpl: typeof fetch, startDate: string, days: number): Promise<DailySea[]> {
  const key = `${startDate}:${days}`;
  const bucket = forecastBucket(fetchImpl);
  const hit = bucket.get(key);
  if (hit && Date.now() - hit.at < FORECAST_TTL_MS && hit.rows.length) return hit.rows;
  const rows = await fetchDailyForecast(fetchImpl, startDate, days);
  if (rows.length) bucket.set(key, { at: Date.now(), rows });
  return rows;
}

async function fetchDailyForecast(fetchImpl: typeof fetch, startDate: string, days: number): Promise<DailySea[]> {
  const end = new Date(`${startDate}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + Math.max(0, days - 1));
  const range = `start_date=${startDate}&end_date=${end.toISOString().slice(0, 10)}&timezone=Atlantic%2FCape_Verde`;
  const grab = async (url: string) => {
    try {
      return await readJson(await fetchImpl(url));
    } catch {
      return null;
    }
  };
  const [marine, weather] = await Promise.all([
    grab(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&daily=wave_height_max&${range}`),
    grab(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=wind_speed_10m_max,temperature_2m_max,sunset&wind_speed_unit=kmh&${range}`),
  ]);
  const m = asRecord(asRecord(marine).daily);
  const w = asRecord(asRecord(weather).daily);
  const dates = Array.isArray(m.time) ? m.time : Array.isArray(w.time) ? w.time : [];
  const at = (list: unknown, i: number) => (Array.isArray(list) && typeof list[i] === "number" ? list[i] as number : null);
  return dates.filter((d): d is string => typeof d === "string").map((date, i) => ({
    date,
    waveHeightM: at(m.wave_height_max, i),
    windKmh: at(w.wind_speed_10m_max, i),
    tempMaxC: at(w.temperature_2m_max, i),
    sunset: Array.isArray(w.sunset) && typeof w.sunset[i] === "string" ? (w.sunset[i] as string).slice(11, 16) || null : null,
  }));
}

export const forecastSourceName = openMeteo.name;

/** HH:MM in Atlantic/Cape_Verde for an ISO instant. Sunset from the astronomy API is UTC. */
export function capeVerdeHm(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Atlantic/Cape_Verde",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  if (!/^\d{2}$/.test(hour) || !/^\d{2}$/.test(minute)) return null;
  return `${hour}:${minute}`;
}

/** solarEvents.sunset for each date, converted to Cape Verde local time. */
export async function loadSunsets(fetchImpl: typeof fetch, dates: string[]): Promise<{ date: string; time: string }[]> {
  const unique = [...new Set(dates)].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).slice(0, 7);
  const rows = await Promise.all(unique.map(async (date) => {
    try {
      const response = await fetchImpl(`https://api.maio.cv/api/v1/astronomy/sky?date=${date}&time=12:00`, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) return null;
      const body = asRecord(await response.json());
      const sunset = asRecord(body.solarEvents).sunset;
      if (typeof sunset !== "string") return null;
      const time = capeVerdeHm(sunset);
      return time ? { date, time } : null;
    } catch {
      return null;
    }
  }));
  return rows.filter((row): row is { date: string; time: string } => !!row);
}
