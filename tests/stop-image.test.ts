import { existsSync, readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { coverImage, stopImage, type StopRef } from "../lib/stop-image.ts";
import { EXPERIENCES, FOOD, PLACES } from "../lib/trip.ts";

const absent = () => false;
const present = () => true;
const onDisk = (path: string) => existsSync(new URL(`../public${path}`, import.meta.url));

function alts(stop: StopRef) {
  const image = stopImage(stop, { fileExists: absent });
  for (const locale of ["en", "pt", "fr"] as const) assert.ok(image.alt[locale].trim().length > 2, locale);
  assert.notEqual(image.alt.en, image.alt.pt);
  assert.notEqual(image.alt.en, image.alt.fr);
  return image;
}

test("placeholder icons are square illustrations on the soft brand background", () => {
  for (const name of ["plane", "boat", "rest", "beach", "food", "sight", "activity"]) {
    const svg = readFileSync(new URL(`../public/placeholders/${name}.svg`, import.meta.url), "utf8");
    assert.match(svg, /viewBox="0 0 128 128"/, name);
    assert.match(svg, /#eaf2ff/, name);
    assert.match(svg, /#1763b6/, name);
  }
});

test("flight arrival, transfer, and airport departure use the plane", () => {
  for (const stop of [
    { kind: "transport", refId: "flight", slot: "arrival" },
    { kind: "free", refId: "transfer", slot: "transfer" },
    { kind: "free", refId: "depart-airport", slot: "departure" },
  ]) {
    const image = alts(stop);
    assert.equal(image.src, "/placeholders/plane.svg", stop.refId);
    assert.equal(image.fallback, "/placeholders/plane.svg");
    assert.equal(image.placeholder, true);
  }
});

test("ferry arrival and port departure use the boat", () => {
  for (const stop of [
    { kind: "transport", refId: "ferry", slot: "arrival" },
    { kind: "free", refId: "depart-port", slot: "departure" },
  ]) {
    const image = alts(stop);
    assert.equal(image.src, "/placeholders/boat.svg", stop.refId);
    assert.equal(image.fallback, "/placeholders/boat.svg");
  }
});

test("free time and rest use the lounger unless a stay photo is on disk", () => {
  for (const refId of ["rest", "free-time"]) {
    const missing = stopImage({ kind: "free", refId, slot: "rest" }, { fileExists: absent });
    assert.equal(missing.src, "/placeholders/rest.svg");
    assert.equal(missing.fallback, "/placeholders/rest.svg");
    const photo = stopImage({ kind: "free", refId, slot: "rest" }, { fileExists: present });
    assert.equal(photo.src, "/placeholders/stay.jpg");
    assert.equal(photo.fallback, "/placeholders/rest.svg");
    assert.equal(photo.placeholder, true);
    alts({ kind: "free", refId, slot: "rest" });
  }
});

test("breakfast, lunch, and dinner at the stay use a photo when the file exists, else the food icon", () => {
  const cases = [
    ["breakfast-stay", "breakfast-stay.jpg"],
    ["lunch-free", "lunch.jpg"],
    ["dinner-free", "dinner.jpg"],
  ] as const;
  for (const [refId, file] of cases) {
    const stop = { kind: "free", refId, slot: refId === "breakfast-stay" ? "breakfast" : refId === "lunch-free" ? "lunch" : "dinner" };
    const missing = stopImage(stop, { fileExists: absent });
    assert.equal(missing.src, "/placeholders/food.svg", refId);
    assert.equal(missing.fallback, "/placeholders/food.svg");
    const photo = stopImage(stop, { fileExists: present });
    assert.equal(photo.src, `/placeholders/${file}`);
    assert.equal(photo.fallback, "/placeholders/food.svg");
    assert.equal(photo.placeholder, true);
    const disk = stopImage(stop, { fileExists: onDisk });
    assert.equal(disk.src, onDisk(`/placeholders/${file}`) ? `/placeholders/${file}` : "/placeholders/food.svg");
    alts(stop);
  }
});

test("listing photos pass through, and a record with no photo uses its category", () => {
  const beach = PLACES.find((row) => row.category === "beach" && row.image);
  const sight = PLACES.find((row) => row.category !== "beach" && row.image);
  const meal = FOOD.find((row) => row.image);
  const activity = EXPERIENCES.find((row) => row.image);
  assert.ok(beach && sight && meal && activity);

  const beachPhoto = stopImage({ kind: "place", refId: beach.id });
  assert.equal(beachPhoto.placeholder, false);
  assert.equal(beachPhoto.src, beach.image);
  assert.equal(beachPhoto.fallback, "/placeholders/beach.svg");
  assert.equal(beachPhoto.alt.en, beach.name.en);
  assert.equal(beachPhoto.alt.pt, beach.name.pt);
  assert.equal(beachPhoto.alt.fr, beach.name.pt);

  assert.equal(stopImage({ kind: "place", refId: beach.id, image: null }).src, "/placeholders/beach.svg");
  alts({ kind: "place", refId: beach.id, image: null });
  assert.equal(stopImage({ kind: "place", refId: beach.id, image: "" }).src, "/placeholders/beach.svg");
  assert.equal(stopImage({ kind: "place", refId: sight.id, image: null }).src, "/placeholders/sight.svg");
  assert.equal(stopImage({ kind: "place", category: "historical_heritage", image: null, title: "Capela" }).src, "/placeholders/sight.svg");
  assert.equal(stopImage({ kind: "place", category: "hotel", image: null, title: "Villa" }).src, "/placeholders/rest.svg");

  const mealPhoto = stopImage({ kind: "food", refId: meal.id });
  assert.equal(mealPhoto.src, meal.image);
  assert.equal(mealPhoto.fallback, "/placeholders/food.svg");
  assert.equal(stopImage({ kind: "food", refId: meal.id, image: "javascript:alert(1)" }).src, "/placeholders/food.svg");
  assert.equal(stopImage({ kind: "food", category: "bar", image: null, title: "Bar" }).src, "/placeholders/food.svg");

  const activityPhoto = stopImage({ kind: "experience", refId: activity.id });
  assert.equal(activityPhoto.src, activity.image);
  assert.equal(activityPhoto.fallback, "/placeholders/activity.svg");
  assert.equal(activityPhoto.alt.en, activity.title);
  assert.equal(stopImage({ kind: "experience", refId: activity.id, image: null }).src, "/placeholders/activity.svg");
  assert.equal(stopImage({ kind: "experience", category: "guided_tour", image: null }).src, "/placeholders/activity.svg");
  assert.equal(stopImage({ kind: "place", slot: "sunset", image: null }).src, "/placeholders/beach.svg");
  const offroad = EXPERIENCES.find((row) => row.image?.startsWith("/"));
  if (offroad) assert.equal(stopImage({ kind: "experience", refId: offroad.id }).src, `https://www.visitmaio.com${offroad.image}`);
});

test("the trip cover keeps a real photo when the day opens on a generic stop", () => {
  const beach = PLACES.find((row) => row.category === "beach" && row.image)!;
  const image = coverImage([
    { kind: "free", refId: "transfer", slot: "transfer" },
    { kind: "free", refId: "breakfast-stay", slot: "breakfast" },
    { kind: "place", refId: beach.id },
  ], { fileExists: absent });
  assert.equal(image.placeholder, false);
  assert.equal(image.src, beach.image);
  const onlyGeneric = coverImage([
    { kind: "free", refId: "transfer", slot: "transfer" },
    { kind: "free", refId: "free-time", slot: "rest" },
  ], { fileExists: absent });
  assert.equal(onlyGeneric.src, "/placeholders/plane.svg");
});
