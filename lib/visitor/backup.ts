/**
 * The answer when the guide times out or fails: still from the Maio places, still in the guest's village.
 * Only for "where to eat / drink / swim / stay" questions with a known village (asked or saved).
 */
import { fold, zoneFromText, ZONES } from "./geo.ts";
import { nearby, type Anchor, type Place, type PlaceKind } from "./places.ts";
import type { PlaceCard, VisitorContext, VisitorLocale } from "./agent.ts";

const NEEDS: [RegExp, PlaceKind[]][] = [
  [/\b(?:eat|food|restaurants?|lunch|dinner|breakfast|brunch|cafe|coffee|pizza|fish|seafood|comer|almoco|jantar|pequeno almoco|restaurantes?|manger|dejeuner|diner|petit dejeuner)\b/, ["food"]],
  [/\b(?:drinks?|bars?|beer|cocktails?|nightlife|beber|bebida|cerveja|boire|biere)\b/, ["bar"]],
  [/\b(?:beach|beaches|swim|swimming|praias?|nadar|plages?|baigner)\b/, ["beach"]],
];

const TOWN = /\b(?:in town|na vila|en ville|the town)\b/;

function anchorFor(text: string, context: VisitorContext): Anchor | null {
  const n = fold(text);
  const asked = zoneFromText(text) ?? (TOWN.test(n) ? ZONES.find((zone) => zone.id === "vila") ?? null : null);
  if (asked) {
    // Their own village with a saved stay: distances from the stay.
    const stayZone = context.stay ? zoneFromText(context.stay.area ?? context.stay.name) : null;
    if (context.stay?.lat !== undefined && context.stay?.lon !== undefined && stayZone?.id === asked.id) {
      return { name: context.stay.name, lat: context.stay.lat, lon: context.stay.lon, zone: asked.name, zoneId: asked.id, source: "context" };
    }
    return { name: asked.name, lat: asked.lat, lon: asked.lon, zone: asked.name, zoneId: asked.id, source: "village" };
  }
  if (context.stay?.lat !== undefined && context.stay?.lon !== undefined) {
    const zone = zoneFromText(context.stay.area ?? context.stay.name);
    if (zone) return { name: context.stay.name, lat: context.stay.lat, lon: context.stay.lon, zone: zone.name, zoneId: zone.id, source: "context" };
  }
  if (context.base) return { name: context.base.name, lat: context.base.lat, lon: context.base.lon, zone: context.base.name, zoneId: context.base.zoneId, source: "context" };
  return null;
}

const WALK = { en: "min walk", pt: "min a pé", fr: "min à pied" } as const;
const DRIVE = { en: "min drive", pt: "min de carro", fr: "min en voiture" } as const;

export function villageBackup(text: string, context: VisitorContext, places: Place[]): { reply: string; cards: PlaceCard[]; anchor: Anchor } | null {
  const n = fold(text);
  const kinds = NEEDS.find(([pattern]) => pattern.test(n))?.[1];
  if (!kinds || !places.length) return null;
  const anchor = anchorFor(text, context);
  if (!anchor?.zoneId) return null;
  const byId = new Map(places.map((place) => [place.id, place]));
  const locale: VisitorLocale = context.locale;
  const rows = nearby(places, { kinds, anchor, car: context.car, limit: 8, locale: locale === "pt" ? "pt" : "en" }).results
    .filter((row) => byId.get(row.id)?.zoneId === anchor.zoneId)
    .slice(0, 3);
  if (!rows.length) return null;
  const label = (row: (typeof rows)[number]) => {
    if (row.km === null || row.approxLocation) return row.name;
    return row.walkMin !== null && row.walkMin <= 25 ? `${row.name} (${row.walkMin} ${WALK[locale]})` : row.driveMin !== null ? `${row.name} (${row.driveMin} ${DRIVE[locale]})` : row.name;
  };
  const parts = rows.map(label);
  const and = locale === "pt" ? " e " : locale === "fr" ? " et " : " and ";
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")}${and}${parts[parts.length - 1]}` : parts[0];
  const reply = locale === "pt" ? `Em ${anchor.zone}: ${list}.` : locale === "fr" ? `À ${anchor.zone} : ${list}.` : `In ${anchor.zone}: ${list}.`;
  const cards: PlaceCard[] = rows.map((row) => {
    const place = byId.get(row.id);
    return { id: row.id, name: row.name, kind: row.kind, area: row.area, km: row.km, walkMin: row.walkMin, driveMin: row.driveMin, image: place?.image ?? null, approxLocation: row.approxLocation, lat: place?.lat ?? null, lon: place?.lon ?? null };
  });
  return { reply, cards, anchor };
}
