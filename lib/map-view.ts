/**
 * A keyless map view: which OpenStreetMap tiles to draw and where each point lands, as percentages of a
 * fixed-aspect box. Pure, so the panel renders on the server and the client the same way.
 */
export type MapPoint = { id: string; lat: number; lon: number };
export type MapTile = { key: string; url: string; left: number; top: number; size: number };
export type MapPin = { id: string; left: number; top: number };
export type MapView = { zoom: number; tiles: MapTile[]; pins: MapPin[] };

const TILE = 256;

function world(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const scale = TILE * 2 ** zoom;
  const phi = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * scale, y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * scale };
}

/** Fit every point in a width×height box (CSS px at 1×) with padding, zoom 10–16. */
export function mapView(points: MapPoint[], width = 384, height = 216, pad = 28): MapView | null {
  if (!points.length) return null;
  let zoom = 16;
  for (; zoom > 10; zoom--) {
    const xs = points.map((point) => world(point.lat, point.lon, zoom).x);
    const ys = points.map((point) => world(point.lat, point.lon, zoom).y);
    if (Math.max(...xs) - Math.min(...xs) <= width - 2 * pad && Math.max(...ys) - Math.min(...ys) <= height - 2 * pad) break;
  }
  if (points.length === 1) zoom = Math.min(zoom, 14);
  const projected = points.map((point) => ({ id: point.id, ...world(point.lat, point.lon, zoom) }));
  const cx = (Math.min(...projected.map((point) => point.x)) + Math.max(...projected.map((point) => point.x))) / 2;
  const cy = (Math.min(...projected.map((point) => point.y)) + Math.max(...projected.map((point) => point.y))) / 2;
  const left0 = cx - width / 2;
  const top0 = cy - height / 2;
  const tiles: MapTile[] = [];
  const max = 2 ** zoom;
  for (let tx = Math.floor(left0 / TILE); tx <= Math.floor((left0 + width) / TILE); tx++) {
    for (let ty = Math.floor(top0 / TILE); ty <= Math.floor((top0 + height) / TILE); ty++) {
      if (ty < 0 || ty >= max) continue;
      const wrapped = ((tx % max) + max) % max;
      tiles.push({
        key: `${zoom}/${wrapped}/${ty}`,
        url: `https://tile.openstreetmap.org/${zoom}/${wrapped}/${ty}.png`,
        left: ((tx * TILE - left0) / width) * 100,
        top: ((ty * TILE - top0) / height) * 100,
        size: (TILE / width) * 100,
      });
    }
  }
  const pins = projected.map((point) => ({ id: point.id, left: ((point.x - left0) / width) * 100, top: ((point.y - top0) / height) * 100 }));
  return { zoom, tiles, pins };
}
