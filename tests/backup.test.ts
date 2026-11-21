// The timeout backup keeps to the guest's village (breakfast in Vila never lists Calheta).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { villageBackup } from "../lib/visitor/backup.ts";
import { loadPlaces } from "../lib/visitor/places.ts";
import { zoneFromText } from "../lib/visitor/geo.ts";

test("the backup answer names only places in the asked or saved village", async () => {
  const places = await loadPlaces(fetch);
  if (!places.length) return;
  const vila = villageBackup("Where can I get breakfast in town?", { locale: "en", car: null }, places);
  assert.ok(vila, "vila answer");
  assert.match(vila!.reply, /^In Vila do Maio: /);
  for (const card of vila!.cards) assert.equal(zoneFromText(card.area ?? "")?.id, zoneFromText("Vila do Maio")?.id, card.name);
  const calheta = villageBackup("Onde podemos jantar?", { locale: "pt", car: false, stay: { name: "Casa do Mar", area: "Calheta", lat: 15.2271, lon: -23.2167 } }, places);
  assert.ok(calheta);
  assert.match(calheta!.reply, /^Em Calheta: /);
  assert.equal(calheta!.anchor.name, "Casa do Mar");
  assert.ok(calheta!.cards.every((card) => card.area === "Calheta"));
  assert.equal(villageBackup("Is Maio safe?", { locale: "en", car: null }, places), null);
  assert.equal(villageBackup("Where can we eat?", { locale: "en", car: null }, places), null);
});
