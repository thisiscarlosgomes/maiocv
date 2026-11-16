// Local test model for /api/plan when PLAN_MOCK=1 (no AI Gateway key). It replays the tool calls a real
// model would make, so the whole route (tools, planner) runs. A change rebuilds the plan. Never enabled in production by default.
import { MockLanguageModelV4 } from "ai/test";
import type { ModelMessage } from "ai";
import type { TripPlan } from "./trip.ts";

type Call = { tool: string; input: unknown };
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };

export function mockScript(messages: ModelMessage[], plan: TripPlan | null, today: string): { calls: Call[][]; reply: string } {
  const last = String(messages[messages.length - 1]?.content ?? "").toLowerCase();
  if (!plan) {
    const start = new Date(`${today}T12:00:00Z`); start.setUTCDate(start.getUTCDate() + 1);
    return { calls: [[{ tool: "propose_itinerary", input: { startDate: start.toISOString().slice(0, 10), days: 3, locale: "en", boatTrips: 0, interests: ["beach"], hasCar: false, adults: 2, pace: "slow" } }]],
      reply: "Overview - Length: 3 days - Pace: slow Day 1 — 2026-11-16 - 08:10 — Breakfast: Sete Sois Sete Luas (food listing) - 09:00 — Experience: Rental Quad (id blue-rental-quad-big-game) we list that by id: blue-rental-quad-big-game 2026-11-16 → 2026-11-18" };
  }
  // A change rebuilds the plan from the trip we already have. Questions stay read-only.
  if (/laz|sunset|swap|move|remove|change|add|replace|calm|tranq|mud|troc|chang|ajout|car|carro|voiture|friday|saturday|sexta|sabado|vendredi|samedi|adult|dias|jours|days|pace|slow|calmo/.test(last))
    return { calls: [[{ tool: "propose_itinerary", input: { startDate: plan.days[0].date, days: plan.days.length, locale: plan.locale, adults: plan.party.adults, kids: plan.party.kids, hasCar: /no car|sem carro|sans voiture/.test(last) ? false : plan.hasCar || /car|carro|voiture/.test(last), drinks: /laz|quiet|calm|tranq/.test(last) ? false : true, ...(plan.party.youngestAge !== undefined ? { youngestAge: plan.party.youngestAge } : {}) } }]],
      reply: /\b(jours|plage|voiture|vendredi|samedi|loue)\b/.test(last)
        ? "J'ai mis le plan à jour."
        : /\b(dias|praia|carro|sexta|sabado|alugamos)\b/.test(last) || /[ãõç]/.test(last)
          ? "Atualizei o plano."
          : "I rebuilt the plan from that change." };
  if (/kid|child|crian|enfant/.test(last)) return { calls: [], reply: "Yes. The water is shallow near the shore. Go before 17:00, when the wind picks up." };
  if (/eat|food|comer|manger/.test(last)) return { calls: [], reply: "In Calheta, try the grilled fish places by the beach. Lunch runs 12:00 to 15:00." };
  if (/pack|mala|valise/.test(last)) return { calls: [], reply: "Sunscreen, a hat, water shoes for the rocks and a light layer for the boat." };
  return { calls: [], reply: "Test mode: ask about the beaches, food or the sea." };
}

export function mockModel(script: { calls: Call[][]; reply: string }) {
  let step = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const calls = script.calls[step]; step += 1;
      if (calls) return { content: calls.map((c, i) => ({ type: "tool-call" as const, toolCallId: `mock-${step}-${i}`, toolName: c.tool, input: JSON.stringify(c.input) })),
        finishReason: { unified: "tool-calls" as const, raw: undefined }, usage, warnings: [] };
      return { content: [{ type: "text" as const, text: script.reply }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
    },
  });
}
