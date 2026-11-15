import { gateway } from "@ai-sdk/gateway";
import type { LanguageModel, ModelMessage } from "ai";
import { after } from "next/server";
import { z } from "zod";
import { maioClock } from "../../../lib/agora";
import { conversationContext } from "../../../lib/chat-flags";
import { scheduleTurnReview, type ReviewDeps } from "../../../lib/chat-judge";
import { runPlanAgent, type PlanReplyTurn } from "../../../lib/plan-agent";
import { planEnabled } from "../../../lib/plan-flag";
import { isProductionEnv, readTask, signTask, taskSecret } from "../../../lib/awareness/sign";
import { emptyTask } from "../../../lib/awareness/task";
import { parseTripPlan } from "../../../lib/trip";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(2000) })).min(1).max(30),
  plan: z.unknown().optional(),
  /** Server-signed task blob. The browser stores it; it is not a source of numbers. */
  task: z.string().max(16_000).nullish(),
  locale: z.enum(["pt", "en", "fr"]).optional(),
});

function flagDeps(): ReviewDeps {
  return { after: (task) => { after(() => task()); } };
}

function reviewPlan(turn: PlanReplyTurn, messages: { role: string; content: string }[], deps: ReviewDeps) {
  const context = conversationContext(messages);
  scheduleTurnReview({
    surface: "plan",
    locale: turn.locale === "pt" || turn.locale === "fr" ? turn.locale : "en",
    userMessage: turn.userMessage || context.userMessage,
    previousTurns: turn.previousTurns,
    botReply: turn.reply,
    planBefore: turn.planBefore,
    planAfter: turn.planAfter,
    chips: turn.chips,
    planTurn: turn.planTurn,
    toolFacts: turn.toolFacts,
    previousReply: context.previousReply,
  }, deps);
}

export async function POST(request: Request) {
  if (!planEnabled()) return Response.json({ error: "Not found" }, { status: 404 });
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  if (isProductionEnv() && !taskSecret()) return Response.json({ error: "Planner unavailable" }, { status: 500 });
  const messages = body.data.messages as ModelMessage[];
  const current = body.data.plan ? parseTripPlan(body.data.plan) : null;
  const locale = body.data.locale ?? current?.locale ?? "en";
  const task = body.data.task ? readTask(body.data.task, process.env, locale) : current ? null : emptyTask(locale);
  const deps = flagDeps();
  try {
    let model: LanguageModel = gateway(process.env.PLAN_MODEL ?? "openai/gpt-5-mini");
    // PLAN_MOCK=1: scripted test model for local runs and previews without a Gateway key.
    if (process.env.PLAN_MOCK === "1") {
      const { mockModel, mockScript } = await import("../../../lib/plan-mock");
      model = mockModel(mockScript(messages, current, maioClock(new Date()).date));
    }
    const result = await runPlanAgent(messages, current, {
      model,
      fetchImpl: fetch,
      onReply: (turn) => reviewPlan(turn, body.data.messages, deps),
    }, task);
    const signed = signTask(result.task);
    return Response.json({ reply: result.reply, plan: result.plan, toolEvents: result.toolEvents, task: signed, chips: result.chips, intent: result.intent, status: result.status });
  } catch {
    try {
      const context = conversationContext(body.data.messages);
      scheduleTurnReview({
        surface: "plan",
        locale,
        userMessage: context.userMessage,
        previousTurns: context.previousTurns,
        botReply: "",
        planBefore: current,
        planAfter: current,
        chips: [],
        planTurn: false,
        toolFacts: "",
        previousReply: context.previousReply,
        failure: "model_error",
      }, deps);
    } catch { /* the error response still returns */ }
    return Response.json({ error: "Planner unavailable" }, { status: 502 });
  }
}
