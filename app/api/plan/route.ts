import { languageModel } from "../../../lib/ai-model";
import type { LanguageModel, ModelMessage } from "ai";
import { after } from "next/server";
import { z } from "zod";
import { maioClock } from "../../../lib/agora";
import { conversationContext } from "../../../lib/chat-flags";
import { scheduleTurnReview, type ReviewDeps } from "../../../lib/chat-judge";
import { runPlanAgent, type PlanReplyTurn } from "../../../lib/plan-agent";
import { planEnabled } from "../../../lib/plan-flag";
import { isProductionEnv, readTask, signTask, taskSecret } from "../../../lib/awareness/sign";
import { emptyTask, type TaskLocale } from "../../../lib/awareness/task";
import { sideQuestionFallback } from "../../../lib/island-answer";
import { wantsPlanStream } from "../../../lib/plan-status";
import { parseTripPlan } from "../../../lib/trip";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(2000) })).min(1).max(30),
  plan: z.unknown().optional(),
  /** Server-signed task blob. The browser stores it; it is not a source of numbers. */
  task: z.string().max(16_000).nullish(),
  locale: z.enum(["pt", "en", "fr"]).optional(),
  /** Ask for the ndjson status stream. Omitted by every caller that still wants one JSON body. */
  stream: z.boolean().optional(),
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
    appliedEdit: turn.appliedEdit,
  }, deps);
}

function ndjson(work: (send: (event: unknown) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) { controller = ctrl; },
  });
  const send = (event: unknown) => {
    try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { /* the client went away */ }
  };
  void work(send).finally(() => { try { controller.close(); } catch { /* already closed */ } });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(request: Request) {
  if (!planEnabled()) return Response.json({ error: "Not found" }, { status: 404 });
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  if (isProductionEnv() && !taskSecret()) return Response.json({ error: "Planner unavailable" }, { status: 500 });
  const data = body.data;
  const messages = data.messages as ModelMessage[];
  const current = data.plan ? parseTripPlan(data.plan) : null;
  const locale = data.locale ?? current?.locale ?? "en";
  const task = data.task ? readTask(data.task, process.env, locale) : current ? null : emptyTask(locale);
  const deps = flagDeps();
  const fallbackLocale: TaskLocale = locale === "pt" || locale === "fr" ? locale : "en";
  const stream = wantsPlanStream(request.headers.get("accept"), data.stream);

  async function execute(onStatus?: (text: string) => void) {
    let model: LanguageModel = languageModel(process.env.PLAN_MODEL ?? "openai/gpt-5-mini");
    let sideModel: LanguageModel = languageModel(process.env.PLAN_SIDE_MODEL ?? "openai/gpt-5-nano");
    // PLAN_MOCK=1: scripted test model for local runs and previews without a Gateway key.
    if (process.env.PLAN_MOCK === "1") {
      const { mockModel, mockScript } = await import("../../../lib/plan-mock");
      model = mockModel(mockScript(messages, current, maioClock(new Date()).date));
      sideModel = model;
    }
    const result = await runPlanAgent(messages, current, {
      model,
      sideModel,
      fetchImpl: fetch,
      onReply: (turn) => reviewPlan(turn, data.messages, deps),
      onStatus,
    }, task);
    const signed = signTask(result.task);
    return { reply: result.reply, plan: result.plan, toolEvents: result.toolEvents, task: signed, chips: result.chips, intent: result.intent, status: result.status, steps: result.steps };
  }

  function failureBody() {
    try {
      const context = conversationContext(data.messages);
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
    let signed: string | undefined;
    if (typeof data.task === "string") signed = data.task;
    else if (task) {
      try { signed = signTask(task); } catch { signed = undefined; }
    }
    return {
      reply: sideQuestionFallback(fallbackLocale),
      plan: current,
      toolEvents: [],
      ...(signed ? { task: signed } : {}),
      chips: [] as string[],
      intent: "side_question" as const,
      status: "ready",
      steps: [] as string[],
    };
  }

  // Status lines are enqueued as each step starts. Nothing here waits before the work, and nothing holds the answer.
  if (!stream) {
    try {
      return Response.json(await execute());
    } catch {
      return Response.json(failureBody());
    }
  }
  return ndjson(async (send) => {
    try {
      const payload = await execute((text) => send({ type: "status", text }));
      send({ type: "result", ...payload });
    } catch {
      send({ type: "result", ...failureBody() });
    }
  });
}
