import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

type WorkerRequest = { url: string; method: string; mode: string };
function harness({ offline = false, status = 200, installFails = false } = {}) {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const added: string[] = [];
  const deleted: string[] = [];
  const fetched: WorkerRequest[] = [];
  const fallback = new Response("Offline: chat needs internet", { headers: { "Content-Type": "text/html" } });
  const cache = {
    addAll: async (urls: string[]) => {
      if (installFails) throw new Error("Asset unavailable");
      added.push(...urls);
    },
    match: async (url: string) => url === "/offline.html" ? fallback : undefined,
  };
  vm.runInNewContext(source, {
    self: { location: { origin: "https://www.maio.cv" }, addEventListener: (name: string, fn: (event: Record<string, unknown>) => void) => handlers.set(name, fn) },
    caches: { open: async () => cache, keys: async () => ["maio-offline-v0", "maio-offline-v1", "other-app"], delete: async (key: string) => { deleted.push(key); return true; } },
    fetch: async (request: WorkerRequest) => { fetched.push(request); if (offline) throw new TypeError("Offline"); return new Response("Fresh response", { status }); },
    URL, Response,
  });
  function lifecycle(name: string) {
    let pending: Promise<unknown> | undefined;
    handlers.get(name)!({ waitUntil: (value: Promise<unknown>) => { pending = value; } });
    assert.ok(pending, `Worker must handle ${name}`);
    return pending;
  }
  function request(path: string, { method = "GET", mode = "navigate" } = {}) {
    let pending: Promise<Response> | undefined;
    handlers.get("fetch")!({ request: { url: new URL(path, "https://www.maio.cv").href, method, mode }, respondWith: (value: Promise<Response>) => { pending = value; } });
    return pending;
  }
  return { lifecycle, request, added, deleted, fetched };
}

test("pre-caches only the offline shell and preserves unrelated origin caches", async () => {
  const worker = harness();
  await worker.lifecycle("install");
  assert.deepEqual(worker.added, ["/offline.html", "/offline.css", "/offline.js"]);
  await worker.lifecycle("activate");
  assert.deepEqual(worker.deleted, ["maio-offline-v0"]);
});

test("failed offline assets prevent a broken worker from replacing the current one", async () => {
  await assert.rejects(harness({ installFails: true }).lifecycle("install"), /Asset unavailable/);
});

test("page navigations use fresh responses and only fall back when disconnected", async () => {
  const online = harness();
  assert.equal(await (await online.request("/en/chat"))!.text(), "Fresh response");
  assert.deepEqual(online.added, []);
  const offline = harness({ offline: true });
  assert.equal(await (await offline.request("/fr/chat"))!.text(), "Offline: chat needs internet");
});

test("HTTP failures pass through without being cached or mislabelled as offline", async () => {
  const worker = harness({ status: 503 });
  assert.equal((await worker.request("/en"))!.status, 503);
  assert.deepEqual(worker.added, []);
});

test("chat, transcription, API requests, external resources and app assets bypass the cache", () => {
  const worker = harness();
  assert.equal(worker.request("/api/chat", { method: "POST", mode: "cors" }), undefined);
  assert.equal(worker.request("/api/transcribe", { method: "POST", mode: "cors" }), undefined);
  assert.equal(worker.request("/api/chat"), undefined);
  assert.equal(worker.request("https://api.maio.cv/api/v1/sources"), undefined);
  assert.equal(worker.request("/_next/static/chunk.js", { mode: "cors" }), undefined);
  assert.deepEqual(worker.fetched, []);
});

test("manifest install icons have the declared PNG dimensions", () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some((icon: { purpose: string }) => icon.purpose === "maskable"));
  for (const icon of [...manifest.icons, { src: "/apple-touch-icon.png", sizes: "180x180" }]) {
    const image = readFileSync(new URL(`../public${icon.src}`, import.meta.url));
    const [width, height] = icon.sizes.split("x").map(Number);
    assert.equal(image.subarray(1, 4).toString(), "PNG");
    assert.equal(image.readUInt32BE(16), width);
    assert.equal(image.readUInt32BE(20), height);
  }
});
