import { strict as assert } from "node:assert";
import { test } from "node:test";
import { runPlanAgent } from "../lib/plan-agent.ts";
import { emptyTask } from "../lib/awareness/task.ts";
import { clearBusinessCache, loadBusinesses, searchBusinesses } from "../lib/maio-catalog.ts";
import { scriptedModel } from "./plan/mock-model.ts";

const TODAY = new Date("2026-11-15T12:00:00Z");

function feature(id: string, name: string, phone = "", extra: Record<string, string> = {}) {
  return {
    type: "Feature",
    id,
    properties: { name, publicationStatus: "published", attributes: { name, phone, location: "Vila do Maio", ...extra } },
  };
}

function apiFetch(features: unknown[]): typeof fetch {
  return (async () => new Response(JSON.stringify({ features }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
}

function downFetch(): typeof fetch {
  return (async () => { throw new Error("offline"); }) as typeof fetch;
}

test("business catalog reads the Maio API and falls back when it is down", async () => {
  clearBusinessCache();
  const live = await loadBusinesses(apiFetch([
    feature("maio-guide-food-006", "Enzo Caffe Pizza"),
    feature("maio-guide-blue-rental-quad-big-game", "Big Game Rental Quad", "+238 971 05 93"),
  ]));
  assert.equal(live.source, "api");
  assert.equal(searchBusinesses(live.records, "Enzo Caffe Pizza")[0]?.phone, "");
  assert.equal(searchBusinesses(live.records, "quad")[0]?.phone, "+238 971 05 93");
  clearBusinessCache();
  const offline = await loadBusinesses(downFetch());
  assert.equal(offline.source, "fallback");
  assert.ok(offline.records.some((item) => item.name === "Enzo Caffe Pizza"));
  assert.equal(offline.records.find((item) => item.name === "Enzo Caffe Pizza")?.phone, "");
});

test("phone and pharmacy questions use the Maio API in EN, PT and FR", async () => {
  clearBusinessCache();
  const fetchImpl = apiFetch([
    feature("maio-guide-food-006", "Enzo Caffe Pizza"),
    feature("maio-guide-blue-rental-quad-big-game", "Big Game Rental Quad", "5974467", { category: "sports" }),
  ]);
  const model = scriptedModel([], "should not be used");
  const enzo = await runPlanAgent(
    [{ role: "user", content: "phone number for Enzo Caffe Pizza" }],
    null,
    { model, fetchImpl, now: TODAY },
  );
  assert.match(enzo.reply, /Enzo Caffe Pizza/);
  assert.match(enzo.reply, /No phone number is published/);
  assert.equal(enzo.plan, null);
  assert.equal(enzo.toolEvents[0]?.name, "maio-businesses");
  assert.equal(enzo.toolEvents[0]?.ok, true);

  clearBusinessCache();
  const pt = await runPlanAgent(
    [{ role: "user", content: "número de telefone do Enzo Caffe Pizza" }],
    null,
    { model, fetchImpl, now: TODAY },
    emptyTask("pt"),
  );
  assert.match(pt.reply, /Não há telefone publicado/);
  assert.equal(pt.plan, null);

  clearBusinessCache();
  const fr = await runPlanAgent(
    [{ role: "user", content: "numéro de téléphone de Enzo Caffe Pizza" }],
    null,
    { model, fetchImpl, now: TODAY },
    emptyTask("fr"),
  );
  assert.match(fr.reply, /Aucun numéro n'est publié/);

  clearBusinessCache();
  const quad = await runPlanAgent(
    [{ role: "user", content: "phone number for Big Game Rental Quad" }],
    null,
    { model, fetchImpl, now: TODAY },
  );
  assert.match(quad.reply, /\+238 597 44 67/);
  assert.doesNotMatch(quad.reply, /€|\$/);

  clearBusinessCache();
  const pharmacy = await runPlanAgent(
    [{ role: "user", content: "is there a pharmacy open" }],
    null,
    { model, fetchImpl, now: TODAY },
  );
  assert.match(pharmacy.reply, /No pharmacy/);
  assert.match(pharmacy.reply, /\+238 255 11 30/);
  assert.equal(pharmacy.plan, null);
});
