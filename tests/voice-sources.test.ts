import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createVoiceSourceEvidence, parseVoiceSources, type VoiceSource } from "../lib/voice-sources.ts";

// Exercise host/format validation independently, even when evidence matches.
function withEvidence(sources: VoiceSource[]) {
  return parseVoiceSources({ sources }, new Set(sources.map(source => source.url)));
}

const source = { title: "Source", url: "https://api.maio.cv/api/v1/sources/dataset-payments" };
const call = {
  service_id: "maio-open-data", tool_call_id: "call-1", tool_name: "get_open_data_source",
  parameters: {}, timestamp: "2026-10-27T11:00:00+00:00",
};
const success = (payload: unknown) => ({
  ...call, state: "success", result: [{ type: "text", text: JSON.stringify(payload), annotations: null, _meta: null }],
});

function recordResult(evidence: ReturnType<typeof createVoiceSourceEvidence>, payload: unknown) {
  evidence.record({ ...call, state: "loading" });
  evidence.record(success(payload));
}

test("source tool accepts Maio and verified original sources with normalized links", () => {
  assert.deepEqual(withEvidence([
    { title: "  Maio data  ", url: "https://API.MAIO.CV/api/v1/sources/dataset-payments" },
    { title: "Published sailings", url: "https://www.cvinterilhas.cv/routesschedules" },
    { title: "Weather", url: "https://open-meteo.com" },
    { title: "Heritage", url: "https://visitmaio.com/heritage" },
  ]), [
    { title: "Maio data", url: "https://api.maio.cv/api/v1/sources/dataset-payments" },
    { title: "Published sailings", url: "https://www.cvinterilhas.cv/routesschedules" },
    { title: "Weather", url: "https://open-meteo.com/" },
    { title: "Heritage", url: "https://visitmaio.com/heritage" },
  ]);
});

test("malformed source tool payloads and entries are ignored", () => {
  for (const parameters of [null, "text", [], {}, { sources: "not an array" }, { sources: [null, 1, {}, { title: 1, url: "https://maio.cv/" }, { title: " ", url: "https://maio.cv/" }, { title: "Missing URL" }] }]) {
    assert.deepEqual(parseVoiceSources(parameters, new Set(["https://maio.cv/"])), []);
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
  for (const url of urls) assert.deepEqual(withEvidence([{ title: "Source", url }]), [], url);
});

test("bounds work and output to ten sources and short display titles", () => {
  const sources = Array.from({ length: 20 }, (_, index) => ({ title: "x".repeat(250), url: `https://api.maio.cv/api/v1/sources/source-${index}` }));
  const result = withEvidence(sources);
  assert.equal(result.length, 10);
  assert.ok(result.every(source => source.title.length === 200));
  assert.deepEqual(withEvidence([{ title: "Long URL", url: `https://maio.cv/${"x".repeat(2048)}` }]), []);
});

test("normalization removes controls and deduplicates canonical URLs", () => {
  assert.deepEqual(withEvidence([
    { title: "Source\u202e\n\tdata", url: "https://MAIO.CV" },
    { title: "Repeated source", url: "https://maio.cv/" },
    { title: "Different article", url: "https://maio.cv/#article-2" },
  ]), [
    { title: "Source data", url: "https://maio.cv/" },
    { title: "Different article", url: "https://maio.cv/#article-2" },
  ]);
});

test("GitHub citations are limited to the verified astronomy source", () => {
  assert.equal(withEvidence([{ title: "Astronomy Engine", url: "https://github.com/cosinekitty/astronomy" }]).length, 1);
  assert.equal(withEvidence([{ title: "Astronomy docs", url: "https://github.com/cosinekitty/astronomy/tree/master/source" }]).length, 1);
  for (const url of ["https://github.com/other/repository", "https://github.com/cosinekitty/astronomy-other", "https://github.com/cosinekitty/astronomy/../../other/repository"]) {
    assert.deepEqual(withEvidence([{ title: "Unreviewed repo", url }]), []);
  }
});

test("source suggestions fail closed without exact current-turn evidence", () => {
  assert.deepEqual(parseVoiceSources({ sources: [source] }), []);
  assert.deepEqual(parseVoiceSources({ sources: [source] }, new Set()), []);
  for (const url of [`${source.url}/guessed`, `${source.url}?page=2`, `${source.url}#guessed`, source.url.toUpperCase()]) {
    assert.deepEqual(parseVoiceSources({ sources: [{ ...source, url }] }, new Set([source.url])), []);
  }
});

test("supported MCP success content supplies exact source URLs from JSON text", () => {
  const evidence = createVoiceSourceEvidence();
  recordResult(evidence, { tool: call.tool_name, ok: true, payload: { sources: [source] } });
  assert.deepEqual(parseVoiceSources({ sources: [source] }, evidence.urls), [source]);
  assert.deepEqual([...evidence.urls], [source.url]);
});

test("a genuine stats tool result cannot authorize a fabricated URL on an allowed host", () => {
  const evidence = createVoiceSourceEvidence();
  const statsCall = { ...call, tool_name: "get_codigo_postura_stats" };
  evidence.record({ ...statsCall, state: "loading" });
  evidence.record({ ...success({
    tool: "get_codigo_postura_stats", ok: true,
    payload: {
      total_chunks: 269, total_docs: 1,
      docs: [{ doc_id: "codigo-postura-bo-17-02-2026-31-i89900", article_count: 268, page_start: 1, page_end: 87 }],
      source_pdf: "/internal/codigo-postura.pdf", corpus_paths: ["/internal/corpus.json"],
    },
  }), ...statsCall });
  assert.deepEqual(parseVoiceSources({ sources: [{ title: "Código de Postura stats", url: "https://api.maio.cv/codigo-postura/stats" }] }, evidence.urls), []);
  assert.equal(evidence.urls.size, 0);
});

test("old-turn completions, unmatched calls, and new sessions cannot reuse source evidence", () => {
  const evidence = createVoiceSourceEvidence();
  const result = success({ ok: true, payload: { url: source.url } });
  evidence.record(result);
  assert.equal(evidence.urls.size, 0);
  evidence.record({ ...call, state: "loading" });
  evidence.reset();
  evidence.record(result);
  assert.equal(evidence.urls.size, 0);
  recordResult(evidence, { ok: true, payload: { url: source.url } });
  assert.equal(evidence.urls.size, 1);
  evidence.reset();
  assert.deepEqual(parseVoiceSources({ sources: [source] }, evidence.urls), []);
  const nextSession = createVoiceSourceEvidence();
  nextSession.record(result);
  assert.deepEqual(parseVoiceSources({ sources: [source] }, nextSession.urls), []);
  for (const changed of [{ service_id: "other-service" }, { tool_name: "other-tool" }, { tool_call_id: "other-call" }]) {
    evidence.record({ ...call, state: "loading" });
    evidence.record({ ...result, ...changed });
    assert.equal(evidence.urls.size, 0);
    evidence.reset();
  }
});

test("failed, empty, malformed and non-JSON tool results supply no evidence", () => {
  const results: unknown[] = [
    { ...call, state: "failure", error_message: source.url },
    { ...call, state: "success" },
    { ...call, state: "success", result: [] },
    { ...call, state: "success", result: [{ type: "text", text: `See ${source.url}` }] },
    { ...call, state: "success", result: [{ type: "text", text: "{" }] },
    { ...call, state: "success", result: [{ type: "image", url: source.url }] },
    success(null), success({ ok: false, url: source.url }), success({ isError: true, url: source.url }),
    success({ ok: true, payload: { nested: { ok: false, url: source.url } } }),
  ];
  for (const result of results) {
    const evidence = createVoiceSourceEvidence();
    evidence.record({ ...call, state: "loading", parameters: { url: source.url } });
    evidence.record(result);
    assert.equal(evidence.urls.size, 0);
    // Failure/empty completion cannot later be replayed as successful evidence.
    evidence.record(success({ ok: true, payload: { url: source.url } }));
    assert.equal(evidence.urls.size, 0);
  }
});

test("evidence collection keeps the public host guard and bounds result size, depth and URLs", () => {
  const evidence = createVoiceSourceEvidence();
  recordResult(evidence, { ok: true, payload: [source.url, "https://localhost/private", "file:///internal/corpus", "https://unknown.example/source"] });
  assert.deepEqual([...evidence.urls], [source.url]);
  evidence.reset();
  recordResult(evidence, { ok: true, padding: "x".repeat(65_536), url: source.url });
  assert.equal(evidence.urls.size, 0);
  let nested: unknown = source.url;
  for (let depth = 0; depth < 20; depth++) nested = { nested };
  recordResult(evidence, nested);
  assert.equal(evidence.urls.size, 0);
  recordResult(evidence, { padding: Array(1100).fill(null), url: source.url });
  assert.equal(evidence.urls.size, 0);
  const urls = Array.from({ length: 100 }, (_, i) => `https://maio.cv/source-${i}`);
  recordResult(evidence, { ok: true, payload: urls });
  assert.equal(evidence.urls.size, 64);
  assert.ok(evidence.urls.has(urls[0]));
  assert.ok(!evidence.urls.has(urls[64]));
});
