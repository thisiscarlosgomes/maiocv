// Golden-prompt evals for /api/plan. Mocked by default; set PLAN_EVAL_LIVE=1 with AI_GATEWAY_API_KEY
// (or VERCEL_OIDC_TOKEN) to run the same prompts and assertions against the real model.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { runPlanAgent, type PlanAgentResult } from "../lib/plan-agent.ts";
import { distanceKm, experience, place, unknownRefs, type TripPlan } from "../lib/trip.ts";
import { NOW, SCENARIOS, fakeFetch } from "./plan/fixtures.ts";
import { scriptedModel } from "./plan/mock-model.ts";

const live = process.env.PLAN_EVAL_LIVE === "1" && !!(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
const results = new Map<string, PlanAgentResult>();

async function run(name: string): Promise<PlanAgentResult> {
  if (results.has(name)) return results.get(name)!;
  const s = SCENARIOS.find((x) => x.name === name)!;
  const model = live
    ? (await import("@ai-sdk/gateway")).gateway(process.env.PLAN_MODEL ?? "openai/gpt-5-mini")
    : scriptedModel(s.script, s.reply);
  const result = await runPlanAgent([{ role: "user", content: s.prompt }], null, { model, fetchImpl: fakeFetch(s.waves, s.sailings), now: NOW });
  results.set(name, result);
  return result;
}

const items = (plan: TripPlan) => plan.days.flatMap((d, day) => d.items.map((i) => ({ ...i, day })));
const seaItems = (plan: TripPlan) => items(plan).filter((i) => i.kind === "experience" && experience(i.refId)?.seaDependent);
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

test(`mode: ${live ? "LIVE model via AI Gateway" : "mocked model (no gateway key or PLAN_EVAL_LIVE unset)"}`, () => {});

for (const s of SCENARIOS) {
  test(`${s.name}: valid plan, zero made-up ids, propose_itinerary called`, async () => {
    const r = await run(s.name);
    assert.ok(r.plan, "plan returned");
    assert.deepEqual(unknownRefs(r.plan), []);
    assert.ok(r.toolEvents.some((e) => e.name === "propose_itinerary" && e.ok));
    assert.ok(r.reply.length > 0);
  });
}

test("calm water, one boat trip: exactly one sea outing, on the calmest day", async () => {
  const { plan } = await run("3 days calm water one boat trip (en)");
  const sea = seaItems(plan!);
  assert.equal(sea.length, 1);
  assert.equal(sea[0].day, 1, "day with 0.6 m waves");
  assert.equal(plan!.days.length, 3);
});

test("PT and FR variants give the same plan structure in their own language", async () => {
  const en = (await run("3 days calm water one boat trip (en)")).plan!;
  for (const name of ["3 days calm water one boat trip (pt)", "3 days calm water one boat trip (fr)"]) {
    const other = (await run(name)).plan!;
    assert.deepEqual(items(other).map((i) => i.refId), items(en).map((i) => i.refId));
    assert.notEqual(other.title, en.title);
  }
  assert.equal((await run("3 days calm water one boat trip (pt)")).plan!.locale, "pt");
});

test("rough sea on day 2: no sea outing that day, both moved to safe days", async () => {
  const { plan, toolEvents } = await run("rough sea day 2");
  assert.equal(plan!.days[1].sea?.status, "rough");
  assert.equal(seaItems(plan!).filter((i) => i.day === 1).length, 0);
  assert.equal(seaItems(plan!).length, 2);
  if (!live) assert.ok(toolEvents.some((e) => e.name === "get_sea_forecast"));
});

test("arrive by ferry Friday: starts Friday, transport first, nothing before landing", async () => {
  const { plan } = await run("arrive by ferry Friday");
  assert.equal(plan!.days[0].date, "2026-10-30");
  const [first, ...rest] = plan!.days[0].items;
  assert.equal(first.kind, "transport");
  for (const item of rest) assert.ok(toMin(item.start) >= toMin(first.start) + 120, `${item.refId} ${item.start}`);
  if (!live) assert.match(first.note ?? "", /CV Interilhas Praia → Maio 08:30/);
});

test("family with toddler, no car: age-appropriate, walkable or pickup, short", async () => {
  const { plan } = await run("family toddler no car");
  assert.ok(plan!.party.kids > 0);
  const town = place("cidade-porto-ingles")!;
  for (const i of items(plan!)) {
    if (i.kind === "experience") {
      const e = experience(i.refId)!;
      assert.ok(e.example.minAge <= 2, `${e.id} minAge ${e.example.minAge}`);
      assert.ok(e.example.durationMin <= 180);
      assert.equal(e.seaDependent, false);
    }
    if (i.kind === "place") assert.ok(distanceKm(place(i.refId)!, town) <= 3, i.refId);
  }
});

test("out-of-data request: says so, invents nothing", async () => {
  const { plan, toolEvents, reply } = await run("out-of-data request");
  assert.ok(plan!.unmet.length > 0);
  assert.deepEqual(unknownRefs(plan!), []);
  assert.ok(!items(plan!).some((i) => /dolphin|night/i.test(i.refId)));
  if (!live) {
    assert.deepEqual(toolEvents.find((e) => e.name === "propose_itinerary")?.dropped, ["dolphin-cruise"]);
    assert.match(reply, /don't list/);
  }
});
