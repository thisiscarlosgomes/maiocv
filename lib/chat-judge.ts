import { generateText, Output } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { z } from "zod";
import { buildFlag, inspectTurn, partyLine, summarizePlan, trimContext, type FlagSeverity, type TurnForFlags } from "./chat-flags.ts";
import { consumeJudgeBudget } from "./chat-flags-mongo.ts";
import { recordFlag, type FlagStore } from "./chat-flags-store.ts";

export const JUDGE_DAILY_CAP = 2000;
export const JUDGE_MODEL = "openai/gpt-5-nano";

export type JudgeVerdict = { ok: boolean; reasons: string[]; severity: FlagSeverity };

export type JudgeBudget = {
  tryConsume(day: string, cap: number): Promise<boolean>;
};

const JudgeSchema = z.object({
  ok: z.boolean(),
  reasons: z.array(z.string().max(180)).max(6),
  severity: z.enum(["low", "med", "high"]),
});

let budgetOverride: JudgeBudget | null = null;

export function setJudgeBudget(budget: JudgeBudget | null) {
  budgetOverride = budget;
}

export function memoryJudgeBudget(): JudgeBudget & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return {
    counts,
    async tryConsume(day, cap) {
      const used = counts.get(day) ?? 0;
      if (used >= cap) return false;
      counts.set(day, used + 1);
      return true;
    },
  };
}

export function judgeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.MAIO_JUDGE?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  return env.NODE_ENV === "production";
}

export function judgeRate(env: Record<string, string | undefined> = process.env): number {
  const raw = env.MAIO_JUDGE_RATE;
  if (raw === undefined || raw.trim() === "") return 1;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

export function judgeCap(env: Record<string, string | undefined> = process.env): number {
  const raw = env.MAIO_JUDGE_DAILY_CAP;
  if (raw === undefined || raw.trim() === "") return JUDGE_DAILY_CAP;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return JUDGE_DAILY_CAP;
  return value;
}

export function judgeSampled(rate: number, random: () => number = Math.random): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  return random() < rate;
}

function clip(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

/** The grader sees the turn, not the request. No IP, user agent, cookie, or user id. */
export function judgePrompt(turn: TurnForFlags): string {
  const before = summarizePlan(turn.planBefore);
  const after = summarizePlan(turn.planAfter);
  return [
    "Grade this single Maio reply. Set ok=false only for a real failure.",
    "Check: did it answer what was asked; did it ignore or misread the intent; did it claim phones, businesses, times, or prices that are not in the tool facts; are dates, party, and car consistent with what the user said; did it re-show the plan on a non-plan turn; is the reply short.",
    "severity high = wrong facts or a clear edit ignored; med = missed intent or a needless plan; low = too long or minor.",
    "reasons are short phrases. Leave reasons empty when ok is true.",
    `surface: ${turn.surface}`,
    `locale: ${turn.locale}`,
    `plan turn: ${turn.planTurn ? "yes" : "no"}`,
    `user: ${clip(turn.userMessage ?? "", 500)}`,
    `earlier: ${clip(trimContext(turn.previousTurns ?? []), 1500) || "(none)"}`,
    `reply: ${clip(turn.botReply ?? "", 1500)}`,
    `plan before: ${before ? JSON.stringify(before) : "none"} ${partyLine(turn.planBefore)}`.trim(),
    `plan after: ${after ? JSON.stringify(after) : "none"} ${partyLine(turn.planAfter)}`.trim(),
    `tool facts: ${clip(turn.toolFacts ?? "", 2000) || "(none)"}`,
  ].join("\n");
}

export function parseJudgeVerdict(value: unknown): JudgeVerdict | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.ok !== "boolean") return null;
  const severity: FlagSeverity = row.severity === "low" || row.severity === "high" || row.severity === "med" ? row.severity : "med";
  const reasons = Array.isArray(row.reasons)
    ? row.reasons.flatMap((reason) => typeof reason === "string" && reason.trim() ? [reason.trim().slice(0, 180)] : []).slice(0, 6)
    : [];
  return { ok: row.ok, reasons, severity };
}

export async function gatewayJudge(prompt: string, env: Record<string, string | undefined> = process.env): Promise<JudgeVerdict> {
  const modelId = env.MAIO_JUDGE_MODEL?.trim() || JUDGE_MODEL;
  const result = await generateText({
    model: gateway(modelId),
    output: Output.object({
      schema: JudgeSchema,
      name: "maio_reply_grade",
      description: "Whether this Maio reply failed, why, and how serious it is.",
    }),
    prompt,
    temperature: 0,
    maxRetries: 0,
    maxOutputTokens: 200,
    abortSignal: AbortSignal.timeout(12_000),
  });
  const verdict = parseJudgeVerdict(result.output);
  if (!verdict) throw new Error("judge output");
  return verdict;
}

const mongoBudget: JudgeBudget = { tryConsume: (day, cap) => consumeJudgeBudget(day, cap) };

export type ReviewDeps = {
  env?: Record<string, string | undefined>;
  store?: FlagStore | null;
  budget?: JudgeBudget | null;
  judge?: (prompt: string) => Promise<JudgeVerdict>;
  random?: () => number;
  now?: Date;
  /** Next.js after() / waitUntil. The judge runs only inside this callback. */
  after?: (task: () => Promise<void>) => void;
};

function activeBudget(deps: ReviewDeps, env: Record<string, string | undefined>): JudgeBudget | null {
  if (deps.budget) return deps.budget;
  if (budgetOverride) return budgetOverride;
  if (!env.ANALYTICS_MONGODB_URI) return null;
  return mongoBudget;
}

/**
 * Runs the cheap grader. Stores a flag only when ok is false.
 * Judge errors, a missing store, the sample rate, and the daily cap all fail open.
 */
export async function reviewWithJudge(turn: TurnForFlags, deps: ReviewDeps = {}): Promise<void> {
  try {
    const env = deps.env ?? process.env;
    if (!judgeEnabled(env)) return;
    if (!judgeSampled(judgeRate(env), deps.random)) return;
    const budget = activeBudget(deps, env);
    if (!budget) return;
    const day = (deps.now ?? new Date()).toISOString().slice(0, 10);
    if (!(await budget.tryConsume(day, judgeCap(env)))) return;
    const judge = deps.judge ?? ((prompt: string) => gatewayJudge(prompt, env));
    const verdict = await judge(judgePrompt(turn));
    if (!verdict || verdict.ok !== false) return;
    const reasons = verdict.reasons.length ? verdict.reasons : ["judge"];
    recordFlag(buildFlag(turn, { source: "judge", reasons, severity: verdict.severity, now: deps.now }), deps.store);
  } catch {
    // Fail open: a grader outage never affects the guest and stores nothing.
  }
}

/** Invariant flags are recorded now. The grader is scheduled and not awaited. */
export function scheduleTurnReview(turn: TurnForFlags, deps: ReviewDeps = {}): void {
  try {
    const reasons = inspectTurn(turn);
    if (reasons.length) recordFlag(buildFlag(turn, { source: "auto", reasons, now: deps.now }), deps.store);
  } catch { /* a check must not change the reply */ }
  if (turn.failure || !turn.botReply.trim() || !deps.after) return;
  try {
    deps.after(() => reviewWithJudge(turn, deps));
  } catch { /* scheduling failed; the reply already stands */ }
}
