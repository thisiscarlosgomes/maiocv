import { conversationContext, type FlagLocale, type TurnForFlags } from "./chat-flags.ts";
import { scheduleTurnReview, type ReviewDeps } from "./chat-judge.ts";

const UPSTREAM = "https://portal.maio.cv/api/chat";
const MAX_BODY = 80_000;

function localeOf(body: unknown): FlagLocale {
  const lang = body && typeof body === "object" ? (body as { context?: { lang?: unknown } }).context?.lang : undefined;
  return lang === "en" || lang === "fr" || lang === "pt" ? lang : "pt";
}

function asksForPlan(text: string): boolean {
  return /\b(?:itinerary|roteiro|itineraire|plan my|planeia|planifie|\d+\s*(?:days?|dias?|jours?))\b/i.test(text);
}

export function askTurn(body: unknown, status: number, payloadText: string, timedOut: boolean): TurnForFlags | null {
  if (!body || typeof body !== "object") return null;
  const messages = (body as { messages?: { role: string; content?: unknown }[] }).messages;
  if (!Array.isArray(messages)) return null;
  const context = conversationContext(messages);
  if (!context.userMessage) return null;
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(payloadText);
    if (parsed && typeof parsed === "object") payload = parsed as Record<string, unknown>;
  } catch { /* upstream was not JSON */ }
  const message = typeof payload.message === "string" ? payload.message : "";
  const facts = JSON.stringify({
    toolEvents: payload.toolEvents ?? null,
    sources: payload.sources ?? null,
    citations: payload.citations ?? null,
  }).slice(0, 8000);
  const failure = timedOut ? "timeout" as const : status >= 500 ? "model_error" as const : null;
  return {
    surface: "ask",
    locale: localeOf(body),
    userMessage: context.userMessage,
    previousTurns: context.previousTurns,
    botReply: message,
    planBefore: null,
    planAfter: null,
    chips: [],
    planTurn: asksForPlan(context.userMessage),
    toolFacts: facts,
    previousReply: context.previousReply,
    ...(failure ? { failure } : {}),
  };
}

export async function handleMaioChat(request: Request, deps: ReviewDeps & { fetchImpl?: typeof fetch } = {}): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "Invalid request" }, { status: 413, headers: { "cache-control": "no-store" } });
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const upstream = await fetchImpl(UPSTREAM, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: raw,
      signal: AbortSignal.timeout(55_000),
      redirect: "manual",
    });
    const text = await upstream.text();
    const turn = askTurn(body, upstream.status, text, false);
    if (turn) scheduleTurnReview(turn, deps);
    const headers = new Headers();
    headers.set("content-type", upstream.headers.get("content-type") ?? "application/json; charset=utf-8");
    headers.set("cache-control", "no-store");
    const retry = upstream.headers.get("retry-after");
    if (retry) headers.set("retry-after", retry);
    return new Response(text, { status: upstream.status, headers });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    const turn = askTurn(body, 502, "", timedOut);
    if (turn) scheduleTurnReview(turn, deps);
    return Response.json({ error: "Maio could not be reached." }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
