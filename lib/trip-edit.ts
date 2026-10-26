import { z } from "zod";
import { experience, food, place, type PlanItem, type TripPlan } from "./trip.ts";

export const EditOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("swap"), itemId: z.string(), refId: z.string().describe("New experience, food or place id of the same kind") }),
  z.object({ op: z.literal("move"), itemId: z.string(), toDay: z.number().int().min(0).max(6).describe("0-based day index") }),
  z.object({ op: z.literal("remove"), itemId: z.string() }),
  z.object({ op: z.literal("retime"), itemId: z.string(), start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe("New start time HH:MM, e.g. a later, lazier start") }),
]);
export type EditOp = z.infer<typeof EditOpSchema>;

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

function locate(plan: TripPlan, itemId: string) {
  for (let d = 0; d < plan.days.length; d += 1) {
    const i = plan.days[d].items.findIndex((item) => item.id === itemId);
    if (i >= 0) return { d, i };
  }
  return null;
}

function known(kind: PlanItem["kind"], refId: string) {
  return kind === "experience" ? !!experience(refId) : kind === "food" ? !!food(refId) : kind === "place" ? !!place(refId) : false;
}

const seaRisk = (plan: TripPlan, day: number, item: PlanItem) =>
  item.kind === "experience" && experience(item.refId)?.seaDependent && plan.days[day].sea?.status === "rough";

/** Apply edits one by one. A failing op is skipped and reported; the rest still apply. Input is not mutated. */
export function applyEdits(input: TripPlan, ops: EditOp[]): { plan: TripPlan; errors: string[] } {
  const plan: TripPlan = structuredClone(input);
  const errors: string[] = [];
  for (const op of ops) {
    const at = locate(plan, op.itemId);
    if (!at) { errors.push(`${op.op}: no item ${op.itemId}`); continue; }
    const day = plan.days[at.d];
    const item = day.items[at.i];
    if (op.op === "remove") { day.items.splice(at.i, 1); continue; }
    if (op.op === "retime") {
      if (item.kind === "transport") { errors.push("retime: arrivals keep their published time"); continue; }
      day.items[at.i] = { ...item, start: op.start };
      day.items.sort((a, b) => toMin(a.start) - toMin(b.start));
      continue;
    }
    if (op.op === "swap") {
      if (!known(item.kind, op.refId)) { errors.push(`swap: ${op.refId} is not a known ${item.kind}`); continue; }
      const next: PlanItem = { ...item, refId: op.refId };
      if (item.kind === "experience") {
        const e = experience(op.refId)!;
        const slot = e.example.slots.find((s) => s === item.start) ?? e.example.slots.reduce((best, s) => Math.abs(toMin(s) - toMin(item.start)) < Math.abs(toMin(best) - toMin(item.start)) ? s : best);
        Object.assign(next, { start: slot, durationMin: e.example.durationMin });
      }
      if (seaRisk(plan, at.d, next)) { errors.push(`swap: ${op.refId} needs calm sea and day ${at.d + 1} is rough`); continue; }
      day.items[at.i] = next;
      continue;
    }
    if (op.toDay >= plan.days.length) { errors.push(`move: no day ${op.toDay + 1}`); continue; }
    if (op.toDay === at.d) continue;
    if (seaRisk(plan, op.toDay, item)) { errors.push(`move: day ${op.toDay + 1} is rough, ${item.refId} needs calm sea`); continue; }
    if (item.kind === "transport") { errors.push("move: arrivals cannot be moved"); continue; }
    day.items.splice(at.i, 1);
    const target = plan.days[op.toDay];
    if (target.items.length >= 8) { day.items.splice(at.i, 0, item); errors.push(`move: day ${op.toDay + 1} is full`); continue; }
    target.items.push(item);
    target.items.sort((a, b) => toMin(a.start) - toMin(b.start));
  }
  return { plan, errors };
}

/** Items that differ between two plans, as "day:id" keys. Used to assert minimal edits. */
export function changedItems(a: TripPlan, b: TripPlan): string[] {
  const index = (p: TripPlan) => new Map(p.days.flatMap((d, di) => d.items.map((i) => [i.id, `${di}|${i.refId}|${i.start}`] as const)));
  const ia = index(a), ib = index(b);
  const ids = new Set([...ia.keys(), ...ib.keys()]);
  return [...ids].filter((id) => ia.get(id) !== ib.get(id)).sort();
}

// Share link: the whole plan in the URL (no database). base64url of the JSON.
export function encodeTrip(plan: TripPlan): string {
  const bytes = new TextEncoder().encode(JSON.stringify(plan));
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeTrip(value: string): unknown {
  try {
    const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch { return null; }
}
