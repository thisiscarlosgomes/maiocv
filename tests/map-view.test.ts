import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mapView } from "../lib/map-view.ts";

const CALHETA = [
  { id: "anita", lat: 15.1905, lon: -23.2203 },
  { id: "vanuza", lat: 15.1921, lon: -23.2231 },
  { id: "baxona", lat: 15.1869, lon: -23.2244 },
];

test("every pin lands inside the box with padding", () => {
  const view = mapView(CALHETA, 384, 216)!;
  for (const pin of view.pins) {
    assert.ok(pin.left > 5 && pin.left < 95, `left ${pin.left}`);
    assert.ok(pin.top > 5 && pin.top < 95, `top ${pin.top}`);
  }
});

test("close places zoom in, island-wide places zoom out", () => {
  const near = mapView(CALHETA)!;
  const wide = mapView([...CALHETA, { id: "praia-real", lat: 15.3245, lon: -23.1663 }])!;
  assert.ok(near.zoom >= 15, String(near.zoom));
  assert.ok(wide.zoom < near.zoom, `${wide.zoom} < ${near.zoom}`);
});

test("tiles cover the whole box and are keyless OpenStreetMap tiles", () => {
  const view = mapView(CALHETA)!;
  assert.ok(view.tiles.length >= 2);
  assert.ok(view.tiles.every((tile) => tile.url.startsWith("https://tile.openstreetmap.org/") && !/key=|token=/.test(tile.url)));
  assert.ok(view.tiles.some((tile) => tile.left <= 0) && view.tiles.some((tile) => tile.left + tile.size >= 100));
});

test("one place does not zoom to street level, and no places gives no map", () => {
  assert.ok(mapView([CALHETA[0]])!.zoom <= 14);
  assert.equal(mapView([]), null);
});
