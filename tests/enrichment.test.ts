import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { citeWebFacts, usesFact, webFacts, WEB_FIELDS } from "../lib/visitor/enrichment.ts";
import { directoryBlock } from "../lib/visitor/agent.ts";

const file = { entries: [
  { name: "Barbearia DAD", fields: { village: { value: "Calheta", sourceUrl: "https://cv.geoview.info/barbearia_dad,11560303773n" } } },
  { name: "Nha Terra", fields: { phone: { value: "+238 928 60 85", sourceUrl: "https://www.facebook.com/nhaterracafemaio/" }, hours: { value: "Tue 9 am - 11 pm", sourceUrl: "https://www.mapquest.com/cv/nha-terra-525990203" } } },
] };

test("web facts fill only empty Maio fields; the Maio API wins", () => {
  assert.deepEqual(webFacts("Nha Terra", { phone: "+238 999 00 00" }, file)?.phone, undefined);
  assert.equal(webFacts("Nha Terra", { phone: "" }, file)?.phone?.source, "facebook.com");
  assert.equal(webFacts("barbearia dad", {}, file)?.village?.value, "Calheta");
  assert.equal(webFacts("Barbearia DAD", { village: "Vila do Maio" }, file), null);
  assert.equal(webFacts("Unknown place", {}, file), null);
});

test("a used web fact is cited with its site; an unused one is not", () => {
  const facts = [{ name: "Nha Terra", facts: webFacts("Nha Terra", {}, file)! }];
  const used = citeWebFacts("Call Nha Terra on 928 60 85.", facts);
  assert.match(used.reply, /Source: facebook\.com\.$/);
  assert.equal(used.sources[0].url, "https://www.facebook.com/nhaterracafemaio/");
  const unused = citeWebFacts("Nha Terra is in Vila.", facts);
  assert.equal(unused.reply, "Nha Terra is in Vila.");
  assert.equal(unused.sources.length, 0);
  assert.equal(usesFact("Nha Terra opens at 9 am.", "Nha Terra", "hours", "Tue 9 am - 11 pm"), true);
});

test("the directory block gives Barbearia DAD its web village with the source", () => {
  const block = directoryBlock([{ name: "Barbearia DAD", category: "hairdresser", location: "" }], []);
  assert.match(block, /Barbearia DAD \(near Calheta, per cv\.geoview\.info\)/);
});

test("the reviewed file: every value has a source URL and a quote, rejections have reasons", () => {
  const data = JSON.parse(readFileSync(new URL("../data/enrichment/maio-places.json", import.meta.url), "utf8"));
  assert.ok(data.review.status);
  assert.ok(data.entries.length > 0);
  for (const entry of data.entries) for (const [field, value] of Object.entries(entry.fields) as [string, { value: string; sourceUrl: string; quote: string }][]) {
    assert.ok((WEB_FIELDS as readonly string[]).includes(field), field);
    assert.match(value.sourceUrl, /^https:\/\//);
    assert.ok(value.value && value.quote, `${entry.name} ${field}`);
  }
  for (const item of data.review.rejected) assert.ok(item.reason);
  assert.equal(data.filled, data.entries.reduce((sum: number, entry: { fields: object }) => sum + Object.keys(entry.fields).length, 0));
});

test("a reply that names the site counts as using the fact; Google Maps pages get that label", () => {
  const maps = { entries: [{ name: "Onda Azul Maio", fields: { hours: { value: "Monday: 10 am–5 pm", sourceUrl: "https://www.google.com/maps/place?q=place_id:x" } } }] };
  const facts = webFacts("Onda Azul Maio", {}, maps)!;
  assert.equal(facts.hours?.source, "Google Maps");
  const out = citeWebFacts("Open Monday to Saturday 10:00–17:00 (per Google Maps).", [{ name: "Onda Azul Maio", facts, asked: true }]);
  assert.equal(out.reply, "Open Monday to Saturday 10:00–17:00 (per Google Maps).");
  assert.equal(out.sources.length, 1);
  // From the directory (not asked about): the place must be named.
  assert.equal(citeWebFacts("Open 10:00 (per Google Maps).", [{ name: "Onda Azul Maio", facts }]).sources.length, 0);
});
