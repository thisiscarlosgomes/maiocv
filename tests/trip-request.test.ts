import test from "node:test";
import assert from "node:assert/strict";
import { samplePlan } from "../lib/trip-sample.ts";
import { experience, parseTripPlan } from "../lib/trip.ts";
import { resolveRequest, sendRequest, simulateOperatorSend } from "../lib/trip-request.ts";

function firstExperience() {
  const plan = samplePlan("en");
  for (const [dayIndex, d] of plan.days.entries()) for (const it of d.items)
    if (it.kind === "experience") return { plan, dayIndex, item: it, slots: experience(it.refId)!.example.slots };
  throw new Error("no experience in sample");
}

test("send → sent, valid plan, portuguese operator message", () => {
  const { plan, dayIndex, item, slots } = firstExperience();
  const before = JSON.stringify(plan);
  const r = sendRequest(plan, { dayIndex, itemId: item.id, slot: slots[0], guests: 2, name: "Ana", whatsapp: "+238 999" });
  assert.ok(!("error" in r));
  const sent = r.plan.days[dayIndex].items.find((i) => i.id === item.id)!;
  assert.equal(sent.request?.state, "sent");
  assert.ok(parseTripPlan(r.plan));
  assert.match(r.message.text, /^Novo pedido · /);
  assert.match(r.message.text, /2 pessoas/);
  assert.match(r.message.text, /✓ SIM, confirmo \/ NÃO/);
  assert.equal(JSON.stringify(plan), before, "input not mutated");
});

test("simulated send only logs", () => {
  const { plan, dayIndex, item, slots } = firstExperience();
  const r = sendRequest(plan, { dayIndex, itemId: item.id, slot: slots[0], guests: 1 });
  assert.ok(!("error" in r));
  const lines: string[] = [];
  simulateOperatorSend(r.message, (l) => lines.push(l));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /simulated/);
  assert.match(lines[0], /1 pessoa\b/);
});

test("confirm and decline", () => {
  const { plan, dayIndex, item, slots } = firstExperience();
  const r = sendRequest(plan, { dayIndex, itemId: item.id, slot: slots[0], guests: 2 });
  assert.ok(!("error" in r));
  const ok = resolveRequest(r.plan, dayIndex, item.id, "confirm");
  assert.equal(findReq(ok)?.state, "confirmed");
  const no = resolveRequest(r.plan, dayIndex, item.id, "decline");
  assert.equal(findReq(no)?.state, "declined");
  const alts = findReq(no)!.alternatives!;
  assert.ok(alts.length > 0, "declined offers alternatives");
  assert.ok(alts.every((a) => slots.includes(a.slot) && !(a.slot === slots[0] && a.date === plan.days[dayIndex].date)));
  assert.equal(findReq(resolveRequest(ok, dayIndex, item.id, "decline"))?.state, "confirmed", "only sent requests resolve");
  function findReq(p: typeof plan) { return p.days[dayIndex].items.find((i) => i.id === item.id)!.request; }
});

test("rejects bad requests", () => {
  const { plan, dayIndex, item } = firstExperience();
  assert.ok("error" in sendRequest(plan, { dayIndex, itemId: item.id, slot: "03:00", guests: 2 }));
  assert.ok("error" in sendRequest(plan, { dayIndex, itemId: "nope", slot: "08:00", guests: 2 }));
});
