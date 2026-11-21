// Services Maio rarely lists trigger a search in code; outside hits are cleaned before the guest sees them.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { cleanOutsideHits, outsideNeed } from "../lib/visitor/needs.ts";
import { listedForNeed, outsideReply } from "../lib/visitor/agent.ts";
import type { FallbackHit } from "../lib/visitor/fallback.ts";

const hit = (name: string, extra: Partial<FallbackHit> = {}): FallbackHit => ({ name, source: "google", sourceLabel: "Google Maps", url: "https://maps.google.com/?cid=1", address: null, lat: 15.138, lon: -23.209, area: "Vila do Maio", km: 0.2, walkMin: 3, driveMin: 2, snippet: null, ...extra });

test("gym, dentist (EN/PT/FR), pharmacy, laundry, yoga and car hire are outside needs", () => {
  assert.equal(outsideNeed("Is there a gym on the island?")?.id, "gym");
  assert.equal(outsideNeed("Is there a dentist on Maio?")?.id, "dentist");
  assert.equal(outsideNeed("Há algum dentista no Maio?")?.id, "dentist");
  assert.equal(outsideNeed("Y a-t-il un dentiste ?")?.id, "dentist");
  assert.equal(outsideNeed("Where can I find a pharmacy?")?.id, "pharmacy");
  assert.equal(outsideNeed("Where can I get laundry done?")?.id, "laundry");
  assert.equal(outsideNeed("Where can I do a yoga class?")?.id, "yoga");
  assert.equal(outsideNeed("where can we rent a car")?.id, "car");
  assert.equal(outsideNeed("Onde podemos alugar um carro?")?.id, "car");
  assert.equal(outsideNeed("Où peut-on louer une voiture ?")?.id, "car");
  assert.equal(outsideNeed("Where can we eat fish in Calheta?"), null);
  assert.equal(outsideNeed("Sim, obrigado"), null);
});

test("already-listed places, generic names and off-category hits are dropped", () => {
  const yoga = outsideNeed("yoga class")!;
  const listed = (name: string) => ["onda azul maio", "wave maze", "a caminhada"].includes(name.toLowerCase());
  const kept = cleanOutsideHits([hit("Onda Azul Maio", { types: ["gym"] }), hit("Wave Maze"), hit("Casa Djarmai Yoga", { types: ["yoga_studio"] })], yoga, listed);
  assert.deepEqual(kept.map((item) => item.name), ["Casa Djarmai Yoga"]);
  const laundry = outsideNeed("laundry")!;
  assert.deepEqual(cleanOutsideHits([hit("Maio Cabo Verde"), hit("A Caminhada"), hit("Lavandaria Sol", { types: ["laundry"] }), hit("Bar Tropical", { types: ["bar"] })], laundry, listed).map((item) => item.name), ["Lavandaria Sol"]);
  const car = outsideNeed("rent a car")!;
  assert.deepEqual(cleanOutsideHits([hit("Auto Evaristo", { types: ["car_rental"] }), hit("Maio Car, Lda"), hit("Big Game Rental Quad")], car, (name) => name === "Big Game Rental Quad").map((item) => item.name), ["Auto Evaristo", "Maio Car, Lda"]);
});

test("a quad rental is not car hire, so car hire is never 'listed' and the search runs", () => {
  const car = outsideNeed("where can we rent a car")!;
  assert.deepEqual(listedForNeed(car, [{ id: "1", name: "Big Game Rental Quad", phone: "", location: "", category: "sports" }], []), []);
  const gym = outsideNeed("gym")!;
  assert.deepEqual(listedForNeed(gym, [{ id: "1", name: "Big Game Rental Quad", phone: "", location: "", category: "sports" }], []), []);
});

test("the code-built reply names the hits with their source", () => {
  const car = outsideNeed("where can we rent a car")!;
  const reply = outsideReply(car, [hit("Auto Evaristo"), hit("Maio Car, Lda")], "en");
  assert.match(reply, /Auto Evaristo \(Google Maps, Vila do Maio\) and Maio Car, Lda \(Google Maps/);
  assert.match(outsideReply(car, [hit("Auto Evaristo")], "pt"), /^Não há aluguer de carro nas listas do Maio/);
});
