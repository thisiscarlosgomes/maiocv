// Normalize Visit Maio's public data into lib/trip-data.json for the /plan test.
// Usage: node scripts/build-trip-fixture.mjs /path/to/visitmaio
// Real fields come from visitmaio/public/data. Everything under `example` is invented
// for the test (durations, slots, age limits, pickup) and must be replaced
// with operator-confirmed values before launch.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
if (!root) throw new Error("Pass the visitmaio checkout path");
const read = (file) => JSON.parse(readFileSync(join(root, "public/data", file), "utf8"));
const groups = read("experience_places_by_slug.json");
const places = read("maio_places_with_coords.json");

const keepCategories = new Set(["beach", "settlement", "protected_area", "mountain", "historical_heritage", "religious_heritage", "wetland", "dunes", "education_center", "economic_activity", "islet", "forest_area"]);
const placeOut = places
  .filter((p) => keepCategories.has(p.category) && Array.isArray(p.coordinates))
  .map((p) => ({
    id: p.id,
    name: { pt: p.name.pt, en: p.name.en ?? p.name.pt },
    category: p.category,
    location: p.location?.en ?? p.location?.pt ?? "",
    lon: p.coordinates[0],
    lat: p.coordinates[1],
    image: typeof p.image_url === "string" ? p.image_url : null,
    source: p.source ?? "Visit Maio",
  }));
const placeIds = new Set(placeOut.map((p) => p.id));

// Where each experience happens, matched by its published location.
const anchor = {
  "Praia do Morro": "praia-do-morro",
  "Praia de Bitche Rotcha": "praia-bitche-rotcha",
  "Cidade do Porto Inglês": "cidade-porto-ingles",
  Calheta: "baxona-ribinha",
  Maio: "cidade-porto-ingles",
  "": "cidade-porto-ingles",
};
// Invented test values, keyed by experience id. Marked example: true in the output.
const example = {
  "blue-ondaazul-maio": { kind: "sea", seaDependent: true, durationMin: 120, slots: ["09:00", "15:00"], minAge: 8, pickup: true },
  "blue-maioazul-jetski": { kind: "sea", seaDependent: true, durationMin: 30, slots: ["10:00", "11:00", "16:00"], minAge: 16, pickup: false },
  "blue-beach-volley-camp": { kind: "land", seaDependent: false, durationMin: 90, slots: ["17:00"], minAge: 6, pickup: false },
  "blue-rental-quad-big-game": { kind: "land", seaDependent: false, durationMin: 180, slots: ["09:00", "14:00"], minAge: 18, pickup: true },
  "blue-sport-fishing-big-game": { kind: "sea", seaDependent: true, boat: true, durationMin: 240, slots: ["08:00"], minAge: 10, pickup: true },
  "blue-maio-offroad": { kind: "land", seaDependent: false, durationMin: 240, slots: ["09:00"], minAge: 6, pickup: true },
  "trek-001": { kind: "land", seaDependent: false, durationMin: 240, slots: ["07:30"], minAge: 10, pickup: true },
  "guia-001": { kind: "land", seaDependent: false, durationMin: 180, slots: ["09:00", "14:30"], minAge: 0, pickup: true },
  "guia-002": { kind: "land", seaDependent: false, durationMin: 120, slots: ["10:00", "16:00"], minAge: 0, pickup: false },
};

const experiences = [];
const food = [];
for (const group of groups) {
  if (group.slug === "stay") continue;
  for (const item of group.places) {
    const placeId = anchor[item.location ?? ""] ?? "cidade-porto-ingles";
    if (!placeIds.has(placeId)) throw new Error(`Unknown anchor ${placeId}`);
    const base = {
      id: item.id,
      title: item.title.replace(/\s*\|\s*/g, " · "),
      description: { pt: item.description?.pt ?? "", en: item.description?.en ?? item.description?.pt ?? "" },
      location: item.location || "Maio",
      placeId,
      image: item.image || null,
      sourceUrl: item.source_url ?? item.instagram_url ?? item.facebook_url ?? item.map_url ?? null,
      group: group.slug,
    };
    // Operator contact, only from Visit Maio data. Blank means the UI shows nothing.
    // bookingUrl: the operator's own (non-social) website; Instagram/Facebook are not booking sites.
    const site = item.source_url && !/instagram|facebook|tripadvisor/i.test(item.source_url) ? item.source_url : "";
    const digits = String(item.phone ?? "").replace(/\D/g, "");
    const operator = { name: base.title, bookingUrl: site, whatsapp: "", phone: digits.length === 7 ? `+238${digits}` : "" };
    if (group.slug === "food") food.push(base);
    else {
      const ex = example[item.id];
      if (!ex) throw new Error(`No example values for ${item.id}`);
      const { kind, seaDependent, boat = false, ...rest } = ex;
      experiences.push({ ...base, kind, seaDependent, boat, operator, example: { ...rest, isExample: true } });
    }
  }
}

writeFileSync(
  new URL("../lib/trip-data.json", import.meta.url),
  JSON.stringify({ source: "github.com/thisiscarlosgomes/visitmaio public/data", experiences, food, places: placeOut }, null, 1) + "\n",
);
console.log(`experiences ${experiences.length}, food ${food.length}, places ${placeOut.length}`);
