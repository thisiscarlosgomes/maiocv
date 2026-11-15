import { createHash, timingSafeEqual } from "node:crypto";
import { buildFlag, parseFlagPost, type FlagStatus } from "./chat-flags.ts";
import { judgeHealthSnapshot } from "./chat-judge.ts";
import { readJudgeHealth, type JudgeDayStats } from "./chat-flags-mongo.ts";
import { listFlags, recordFlag, updateFlag } from "./chat-flags-store.ts";

const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY = 12_000;
let postLimit = 60;
let sameLimit = 6;
const hits: { at: number; key: string }[] = [];

export function flagsAuthorized(authorization: string | null, secret = process.env.FLAGS_ADMIN_KEY): boolean {
  if (!secret || secret.length < 16 || !authorization?.startsWith("Bearer ")) return false;
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(token), digest(secret));
}

export function resetFlagPostLimit() {
  hits.length = 0;
  postLimit = 60;
  sameLimit = 6;
}

export function setFlagPostLimit(posts: number, same = 6) {
  postLimit = posts;
  sameLimit = same;
  hits.length = 0;
}

export function allowFlagPost(key: string, now = Date.now()): boolean {
  const windowMs = 60_000;
  while (hits.length && hits[0].at < now - windowMs) hits.shift();
  const same = hits.reduce((count, hit) => count + (hit.key === key ? 1 : 0), 0);
  if (hits.length >= postLimit || same >= sameLimit) return false;
  hits.push({ at: now, key });
  return true;
}

function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
}

function cleanPrUrl(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 300) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const sent = new URL(origin);
    const host = request.headers.get("host");
    if (host && sent.host === host) return true;
    return sent.origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function handleFlagPost(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403, headers: NO_STORE });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return new Response(null, { status: 413, headers: NO_STORE });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return new Response(null, { status: 413, headers: NO_STORE });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE }); }
  const parsed = parseFlagPost(body);
  if (!parsed) return Response.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });
  const key = createHash("sha256").update(`${parsed.surface}\n${parsed.userMessage}\n${parsed.botReply}\n${parsed.note ?? ""}`).digest("hex");
  if (!allowFlagPost(key)) return Response.json({ error: "Too many flags" }, { status: 429, headers: NO_STORE });
  recordFlag(buildFlag({
    surface: parsed.surface,
    locale: parsed.locale,
    userMessage: parsed.userMessage,
    previousTurns: parsed.previousTurns,
    botReply: parsed.botReply,
    planBefore: parsed.planBefore,
    planAfter: parsed.planAfter,
    chips: parsed.chips,
    planTurn: false,
    toolFacts: "",
  }, { source: "thumbs_down", reasons: ["thumbs_down"], note: parsed.note }));
  return new Response(null, { status: 204, headers: NO_STORE });
}

export async function handleFlagHealth(request: Request, read: (day: string) => Promise<JudgeDayStats | null> = readJudgeHealth): Promise<Response> {
  if (!flagsAuthorized(request.headers.get("authorization"))) return unauthorized();
  const day = new Date().toISOString().slice(0, 10);
  const memory = judgeHealthSnapshot();
  const remote = await read(day).catch(() => null);
  const health = remote ?? memory;
  return Response.json({
    judgeCallsToday: health.calls,
    judgeFailuresToday: health.failures,
    flagsWrittenToday: health.flags,
    judgeSkippedToday: health.skips ?? 0,
    lastErrorType: health.lastError,
  }, { headers: NO_STORE });
}

export async function handleFlagGet(request: Request): Promise<Response> {
  if (!flagsAuthorized(request.headers.get("authorization"))) return unauthorized();
  const url = new URL(request.url);
  const sinceRaw = url.searchParams.get("since");
  const since = sinceRaw ? new Date(sinceRaw) : new Date(0);
  if (Number.isNaN(since.getTime())) return Response.json({ error: "Invalid since" }, { status: 400, headers: NO_STORE });
  const parsedLimit = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(parsedLimit) ? Math.min(200, Math.max(1, Math.floor(parsedLimit))) : 50;
  try {
    const flags = await listFlags(since, limit);
    return Response.json({ flags }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "Unavailable" }, { status: 503, headers: NO_STORE });
  }
}

const STATUSES = new Set<FlagStatus>(["new", "triaged", "fixed", "wontfix"]);

export async function handleFlagPatch(request: Request, id: string): Promise<Response> {
  if (!flagsAuthorized(request.headers.get("authorization"))) return unauthorized();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });
  }
  const raw = await request.text();
  if (raw.length > 2000) return Response.json({ error: "Invalid request" }, { status: 413, headers: NO_STORE });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE }); }
  if (!body || typeof body !== "object") return Response.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });
  const row = body as Record<string, unknown>;
  if (typeof row.status !== "string" || !STATUSES.has(row.status as FlagStatus)) {
    return Response.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });
  }
  const prUrl = cleanPrUrl(row.prUrl);
  if (prUrl === null) return Response.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });
  try {
    const updated = await updateFlag(id, { status: row.status as FlagStatus, ...(prUrl ? { prUrl } : {}) });
    if (!updated) return Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    return Response.json({ id, status: row.status, ...(prUrl ? { prUrl } : {}) }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "Unavailable" }, { status: 503, headers: NO_STORE });
  }
}
