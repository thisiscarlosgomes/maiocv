import { FOOD, PLACES, distanceKm, experience, food, place, type Experience, type PlanDay, type PlanItem, type Slot } from "./trip.ts";
import type { Locale } from "./locale.ts";
import { venueType } from "./plan-rules.ts";

/** Full-day plan (Carlos, Oct 27; research-full-day.md §3). Relaxed by default.
 *  Full day: 08:30 breakfast · 09:30 morning beach/walk · 12:30 lunch · 14:30 rest · 16:00 activity/second beach
 *  · ~18:15 sunset · 19:30 dinner · 21:00 drinks (optional). 6–8 stops.
 *  Arrival: transfer → meal → easy beach → sunset → dinner (3–5 stops, no tour).
 *  Departure: breakfast → short beach → lunch if leaving late → head to the airport/port (2–4 stops, no tour).
 *  Real places only; unfillable slots become generic rows. At most one repeat per day, with the reason in the note. */

export const FULL_DAY_SLOTS: Slot[] = ["breakfast", "morning", "lunch", "rest", "activity", "sunset", "dinner"];
export const FULL_DAY_RANGE = { min: 6, max: 8 } as const;
export const ARRIVAL_RANGE = { min: 3, max: 5 } as const;
export const DEPARTURE_RANGE = { min: 2, max: 4 } as const;
export const DEFAULT_SUNSET = "18:15";
const T = { breakfast: "08:30", morning: "09:30", lunch: "12:30", rest: "14:30", activity: "16:00", dinner: "19:30", drinks: "21:00" };
const WALKABLE_KM = 3;
const TOWN = place("cidade-porto-ingles")!;

export const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
export const toTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;
const round5 = (m: number) => Math.round(m / 5) * 5;

type Pt = { lat: number; lon: number };
export type DayKind = "arrival" | "full" | "departure";

const repeatNotes: Record<Locale, { venue: string; sunset: string; meal: string }> = {
  en: { venue: "Back again: few other options close by", sunset: "Back again: the best sunset near town", meal: "Back again: one of the few places to eat nearby" },
  pt: { venue: "De volta: há poucas opções perto", sunset: "De volta: o melhor pôr do sol perto da vila", meal: "De volta: um dos poucos sítios para comer perto" },
  fr: { venue: "Encore une fois : peu d'autres options à proximité", sunset: "Encore une fois : le plus beau coucher de soleil près de la ville", meal: "Encore une fois : l'un des rares endroits où manger à proximité" },
};

/** West/south-west coast: leeward of the NE trade winds (sheltered on rough days) and facing the sunset. */
export const isWestCoast = (p: Pt) => p.lon <= -23.19;
const WALK_CATEGORIES = new Set(["settlement", "historical_heritage", "religious_heritage", "mountain"]);

export function itemPoint(i: PlanItem): Pt | null {
  const ref = i.kind === "experience" ? place(experience(i.refId)?.placeId ?? "") : i.kind === "food" ? place(food(i.refId)?.placeId ?? "") : i.kind === "place" ? place(i.refId) : undefined;
  return ref ? { lat: ref.lat, lon: ref.lon } : null;
}

export type Pools = { hasCar: boolean; locale: Locale; drinks: boolean };

/** Trip-wide state: what has been used, so later days prefer new places and each day allows one repeat. */
export class Picker {
  used = new Set<string>();
  private reach: (p: Pt) => boolean;
  private o: Pools;
  constructor(o: Pools) { this.o = o; this.reach = (p) => o.hasCar || distanceKm(p, TOWN) <= WALKABLE_KM; }
  restaurants() { return FOOD.filter((f) => venueType(f) === "restaurant" && this.reach(place(f.placeId)!)); }
  cafes() { return this.restaurants().filter((f) => /caf[eé]|coffee|breakfast|bakery|pastelaria/i.test(`${f.title} ${f.description.en}`)); }
  bars() { return FOOD.filter((f) => venueType(f) === "bar" && this.reach(place(f.placeId)!)); }
  beaches(sheltered = false) { return PLACES.filter((p) => p.category === "beach" && this.reach(p) && (!sheltered || isWestCoast(p))); }
  walks() { return PLACES.filter((p) => WALK_CATEGORIES.has(p.category) && this.reach(p)); }
  sunsets() { return this.beaches().filter(isWestCoast); }

  /** Nearest unused candidate to `from` (avoids backtracking); else the nearest used one if the day still has its repeat. */
  pick<T extends { id: string }>(list: T[], pt: (x: T) => Pt, from: Pt, day: DayState, note: "venue" | "sunset" | "meal", freshOnly = false): { id: string; note?: string } | null {
    const near = (a: T, b: T) => distanceKm(from, pt(a)) - distanceKm(from, pt(b));
    const fresh = list.filter((x) => !this.used.has(x.id) && !day.ids.has(x.id)).sort(near)[0];
    if (fresh) { this.used.add(fresh.id); day.ids.add(fresh.id); return { id: fresh.id }; }
    if (freshOnly || day.repeats >= 1) return null;
    const again = list.filter((x) => !day.ids.has(x.id)).sort(near)[0];
    if (!again) return null;
    day.repeats += 1; day.ids.add(again.id);
    return { id: again.id, note: repeatNotes[this.o.locale][note] };
  }
}

export type DayState = { ids: Set<string>; repeats: number };

/** Builds one day's items. `tour` is the trip's single experience when it falls on this (full) day. */
export function buildDay(args: {
  index: number; kind: DayKind; rough: boolean; sunset?: string | null; picker: Picker; pools: Pools;
  arrival?: PlanItem | null; arrivalReadyMin?: number; leave?: { mode: "ferry" | "flight"; time: string; note?: string };
  tour?: Experience | null; quietNight?: boolean;
}): PlanItem[] {
  const { index: i, kind, rough, picker, pools } = args;
  const day: DayState = { ids: new Set(), repeats: 0 };
  const items: PlanItem[] = [];
  let from: Pt = TOWN;
  const sunsetStart = round5(toMin(args.sunset ?? DEFAULT_SUNSET) - (args.sunset ? 25 : 0));
  const add = (slot: Slot, it: Omit<PlanItem, "id" | "slot">) => {
    const item: PlanItem = { id: `d${i}-${slot}`, slot, ...it };
    items.push(item);
    const p = itemPoint(item); if (p) from = p;
    return item;
  };
  const free = (slot: Slot, refId: string, start: number, durationMin: number, note?: string) => add(slot, { kind: "free", refId, start: toTime(start), durationMin, ...(note ? { note } : {}) });
  const foodPt = (f: { placeId: string }) => place(f.placeId)!;
  const meal = (slot: Slot, start: number, dur: number, fallback: string) => {
    const r = picker.pick(picker.restaurants(), foodPt, from, day, "meal");
    if (r) add(slot, { kind: "food", refId: r.id, start: toTime(start), durationMin: dur, ...(r.note ? { note: r.note } : {}) });
    else free(slot, fallback, start, dur);
  };
  const outing = (slot: Slot, start: number, dur: number, opts: { sheltered?: boolean; sunset?: boolean; beachOnly?: boolean } = {}) => {
    const lists = opts.sunset ? [picker.sunsets(), picker.walks().filter(isWestCoast)]
      : [picker.beaches(opts.sheltered), ...(opts.beachOnly ? [] : [picker.walks()])];
    for (const list of lists) {
      const p = picker.pick(list, (x) => x, from, day, opts.sunset ? "sunset" : "venue");
      if (p) return add(slot, { kind: "place", refId: p.id, start: toTime(start), durationMin: dur, ...(p.note ? { note: p.note } : {}) });
    }
    return free(slot, "free-time", start, dur);
  };
  const sunsetAndDinner = (clock: number) => {
    const s = Math.max(sunsetStart, clock);
    outing("sunset", s, 45, { sunset: true });
    meal("dinner", Math.max(toMin(T.dinner), s + 60), 90, "dinner-free");
  };

  if (kind === "arrival") {
    if (args.arrival) items.push({ ...args.arrival, slot: "arrival" });
    let clock = args.arrivalReadyMin ?? toMin("14:00");
    free("transfer", "transfer", clock - 30, 30);
    if (clock <= toMin("14:00")) { const l = Math.max(clock, toMin(T.lunch)); meal("lunch", l, 75, "lunch-free"); clock = l + 90; }
    if (clock + 90 <= sunsetStart) outing("activity", Math.max(clock, toMin("15:30")), 90, { sheltered: rough, beachOnly: true });
    sunsetAndDinner(clock);
    return items;
  }

  if (kind === "departure") {
    const lead = args.leave!.mode === "flight" ? 120 : 60;
    const leave = toMin(args.leave!.time) - lead;
    if (leave < toMin("09:30")) free("breakfast", "breakfast-stay", Math.max(toMin("06:00"), leave - 60), 45);
    else {
      const cafe = picker.pick(picker.cafes(), foodPt, from, day, "meal", true);
      if (cafe) add("breakfast", { kind: "food", refId: cafe.id, start: T.breakfast, durationMin: 45, ...(cafe.note ? { note: cafe.note } : {}) });
      else free("breakfast", "breakfast-stay", toMin(T.breakfast), 45);
    }
    if (leave >= toMin("11:30")) {
      const dur = Math.min(120, leave - toMin(T.morning) - (leave >= toMin("14:00") ? 180 : 30));
      if (dur >= 60) { from = TOWN; outing("morning", toMin(T.morning), dur, { sheltered: rough, beachOnly: true }); }
    }
    if (leave >= toMin("14:00")) meal("lunch", toMin(T.lunch), 75, "lunch-free");
    free("departure", args.leave!.mode === "flight" ? "depart-airport" : "depart-port", leave, lead, args.leave!.note);
    return items;
  }

  // Full day. The trip's single tour goes at 16:00 when its slots allow, else in the morning instead of the beach.
  const tour = args.tour ?? null;
  const pm = tour?.example.slots.find((s) => toMin(s) >= toMin("14:30") && toMin(s) <= toMin("16:30") && toMin(s) + tour.example.durationMin <= sunsetStart + 15);
  const am = !pm ? tour?.example.slots.find((s) => toMin(s) >= toMin("07:00") && toMin(s) <= toMin("10:00")) : undefined;
  const breakfastAt = am ? Math.min(toMin(T.breakfast), Math.max(toMin("06:30"), toMin(am) - 50)) : toMin(T.breakfast);
  const cafe = picker.pick(picker.cafes(), foodPt, from, day, "meal", true);
  if (cafe) add("breakfast", { kind: "food", refId: cafe.id, start: toTime(breakfastAt), durationMin: 45, ...(cafe.note ? { note: cafe.note } : {}) });
  else free("breakfast", "breakfast-stay", breakfastAt, 45);

  let clock: number;
  if (am && tour) { add("morning", { kind: "experience", refId: tour.id, start: am, durationMin: tour.example.durationMin }); clock = toMin(am) + tour.example.durationMin; }
  else { outing("morning", toMin(T.morning), 150, { sheltered: rough }); clock = toMin(T.morning) + 150; }

  const lunch = Math.max(toMin(T.lunch), clock + 15);
  meal("lunch", lunch, 75, "lunch-free");
  const rest = Math.max(toMin(T.rest), lunch + 90);
  free("rest", "rest", rest, 75);

  if (pm && tour) { add("activity", { kind: "experience", refId: tour.id, start: pm, durationMin: tour.example.durationMin }); clock = toMin(pm) + tour.example.durationMin; }
  else if (am) { outing("activity", Math.max(toMin(T.activity), rest + 90), 105, { sheltered: rough }); clock = Math.max(toMin(T.activity), rest + 90) + 105; }
  else { const a = Math.max(toMin(T.activity), rest + 90); outing("activity", a, 105, { sheltered: rough }); clock = a + 105; }

  sunsetAndDinner(clock);
  const dinnerEnd = toMin(items[items.length - 1].start) + items[items.length - 1].durationMin;
  if (pools.drinks && !args.quietNight) {
    const bar = picker.pick(picker.bars(), foodPt, from, day, "venue");
    if (bar) add("drinks", { kind: "food", refId: bar.id, start: toTime(Math.max(toMin(T.drinks), dinnerEnd)), durationMin: 90, ...(bar.note ? { note: bar.note } : {}) });
  }
  return items.sort((a, b) => toMin(a.start) - toMin(b.start));
}

/** Kind of a day as stored in a plan: an arrival transport row or a departure row marks the ends. */
export function dayKind(day: PlanDay): DayKind {
  if (day.items.some((i) => i.slot === "departure" || (i.kind === "free" && i.refId.startsWith("depart-")))) return "departure";
  if (day.items.some((i) => i.kind === "transport")) return "arrival";
  return "full";
}

/** Count of stops a guest sees (the arrival transport row is a header, not a stop). */
export const stopCount = (day: PlanDay) => day.items.filter((i) => i.kind !== "transport").length;

/** Slot for an item that has none (older plans): from its kind and time. */
export function inferSlot(i: PlanItem): Slot {
  if (i.slot) return i.slot;
  const m = toMin(i.start);
  if (i.kind === "transport") return "arrival";
  if (i.kind === "food") return m < toMin("11:00") ? "breakfast" : m < toMin("17:00") ? "lunch" : m < toMin("20:45") ? "dinner" : "drinks";
  if (i.kind === "experience") return m < toMin("12:00") ? "morning" : "activity";
  if (i.kind === "free") return i.refId === "rest" ? "rest" : i.refId === "transfer" ? "transfer" : i.refId.startsWith("depart-") ? "departure" : m < toMin("12:00") ? "morning" : "activity";
  return m < toMin("12:00") ? "morning" : m >= toMin("17:30") ? "sunset" : "activity";
}

const FILL: Record<string, { refId: string; at: string; dur: number }> = {
  breakfast: { refId: "breakfast-stay", at: T.breakfast, dur: 45 }, morning: { refId: "free-time", at: T.morning, dur: 150 },
  lunch: { refId: "lunch-free", at: T.lunch, dur: 75 }, rest: { refId: "rest", at: T.rest, dur: 75 },
  activity: { refId: "free-time", at: T.activity, dur: 105 }, sunset: { refId: "free-time", at: DEFAULT_SUNSET, dur: 45 },
  dinner: { refId: "dinner-free", at: T.dinner, dur: 90 },
};

/** Repair after generation: every full day gets all seven core slots (generic rows fill gaps), extras beyond 8 are dropped
 *  (drinks first), arrival/departure days are trimmed to their ranges. Never adds a venue. */
export function repairDay(day: PlanDay, i: number): PlanDay {
  const kind = dayKind(day);
  let items: PlanItem[] = day.items.map((it) => ({ ...it, slot: inferSlot(it) }));
  if (kind === "full") {
    const has = new Set(items.map((x) => x.slot));
    const first = Math.min(...items.filter((x) => x.kind !== "transport").map((x) => toMin(x.start)));
    for (const slot of FULL_DAY_SLOTS) if (!has.has(slot) && !(slot === "rest" && restCovered(items))) {
      const f = FILL[slot];
      // Breakfast goes before an early tour rather than on top of it.
      const at = slot === "breakfast" ? toTime(Math.max(toMin("06:00"), Math.min(toMin(f.at), first - f.dur))) : f.at;
      items.push({ id: `d${i}-${slot}-fill`, kind: "free", refId: f.refId, start: at, durationMin: f.dur, slot });
    }
    while (stopCountItems(items) > FULL_DAY_RANGE.max) items = dropOne(items, ["drinks"]);
  } else {
    const max = kind === "arrival" ? ARRIVAL_RANGE.max : DEPARTURE_RANGE.max;
    items = items.filter((x) => x.kind !== "experience");
    while (stopCountItems(items) > max) items = dropOne(items, ["drinks", "activity", "morning", "lunch"]);
  }
  return { ...day, items: resolveOverlaps(items) };
}

/** An afternoon tour starting 13:30–16:00 takes the rest slot: the day has no separate rest row. */
export const restCovered = (items: PlanItem[]) => items.some((x) => x.kind === "experience" && toMin(x.start) >= toMin("13:30") && toMin(x.start) < toMin("16:00"));

/** No two stops may overlap. Free time yields to a real stop (trimmed, or dropped if under 30 min left); otherwise the
 *  later stop moves to when the earlier one ends. The arrival transport row is a header and is not checked. */
export function resolveOverlaps(input: PlanItem[]): PlanItem[] {
  const sorted = [...input].sort((a, b) => toMin(a.start) - toMin(b.start) || (a.kind === "free" ? 1 : 0) - (b.kind === "free" ? 1 : 0));
  const out: PlanItem[] = [];
  const end = (x: PlanItem) => toMin(x.start) + (x.durationMin ?? 0);
  for (let item of sorted) {
    if (item.kind === "transport") { out.push(item); continue; }
    for (;;) {
      const k = out.findLastIndex((x) => x.kind !== "transport");
      const prev = k >= 0 ? out[k] : null;
      if (!prev || toMin(item.start) >= end(prev)) { out.push(item); break; }
      if (item.kind === "free") {
        const left = end(item) - end(prev);
        if (left >= 30) out.push({ ...item, start: toTime(end(prev)), durationMin: left });
        break;
      }
      if (prev.kind === "free") {
        const left = toMin(item.start) - toMin(prev.start);
        if (left >= 30) out[k] = { ...prev, durationMin: left }; else out.splice(k, 1);
        continue;
      }
      item = { ...item, start: toTime(end(prev)) };
    }
  }
  return out;
}
const stopCountItems = (items: PlanItem[]) => items.filter((x) => x.kind !== "transport").length;
function dropOne(items: PlanItem[], order: Slot[]): PlanItem[] {
  for (const s of order) { const k = items.findIndex((x) => x.slot === s && x.kind !== "experience"); if (k >= 0) return items.filter((_, j) => j !== k); }
  const seen = new Set<string>();
  for (let k = 0; k < items.length; k += 1) { const key = items[k].slot ?? ""; if (seen.has(key) && items[k].kind !== "transport") return items.filter((_, j) => j !== k); seen.add(key); }
  return items.slice(0, -1);
}
