import { generateText, stepCountIs, tool, type LanguageModel, type ModelMessage } from "ai";
import { z } from "zod";
import { forecastSourceName, loadDailyForecast, maioClock, type DailySea } from "./agora.ts";
import { loadSailings, type Sailing } from "./essentials.ts";
import { EXPERIENCES, FOOD, experience, food, place, parseTripPlan, type TripPlan } from "./trip.ts";
import { TripRequestSchema, buildPlan, seaStatus } from "./trip-planner.ts";

export type ToolEvent = { name: string; ok: boolean; arguments?: unknown; dropped?: string[] };
export type PlanAgentResult = { reply: string; plan: TripPlan | null; toolEvents: ToolEvent[] };
export type PlanDeps = { model: LanguageModel; fetchImpl: typeof fetch; now?: Date };

function weekday(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
}

export function planInstructions(today: string, current: TripPlan | null): string {
  return [
    "You are the Maio island trip concierge on maio.cv. You plan days on Maio, Cabo Verde.",
    `Today in Cabo Verde is ${weekday(today)} ${today}. Resolve relative dates like "Friday" to the next such date.`,
    "Always reply in the guest's language (pt, en or fr) and set locale to match.",
    current ? "The plan below is FIXED. Never change its stops, times or places, and do not build a new one. If the guest asks to change it, say kindly that the plan is fixed, then answer any question they have; they can start a new plan with \"Plan my trip\"." : "For a new trip call propose_itinerary once. Default: start tomorrow, 2 adults, no car, 3 days.",
    current ? "Answer questions about Maio and this trip (beaches, food, kids, sea, what to pack, getting around) from the tools and the plan." : "",
    "Include at most ONE tour or experience in the whole trip; fill other days with beaches, places and meals.",
    "Restaurants are for daytime meals (lunch). Recommend bars only in the evening (19:00 or later).",
    "Use only experience ids returned by search_experiences. Never invent places, operators, contacts or times.",
    "If the guest asks for something that search_experiences does not return (for example nightlife, diving or a dolphin cruise), put it in unmet and say plainly that we don't list it yet.",
    "Ferry or flight arrival: set arrival with dayIndex. Use get_transport for published times; if none are published say so.",
    "You do not book anything and you never mention prices. If asked, say guests arrange directly with the operator; the plan shows a contact only when we have one.",
    "Reply in 2 to 4 short sentences. The plan is shown as a trip page, so do not list every item.",
    current ? `Current plan (JSON): ${JSON.stringify(current)}` : "There is no plan yet.",
  ].filter(Boolean).join("\n");
}

export async function runPlanAgent(messages: ModelMessage[], current: TripPlan | null, deps: PlanDeps): Promise<PlanAgentResult> {
  const today = maioClock(deps.now ?? new Date()).date;
  let plan: TripPlan | null = current;
  const toolEvents: ToolEvent[] = [];
  const forecastCache = new Map<string, Promise<DailySea[]>>();
  const forecast = (start: string, days: number) => {
    const key = `${start}:${days}`;
    if (!forecastCache.has(key)) forecastCache.set(key, loadDailyForecast(deps.fetchImpl, start, days).catch(() => []));
    return forecastCache.get(key)!;
  };
  let sailings: Promise<Sailing[]> | null = null;
  const getSailings = () => (sailings ??= loadSailings(deps.fetchImpl));

  const tools = {
    search_experiences: tool({
      description: "List experiences, food places and beaches on Maio from Visit Maio data. Returns ids to use in the plan.",
      inputSchema: z.object({ kind: z.enum(["sea", "land", "food", "any"]).default("any"), query: z.string().max(60).optional() }),
      execute: async ({ kind, query }) => {
        const q = query?.toLowerCase();
        const match = (text: string) => !q || q.split(/\s+/).some((w) => w.length > 2 && text.toLowerCase().includes(w));
        const exps = kind === "food" ? [] : EXPERIENCES.filter((e) => (kind === "any" || e.kind === kind) && match(`${e.title} ${e.description.en} ${e.description.pt}`))
          .map((e) => ({ id: e.id, title: e.title, kind: e.kind, location: e.location, seaDependent: e.seaDependent, boat: e.boat, minAge: e.example.minAge, slots: e.example.slots, durationMin: e.example.durationMin }));
        const eats = kind === "food" || kind === "any" ? FOOD.filter((f) => match(`${f.title} ${f.description.en}`)).map((f) => ({ id: f.id, title: f.title, location: f.location })) : [];
        toolEvents.push({ name: "search_experiences", ok: true, arguments: { kind, query } });
        return { experiences: exps, food: eats, note: exps.length + eats.length ? undefined : "Nothing matches in Visit Maio data." };
      },
    }),
    get_sea_forecast: tool({
      description: "Daily wave height and wind for Maio (Open-Meteo), up to 7 days.",
      inputSchema: z.object({ startDate: z.string(), days: z.number().int().min(1).max(7) }),
      execute: async ({ startDate, days }) => {
        const rows = await forecast(startDate, days);
        toolEvents.push({ name: "get_sea_forecast", ok: rows.length > 0, arguments: { startDate, days } });
        return rows.map((r) => ({ ...r, status: seaStatus(r) }));
      },
    }),
    get_transport: tool({
      description: "Published ferry sailings (CV Interilhas via portal.maio.cv) for a date. Flights: only status is known.",
      inputSchema: z.object({ date: z.string() }),
      execute: async ({ date }) => {
        const rows = (await getSailings()).filter((s) => s.date === date);
        toolEvents.push({ name: "get_transport", ok: true, arguments: { date } });
        return { sailings: rows, note: rows.length ? undefined : "No sailings published for that date yet." };
      },
    }),
    propose_itinerary: tool({
      description: "Build a day-by-day plan from the guest's request. Returns a summary; the full plan is shown to the guest as cards.",
      inputSchema: TripRequestSchema,
      execute: async (request) => {
        const dropped = request.include.filter((id) => !experience(id));
        const clean = { ...request, include: request.include.filter((id) => experience(id)) };
        plan = buildPlan({ request: clean, forecast: await forecast(clean.startDate, clean.days), sailings: await getSailings(), forecastSource: forecastSourceName });
        toolEvents.push({ name: "propose_itinerary", ok: true, arguments: request, ...(dropped.length ? { dropped } : {}) });
        return summarize(plan);
      },
    }),
  };

  // v3.2: once a plan exists it is fixed. Only read-only tools are offered, so the model can't rebuild or edit it.
  const { propose_itinerary, ...readOnly } = tools;
  const result = await generateText({
    model: deps.model,
    instructions: planInstructions(today, current),
    messages,
    tools: current ? readOnly : { ...readOnly, propose_itinerary },
    stopWhen: stepCountIs(6),
    temperature: 0,
  } as Parameters<typeof generateText>[0]);

  const safe = current ?? (plan ? parseTripPlan(plan) : null);
  return { reply: result.text.trim(), plan: safe, toolEvents };
}

function summarize(plan: TripPlan) {
  return {
    title: plan.title,
    unmet: plan.unmet,
    days: plan.days.map((d) => ({
      date: d.date,
      sea: d.sea?.status ?? "unknown",
      items: d.items.map((i) => `${i.id} ${i.start} ${i.kind}:${i.refId} ${label(i.kind, i.refId)}`),
    })),
  };
}

function label(kind: string, id: string) {
  return kind === "experience" ? experience(id)?.title : kind === "food" ? food(id)?.title : kind === "place" ? place(id)?.name.en : id;
}
