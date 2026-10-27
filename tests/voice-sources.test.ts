import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseVoiceSources as voiceSourcesFrom } from "../lib/voice-sources.ts";

test("source tool accepts Maio and verified original sources with normalized links", () => {
  assert.deepEqual(voiceSourcesFrom({ sources: [
    { title: "  Maio data  ", url: "https://API.MAIO.CV/api/v1/sources/dataset-payments" },
    { title: "Published sailings", url: "https://www.cvinterilhas.cv/routesschedules" },
    { title: "Weather", url: "https://open-meteo.com" },
    { title: "Heritage", url: "https://visitmaio.com/heritage" },
  ] }), [
    { title: "Maio data", url: "https://api.maio.cv/api/v1/sources/dataset-payments" },
    { title: "Published sailings", url: "https://www.cvinterilhas.cv/routesschedules" },
    { title: "Weather", url: "https://open-meteo.com/" },
    { title: "Heritage", url: "https://visitmaio.com/heritage" },
  ]);
});

test("malformed source tool payloads and entries are ignored", () => {
  for (const parameters of [null, "text", [], {}, { sources: "not an array" }, { sources: [null, 1, {}, { title: 1, url: "https://maio.cv/" }, { title: " ", url: "https://maio.cv/" }, { title: "Missing URL" }] }]) {
    assert.deepEqual(voiceSourcesFrom(parameters), []);
  }
});

test("unsafe schemes, credentials, local targets and misleading hosts are excluded", () => {
  const urls = [
    "javascript:alert(1)", "data:text/html,hello", "file:///etc/passwd", "http://maio.cv/", "/sources",
    "https://user:password@portal.maio.cv/sources", "https://localhost/", "https://localhost.localdomain/",
    "https://127.0.0.1/", "https://2130706433/", "https://10.0.0.1/", "https://192.168.1.1/",
    "https://169.254.169.254/", "https://[::1]/", "https://[fd00::1]/", "https://service.internal/",
    "https://portal.maio.cv.evil.example/", "https://portal.maio.cv@evil.example/", "https://evil.example@portal.maio.cv/",
    "https://portal.maio.cv:8443/", "https://portal.maio.cv\n/sources", "https://portal.maio.cv\\sources",
    "https://portal.maio.cv./sources", "https://unreviewed-source.org/data",
  ];
  for (const url of urls) assert.deepEqual(voiceSourcesFrom({ sources: [{ title: "Source", url }] }), [], url);
});

test("bounds work and output to ten sources and short display titles", () => {
  const sources = Array.from({ length: 20 }, (_, index) => ({ title: "x".repeat(250), url: `https://api.maio.cv/api/v1/sources/source-${index}` }));
  const result = voiceSourcesFrom({ sources });
  assert.equal(result.length, 10);
  assert.ok(result.every(source => source.title.length === 200));
  assert.deepEqual(voiceSourcesFrom({ sources: [{ title: "Long URL", url: `https://maio.cv/${"x".repeat(2048)}` }] }), []);
});

test("normalization removes controls and deduplicates canonical URLs", () => {
  assert.deepEqual(voiceSourcesFrom({ sources: [
    { title: "Source\u202e\n\tdata", url: "https://MAIO.CV" },
    { title: "Repeated source", url: "https://maio.cv/" },
    { title: "Different article", url: "https://maio.cv/#article-2" },
  ] }), [
    { title: "Source data", url: "https://maio.cv/" },
    { title: "Different article", url: "https://maio.cv/#article-2" },
  ]);
});

test("GitHub citations are limited to the verified astronomy source", () => {
  assert.equal(voiceSourcesFrom({ sources: [{ title: "Astronomy Engine", url: "https://github.com/cosinekitty/astronomy" }] }).length, 1);
  assert.equal(voiceSourcesFrom({ sources: [{ title: "Astronomy docs", url: "https://github.com/cosinekitty/astronomy/tree/master/source" }] }).length, 1);
  for (const url of ["https://github.com/other/repository", "https://github.com/cosinekitty/astronomy-other", "https://github.com/cosinekitty/astronomy/../../other/repository"]) {
    assert.deepEqual(voiceSourcesFrom({ sources: [{ title: "Unreviewed repo", url }] }), []);
  }
});
