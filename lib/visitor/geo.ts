/** Distances on Maio, computed in code. Straight-line km (haversine) and rough travel minutes. */

export type LatLon = { lat: number; lon: number };

export function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** Walking: 4.5 km/h on a path ~1.2× the straight line. */
export function walkMinutes(km: number): number {
  return Math.max(1, Math.round((km * 1.2 / 4.5) * 60));
}

/** Driving: road ~1.3× the straight line at ~45 km/h, plus 2 minutes to park. Rough, not routed. */
export function driveMinutes(km: number): number {
  return Math.max(2, Math.round((km * 1.3 / 45) * 60) + 2);
}

export type Zone = { id: string; name: string; lat: number; lon: number; aliases: string[] };

/**
 * Village anchors from api.maio.cv settlements (OSM points). Order matters only for ties.
 * `aliases` are lowercase, accent-free words a guest may type.
 */
export const ZONES: Zone[] = [
  { id: "vila", name: "Vila do Maio", lat: 15.1375142, lon: -23.2112673, aliases: ["vila do maio", "vila", "porto ingles", "cidade do porto ingles", "cidade", "town", "maio town", "fontona", "calhetinha", "the port", "harbour", "harbor", "pier", "cais"] },
  { id: "airport", name: "the airport (near Vila)", lat: 15.1560111, lon: -23.2137036, aliases: ["airport", "aeroporto", "aeroport", "aerodromo"] },
  { id: "morro", name: "Morro", lat: 15.1796575, lon: -23.2217424, aliases: ["morro"] },
  { id: "calheta", name: "Calheta", lat: 15.2292429, lon: -23.2112107, aliases: ["calheta", "calheta de cima", "calheta de baixo", "baxona", "ribinha", "ribona", "lem tavares"] },
  { id: "morrinho", name: "Morrinho", lat: 15.2655865, lon: -23.2043873, aliases: ["morrinho"] },
  { id: "cascabulho", name: "Cascabulho", lat: 15.269957, lon: -23.1725926, aliases: ["cascabulho"] },
  { id: "santo-antonio", name: "Santo António", lat: 15.2751226, lon: -23.1230088, aliases: ["santo antonio"] },
  { id: "praia-goncalo", name: "Praia Gonçalo", lat: 15.2673462, lon: -23.1141108, aliases: ["praia goncalo", "praiona"] },
  { id: "pedro-vaz", name: "Pedro Vaz", lat: 15.2473839, lon: -23.1158373, aliases: ["pedro vaz"] },
  { id: "penoso", name: "Penoso", lat: 15.2388969, lon: -23.1137659, aliases: ["penoso", "povoacao penosa"] },
  { id: "alcatraz", name: "Alcatraz", lat: 15.2174703, lon: -23.1032877, aliases: ["alcatraz"] },
  { id: "pilao-cao", name: "Pilão Cão", lat: 15.2091337, lon: -23.1051179, aliases: ["pilao cao"] },
  { id: "ribeira-d-joao", name: "Ribeira D. João", lat: 15.1441919, lon: -23.12134, aliases: ["ribeira d joao", "ribeira dom joao", "ribeira de dom joao", "ribeira d. joao"] },
  { id: "figueira", name: "Figueira", lat: 15.1597077, lon: -23.1515582, aliases: ["figueira", "figueira horta", "figueira da horta", "figueira seca"] },
  { id: "barreiro", name: "Barreiro", lat: 15.1350598, lon: -23.1607208, aliases: ["barreiro", "lem varela", "banda riba"] },
  { id: "lagoa", name: "Lagoa", lat: 15.1293489, lon: -23.1520342, aliases: ["lagoa"] },
];

/** A point this close to a village anchor belongs to it. Farther points are "near <village>". */
const IN_VILLAGE_KM = 2.5;

export function nearestZone(point: LatLon): { zone: Zone; km: number; inside: boolean } {
  let best = ZONES[0];
  let bestKm = Infinity;
  for (const zone of ZONES) {
    if (zone.id === "airport") continue;
    const km = haversineKm(point, zone);
    if (km < bestKm) { best = zone; bestKm = km; }
  }
  return { zone: best, km: bestKm, inside: bestKm <= IN_VILLAGE_KM };
}

export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** The village a free-text location names, longest alias first ("calheta de baixo" before "calheta"). */
export function zoneFromText(text: string): Zone | null {
  const folded = ` ${fold(text)} `;
  let hit: { zone: Zone; len: number } | null = null;
  for (const zone of ZONES) {
    for (const alias of zone.aliases) {
      if (folded.includes(` ${alias} `) && (!hit || alias.length > hit.len)) hit = { zone, len: alias.length };
    }
  }
  return hit?.zone ?? null;
}

/** Search radius in km. No car: walking distance; car: most of the island, still nearest first. */
export function radiusKm(car: boolean | null | undefined): number {
  if (car === true) return 30;
  if (car === false) return 3;
  return 6;
}
