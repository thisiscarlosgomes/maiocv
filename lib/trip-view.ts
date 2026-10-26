import { PLACES, experience, food, place, type PlanDay, type PlanItem, type SeaDay } from "./trip.ts";
import type { Locale } from "./locale.ts";
import type { PlanStrings } from "./trip-strings.ts";

export const EUR_TO_CVE = 110.265;
const intl: Record<Locale, string> = { pt: "pt-PT", en: "en-GB", fr: "fr-FR" };

export function dayLabel(date: string, locale: Locale): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(intl[locale], { weekday: "short", day: "numeric", timeZone: "UTC" }).replace(".", "");
}

export function duration(min: number, s: PlanStrings): string {
  if (min < 60) return `${min} ${s.min}`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} ${s.h} ${m}` : `${h} ${s.h}`;
}

export function cve(eur: number): string {
  return `${String(Math.round(eur * EUR_TO_CVE)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} CVE`;
}

export type CardView = {
  kind: PlanItem["kind"]; title: string; meta: string; image: string | null; slots: string[];
  price: string | null; lat: number | null; lon: number | null; link: string | null; seaDependent: boolean;
};

/** Everything a card shows, derived only from fixture data. Returns null for unknown ids. */
export function cardView(item: PlanItem, locale: Locale, s: PlanStrings): CardView | null {
  if (item.kind === "experience") {
    const e = experience(item.refId); if (!e) return null;
    const p = place(e.placeId)!;
    return { kind: item.kind, title: e.title, meta: `${duration(e.example.durationMin, s)} · ${e.location}`, image: e.image, slots: e.example.slots,
      price: `${s.from} €${e.example.priceEur} · ${cve(e.example.priceEur)} · ${s.payOnIsland}`, lat: p.lat, lon: p.lon, link: e.sourceUrl, seaDependent: e.seaDependent };
  }
  if (item.kind === "food") {
    const f = food(item.refId); if (!f) return null;
    const p = place(f.placeId)!;
    return { kind: item.kind, title: f.title, meta: `${s.lunch} · ${f.location}`, image: f.image, slots: [], price: null, lat: p.lat, lon: p.lon, link: f.sourceUrl, seaDependent: false };
  }
  if (item.kind === "place") {
    const p = place(item.refId); if (!p) return null;
    return { kind: item.kind, title: locale === "pt" ? p.name.pt : p.name.en, meta: `${p.category === "beach" ? s.beach : s.place} · ${p.location}`, image: p.image, slots: [], price: null,
      lat: p.lat, lon: p.lon, link: `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=14/${p.lat}/${p.lon}`, seaDependent: false };
  }
  return { kind: "transport", title: item.refId === "ferry" ? s.ferry : s.flight, meta: item.note ?? "", image: null, slots: [], price: null, lat: null, lon: null, link: null, seaDependent: false };
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
