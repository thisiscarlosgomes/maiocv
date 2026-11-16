import { gateway } from "@ai-sdk/gateway";
import { generateText, stepCountIs, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { conversationContext, type FlagLocale, type TurnForFlags } from "./chat-flags.ts";
import { scheduleTurnReview, type ReviewDeps } from "./chat-judge.ts";
import { syncLiveCatalog } from "./live-catalog.ts";
import {
  answerGrounded,
  askInstructions,
  chatFetch,
  classifyAsk,
  directoryContacts,
  readBoatSchedule,
  readBusinesses,
  readExperiences,
  readFlightSchedule,
  readStays,
  readWeather,
  replyUsesListedFacts,
  safeContactReply,
  type AskLocale,
  type Citation,
  type ToolEvent,
} from "./maio-chat-tools.ts";
import { gatewayReady } from "./plan-intent.ts";

/** Same model id and turn budget the planner uses. A hung gateway call must not hold the reply. */
export const CHAT_MODEL = process.env.PLAN_MODEL?.trim() || "openai/gpt-5-mini";
export const CHAT_TURN_MS = 4_500;

const MAX_BODY = 80_000;
const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

export type ChatDeps = ReviewDeps & {
  fetchImpl?: typeof fetch;
  model?: LanguageModel;
  now?: Date;
};

function localeOf(body: unknown, question: string): AskLocale {
  const lang = body && typeof body === "object" ? (body as { context?: { lang?: unknown } }).context?.lang : undefined;
  if (lang === "en" || lang === "fr" || lang === "pt") return lang;
  if (/Reply in English/i.test(question)) return "en";
  if (/R[eé]ponds en fran[cç]ais/i.test(question)) return "fr";
  return "pt";
}

function asksForPlan(text: string): boolean {
  return /\b(?:itinerary|roteiro|itineraire|plan my|planeia|planifie|\d+\s*(?:days?|dias?|jours?))\b/i.test(text);
}

type ChatMessage = { role: "user" | "assistant"; content: string };

function normalizeMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  const messages: ChatMessage[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const text = content.trim().slice(0, 4_000);
    if (text) messages.push({ role, content: text });
  }
  return messages.slice(-12);
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
  } catch { /* the body was not JSON */ }
  const message = typeof payload.message === "string" ? payload.message : "";
  const facts = JSON.stringify({
    toolEvents: payload.toolEvents ?? null,
    sources: payload.sources ?? null,
    citations: payload.citations ?? null,
  }).slice(0, 8000);
  const failure = timedOut ? "timeout" as const : status >= 500 ? "model_error" as const : null;
  return {
    surface: "ask",
    locale: localeOf(body, context.userMessage) as FlagLocale,
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

function failFast<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })), ms);
    work.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function blank(value: string | null | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function chatTools(fetchImpl: typeof fetch, now: Date, events: ToolEvent[], facts: string[]) {
  const note = (name: string, args: Record<string, unknown>, ok: boolean, payload: unknown) => {
    events.push({ name, arguments: args, ok });
    facts.push(JSON.stringify(payload));
    return payload;
  };
  return {
    get_boat_schedules: tool({
      description: "Published CV Interilhas timetable for the Santiago–Maio ferry. Not a boat trip, not live status, and not a substitute when the experience directory has no boat trip.",
      inputSchema: z.object({ from: dateField, to: dateField }),
      execute: async ({ from, to }) => {
        const result = await readBoatSchedule(fetchImpl, now, { from, to });
        return note("get_boat_schedules", { from: from ?? null, to: to ?? null }, result.available, result);
      },
    }),
    get_flight_schedules: tool({
      description: "Published Praia–Maio flight timetable. Not live status. Do not say a flight is airborne, on time, or delayed.",
      inputSchema: z.object({ from: dateField, to: dateField }),
      execute: async ({ from, to }) => {
        const result = await readFlightSchedule(fetchImpl, now, { from, to });
        return note("get_flight_schedules", { from: from ?? null, to: to ?? null }, result.available, result);
      },
    }),
    get_maio_accommodation: tool({
      description: "Hotels and stays from api.maio.cv/api/v1/accommodation. Pass null name and area to list the directory. Never invent a stay, contact, price, or availability.",
      inputSchema: z.object({ name: z.string().max(80).nullable().optional(), area: z.string().max(80).nullable().optional() }),
      execute: async ({ name, area }) => {
        const result = await readStays(fetchImpl);
        const needle = normJoin(blank(name), blank(area));
        const stays = needle
          ? result.stays.filter((stay) => `${stay.name} ${stay.area ?? ""}`.toLowerCase().includes(needle.toLowerCase()))
          : result.stays;
        return note("get_maio_accommodation", { name: name ?? null, area: area ?? null }, result.available, { ...result, stays });
      },
    }),
    get_maio_experiences: tool({
      description: "Activities and experiences from api.maio.cv/api/v1/experiences, including boat trips. A boat trip is never the Santiago–Maio ferry. Never invent an operator, contact, price, or activity.",
      inputSchema: z.object({ kind: z.string().max(40).nullable().optional(), name: z.string().max(80).nullable().optional() }),
      execute: async ({ kind, name }) => {
        const result = await readExperiences(fetchImpl);
        const needle = normJoin(blank(kind), blank(name));
        const experiences = needle
          ? result.experiences.filter((item) => item.text.includes(needle.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()))
          : result.experiences;
        const shown = experiences.map(({ text, ...item }) => item);
        return note("get_maio_experiences", { kind: kind ?? null, name: name ?? null }, result.available, { ...result, experiences: shown });
      },
    }),
    get_business: tool({
      description: "Look up one business by name in api.maio.cv businesses. Phones are only those the directory published. Mapped businesses are not the island total.",
      inputSchema: z.object({ query: z.string().min(3).max(80) }),
      execute: async ({ query }) => {
        const result = await readBusinesses(fetchImpl, query);
        return note("get_business", { query }, result.available, result);
      },
    }),
    get_maio_weather: tool({
      description: "Current weather, wind, and sea for Maio in general. Not a surf-spot forecast. Surf schools and lessons are experiences, not this tool.",
      inputSchema: z.object({}),
      execute: async () => {
        const result = await readWeather(fetchImpl, now);
        return note("get_maio_weather", {}, result.available, result);
      },
    }),
  };
}

function normJoin(left?: string, right?: string): string {
  return [left, right].filter((item): item is string => Boolean(item)).join(" ").trim();
}

function noStore(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function handleMaioChat(request: Request, deps: ChatDeps = {}): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return noStore({ error: "Invalid request" }, 413);
  let body: unknown = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  const messages = normalizeMessages(body && typeof body === "object" ? (body as { messages?: unknown }).messages : null);
  const question = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  if (!question) return noStore({ error: "Missing messages" }, 400);

  const locale = localeOf(body, question);
  const now = deps.now ?? new Date();
  const fetchImpl = chatFetch(deps.fetchImpl ?? fetch);
  // The reply review checks names against the venues the API lists now. It runs after the reply, so do not wait here.
  void syncLiveCatalog(deps.fetchImpl ?? fetch).catch(() => {});
  const kind = classifyAsk(question);
  const toolEvents: ToolEvent[] = [];
  const factParts: string[] = [];
  let message = "";
  let citations: Citation[] = [];
  let status = 200;
  let timedOut = false;

  try {
    if (kind !== "open") {
      const grounded = await answerGrounded(kind, question, locale, fetchImpl, now);
      message = grounded.message;
      toolEvents.push(...grounded.toolEvents);
      citations = grounded.citations;
      factParts.push(grounded.facts);
    } else {
      const model = await resolveModel(deps.model);
      const generated = await failFast(generateText({
        model,
        instructions: askInstructions(locale),
        messages,
        tools: chatTools(fetchImpl, now, toolEvents, factParts),
        stopWhen: stepCountIs(3),
        temperature: 0,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(CHAT_TURN_MS),
      }), CHAT_TURN_MS);
      message = generated.text.trim();
      if (!replyUsesListedFacts(message, factParts.join("\n"))) message = safeContactReply(locale);
    }
  } catch (error) {
    timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    status = 502;
    message = "";
  }

  if (status === 200 && !message.trim()) status = 502;
  const payload = {
    message,
    toolEvents,
    citations,
    sources: citations,
    model: CHAT_MODEL,
  };
  const turn = askTurn(body, status, JSON.stringify(payload), timedOut);
  const contacts = directoryContacts(factParts);
  if (turn && contacts) turn.toolFacts = `${turn.toolFacts}\n${contacts}`.slice(0, 8000);
  if (turn) scheduleTurnReview(turn, deps);
  if (status !== 200) return noStore({ error: "Maio could not be reached." }, status);
  return noStore(payload, 200);
}

async function resolveModel(injected: LanguageModel | undefined): Promise<LanguageModel> {
  if (injected) return injected;
  if (process.env.PLAN_MOCK === "1" || !gatewayReady()) {
    throw Object.assign(new Error("gateway unavailable"), { name: "GatewayError" });
  }
  return gateway(CHAT_MODEL);
}
