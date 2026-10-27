import { FOOD, PLACES, distanceKm, experience, place, food, type Food, type PlanDay, type PlanItem, type TripPlan } from "./trip.ts";

/** Plan rules enforced in code after generation (Carlos, Oct 27):
 *  1. At most one tour/experience across the whole trip.
 *  2. Bars only in evening slots (19:00+); daytime meals go to restaurants. */

export const EVENING_START = "19:00";
export const BAR_SLOT = "21:00";
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const toTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export type VenueType = "bar" | "restaurant";

/** Visit Maio data has no category field for food, so classify from title + description.
 *  "Bar restaurante …" (a bar-restaurant serving meals) counts as a restaurant; a sports bar / pub is a bar. */
export function venueType(f: Pick<Food, "title" | "description">): VenueType {
  const text = `${f.title} ${f.description.en}`.toLowerCase();
  if (/restaurant|pizzeria|caf[eé]|seafood|dining|cuisine/.test(text)) return "restaurant";
  if (/\b(bar|pub|lounge|sports bar|cocktail)\b/.test(text)) return "bar";
  return "restaurant";
}
export const isBar = (refId: string) => { const f = food(refId); return !!f && venueType(f) === "bar"; };

/** Higher is better: an explicitly requested experience wins, then sea outings on safe days, then longer ones. */
function experienceScore(item: PlanItem, day: PlanDay, requested: Set<string>): number {
  const e = experience(item.refId);
  if (!e) return -1;
  const safe = day.sea?.status === "calm" || day.sea?.status === "moderate";
  return (requested.has(e.id) ? 1000 : 0) + (e.seaDependent && safe ? 100 : 0) + (e.boat ? 10 : 0) + e.example.durationMin / 60;
}

export function enforcePlanRules(plan: TripPlan, opts: { requested?: string[]; hasCarPlaces?: boolean } = {}): TripPlan {
  const requested = new Set(opts.requested ?? []);
  const days = plan.days.map((d) => ({ ...d, items: d.items.map((i) => ({ ...i })) }));

  // Rule 1: one experience per trip. Keep the best, replace the others with a beach/place visit (or drop).
  const exps = days.flatMap((d, di) => d.items.filter((i) => i.kind === "experience").map((i) => ({ i, d, di })));
  if (exps.length > 1) {
    const best = exps.reduce((a, b) => (experienceScore(b.i, b.d, requested) > experienceScore(a.i, a.d, requested) ? b : a));
    const used = new Set(days.flatMap((d) => d.items.filter((i) => i.kind === "place").map((i) => i.refId)));
    const town = place("cidade-porto-ingles")!;
    // Without a car, only beaches within walking distance of Porto Inglês (same 3 km rule as buildPlan).
    const beaches = PLACES.filter((p) => p.category === "beach" && (plan.hasCar || distanceKm(p, town) <= 3));
    for (const { i, d } of exps) {
      if (i === best.i) continue;
      const p = beaches.find((b) => !used.has(b.id));
      const idx = d.items.indexOf(i);
      if (p) { used.add(p.id); d.items[idx] = { id: `${i.id}-place`, kind: "place", refId: p.id, start: i.start, durationMin: 120 }; }
      else d.items.splice(idx, 1);
    }
  }

  // Rule 2: bars only from 19:00. A daytime bar becomes a restaurant meal; the bar moves to an evening slot.
  const restaurants = FOOD.filter((f) => venueType(f) === "restaurant");
  let r = 0;
  for (const d of days) {
    for (const item of [...d.items]) {
      if (item.kind !== "food" || !isBar(item.refId) || toMin(item.start) >= toMin(EVENING_START)) continue;
      const bar = item.refId;
      const taken = new Set(d.items.filter((x) => x.kind === "food").map((x) => x.refId));
      const swap = restaurants.map((_, k) => restaurants[(r + k) % restaurants.length]).find((f) => !taken.has(f.id));
      r += 1;
      if (swap) item.refId = swap.id;
      else d.items.splice(d.items.indexOf(item), 1);
      const lastEnd = Math.max(toMin(BAR_SLOT), ...d.items.map((x) => toMin(x.start) + x.durationMin));
      if (d.items.length < 8 && lastEnd <= toMin("22:00") && !d.items.some((x) => x.kind === "food" && x.refId === bar)) {
        d.items.push({ id: `${item.id}-evening`, kind: "food", refId: bar, start: toTime(lastEnd), durationMin: 90 });
      }
    }
    d.items.sort((a, b) => toMin(a.start) - toMin(b.start));
  }
  return { ...plan, days };
}

/** For tests/evals: list rule violations. */
export function planRuleViolations(plan: TripPlan): string[] {
  const out: string[] = [];
  const n = plan.days.flatMap((d) => d.items).filter((i) => i.kind === "experience").length;
  if (n > 1) out.push(`${n} experiences (max 1)`);
  for (const d of plan.days) for (const i of d.items) if (i.kind === "food" && isBar(i.refId) && toMin(i.start) < toMin(EVENING_START)) out.push(`bar ${i.refId} at ${i.start} on ${d.date}`);
  return out;
}
