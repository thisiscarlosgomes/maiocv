/**
 * Visitor-question evals for the Maio guide.
 *   node scripts/visitor-evals.ts --local                 run runPlanAgent in-process (needs OPENAI_API_KEY)
 *   node scripts/visitor-evals.ts --base https://host     POST each case to <host>/api/plan
 * Options: --only id1,id2  --concurrency 4  --out file.json
 * Checks: answered the question (LLM judge), no car question up front, no plan started, every named
 * place exists in the Maio API (or is island geography), nearby answers stay in the guest's area.
 */
import { generateText, type LanguageModel } from "ai";
import { writeFileSync } from "node:fs";
import { languageModel } from "../lib/ai-model.ts";
import { fold, haversineKm, ZONES } from "../lib/visitor/geo.ts";
import { sendsToOffice } from "../lib/visitor/scrub.ts";
import { findPlace, loadPlaces, type Place } from "../lib/visitor/places.ts";
import { VISITOR_CASES, type VisitorCase } from "../tests/visitor-evals/questions.ts";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const base = flag("--base");
const local = args.includes("--local");
const only = flag("--only")?.split(",");
const concurrency = Number(flag("--concurrency") ?? 4);
const out = flag("--out");
const bypass = process.env.VERCEL_BYPASS_SECRET;
/** --vercel-scope <team>: reach a protected preview through `vercel curl` with the CLI's own login. */
const vercelScope = flag("--vercel-scope");

type Turn = { role: "user" | "assistant"; content: string };
type Answer = { reply: string; plan: unknown; cards: { name: string; area: string | null }[]; task?: string; ms: number; status: number };

let runLocal: ((messages: Turn[], task: unknown) => Promise<Answer & { taskObj?: unknown }>) | null = null;
if (local) {
  const { runPlanAgent } = await import("../lib/plan-agent.ts");
  const { emptyTask } = await import("../lib/awareness/task.ts");
  const model = languageModel(process.env.PLAN_MODEL ?? "openai/gpt-5-mini");
  const sideModel = languageModel(process.env.PLAN_SIDE_MODEL ?? "openai/gpt-5-nano");
  runLocal = async (messages, task) => {
    const t0 = Date.now();
    const locale = (task as { locale?: string } | null)?.locale;
    const result = await runPlanAgent(messages, null, { model, sideModel, fetchImpl: fetch }, (task as never) ?? emptyTask((locale as never) ?? "en"));
    return { reply: result.reply, plan: result.plan, cards: result.cards ?? [], ms: Date.now() - t0, status: 200, taskObj: result.task };
  };
}

async function ask(messages: Turn[], locale: string, task: unknown): Promise<Answer & { taskObj?: unknown }> {
  if (runLocal) {
    const { emptyTask } = await import("../lib/awareness/task.ts");
    return runLocal(messages, task ?? emptyTask(locale as never));
  }
  const t0 = Date.now();
  const payload = JSON.stringify({ messages, locale, ...(typeof task === "string" ? { task } : {}) });
  if (vercelScope) {
    const { execFile } = await import("node:child_process");
    // The CLI can hit Deployment Protection with a stale token (a 401 with no body): retry those, and say so if they persist.
    let body: Record<string, unknown> = {};
    let code = 0;
    for (let attempt = 0; attempt < 3 && !body.reply; attempt++) {
      const text = await new Promise<string>((resolve, reject) => execFile("vercel", ["curl", `${base}/api/plan`, "--scope", vercelScope, "--", "--silent", "--max-time", "60", "--write-out", "\n%{http_code}", "--request", "POST", "--header", "Content-Type: application/json", "--data", payload], { maxBuffer: 4_000_000, timeout: 90_000 }, (error, stdout) => (error && !stdout ? reject(error) : resolve(stdout))));
      const cut = text.lastIndexOf("\n");
      code = Number(text.slice(cut + 1).trim()) || 0;
      try { body = JSON.parse(text.slice(text.indexOf("{"), cut)); } catch { body = {}; }
      if (code === 200) break;
    }
    return { reply: String(body.reply ?? ""), plan: body.plan ?? null, cards: Array.isArray(body.cards) ? body.cards as Answer["cards"] : [], task: typeof body.task === "string" ? body.task : undefined, ms: Date.now() - t0, status: code || 502 };
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (bypass) { headers["x-vercel-protection-bypass"] = bypass; headers["x-vercel-set-bypass-cookie"] = "true"; }
  const response = await fetch(`${base}/api/plan`, { method: "POST", headers, body: JSON.stringify({ messages, locale, ...(typeof task === "string" ? { task } : {}) }), signal: AbortSignal.timeout(60_000) });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { reply: String(body.reply ?? ""), plan: body.plan ?? null, cards: Array.isArray(body.cards) ? body.cards as Answer["cards"] : [], task: typeof body.task === "string" ? body.task : undefined, ms: Date.now() - t0, status: response.status };
}

/** Island and travel geography that is not a listed venue. */
const GEOGRAPHY = /^(?:the |village of |villages of |city of |town of |island of |ilha do |vila de )?(maio|cabo verde|cape verde|praia|santiago|sal|boa vista|boavista|sao vicente|santo antao|fogo|brava|sao nicolau|lisbon|lisboa|lisbonne|portugal|london|paris|europe|france|uk|mindelo|cvsky|cv interilhas|interilhas|kriola|tap|cabo verde airlines|binter|bestfly|fmb|fundacao maio biodiversidade|maio biodiversity foundation|unesco|nelson mandela|amilcar cabral|aeroporto|airport|aerodromo|norte|north|south|west|east|north coast|east coast|west coast|south coast|mercado|market|salinas?|salt pans?|dunes?|calheta|morro|morrinho|vila|porto ingles|the town|town|vila do maio|cidade do porto ingles|upper calheta|lower calheta|calheta de baixo|calheta de cima|ribeira d joao|ribeira dom joao)(?: island| town| village| area| harbour| harbor| port| pier)?$/;

/** Never in a reply: a made-up office, raw listing wording, superlatives pinned on "most visitors". Kept in step with lib/visitor/scrub.ts. */
const LEAKS: [string, RegExp][] = [
  ["tourist-office", { test: (reply: string) => reply.split(/(?<=[.!?])\s+/).some(sendsToOffice) } as RegExp],
  ["raw-listing", /location not listed|\(listed\)|listed as an? ["“]|"[^"]*not listed[^"]*"|\blisting(?:s)? (?:say|says|show|shows|data)\b/i],
  ["unsupported-superlative", /\b(?:most|many|all) (?:visitors|people|travell?ers|tourists|guests|locals) (?:call|consider|say|rate|agree|think)|widely (?:considered|regarded)|everyone (?:says|calls|agrees)/i],
];

let judge: LanguageModel | null = null;
async function grade(c: VisitorCase, reply: string): Promise<{ answered: boolean; reason: string; places: string[] }> {
  judge ??= languageModel(process.env.EVAL_JUDGE_MODEL ?? "openai/gpt-5-mini");
  const prompt = `A visitor asked a travel guide for the island of Maio (Cabo Verde): "${c.q}"${c.history ? ` (earlier they said: ${c.history.join(" / ")})` : ""}.
The guide replied: """${reply}"""
Return JSON only: {"answered": true|false, "reason": "<short>", "places": ["..."]}
- answered: true if the reply directly answers or substantively addresses what was asked (a recommendation, the fact, or an honest "not listed" plus the closest useful info). false if it dodges, only asks questions back, starts planning a trip instead, or answers a different question.
- places: every PROPER NAME of a specific venue, restaurant, bar, hotel/stay, shop, business, tour operator, beach, monument, natural site or village named in the reply, exactly as written. Exclude islands, countries, cities outside Maio, airlines, ferry companies, organisations and generic descriptions (e.g. "main square", "the road", "small bars"). Drop parenthetical notes.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await generateText({ model: judge, prompt, maxRetries: 1, abortSignal: AbortSignal.timeout(40_000) });
      const json = JSON.parse(result.text.slice(result.text.indexOf("{"), result.text.lastIndexOf("}") + 1));
      return { answered: Boolean(json.answered), reason: String(json.reason ?? ""), places: Array.isArray(json.places) ? json.places.map(String) : [] };
    } catch { /* retry once */ }
  }
  return { answered: false, reason: "judge failed", places: [] };
}

function firstSentence(text: string): string {
  const match = text.trim().match(/^[\s\S]*?[.!?](?:\s|$)/);
  return (match ? match[0] : text).trim();
}

const CAR = /\b(car|cars|carro|voiture|4x4|drive|driving|rent|alug|location)\b/i;

function locate(places: Place[], raw: string): { place: Place | null; geography: boolean } {
  const name = raw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (/fmb|biodiversi|unesco|nelson mandela|amilcar cabral|praia airport|international airport|sotavento|seafront|waterfront|health cent|hospital|harbou?r|\bport\b|porto ingl|\bpier\b|turtle|bird|wildlife|saltworks|salt ?pans?|^ferry$|airport taxi|^pizzeria in /i.test(name)) return { place: null, geography: true };
  const place = findPlace(places, name);
  if (place) return { place, geography: false };
  const n = fold(name);
  const alias = ZONES.some((zone) => zone.aliases.includes(n.replace(/^(?:the|village of|villages of|city of|town of|vila de)\s+/, "")) || fold(zone.name) === n);
  if (alias || GEOGRAPHY.test(n)) return { place: null, geography: true };
  // Loose: every long word of the name appears in one listed name.
  const words = n.split(" ").filter((word) => word.length >= 4);
  const loose = places.find((item) => words.length > 0 && words.every((word) => fold(`${item.name} ${item.namePt}`).includes(word)));
  return { place: loose ?? null, geography: false };
}

function areaOk(place: Place, notArea: string[]): boolean {
  if (place.lat === null || place.lon === null) return true;
  for (const id of notArea) {
    const zone = ZONES.find((item) => item.id === id);
    if (!zone) continue;
    // In the forbidden village: within 2.5 km of its anchor and closer to it than to any other.
    const km = haversineKm(place as { lat: number; lon: number }, zone);
    if (km <= 2.5 && place.zoneId === id) return false;
  }
  return true;
}

type Row = { id: string; q: string; reply: string; ms: number; pass: boolean; fails: string[]; places: string[]; cards: string[] };

async function runCase(c: VisitorCase, places: Place[]): Promise<Row> {
  const locale = c.locale ?? "en";
  const messages: Turn[] = [];
  let task: unknown = undefined;
  for (const earlier of c.history ?? []) {
    messages.push({ role: "user", content: earlier });
    const first = await ask(messages, locale, task);
    messages.push({ role: "assistant", content: first.reply || "OK." });
    task = runLocal ? first.taskObj : first.task;
  }
  messages.push({ role: "user", content: c.q });
  let answer: Answer;
  try { answer = await ask(messages, locale, task); } catch (error) { return { id: c.id, q: c.q, reply: `ERROR ${(error as Error).message}`, ms: 0, pass: false, fails: ["error"], places: [], cards: [] }; }
  const fails: string[] = [];
  const reply = answer.reply.trim();
  if (answer.status !== 200) fails.push(`http-${answer.status}`);
  else if (!reply) fails.push("no-reply");
  if (/can't reach the model|não chego ao modelo|n'atteins pas le modèle|could not be reached/i.test(reply)) fails.push("fallback");
  const lead = firstSentence(reply);
  if (lead.endsWith("?")) fails.push("leads-with-question");
  if (CAR.test(lead) && lead.includes("?")) fails.push("car-question-first");
  if (answer.plan) fails.push("started-plan");
  if (c.open && /\b(how many days|quantos dias|combien de jours|which dates|que datas|quelles dates|when do you arrive)\b/i.test(reply)) fails.push("asks-trip-details");
  if (c.mention && !c.mention.test(fold(reply)) && !c.mention.test(reply)) fails.push(`missing:${c.mention.source}`);
  const graded = reply ? await grade(c, reply) : { answered: false, reason: "empty", places: [] };
  if (!graded.answered) fails.push(`not-answered(${graded.reason})`);
  for (const name of graded.places) {
    const hit = locate(places, name);
    if (!hit.place && !hit.geography) fails.push(`invented:${name}`);
    // Two listings can share a name ("Cadjetinha Beach" in Vila and in Morrinho): any matching listing in the right area is fine.
    const candidates = hit.place ? places.filter((item) => item === hit.place || findPlace([item], name.replace(/\([^)]*\)/g, " ").trim())) : [];
    const inArea = !c.notArea?.length || candidates.some((item) => areaOk(item, c.notArea!) || !["food", "bar", "beach", "stay", "shop", "sight"].includes(item.kind));
    if (hit.place && !inArea) fails.push(`wrong-area:${name}@${hit.place.zone}`);
  }
  for (const [kind, pattern] of LEAKS) if (pattern.test(reply)) fails.push(`leak:${kind}`);
  if (c.forbid && c.forbid.test(reply)) fails.push(`forbidden:${c.forbid.source}`);
  return { id: c.id, q: c.q, reply, ms: answer.ms, pass: fails.length === 0, fails, places: graded.places, cards: answer.cards.map((card) => `${card.name}${card.area ? ` (${card.area})` : ""}`) };
}

const places = await loadPlaces(fetch);
if (!places.length) throw new Error("Maio API places did not load");
const cases = VISITOR_CASES.filter((c) => !only || only.includes(c.id));
const rows: Row[] = [];
let next = 0;
await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => {
  while (next < cases.length) {
    const c = cases[next++];
    const row = await runCase(c, places);
    rows.push(row);
    console.log(`${row.pass ? "PASS" : "FAIL"} ${row.id} (${row.ms}ms)${row.pass ? "" : ` ${row.fails.join("; ")}`}\n   Q: ${row.q}\n   A: ${row.reply.replace(/\s+/g, " ").slice(0, 400)}${row.cards.length ? `\n   cards: ${row.cards.join(" | ")}` : ""}`);
  }
}));
const passed = rows.filter((row) => row.pass).length;
const ms = rows.map((row) => row.ms).sort((a, b) => a - b);
console.log(`\nVISITOR EVALS ${passed}/${rows.length} passed (${Math.round(100 * passed / rows.length)}%). median ${ms[Math.floor(ms.length / 2)]}ms, p90 ${ms[Math.floor(ms.length * 0.9)]}ms`);
const tally = new Map<string, number>();
for (const row of rows) for (const fail of row.fails) { const key = fail.split(/[:(]/)[0]; tally.set(key, (tally.get(key) ?? 0) + 1); }
console.log("failure kinds:", JSON.stringify(Object.fromEntries(tally)));
if (out) writeFileSync(out, JSON.stringify({ target: base ?? "local", passed, total: rows.length, rows: rows.sort((a, b) => a.id.localeCompare(b.id)) }, null, 2));
