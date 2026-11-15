import { asSchema, generateText, Output } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { z } from "zod";
import { buildFlag, inspectTurn, partyLine, planDayDiff, summarizePlan, trimContext, type FlagSeverity, type TurnForFlags } from "./chat-flags.ts";
import { bumpJudgeHealth, consumeJudgeBudget } from "./chat-flags-mongo.ts";
import { recordFlag, type FlagStore } from "./chat-flags-store.ts";

export const JUDGE_DAILY_CAP = 2000;
/** Confirmed on the AI Gateway catalog. */
export const JUDGE_MODEL = "openai/gpt-5-nano";
/** Used only when the preferred model id is rejected. */
export const JUDGE_MODEL_FALLBACK = "openai/gpt-4.1-nano";

export type JudgeVerdict = { ok: boolean; reasons: string[]; severity: FlagSeverity; confidence: "low" | "high" };

export type JudgeBudget = {
  tryConsume(day: string, cap: number): Promise<boolean>;
};

/**
 * OpenAI strict structured output rejects optional properties, maxLength, and maxItems
 * with HTTP 400 on both gpt-5-nano and gpt-4.1-nano. Length is clipped after the parse.
 */
export const JudgeSchema = z.object({
  ok: z.boolean(),
  reasons: z.array(z.string()),
  severity: z.enum(["low", "med", "high"]),
  confidence: z.enum(["low", "high"]),
});

/** JSON schema actually sent as response_format. Tests lock the strict-output rules. */
export async function judgeResponseSchema(): Promise<Record<string, unknown>> {
  return asSchema(JudgeSchema).jsonSchema as Promise<Record<string, unknown>>;
}

/**
 * gpt-5-nano's gateway catalog does not list temperature. Sending temperature: 0 is a 400.
 * gpt-4.1-nano accepts temperature, and it does not need one.
 */
export function judgeCallSettings(): { maxRetries: number; maxOutputTokens: number } {
  return { maxRetries: 0, maxOutputTokens: 200 };
}

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

/** Free-tier default. One in three sampled turns, so the judge does not share the guest's nano budget. */
export const JUDGE_FREE_TIER_RATE = 0.3;

export function judgeRate(env: Record<string, string | undefined> = process.env): number {
  const raw = env.MAIO_JUDGE_RATE;
  if (raw === undefined || raw.trim() === "") return JUDGE_FREE_TIER_RATE;
  const value = Number(raw);
  if (!Number.isFinite(value)) return JUDGE_FREE_TIER_RATE;
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
    "Grade this single Maio reply. A reply that matches the applied edit and the day diff is correct. Do not flag it.",
    "Adding or removing a day is correct when the day diff shows that span change. 'un jour de plus', 'add another day', and 'mais um dia' that turn a 2-day plan into 3 days, with a new card, are a successful edit. Do not say the plan should have stayed the old length.",
    "Set ok=false and confidence=high only when you can name one specific failure, such as a claimed change with an empty day diff, an invented business or phone, or a date the guest named that the plan does not use.",
    "Otherwise set ok=true and confidence=low. Vague reasons such as 'bad' or 'too long' are not failures.",
    "reasons are one concrete sentence. Leave reasons empty when ok is true.",
    `surface: ${turn.surface}`,
    `locale: ${turn.locale}`,
    `plan turn: ${turn.planTurn ? "yes" : "no"}`,
    `user: ${clip(turn.userMessage ?? "", 500)}`,
    `earlier: ${clip(trimContext(turn.previousTurns ?? []), 1500) || "(none)"}`,
    `reply: ${clip(turn.botReply ?? "", 1500)}`,
    `applied edit: ${turn.appliedEdit?.trim() || "none"}`,
    `day diff: ${planDayDiff(turn.planBefore, turn.planAfter)}`,
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
  const confidence = row.confidence === "high" ? "high" : "low";
  const reasons = Array.isArray(row.reasons)
    ? row.reasons.flatMap((reason) => typeof reason === "string" && reason.trim() ? [reason.trim().slice(0, 180)] : []).slice(0, 6)
    : [];
  return { ok: row.ok, reasons, severity, confidence };
}

const VAGUE_REASON = /^(?:bad|wrong|incorrect|too long|minor|not great|issue|problem|erro|mauvais|vague)$/i;

/** A flag needs a high-confidence reason that names the failure in a full sentence. */
export function verdictWarrantsFlag(verdict: JudgeVerdict | null): boolean {
  if (!verdict || verdict.ok !== false || verdict.confidence !== "high") return false;
  return verdict.reasons.some((reason) => reason.trim().split(/\s+/).length >= 4 && !VAGUE_REASON.test(reason.trim()));
}

/**
 * Deterministic check used by evals. A matching edit with a real day diff is not a failure.
 * A claimed change with no diff, an invented phone, or a missed guest date is.
 */
export function judgeShouldFlag(turn: TurnForFlags): string | null {
  const diff = planDayDiff(turn.planBefore, turn.planAfter);
  const reply = turn.botReply ?? "";
  const claimsChange = /\b(?:lighter|mais leve|plus l[eé]ger|busier|packed|moved|mudei|took the boat|leaves at|sai às|part maintenant|ficou mais|is busier|is lighter)\b/i.test(reply);
  if (claimsChange && diff === "no itinerary change") return "claimed a change but the day diff is empty";
  const phone = reply.match(/\+\d[\d\s]{6,}/);
  if (phone && !(turn.toolFacts ?? "").replace(/\D/g, "").includes(phone[0].replace(/\D/g, ""))) return "invented a phone number that is not in the tool facts";
  const asked = /\b18\b/.test(turn.userMessage) && /\b20\b/.test(turn.userMessage) && /\b(?:arriv|leaving|saio|d[eé]part)\b/i.test(turn.userMessage);
  const after = summarizePlan(turn.planAfter);
  if (asked && after && !after.start.endsWith("-18")) return "the plan does not start on the 18th the guest named";
  return null;
}

/** A short reason code. Never the prompt, the reply, or a request identifier. */
export function judgeErrorType(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const message = error.message.toLowerCase();
  if (error.name === "AbortError" || error.name === "TimeoutError" || /timeout|aborted/.test(message)) return "timeout";
  if (/not found|does not exist|404|model/.test(message) && /model|not found|404/.test(message)) return "model_not_found";
  if (/401|403|unauthori[sz]ed|api key/.test(message)) return "auth";
  if (/429|rate limit/.test(message)) return "rate_limit";
  if (/schema|output|parse|json/.test(message)) return "output";
  return "model_error";
}

/** Provider status when the SDK exposes one. 429 stays 429, not the turn text. */
export function providerErrorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const status = (error as { statusCode?: unknown; status?: unknown }).statusCode ?? (error as { status?: unknown }).status;
    if (typeof status === "number" && status >= 100 && status <= 599) return String(status);
  }
  const type = judgeErrorType(error);
  return type === "rate_limit" ? "429" : type;
}

/** One judge request at a time, and about one accepted call every 3 seconds. Extra turns are skipped, not queued. */
export const JUDGE_INTERVAL_MS = 3_000;
export const JUDGE_BACKOFF_MS = 60_000;

export type JudgeGate = {
  tryBegin(now: number): "ok" | "backoff" | "busy" | "paced";
  finish(now: number, error?: unknown): void;
};

export function createJudgeGate(): JudgeGate {
  let busy = false;
  let nextAllowedAt = 0;
  let backoffUntil = 0;
  return {
    tryBegin(now) {
      if (now < backoffUntil) return "backoff";
      if (busy) return "busy";
      if (now < nextAllowedAt) return "paced";
      busy = true;
      nextAllowedAt = now + JUDGE_INTERVAL_MS;
      return "ok";
    },
    finish(now, error) {
      busy = false;
      if (!error) return;
      const code = providerErrorCode(error);
      if (code === "429" || code === "rate_limit") backoffUntil = Math.max(backoffUntil, now + JUDGE_BACKOFF_MS);
    },
  };
}

const sharedGate = createJudgeGate();

export function tryBeginJudge(now = Date.now()): "ok" | "backoff" | "busy" | "paced" {
  return sharedGate.tryBegin(now);
}

export function finishJudge(now = Date.now(), error?: unknown) {
  sharedGate.finish(now, error);
}

/**
 * Try the preferred model. A 429 is returned to the caller, which backs the judge off.
 * Any other error tries the cheap model once. A rate limit does not spend a second call.
 */
export async function attemptJudgeModels(
  models: readonly string[],
  call: (modelId: string) => Promise<JudgeVerdict>,
): Promise<JudgeVerdict> {
  const preferred = models[0] ?? JUDGE_MODEL;
  const fallback = models.find((model) => model !== preferred) ?? JUDGE_MODEL_FALLBACK;
  try {
    return await call(preferred);
  } catch (error) {
    const code = providerErrorCode(error);
    console.warn(`judge model failed: ${preferred} ${code}`);
    if (code === "429" || code === "rate_limit" || fallback === preferred) throw error;
    try {
      return await call(fallback);
    } catch (again) {
      console.warn(`judge model failed: ${fallback} ${providerErrorCode(again)}`);
      throw again;
    }
  }
}

type JudgeHealth = { day: string; calls: number; failures: number; flags: number; skips: number; lastError: string | null };
const judgeHealth: JudgeHealth = { day: "", calls: 0, failures: 0, flags: 0, skips: 0, lastError: null };

function healthDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function rollHealth(now = new Date()) {
  const day = healthDay(now);
  if (judgeHealth.day !== day) {
    judgeHealth.day = day;
    judgeHealth.calls = 0;
    judgeHealth.failures = 0;
    judgeHealth.flags = 0;
    judgeHealth.skips = 0;
    judgeHealth.lastError = null;
  }
}

function persist(now: Date | undefined, event: "call" | "failure" | "flag" | "skip", errorType?: string | null) {
  if (!process.env.ANALYTICS_MONGODB_URI) return;
  const day = (now ?? new Date()).toISOString().slice(0, 10);
  void bumpJudgeHealth(day, event, errorType).catch(() => { /* health is best-effort */ });
}

export function noteJudgeCall(now = new Date()) {
  rollHealth(now);
  judgeHealth.calls += 1;
  persist(now, "call");
}

export function noteJudgeFlag(now = new Date()) {
  rollHealth(now);
  judgeHealth.flags += 1;
  persist(now, "flag");
}

export function noteJudgeFailure(errorType: string, now = new Date()) {
  rollHealth(now);
  judgeHealth.failures += 1;
  judgeHealth.lastError = errorType.slice(0, 40);
  persist(now, "failure", judgeHealth.lastError);
}

export function noteJudgeSkip(now = new Date()) {
  rollHealth(now);
  judgeHealth.skips += 1;
  persist(now, "skip");
}

export function judgeHealthSnapshot(now = new Date()): { calls: number; failures: number; flags: number; skips: number; lastError: string | null } {
  rollHealth(now);
  return { calls: judgeHealth.calls, failures: judgeHealth.failures, flags: judgeHealth.flags, skips: judgeHealth.skips, lastError: judgeHealth.lastError };
}

export function resetJudgeHealth() {
  judgeHealth.day = "";
  judgeHealth.calls = 0;
  judgeHealth.failures = 0;
  judgeHealth.flags = 0;
  judgeHealth.skips = 0;
  judgeHealth.lastError = null;
}

async function callJudgeModel(modelId: string, prompt: string): Promise<JudgeVerdict> {
  const result = await generateText({
    model: gateway(modelId),
    output: Output.object({
      schema: JudgeSchema,
      name: "maio_reply_grade",
      description: "Whether this Maio reply failed, why, and how serious it is.",
    }),
    prompt,
    ...judgeCallSettings(),
    abortSignal: AbortSignal.timeout(8_000),
  });
  const verdict = parseJudgeVerdict(result.output);
  if (!verdict) throw new Error("judge output");
  return verdict;
}

export async function gatewayJudge(prompt: string, env: Record<string, string | undefined> = process.env): Promise<JudgeVerdict> {
  const preferred = env.MAIO_JUDGE_MODEL?.trim() || JUDGE_MODEL;
  const models = preferred === JUDGE_MODEL_FALLBACK ? [preferred] : [preferred, JUDGE_MODEL_FALLBACK];
  return attemptJudgeModels(models, (modelId) => callJudgeModel(modelId, prompt));
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
  /** Per-instance pace. Tests pass a private gate so they do not share the process bucket. */
  gate?: JudgeGate;
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
    const now = deps.now ?? new Date();
    const gate = deps.gate ?? sharedGate;
    const slot = gate.tryBegin(now.getTime());
    if (slot !== "ok") {
      noteJudgeSkip(now);
      return;
    }
    let failed: unknown;
    try {
      const budget = activeBudget(deps, env);
      if (!budget) return;
      const day = now.toISOString().slice(0, 10);
      if (!(await budget.tryConsume(day, judgeCap(env)))) return;
      const judge = deps.judge ?? ((prompt: string) => gatewayJudge(prompt, env));
      noteJudgeCall(now);
      const verdict = await judge(judgePrompt(turn));
      if (!verdictWarrantsFlag(verdict)) return;
      const reasons = verdict.reasons.length ? verdict.reasons : ["judge"];
      noteJudgeFlag(now);
      recordFlag(buildFlag(turn, { source: "judge", reasons, severity: verdict.severity, now }), deps.store);
    } catch (error) {
      failed = error;
      const type = providerErrorCode(error);
      noteJudgeFailure(type, now);
      console.warn(`judge failed: ${type}`);
    } finally {
      gate.finish(now.getTime(), failed);
    }
  } catch (error) {
    const type = providerErrorCode(error);
    noteJudgeFailure(type, deps.now);
    console.warn(`judge failed: ${type}`);
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
