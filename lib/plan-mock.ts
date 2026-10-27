// Local test model for /api/plan when PLAN_MOCK=1 (no AI Gateway key). It replays the tool calls a real
// model would make, so the whole route (tools, planner) runs. After the first plan it only answers questions. Never enabled in production by default.
import { MockLanguageModelV4 } from "ai/test";
import type { ModelMessage } from "ai";
import type { TripPlan } from "./trip.ts";

type Call = { tool: string; input: unknown };
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };

export function mockScript(messages: ModelMessage[], plan: TripPlan | null, today: string): { calls: Call[][]; reply: string } {
  const last = String(messages[messages.length - 1]?.content ?? "").toLowerCase();
  if (!plan) {
    const start = new Date(`${today}T12:00:00Z`); start.setUTCDate(start.getUTCDate() + 1);
    return { calls: [[{ tool: "propose_itinerary", input: { startDate: start.toISOString().slice(0, 10), days: 3, locale: "en", boatTrips: 1, interests: ["beach", "sea"], arrival: { mode: "ferry", dayIndex: 0, time: "07:30" }, departure: { mode: "flight", time: "17:30" } } }]],
      reply: "Here’s a slow plan. Boat on the calmest day, when the sea is calm." };
  }
  // v3.2: the plan is fixed. No tool calls once a plan exists; the chat only answers questions.
  if (/laz|sunset|swap|move|remove|change|add|replace|calm|tranq|mud|troc|chang|ajout/.test(last))
    return { calls: [], reply: "This plan is fixed, so I can't change its stops. Ask me anything about it, or start a new one with Plan my trip." };
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
