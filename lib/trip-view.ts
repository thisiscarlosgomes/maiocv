import { PLACES, distanceKm, experience, food, place, type PlanDay, type PlanItem, type SeaDay } from "./trip.ts";
import type { Locale } from "./locale.ts";
import type { PlanStrings } from "./trip-strings.ts";

const intl: Record<Locale, string> = { pt: "pt-PT", en: "en-GB", fr: "fr-FR" };

export function dayLabel(date: string, locale: Locale): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(intl[locale], { weekday: "short", day: "numeric", timeZone: "UTC" }).replace(".", "");
}

export function dayTitle(date: string, locale: Locale): string {
  const t = new Date(`${date}T12:00:00Z`).toLocaleDateString(intl[locale], { weekday: "long", day: "numeric", timeZone: "UTC" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function dateRange(days: PlanDay[], locale: Locale): string {
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString(intl[locale], { ...o, timeZone: "UTC" });
  const first = days[0].date, last = days[days.length - 1].date;
  return first === last ? fmt(first, { weekday: "short", day: "numeric", month: "short" })
    : `${fmt(first, { weekday: "short", day: "numeric" })} – ${fmt(last, { weekday: "short", day: "numeric", month: "short" })}`;
}

export function duration(min: number, s: PlanStrings): string {
  if (min < 60) return `${min} ${s.min}`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} ${s.h} ${m}` : `${h} ${s.h}`;
}

export type Operator = { name: string; bookingUrl: string; whatsapp: string; phone: string };
export type CardView = {
  kind: PlanItem["kind"]; title: string; meta: string; description: string; location: string; image: string | null;
  lat: number | null; lon: number | null; link: string | null; seaDependent: boolean; operator: Operator | null;
};

function typeLabel(e: { kind: string; boat: boolean }, s: PlanStrings) {
  return e.boat ? s.boat : e.kind === "sea" ? s.seaKind : s.experience;
}

export const osm = (lat: number, lon: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=14/${lat}/${lon}`;

/** Everything a card or detail sheet shows, derived only from fixture data. No prices. Returns null for unknown ids. */
export function cardView(item: PlanItem, locale: Locale, s: PlanStrings): CardView | null {
  if (item.kind === "experience") {
    const e = experience(item.refId); if (!e) return null;
    const p = place(e.placeId)!;
    return { kind: item.kind, title: e.title, meta: `${typeLabel(e, s)} · ${duration(item.durationMin, s)} · ${e.location}`, description: locale === "pt" ? e.description.pt : e.description.en,
      location: e.location, image: e.image, lat: p.lat, lon: p.lon, link: osm(p.lat, p.lon), seaDependent: e.seaDependent, operator: e.operator ?? null };
  }
  if (item.kind === "food") {
    const f = food(item.refId); if (!f) return null;
    const p = place(f.placeId)!;
    return { kind: item.kind, title: f.title, meta: `${item.start >= "19:00" ? s.evening : s.lunch} · ${f.location}`, description: locale === "pt" ? f.description.pt : f.description.en, location: f.location,
      image: f.image, lat: p.lat, lon: p.lon, link: osm(p.lat, p.lon), seaDependent: false, operator: null };
  }
  if (item.kind === "place") {
    const p = place(item.refId); if (!p) return null;
    return { kind: item.kind, title: locale === "pt" ? p.name.pt : p.name.en, meta: `${p.category === "beach" ? s.beach : s.place} · ${p.location}`, description: "", location: p.location,
      image: p.image, lat: p.lat, lon: p.lon, link: osm(p.lat, p.lon), seaDependent: false, operator: null };
  }
  return { kind: "transport", title: item.refId === "ferry" ? s.ferry : s.flight, meta: item.note ?? "", description: "", location: "", image: null, lat: null, lon: null, link: null, seaDependent: false, operator: null };
}

/**
 * Operator contact rule (spec v2): only when the operator has no booking site or app AND we hold
 * a WhatsApp or phone from Visit Maio data. Otherwise nothing, and never a booking link instead.
 */
export function contactLinks(op: Operator | null): { whatsapp: string | null; call: string | null } | null {
  if (!op || op.bookingUrl) return null;
  const wa = op.whatsapp.replace(/\D/g, ""), tel = op.phone.replace(/[^\d+]/g, "");
  if (!wa && !tel) return null;
  return { whatsapp: wa ? `https://wa.me/${wa}` : null, call: tel ? `tel:${tel}` : null };
}

function itemPoint(i: PlanItem) {
  const ref = i.kind === "experience" ? place(experience(i.refId)?.placeId ?? "") : i.kind === "food" ? place(food(i.refId)?.placeId ?? "") : i.kind === "place" ? place(i.refId) : undefined;
  return ref ? { lat: ref.lat, lon: ref.lon } : null;
}

/** "3 stops · 25 min driving" (walking when everything is close and there's no car). Straight-line estimate. */
export function daySummary(day: PlanDay, s: PlanStrings, hasCar: boolean): string {
  const stops = day.items.filter((i) => i.kind !== "transport");
  const pts = stops.map(itemPoint).filter((p): p is { lat: number; lon: number } => !!p);
  let km = 0;
  for (let i = 1; i < pts.length; i += 1) km += distanceKm(pts[i - 1], pts[i]);
  const walk = !hasCar && km < 3;
  const min = Math.max(5, Math.round(((km * 1.3) / (walk ? 4.5 : 40)) * 12) * 5);
  const parts = [`${stops.length} ${stops.length === 1 ? s.stop : s.stops}`];
  if (pts.length > 1) parts.push(`${min} ${s.min} ${walk ? s.walking : s.driving}`);
  return parts.join(" · ");
}

export function seaLine(sea: SeaDay | null, s: PlanStrings): string {
  if (!sea) return s.sea.unknown;
  const parts = [s.sea[sea.status]];
  if (sea.waveHeightM !== null) parts.push(`${sea.waveHeightM.toFixed(1)} ${s.waves}`);
  if (sea.windKmh !== null) parts.push(`${Math.round(sea.windKmh)} ${s.wind}`);
  return parts.join(" · ");
}

// Island silhouette: convex hull of every mapped Visit Maio place.
function hull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const pt of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop(); lower.push(pt); }
  for (const pt of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop(); upper.push(pt); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
const pad = 0.015;
const lons = PLACES.map((p) => p.lon), lats = PLACES.map((p) => p.lat);
const box = { minLon: Math.min(...lons) - pad, maxLon: Math.max(...lons) + pad, minLat: Math.min(...lats) - pad, maxLat: Math.max(...lats) + pad };
export const MAP_W = 300;
export const MAP_H = Math.round(MAP_W * (box.maxLat - box.minLat) / ((box.maxLon - box.minLon) * Math.cos(15.2 * Math.PI / 180)));
export function project(lon: number, lat: number): [number, number] {
  return [Math.round(((lon - box.minLon) / (box.maxLon - box.minLon)) * MAP_W), Math.round(((box.maxLat - lat) / (box.maxLat - box.minLat)) * MAP_H)];
}
export const ISLAND_PATH = "M" + hull(PLACES.map((p) => [p.lon, p.lat])).map(([lon, lat]) => project(lon, lat).join(",")).join("L") + "Z";

export function dayPins(day: PlanDay, locale: Locale, s: PlanStrings) {
  return day.items.flatMap((item, i) => {
    const v = cardView(item, locale, s);
    if (!v || v.lat === null || v.lon === null) return [];
    const [x, y] = project(v.lon, v.lat);
    return [{ n: i + 1, x, y, title: v.title }];
  });
}

/** v3.3 mono day label: "Wed 28" plus the long weekday, split so the date can be mono. */
export function dayParts(date: string, locale: Locale): { short: string; weekday: string } {
  const d = new Date(`${date}T12:00:00Z`);
  const wk = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString(intl[locale], { ...o, timeZone: "UTC" });
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  return { short: `${cap(wk({ weekday: "short" }).replace(".", ""))} ${d.getUTCDate()}`, weekday: cap(wk({ weekday: "long" })) };
}

/** "10:00 – 12:30" for timed visits, just "13:00" for meals and arrivals. */
export function timeSpan(item: PlanItem): string {
  if (item.kind === "food" || item.kind === "transport" || !item.durationMin) return item.start;
  const m = Number(item.start.slice(0, 2)) * 60 + Number(item.start.slice(3)) + item.durationMin;
  return `${item.start} – ${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
