import { gateway } from "@ai-sdk/gateway";
import type { LanguageModel, ModelMessage } from "ai";
import { z } from "zod";
import { maioClock } from "../../../lib/agora";
import { runPlanAgent } from "../../../lib/plan-agent";
import { planEnabled } from "../../../lib/plan-flag";
import { parseTripPlan } from "../../../lib/trip";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(2000) })).min(1).max(20),
  plan: z.unknown().optional(),
});

export async function POST(request: Request) {
  if (!planEnabled()) return Response.json({ error: "Not found" }, { status: 404 });
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const messages = body.data.messages as ModelMessage[];
  const current = body.data.plan ? parseTripPlan(body.data.plan) : null;
  try {
    let model: LanguageModel = gateway(process.env.PLAN_MODEL ?? "openai/gpt-5-mini");
    // PLAN_MOCK=1: scripted test model for local runs and previews without a Gateway key.
    if (process.env.PLAN_MOCK === "1") {
      const { mockModel, mockScript } = await import("../../../lib/plan-mock");
      model = mockModel(mockScript(messages, current, maioClock(new Date()).date));
    }
    const result = await runPlanAgent(messages, current, { model, fetchImpl: fetch });
    return Response.json(result);
  } catch {
    return Response.json({ error: "Planner unavailable" }, { status: 502 });
  }
}
