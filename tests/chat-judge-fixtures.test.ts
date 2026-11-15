// The judge must not flag a reply that matches the day diff, and must flag a real miss.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { planDayDiff, type TurnForFlags } from "../lib/chat-flags.ts";
import { judgePrompt, judgeShouldFlag, verdictWarrantsFlag } from "../lib/chat-judge.ts";
import { relaxDay } from "../lib/plan-edits.ts";
import { buildPlan } from "../lib/trip-planner.ts";
import { addDays, type TripPlan } from "../lib/trip.ts";
import { handleFlagHealth } from "../lib/chat-flags-http.ts";

const forecast = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"].map((date) => ({
  date, waveHeightM: 0.8, windKmh: 16, tempMaxC: 28, sunset: "18:10",
}));

function trip(start = "2026-11-16", days = 3): TripPlan {
  return buildPlan({ request: { startDate: start, days, locale: "en", adults: 2, hasCar: true, boatTrips: 0, pace: "slow" }, forecast, sailings: [] });
}

function turn(partial: Partial<TurnForFlags> & Pick<TurnForFlags, "userMessage" | "botReply">): TurnForFlags {
  return {
    surface: "plan",
    locale: "en",
    previousTurns: [],
    planBefore: null,
    planAfter: null,
    chips: [],
    planTurn: true,
    toolFacts: "",
    appliedEdit: null,
    ...partial,
  };
}

const before = trip();
const relaxed = relaxDay(before, 2, "pt")!.plan;
const lighter = relaxDay(before, 2)!.plan;
const shifted = trip("2026-11-18", 3);

const GOOD: TurnForFlags[] = [
  turn({ userMessage: "o segundo dia mais calmo", botReply: "O dia 2 ficou mais leve: praia de manhã, uma tarde longa livre.", planBefore: before, planAfter: relaxed, appliedEdit: "relax_day", locale: "pt" }),
  turn({ userMessage: "pack the middle day a little more", botReply: "Tue 17 Nov is busier now: 5 stops, including a beach.", planBefore: before, planAfter: lighter, appliedEdit: "busier_day" }),
  turn({ userMessage: "push it 2 days", botReply: "Moved your 3 days to Wed 18 Nov – Fri 20 Nov.", planBefore: before, planAfter: shifted, appliedEdit: "shift_dates" }),
  turn({ userMessage: "Make day 2 more relaxed", botReply: "Day 2 is lighter now: a beach in the morning, a long afternoon free.", planBefore: before, planAfter: lighter, appliedEdit: "relax_day" }),
];

for (const item of GOOD) {
  test(`judge does not flag a matched edit: ${item.userMessage}`, () => {
    assert.equal(judgeShouldFlag(item), null, planDayDiff(item.planBefore, item.planAfter));
    const prompt = judgePrompt(item);
    assert.match(prompt, /day diff:/);
    assert.match(prompt, /applied edit: (relax_day|busier_day|shift_dates)/);
    assert.match(prompt, /confidence=high only when/);
    assert.equal(prompt.includes("203.0.113"), false);
  });
}

test("judge flags a claimed change with no diff, an invented number, and a wrong date", () => {
  const unchanged = turn({
    userMessage: "o segundo dia mais calmo",
    botReply: "O dia 2 ficou mais leve: praia de manhã.",
    planBefore: before,
    planAfter: before,
    appliedEdit: "none",
  });
  assert.match(judgeShouldFlag(unchanged) ?? "", /empty/);
  const invented = turn({
    userMessage: "where can I eat",
    botReply: "Call Restaurante Inventado at +238 991 0000.",
    planBefore: before,
    planAfter: before,
    toolFacts: "Visit Maio lists Enzo.",
  });
  assert.match(judgeShouldFlag(invented) ?? "", /phone/);
  const wrongDate = turn({
    userMessage: "arriving 18, leaving 20 Nov",
    botReply: "Your trip now runs 3 days, Mon 16 Nov to Wed 18 Nov.",
    planBefore: before,
    planAfter: before,
    appliedEdit: "set_dates",
  });
  assert.match(judgeShouldFlag(wrongDate) ?? "", /18th/);
  assert.equal(addDays("2026-11-16", 2), "2026-11-18");
});

test("only a high-confidence specific reason is stored", () => {
  assert.equal(verdictWarrantsFlag({ ok: false, confidence: "low", reasons: ["the day diff is empty so the claim is false"], severity: "high" }), false);
  assert.equal(verdictWarrantsFlag({ ok: false, confidence: "high", reasons: ["bad"], severity: "high" }), false);
  assert.equal(verdictWarrantsFlag({ ok: true, confidence: "high", reasons: ["the day diff is empty so the claim is false"], severity: "high" }), false);
  assert.equal(verdictWarrantsFlag({ ok: false, confidence: "high", reasons: ["claimed a lighter day but the day diff is empty"], severity: "med" }), true);
});

test("health reads the shared daily counters instead of this instance", async () => {
  const previous = process.env.FLAGS_ADMIN_KEY;
  process.env.FLAGS_ADMIN_KEY = "k".repeat(24);
  try {
    const response = await handleFlagHealth(new Request("http://localhost/api/flags/health", {
      headers: { authorization: `Bearer ${"k".repeat(24)}` },
    }), async () => ({ calls: 10, failures: 2, flags: 3, lastError: "timeout" }));
    const body = await response.json() as { judgeCallsToday: number; judgeFailuresToday: number; flagsWrittenToday: number; lastErrorType: string | null };
    assert.equal(body.judgeCallsToday, 10);
    assert.equal(body.judgeFailuresToday, 2);
    assert.equal(body.flagsWrittenToday, 3);
    assert.equal(body.lastErrorType, "timeout");
  } finally {
    process.env.FLAGS_ADMIN_KEY = previous;
  }
});
