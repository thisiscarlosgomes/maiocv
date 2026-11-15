import { EMERGENCY } from "./emergency.ts";
import { visibleStopCount } from "./plan-edits.ts";
import { looksLikeItineraryDump, looksLikeSchedule } from "./plan-reply.ts";
import { planQuestionKind } from "./plan-router.ts";
import { EXPERIENCES, FOOD, PLACES, addDays, parseTripPlan, type TripPlan } from "./trip.ts";

/** MongoDB TTL: documents expire 30 days after createdAt. */
export const FLAG_TTL_SECONDS = 30 * 24 * 60 * 60;

export const FLAG_FIELDS = [
  "id", "createdAt", "surface", "locale", "reasons", "userMessage", "context", "botReply",
  "planBefore", "planAfter", "chips", "deploySha", "source", "note", "status", "prUrl", "severity",
] as const;

export type FlagSurface = "plan" | "ask";
export type FlagLocale = "en" | "pt" | "fr";
export type FlagSource = "auto" | "thumbs_down" | "judge";
export type FlagStatus = "new" | "triaged" | "fixed" | "wontfix";
export type FlagSeverity = "low" | "med" | "high";
export type FlagTurn = { role: "user" | "assistant"; content: string };

export type PlanSummary = {
  start: string;
  end: string;
  days: number;
  car: boolean;
  pace: string;
  stops: number;
};

export type FlagRecord = {
  id: string;
  createdAt: string;
  surface: FlagSurface;
  locale: FlagLocale;
  reasons: string[];
  userMessage: string;
  context: string;
  botReply: string;
  planBefore: PlanSummary | null;
  planAfter: PlanSummary | null;
  chips: string[];
  deploySha: string | null;
  source: FlagSource;
  status: FlagStatus;
  note?: string;
  prUrl?: string;
  severity?: FlagSeverity;
};

export type TurnForFlags = {
  surface: FlagSurface;
  locale: FlagLocale;
  userMessage: string;
  previousTurns: FlagTurn[];
  botReply: string;
  planBefore: unknown;
  planAfter: unknown;
  chips: string[];
  /** This turn was meant to build or edit a plan. */
  planTurn: boolean;
  /** Schedules, businesses, and other tool text from this turn. */
  toolFacts: string;
  previousReply?: string;
  failure?: "model_error" | "timeout" | null;
  /** False when the guest was not shown a new plan card. */
  cardShown?: boolean;
  /** The edit the server applied, when this turn was handled in code. */
  appliedEdit?: string | null;
};

const CONTEXT_CHARS = 2000;

export function flagIndexSpec(): { key: { createdAt: 1 }; expireAfterSeconds: number } {
  return { key: { createdAt: 1 }, expireAfterSeconds: FLAG_TTL_SECONDS };
}

export async function applyFlagIndexes(col: { createIndex: (key: { createdAt: 1 }, options: { expireAfterSeconds: number }) => Promise<unknown> }) {
  const spec = flagIndexSpec();
  await col.createIndex(spec.key, { expireAfterSeconds: spec.expireAfterSeconds });
}

export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/[’']/g, "'").toLowerCase();
}

function dayLine(plan: TripPlan, index: number): string {
  const day = plan.days[index];
  if (!day) return "none";
  const stops = day.items
    .filter((item) => item.kind === "place" || item.kind === "food" || item.kind === "experience" || item.kind === "transport" || item.slot === "departure")
    .slice(0, 6)
    .map((item) => `${item.slot ?? item.kind}:${item.refId}${item.start ? `@${item.start}` : ""}`);
  return `${day.date} [${stops.join(", ") || "empty"}]`;
}

/** Compact before/after of the days that actually changed. "no itinerary change" when the card is the same. */
export function planDayDiff(before: unknown, after: unknown): string {
  const left = parseTripPlan(before);
  const right = parseTripPlan(after);
  if (!left && !right) return "no plan";
  if (!left) return "plan created";
  if (!right) return "plan removed";
  const lines: string[] = [];
  if (left.hasCar !== right.hasCar) lines.push(`car ${left.hasCar} -> ${right.hasCar}`);
  if (left.days[0]?.date !== right.days[0]?.date || left.days.length !== right.days.length) {
    lines.push(`span ${left.days[0]?.date ?? "?"} x${left.days.length} -> ${right.days[0]?.date ?? "?"} x${right.days.length}`);
  }
  const count = Math.max(left.days.length, right.days.length);
  for (let index = 0; index < count; index += 1) {
    const from = dayLine(left, index);
    const to = dayLine(right, index);
    if (from !== to) lines.push(`day ${index + 1}: ${from} -> ${to}`);
  }
  return lines.length ? lines.join("; ").slice(0, 700) : "no itinerary change";
}

export function summarizePlan(value: unknown): PlanSummary | null {
  if (isSummary(value)) return value;
  const plan = parseTripPlan(value);
  if (!plan) return null;
  return summaryFromPlan(plan);
}

function summaryFromPlan(plan: TripPlan): PlanSummary {
  return {
    start: plan.days[0].date,
    end: plan.days[plan.days.length - 1].date,
    days: plan.days.length,
    car: plan.hasCar,
    pace: plan.pace ?? "slow",
    stops: visibleStopCount(plan),
  };
}

function isSummary(value: unknown): value is PlanSummary {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.start)
    && typeof row.end === "string"
    && typeof row.days === "number"
    && typeof row.car === "boolean"
    && typeof row.pace === "string"
    && typeof row.stops === "number"
    && !("version" in row);
}

function planKey(value: unknown): string {
  const plan = parseTripPlan(value);
  if (plan) {
    return JSON.stringify({
      start: plan.days[0].date,
      days: plan.days.length,
      car: plan.hasCar,
      pace: plan.pace ?? "slow",
      items: plan.days.map((day) => day.items.map((item) => `${item.kind}:${item.refId}:${item.start ?? ""}:${item.slot ?? ""}`)),
    });
  }
  const summary = summarizePlan(value);
  return summary ? JSON.stringify(summary) : "";
}

function planDates(value: unknown): string[] {
  const plan = parseTripPlan(value);
  if (plan) return plan.days.map((day) => day.date);
  const summary = summarizePlan(value);
  if (!summary) return [];
  return Array.from({ length: Math.max(0, Math.min(14, summary.days)) }, (_, index) => addDays(summary.start, index));
}

/** Previous turns, newest last, capped at four and about 2_000 characters. */
export function trimContext(turns: FlagTurn[]): string {
  const recent = turns.filter((turn) => (turn.role === "user" || turn.role === "assistant") && turn.content.trim()).slice(-4);
  const lines: string[] = [];
  let used = 0;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const line = `${recent[i].role}: ${recent[i].content.replace(/\s+/g, " ").trim()}`.slice(0, 800);
    if (used + line.length > CONTEXT_CHARS && lines.length >= 2) break;
    const room = CONTEXT_CHARS - used;
    if (room <= 0) break;
    const clipped = line.slice(0, room);
    lines.push(clipped);
    used += clipped.length + 1;
    if (lines.length >= 4) break;
  }
  return lines.reverse().join("\n").slice(0, CONTEXT_CHARS);
}

const CLAIMS_CHANGE = /\b(?:moved|added|removed|updated|all set|all done|done|movi|mudei|adicionei|acrescentei|removi|retirei|atualizei|tudo pronto|tudo certo|esta feito|deplace|ajoute|retire|supprime|mis a jour|mise a jour|c'est bon|c'est fait|termine|tout est pret)\b/;

const DENIES_CHANGE = /(?:\bi (?:did not|didn't|have not|haven't) (?:change|changed|update|updated|modify|modified) the plan\b|\bthe plan (?:was not|wasn't|is not|isn't) changed\b|\bnao (?:alterei|mudei|mexi(?: no)?|atualizei) o plano\b|\bo plano nao (?:foi )?(?:alterado|mudou)\b|\bje n'ai pas (?:modifie|change|touche) (?:le |au )?plan\b|\ble plan n'a pas (?:ete )?(?:modifie|change)\b)/;

const EDIT_INTENT = /\b\d+\s*(?:days?|dias?|jours?)\b|\b(?:tomorrow|today|amanha|hoje|demain|aujourd'hui|aujourdhui)\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|domingo|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b|\b(?:move|add|remove|change|swap|update|shorten|extend|muda|altera|acrescenta|adiciona|tira|troca|encurta|ajoute|enleve|retire|raccourcis|deplace|modifie)\b/;

const MONTHS: Record<string, number> = {
  january: 1, janeiro: 1, janvier: 1, jan: 1,
  february: 2, fevereiro: 2, fevrier: 2, feb: 2, fev: 2,
  march: 3, marco: 3, mars: 3, mar: 3,
  april: 4, abril: 4, avril: 4, apr: 4, abr: 4, avr: 4,
  maio: 5, may: 5, mai: 5,
  june: 6, junho: 6, juin: 6, jun: 6,
  july: 7, julho: 7, juillet: 7, jul: 7,
  august: 8, agosto: 8, aout: 8, aug: 8, ago: 8,
  september: 9, setembro: 9, septembre: 9, sept: 9, sep: 9, set: 9,
  october: 10, outubro: 10, octobre: 10, oct: 10, out: 10,
  november: 11, novembro: 11, novembre: 11, nov: 11,
  december: 12, dezembro: 12, decembre: 12, dec: 12, dez: 12,
};

const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})\\s*(?:de\\s+|d')?(${MONTH_ALT})(?:\\s+(?:de\\s+)?(20\\d{2}))?\\b`, "gi");
const MONTH_DAY = new RegExp(`\\b(${MONTH_ALT})\\s+(\\d{1,2})(?:\\s+(20\\d{2}))?\\b`, "gi");

export type ExplicitDate = { month: number; day: number; year?: number };

export function explicitDates(text: string): ExplicitDate[] {
  DAY_MONTH.lastIndex = 0;
  MONTH_DAY.lastIndex = 0;
  const folded = fold(text);
  const found: ExplicitDate[] = [];
  const seen = new Set<string>();
  const add = (month: number, day: number, year?: number) => {
    if (month < 1 || month > 12 || day < 1 || day > 31) return;
    const key = `${year ?? ""}-${month}-${day}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ month, day, ...(year ? { year } : {}) });
  };
  for (const match of folded.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) add(Number(match[2]), Number(match[3]), Number(match[1]));
  for (const match of folded.matchAll(DAY_MONTH)) add(MONTHS[match[2]] ?? 0, Number(match[1]), match[3] ? Number(match[3]) : undefined);
  for (const match of folded.matchAll(MONTH_DAY)) add(MONTHS[match[1]] ?? 0, Number(match[2]), match[3] ? Number(match[3]) : undefined);
  return found;
}

function dateMatches(planDate: string, asked: ExplicitDate): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(planDate);
  if (!match) return false;
  const year = Number(match[1]);
  return Number(match[2]) === asked.month && Number(match[3]) === asked.day && (asked.year === undefined || asked.year === year);
}

const FALLBACKS = new Set([
  "the planner is unavailable. try again.",
  "planner unavailable",
  "an answer could not be loaded. try again.",
  "no answer came back. try again.",
  "the request took too long. you can try again.",
  "maio could not be reached.",
  "the service is busy. try again.",
  "o planeador nao esta disponivel. tente de novo.",
  "nao foi possivel obter uma resposta. tente novamente.",
  "nao recebemos uma resposta. tente novamente.",
  "a consulta demorou demasiado. pode tentar novamente.",
  "nao foi possivel consultar o maio.",
  "o servico esta ocupado. tente novamente.",
  "le planificateur est indisponible. reessayez.",
  "impossible d'obtenir une reponse. reessayez.",
  "aucune reponse n'est arrivee. reessayez.",
  "la demande a pris trop de temps. vous pouvez reessayer.",
  "impossible de joindre maio.",
  "le service est occupe. reessayez.",
  "something went wrong.",
  "something went wrong",
]);

function isGenericFallback(reply: string): boolean {
  const text = fold(reply).trim();
  if (!text) return false;
  if (FALLBACKS.has(text)) return true;
  return /^(?:sorry[, ]*)?(?:something went wrong|an error occurred|model error|request timed out)\b/.test(text);
}

function looksLikePlanSummary(reply: string): boolean {
  const text = fold(reply);
  if (/\b(?:here is the \d+-day plan|aqui esta o plano|voici le plan)\b/.test(text)) return true;
  const dayStop = /\b(?:day|dia|jour)\s+\d+\b/.test(text);
  const clocks = reply.match(/\b\d{1,2}:\d{2}\b/g)?.length ?? 0;
  const stops = /\b(?:beach|praia|plage|lunch|almoco|dejeuner|dinner|jantar|breakfast|pequeno|petit-dejeuner)\b/.test(text);
  // A timetable of clock times is not a plan. A day heading or a stop list is.
  if (dayStop && (clocks >= 1 || stops)) return true;
  if ((looksLikeItineraryDump(reply) || looksLikeSchedule(reply)) && (dayStop || /\b(?:overview|pace\s*:|length\s*:)\b/.test(text))) return true;
  return false;
}

function dayNumbers(text: string): Set<string> {
  return new Set([...text.matchAll(/\b(?:day|dia|jour)\s+(\d+)\b/gi)].map((match) => match[1] ?? ""));
}

/** A question about one day of the open trip. Naming that day is the answer, not a re-emitted plan. */
function oneDayQuestion(text: string): boolean {
  if (planQuestionKind(text)) return true;
  const n = fold(text);
  return /\b(?:day|dia|jour)\s+\d+\b/.test(n) && /\b(?:what|whats|where|which|lunch|almoco|dejeuner|onde|ou )\b/.test(n);
}

function singleDayAnswer(user: string, reply: string): boolean {
  if (!oneDayQuestion(user)) return false;
  if (dayNumbers(reply).size > 1) return false;
  const text = fold(reply);
  if (/\b(?:here is the \d+-day plan|aqui esta o plano|voici le plan|plano de \d+|plan de \d+)\b/.test(text)) return false;
  return true;
}

function earlierUser(turns: FlagTurn[] | undefined): string {
  if (!turns?.length) return "";
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].role === "user") return turns[i].content.trim();
  }
  return "";
}

const EMERGENCY_DIGITS = new Set(EMERGENCY.flatMap((item) => {
  const digits = item.number.replace(/\D/g, "");
  return digits.startsWith("238") ? [digits, digits.slice(3)] : [digits];
}));

function phonesIn(text: string): string[] {
  const found: string[] = [];
  const patterns = [/\+\d{1,3}(?:[\s().-]*\d){6,14}/g, /\b\d{2,4}[\s.-]\d{2,4}[\s.-]\d{2,4}\b/g];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (/^20\d{2}-\d{2}-\d{2}$/.test(match[0])) continue;
      const digits = match[0].replace(/\D/g, "");
      if (digits.length >= 7 && digits.length <= 15) found.push(digits);
    }
  }
  return [...new Set(found.filter((digits) => !found.some((other) => other.length > digits.length && other.includes(digits))))];
}

let knownNames: string[] | null = null;
function catalogNames(): string[] {
  knownNames ??= [
    ...FOOD.map((item) => item.title),
    ...EXPERIENCES.map((item) => item.title),
    ...PLACES.flatMap((item) => [item.name.en, item.name.pt]),
    "Hospital do Maio",
    "Visit Maio",
    "Cabo Verde",
  ];
  return knownNames;
}

function groundedName(name: string, corpus: string): boolean {
  const needle = fold(name).replace(/[^a-z0-9]+/g, " ").trim();
  if (needle.length < 4) return true;
  const hay = fold(`${corpus}\n${catalogNames().join("\n")}`).replace(/[^a-z0-9]+/g, " ");
  return hay.includes(needle);
}

const BUSINESS = /\b(?:Restaurante|Restaurant|Bar|Café|Cafe|Hotel|Pousada|Farmácia|Farmacia|Pharmacie|Padaria)\s+([A-ZÀ-Ý][\p{L}'’.-]+(?:\s+[A-ZÀ-Ý][\p{L}'’.-]+){0,3})/gu;

function inventedContact(reply: string, corpus: string): boolean {
  const hay = corpus.replace(/\D/g, "");
  for (const phone of phonesIn(reply)) {
    const local = phone.startsWith("238") ? phone.slice(3) : phone;
    if (EMERGENCY_DIGITS.has(phone) || EMERGENCY_DIGITS.has(local)) continue;
    if (hay.includes(phone) || (local !== phone && hay.includes(local))) continue;
    return true;
  }
  BUSINESS.lastIndex = 0;
  for (const match of reply.matchAll(BUSINESS)) {
    const full = match[0];
    if (!groundedName(full, corpus) && !groundedName(match[1] ?? "", corpus)) return true;
  }
  return false;
}

/** Server-side checks. Returns reason codes. Empty means the turn is not stored. */
export function inspectTurn(turn: TurnForFlags): string[] {
  const reasons: string[] = [];
  const reply = turn.botReply ?? "";
  const trimmed = reply.trim();
  const asked = fold(turn.userMessage ?? "");
  const said = fold(trimmed);

  if (turn.failure === "timeout") reasons.push("timeout");
  else if (turn.failure === "model_error") reasons.push("model_error");
  if (!trimmed) reasons.push("empty_reply");
  else if (isGenericFallback(trimmed)) reasons.push("generic_fallback");

  if (trimmed && CLAIMS_CHANGE.test(said)) {
    const before = planKey(turn.planBefore);
    const after = planKey(turn.planAfter);
    const changed = before !== after && after !== "";
    const card = turn.cardShown ?? changed;
    if (!changed || !card) reasons.push("claimed_change_unchanged");
  }

  if (trimmed && DENIES_CHANGE.test(said) && (EDIT_INTENT.test(asked) || explicitDates(turn.userMessage ?? "").length > 0)) {
    reasons.push("denied_change_with_intent");
  }

  const changedPlan = planKey(turn.planBefore) !== planKey(turn.planAfter) && planKey(turn.planAfter) !== "";
  const oneDay = singleDayAnswer(turn.userMessage ?? "", trimmed);
  if (!turn.planTurn && trimmed && !oneDay && (looksLikePlanSummary(trimmed) || (turn.cardShown ?? changedPlan))) {
    reasons.push("plan_reemitted");
  }

  const askedDates = explicitDates(turn.userMessage ?? "");
  const planned = planDates(turn.planAfter);
  if (askedDates.length && planned.length && askedDates.some((date) => !planned.some((day) => dateMatches(day, date)))) {
    reasons.push("dates_mismatch");
  }

  const previous = (turn.previousReply ?? "").trim();
  const earlier = fold(earlierUser(turn.previousTurns));
  const differentAsk = earlier.length > 0 && earlier !== asked;
  if (trimmed.length >= 8 && trimmed === previous && differentAsk) reasons.push("repeated_reply");

  if (trimmed && inventedContact(trimmed, turn.toolFacts ?? "")) reasons.push("invented_contact");

  return reasons;
}

export function partyLine(value: unknown): string {
  const plan = parseTripPlan(value);
  if (!plan) return "";
  return `party: ${plan.party.adults} adults, ${plan.party.kids} kids`;
}

/** Copy only the flag fields. Request metadata never enters the record. */
export function publicFlag<T extends Partial<FlagRecord>>(record: T): FlagRecord {
  const source = record as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of FLAG_FIELDS) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out as FlagRecord;
}

export function buildFlag(turn: TurnForFlags, extra: {
  source: FlagSource;
  reasons: string[];
  note?: string;
  severity?: FlagSeverity;
  id?: string;
  now?: Date;
  deploySha?: string | null;
}): FlagRecord {
  const now = extra.now ?? new Date();
  const note = extra.note?.replace(/\s+/g, " ").trim().slice(0, 300);
  const record: FlagRecord = {
    id: extra.id ?? crypto.randomUUID(),
    createdAt: now.toISOString(),
    surface: turn.surface,
    locale: turn.locale,
    reasons: extra.reasons.map((reason) => reason.replace(/\s+/g, " ").trim().slice(0, 200)).filter(Boolean).slice(0, 8),
    userMessage: (turn.userMessage ?? "").trim().slice(0, 2000),
    context: trimContext(turn.previousTurns ?? []),
    botReply: (turn.botReply ?? "").trim().slice(0, 4000),
    planBefore: summarizePlan(turn.planBefore),
    planAfter: summarizePlan(turn.planAfter),
    chips: (turn.chips ?? []).filter((chip): chip is string => typeof chip === "string").map((chip) => chip.trim().slice(0, 80)).filter(Boolean).slice(0, 8),
    deploySha: (extra.deploySha ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "").trim().slice(0, 64) || null,
    source: extra.source,
    status: "new",
  };
  if (note) record.note = note;
  if (extra.severity) record.severity = extra.severity;
  return publicFlag(record);
}

export type FlagPost = {
  surface: FlagSurface;
  locale: FlagLocale;
  userMessage: string;
  previousTurns: FlagTurn[];
  botReply: string;
  planBefore: unknown;
  planAfter: unknown;
  chips: string[];
  note?: string;
};

export function parseFlagPost(body: unknown): FlagPost | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  const surface = row.surface === "plan" || row.surface === "ask" ? row.surface : null;
  const locale = row.locale === "en" || row.locale === "pt" || row.locale === "fr" ? row.locale : null;
  if (!surface || !locale) return null;
  if (typeof row.userMessage !== "string" || typeof row.botReply !== "string") return null;
  const userMessage = row.userMessage.trim().slice(0, 2000);
  const botReply = row.botReply.trim().slice(0, 4000);
  if (!userMessage || !botReply) return null;
  const previousTurns = Array.isArray(row.previousTurns) ? row.previousTurns.flatMap((turn) => {
    if (!turn || typeof turn !== "object") return [];
    const item = turn as Record<string, unknown>;
    const role: FlagTurn["role"] | null = item.role === "user" ? "user" : item.role === "assistant" ? "assistant" : null;
    if (!role || typeof item.content !== "string") return [];
    const content = item.content.trim().slice(0, 2000);
    return content ? [{ role, content }] : [];
  }).slice(-4) : [];
  const chips = Array.isArray(row.chips) ? row.chips.filter((chip): chip is string => typeof chip === "string").slice(0, 8) : [];
  const note = typeof row.note === "string" ? row.note : undefined;
  return { surface, locale, userMessage, previousTurns, botReply, planBefore: row.planBefore ?? null, planAfter: row.planAfter ?? null, chips, ...(note ? { note } : {}) };
}

export function conversationContext(messages: { role: string; content?: unknown }[]): { userMessage: string; previousTurns: FlagTurn[]; previousReply: string } {
  const turns: FlagTurn[] = messages.flatMap((message) => {
    const role = message.role === "user" || message.role === "assistant" ? message.role : null;
    if (!role || typeof message.content !== "string") return [];
    const content = message.content.trim();
    return content ? [{ role, content }] : [];
  });
  let userAt = -1;
  for (let i = turns.length - 1; i >= 0; i -= 1) if (turns[i].role === "user") { userAt = i; break; }
  const userMessage = userAt >= 0 ? turns[userAt].content : "";
  const previousTurns = turns.slice(Math.max(0, userAt - 4), Math.max(0, userAt));
  let previousReply = "";
  for (let i = userAt - 1; i >= 0; i -= 1) if (turns[i].role === "assistant") { previousReply = turns[i].content; break; }
  return { userMessage, previousTurns, previousReply };
}
