// Local test model for /api/plan when PLAN_MOCK=1 (no AI Gateway key). It replays the tool calls a real
// model would make, so the whole route (tools, planner, edits) runs. Never enabled in production by default.
import { MockLanguageModelV4 } from "ai/test";
import type { ModelMessage } from "ai";
import { place, experience, type TripPlan } from "./trip.ts";

type Call = { tool: string; input: unknown };
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
const plus = (t: string, m: number) => { const v = Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) + m; return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`; };

export function mockScript(messages: ModelMessage[], plan: TripPlan | null, today: string): { calls: Call[][]; reply: string } {
  const last = String(messages[messages.length - 1]?.content ?? "").toLowerCase();
  if (!plan) {
    const start = new Date(`${today}T12:00:00Z`); start.setUTCDate(start.getUTCDate() + 1);
    return { calls: [[{ tool: "propose_itinerary", input: { startDate: start.toISOString().slice(0, 10), days: 3, locale: "en", boatTrips: 1, interests: ["beach", "sea"] } }]],
      reply: "A slow plan. The boat goes on the calmest day." };
  }
  if (/fail|break/.test(last)) return { calls: [[{ tool: "edit_itinerary", input: { ops: [{ op: "remove", itemId: "nope" }] } }]], reply: "Couldn't update the plan. Nothing changed." };
  const boatDay = plan.days.findIndex((d) => d.items.some((i) => i.kind === "experience" && experience(i.refId)?.seaDependent));
  const di = boatDay >= 0 ? boatDay : plan.days.length - 1;
  const day = plan.days[di];
  if (/laz|calm|tranq/.test(last)) {
    const ops: unknown[] = [];
    const exp = day.items.find((i) => i.kind === "experience");
    if (exp) ops.push({ op: "retime", itemId: exp.id, start: plus(exp.start, 90) });
    const spot = day.items.find((i) => i.kind === "place");
    const used = new Set(plan.days.flatMap((d) => d.items.map((i) => i.refId)));
    const near = ["praia-bitche-rotcha", "praia-ponta-preta", "praia-do-morro"].find((id) => place(id) && !used.has(id));
    if (spot && near) ops.push({ op: "swap", itemId: spot.id, refId: near }, { op: "retime", itemId: spot.id, start: "16:30" });
    return { calls: [[{ tool: "edit_itinerary", input: { ops } }]], reply: "Done. The day starts later and ends with a late-afternoon swim." };
  }
  if (/sunset|sol|soleil/.test(last)) {
    const lastDay = plan.days[plan.days.length - 1];
    const spot = [...lastDay.items].reverse().find((i) => i.kind === "place" || i.kind === "food");
    return { calls: spot ? [[{ tool: "edit_itinerary", input: { ops: [{ op: "retime", itemId: spot.id, start: "17:30" }] } }]] : [], reply: "Done. The last stop now catches the sunset." };
  }
  return { calls: [], reply: "Test mode: try “Make Saturday lazier” or “Add a sunset”." };
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
