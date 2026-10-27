import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ARRIVAL_RANGE, DEPARTURE_RANGE, FULL_DAY_RANGE, FULL_DAY_SLOTS, dayKind, inferSlot, restCovered, stopCount, toMin } from "../lib/full-day.ts";
import { enforcePlanRules, isBar, planRuleViolations } from "../lib/plan-rules.ts";
import { buildPlan } from "../lib/trip-planner.ts";
import { samplePlan } from "../lib/trip-sample.ts";
import { EXCLUDED_EXPERIENCE_IDS, EXPERIENCES, FREE_IDS, experience, parseTripPlan, unknownRefs, type TripPlan } from "../lib/trip.ts";

const START = "2026-11-02";
const fc = (waves: number[], sunset = "18:33") => waves.map((w, i) => ({ date: new Date(Date.UTC(2026, 10, 2 + i)).toISOString().slice(0, 10), waveHeightM: w, windKmh: w >= 2 ? 38 : 15, tempMaxC: 28, sunset }));
const plan = (req: Record<string, unknown>, waves = [0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8]) =>
  buildPlan({ request: { startDate: START, days: 3, locale: "en", ...req } as never, forecast: fc(waves), sailings: [] });

// A matrix of requests: length, car, kids, boats, rough days, arrival/departure times, requested exclusions.
const matrix: { name: string; p: TripPlan }[] = [];
for (const days of [1, 2, 3, 5, 7]) for (const hasCar of [false, true]) for (const kids of [0, 2]) for (const rough of [false, true]) {
  const waves = Array.from({ length: 7 }, (_, i) => (rough && i % 2 === 1 ? 2.6 : 0.8));
  matrix.push({ name: `${days}d car=${hasCar} kids=${kids} rough=${rough}`, p: plan({ days, hasCar, kids, youngestAge: kids ? 4 : undefined, boatTrips: 1 }, waves) });
  for (const [arr, dep] of [["07:30", "17:30"], ["15:00", "09:00"], ["11:00", "13:00"]]) {
    matrix.push({ name: `${days}d arr ${arr} dep ${dep} car=${hasCar} rough=${rough}`, p: plan({ days, hasCar, kids, youngestAge: kids ? 4 : undefined, boatTrips: 2,
      include: ["blue-maio-offroad", "blue-beach-volley-camp"], arrival: { mode: "ferry", dayIndex: 0, time: arr }, departure: { mode: "flight", time: dep } }, waves) });
  }
}

test("every generated plan passes all rules (slots, stop ranges, exclusions, tours, bars, repeats)", () => {
  for (const { name, p } of matrix) {
    assert.deepEqual(planRuleViolations(p), [], name);
    assert.ok(parseTripPlan(p), `${name}: parses`);
  }
});

test("full days cover all seven core slots and have 6–8 stops", () => {
  let full = 0;
  for (const { name, p } of matrix) for (const d of p.days) {
    if (dayKind(d) !== "full") continue;
    full += 1;
    const slots = new Set(d.items.map(inferSlot));
    for (const s of FULL_DAY_SLOTS) assert.ok(slots.has(s) || (s === "rest" && restCovered(d.items)), `${name} ${d.date}: ${s}`);
    const n = stopCount(d);
    assert.ok(n >= FULL_DAY_RANGE.min && n <= FULL_DAY_RANGE.max, `${name} ${d.date}: ${n}`);
    const times = d.items.map((i) => toMin(i.start));
    assert.deepEqual(times, [...times].sort((a, b) => a - b), `${name}: ordered`);
  }
  assert.ok(full > 40);
});

test("default slot times: 08:30 breakfast, 09:30 morning, 12:30 lunch, 14:30 rest, 16:00 activity, sunset from forecast, 19:30 dinner, 21:00 drinks", () => {
  const p = plan({ days: 1, boatTrips: 0, exclude: EXPERIENCES.map((e) => e.id) }, [0.8]);
  const at = Object.fromEntries(p.days[0].items.map((i) => [i.slot, i.start]));
  assert.equal(at.breakfast, "08:30"); assert.equal(at.lunch, "12:30"); assert.equal(at.rest, "14:30"); assert.equal(at.dinner, "19:30"); assert.equal(at.drinks, "21:00");
  assert.equal(at.sunset, "18:10", "25 min before the forecast sunset of 18:33, rounded");
  assert.equal(at.morning, "09:30"); assert.equal(at.activity, "16:00");
});

test("hard exclusions: Beach Volley Camp and Maio Offroad never appear, even when requested", () => {
  assert.deepEqual([...EXCLUDED_EXPERIENCE_IDS].sort(), ["blue-beach-volley-camp", "blue-maio-offroad"]);
  assert.ok(EXPERIENCES.every((e) => !EXCLUDED_EXPERIENCE_IDS.has(e.id)), "not offered by search");
  for (const { name, p } of matrix) for (const i of p.days.flatMap((d) => d.items)) assert.ok(!EXCLUDED_EXPERIENCE_IDS.has(i.refId), name);
  // Enforced on any plan, e.g. one a model or an old share link produced.
  const bad: TripPlan = { ...samplePlan("en") };
  bad.days = bad.days.map((d, k) => k === 1 ? { ...d, items: d.items.map((i) => i.kind === "experience" ? { ...i, refId: "blue-maio-offroad" } : i) } : d);
  assert.ok(planRuleViolations(bad).some((v) => v.startsWith("excluded")));
  const fixed = enforcePlanRules(bad);
  assert.ok(!fixed.days.flatMap((d) => d.items).some((i) => EXCLUDED_EXPERIENCE_IDS.has(i.refId)));
  assert.deepEqual(planRuleViolations(fixed), []);
  assert.ok(experience("blue-maio-offroad"), "still resolvable for old links");
});

test("arrival day: arrival row, transfer, then meal / easy beach / sunset / dinner; 3–5 stops and no tour", () => {
  const p = plan({ arrival: { mode: "ferry", dayIndex: 0, time: "07:30" }, departure: { mode: "flight", time: "17:30" }, boatTrips: 1 });
  const d = p.days[0];
  assert.equal(dayKind(d), "arrival");
  assert.equal(d.items[0].kind, "transport");
  assert.deepEqual(d.items.slice(1).map((i) => i.slot), ["transfer", "lunch", "activity", "sunset", "dinner"]);
  for (const { p: q } of matrix) for (const day of q.days) if (dayKind(day) === "arrival") {
    const n = stopCount(day), arrive = toMin(day.items.find((i) => i.kind === "transport")!.start);
    assert.ok(n <= ARRIVAL_RANGE.max && (n >= ARRIVAL_RANGE.min || arrive > toMin("17:00")), `${n}`);
    assert.ok(!day.items.some((i) => i.kind === "experience"));
  }
});

test("departure day: breakfast, short beach, lunch only when leaving late, then head to the airport/port; 2–4 stops", () => {
  const late = plan({ departure: { mode: "flight", time: "17:30" } }).days[2];
  assert.deepEqual(late.items.map((i) => i.slot), ["breakfast", "morning", "lunch", "departure"]);
  assert.equal(late.items.at(-1)!.refId, "depart-airport");
  assert.equal(late.items.at(-1)!.start, "15:30", "two hours before the flight");
  const early = plan({ days: 2, departure: { mode: "ferry", time: "09:00" } });
  assert.deepEqual(early.days[1].items.map((i) => i.refId), ["breakfast-stay", "depart-port"]);
  assert.ok(!early.days[0].items.some((i) => i.slot === "drinks"), "no bar the night before an early exit");
  assert.ok(plan({ days: 2, departure: { mode: "ferry", time: "18:00" } }).days[0].items.some((i) => i.slot === "drinks"), "bar when leaving late");
  for (const { p: q } of matrix) for (const day of q.days) if (dayKind(day) === "departure") {
    const n = stopCount(day);
    assert.ok(n >= DEPARTURE_RANGE.min && n <= DEPARTURE_RANGE.max, `${n}`);
  }
});

test("one tour per trip, on a full day, and never a sea outing on a rough day", () => {
  for (const { name, p } of matrix) {
    const tours = p.days.flatMap((d) => d.items.filter((i) => i.kind === "experience").map(() => d));
    assert.ok(tours.length <= 1, name);
    for (const d of tours) assert.equal(dayKind(d), "full", name);
  }
  const p = plan({ boatTrips: 1 }, [2.6, 0.5, 2.6]);
  const exp = p.days.flatMap((d, k) => d.items.filter((i) => i.kind === "experience").map((i) => ({ i, k })))[0];
  assert.ok(exp && experience(exp.i.refId)!.seaDependent && exp.k === 1, "sea outing on the one calm day");
});

test("meals: restaurants for breakfast/lunch/dinner, bars only as 21:00 drinks", () => {
  for (const { name, p } of matrix) for (const d of p.days) for (const i of d.items) {
    if (i.kind !== "food") continue;
    if (isBar(i.refId)) { assert.equal(i.slot, "drinks", name); assert.ok(toMin(i.start) >= toMin("21:00"), name); }
    else assert.notEqual(i.slot, "drinks", name);
  }
});

test("real places only: every row is a known venue or a generic row; at most one repeat per day, with its reason", () => {
  for (const { name, p } of matrix) {
    assert.deepEqual(unknownRefs(p), [], name);
    for (const i of p.days.flatMap((d) => d.items)) if (i.kind === "free") assert.ok((FREE_IDS as readonly string[]).includes(i.refId), name);
    const seen = new Set<string>();
    for (const d of p.days) {
      let repeats = 0;
      for (const i of d.items) {
        if (i.kind !== "food" && i.kind !== "place") continue;
        if (seen.has(i.refId)) { repeats += 1; assert.ok(i.note?.startsWith("Back again"), `${name}: ${i.refId} repeat without reason`); }
      }
      for (const i of d.items) seen.add(i.refId);
      assert.ok(repeats <= 1, `${name} ${d.date}: ${repeats} repeats`);
    }
  }
});

test("rough days: morning outing is a sheltered (west-coast) beach or a walk", () => {
  const p = plan({ days: 3, hasCar: true, boatTrips: 0 }, [2.6, 2.6, 2.6]);
  for (const d of p.days) {
    const m = d.items.find((i) => i.slot === "morning" && i.kind === "place");
    if (m) assert.ok(!m.refId.includes("santo-antonio") && !m.refId.includes("prainha"), m.refId);
  }
});

test("repair after generation fills missing slots with generic rows and keeps counts in range", () => {
  const stripped: TripPlan = { ...samplePlan("en"), days: [{ date: "2026-11-02", sea: null, items: [
    { id: "a", kind: "place", refId: "praia-bitche-rotcha", start: "10:00", durationMin: 120 },
    { id: "b", kind: "food", refId: "food-004", start: "13:00", durationMin: 75 },
  ] }] };
  assert.ok(planRuleViolations(stripped).length > 0);
  const fixed = enforcePlanRules(stripped);
  assert.deepEqual(planRuleViolations(fixed), []);
  const d = fixed.days[0];
  assert.ok(d.items.filter((i) => i.kind === "free").every((i) => (FREE_IDS as readonly string[]).includes(i.refId)));
  assert.equal(d.items.find((i) => i.slot === "lunch")!.kind, "food");
  assert.ok(!isBar(d.items.find((i) => i.slot === "lunch")!.refId));
});

test("older share links without slots still parse and render", () => {
  const p = samplePlan("en");
  const legacy = { ...p, days: p.days.map((d) => ({ ...d, items: d.items.map(({ slot: _s, ...i }) => i) })) };
  assert.ok(parseTripPlan(legacy));
});

const overlaps = (p: TripPlan) => p.days.flatMap((d) => {
  const xs = d.items.filter((i) => i.kind !== "transport").sort((a, b) => toMin(a.start) - toMin(b.start));
  return xs.slice(1).flatMap((x, k) => toMin(x.start) < toMin(xs[k].start) + xs[k].durationMin ? [`${d.date} ${xs[k].refId}@${xs[k].start} overlaps ${x.refId}@${x.start}`] : []);
});

test("no two stops in a day overlap, across the matrix and with an afternoon tour", () => {
  for (const { name, p } of matrix) assert.deepEqual(overlaps(p), [], name);
  for (const e of EXPERIENCES) {
    const p = plan({ days: 3, hasCar: true, include: [e.id] });
    assert.deepEqual(overlaps(p), [], e.id);
  }
});

test("repair drops rest time that collides with a 14:30 tour (J&Tour case from the PDF)", () => {
  const base = plan({ days: 3, hasCar: true });
  const bad = structuredClone(base) as TripPlan;
  for (const x of bad.days) x.items = x.items.filter((i) => i.kind !== "experience");
  const d = bad.days[1];
  d.items = d.items.filter((i) => i.slot !== "activity").concat([{ id: "jt", kind: "experience", refId: "guia-001", start: "14:30", durationMin: 180, slot: "activity" }]);
  const fixed = enforcePlanRules(bad);
  assert.deepEqual(overlaps(fixed), []);
  const day = fixed.days[1];
  assert.ok(day.items.some((i) => i.refId === "guia-001" && i.start === "14:30"));
  assert.ok(!day.items.some((i) => i.refId === "rest" && toMin(i.start) < toMin("17:30") && toMin(i.start) + i.durationMin > toMin("14:30")));
});
