/**
 * Step 4: Parallel enrichment pass. Fills ONLY empty fields of Maio API places and directory businesses
 * (hours, phone, website, short description, village) from the public web, each value with a source URL
 * and a verbatim quote that code re-checks against the fetched page text.
 * Output: data/enrichment/maio-places.json (secondary data; the Maio API always wins). Nothing is written to the Maio API.
 *
 *   node scripts/enrich-places.ts [--only "name,name"] [--limit 10] [--out data/enrichment/maio-places.json]
 * Needs PARALLEL_API_KEY (search + extract) and a model key for the extraction step. Keys are read from env, never printed.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { generateText } from "ai";
import { languageModel } from "../lib/ai-model.ts";
import { loadPlaces, type Place } from "../lib/visitor/places.ts";
import { loadBusinesses } from "../lib/maio-catalog.ts";
import { fold, nearestZone, ZONES } from "../lib/visitor/geo.ts";

/** "15,23018° … norte" / "-23,21263°" or "23,21263° oeste|west" → a point on Maio. */
function coordinates(text: string): { lat: number; lon: number } | null {
  const lat = text.match(/(?:latitude[^\d-]{0,20})?(1[45][.,]\d{3,})\s*°?/i);
  const lon = text.match(/(-?\\?-?2[23][.,]\d{3,})\s*°?\s*(?:ou[^\n]{0,30})?(oeste|west|ouest|w\b)?/i);
  if (!lat || !lon) return null;
  const la = Number(lat[1].replace(",", "."));
  let lo = Number(lon[1].replace(/\\/g, "").replace(",", "."));
  if (lo > 0) lo = -lo;
  return la > 15 && la < 15.4 && lo < -23 && lo > -23.35 ? { lat: la, lon: lo } : null;
}

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const OUT = arg("out") ?? "data/enrichment/maio-places.json";
const only = arg("only")?.split(",").map((item) => fold(item));
const limit = Number(arg("limit") ?? "999");
const KEY = process.env.PARALLEL_API_KEY?.trim();
if (!KEY) throw new Error("PARALLEL_API_KEY is not set");

type Field = "hours" | "phone" | "website" | "description" | "village";
type Entity = { id: string; name: string; kind: string; village: string | null; missing: Field[]; from: "place" | "business" };
type Page = { url: string; title: string; text: string };
type Value = { value: string; sourceUrl: string; quote: string; retrievedAt: string };

const VENUE_KINDS = new Set(["food", "bar", "stay", "experience", "shop"]);

function entities(places: Place[], records: { id: string; name: string; phone: string; location: string; category: string }[]): Entity[] {
  const out = new Map<string, Entity>();
  for (const place of places) {
    const venue = VENUE_KINDS.has(place.kind);
    const missing: Field[] = [];
    if (venue) missing.push("hours");
    if (venue && !place.phone) missing.push("phone");
    if (venue && !place.website) missing.push("website");
    if (!place.description) missing.push("description");
    if (!place.zone) missing.push("village");
    if (missing.length) out.set(fold(place.name), { id: place.id, name: place.name, kind: place.kind, village: place.zone, missing, from: "place" });
  }
  for (const record of records) {
    const key = fold(record.name);
    const existing = out.get(key);
    const missing: Field[] = ["hours"];
    if (!record.phone) missing.push("phone");
    if (!record.location) missing.push("village");
    if (existing) {
      // A place with the same name: the business record may already carry the phone or village.
      existing.missing = existing.missing.filter((field) => !(field === "phone" && record.phone) && !(field === "village" && record.location));
      continue;
    }
    if (places.some((place) => fold(place.name) === key && place.phone) ) missing.splice(missing.indexOf("phone"), 1);
    out.set(key, { id: record.id, name: record.name, kind: record.category || "business", village: record.location || null, missing: [...new Set(missing)].filter(Boolean) as Field[], from: "business" });
  }
  return [...out.values()].filter((item) => item.missing.length);
}

async function parallel(path: string, body: unknown, timeoutMs: number): Promise<any> {
  const response = await fetch(`https://api.parallel.ai${path}`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": KEY! }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`parallel ${path} ${response.status}`);
  return response.json();
}

async function research(entity: Entity): Promise<Page[]> {
  const where = entity.village ? `${entity.village}, Maio island` : "Maio island";
  const search = await parallel("/v1/search", {
    objective: `Find the official contact details, opening hours, website and location of "${entity.name}", a ${entity.kind} in ${where}, Cabo Verde. Only this exact business on Maio island.`,
    search_queries: [`"${entity.name}" Maio Cabo Verde`, `${entity.name} ${entity.village ?? "Vila do Maio"} Maio`],
    advanced_settings: { max_results: 6 },
  }, 30_000);
  const results: { url: string; title?: string; excerpts?: string[] }[] = (search.results ?? []).filter((row: { url?: string }) => row.url);
  // Keep pages that mention the business name; pull fuller text for the top three.
  const named = results.filter((row) => fold(`${row.title ?? ""} ${(row.excerpts ?? []).join(" ")}`).includes(fold(entity.name).split(" ").slice(0, 3).join(" ")));
  const pages: Page[] = named.map((row) => ({ url: row.url, title: row.title ?? "", text: (row.excerpts ?? []).join("\n") }));
  // Directory pages often link to the business's own page (cv.geoview.info/barbearia_dad,…): read that too.
  const slugs = [fold(entity.name).replace(/ /g, "_"), fold(entity.name).replace(/ /g, "-")];
  const linked = new Set<string>();
  for (const row of results) for (const match of (row.excerpts ?? []).join(" ").matchAll(/\(((?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}\/[^)\s]+)\)/gi)) {
    const url = match[1].startsWith("http") ? match[1] : `https://${match[1]}`;
    if (slugs.some((slug) => fold(url).replace(/ /g, "_").includes(slug) || url.toLowerCase().includes(slug))) linked.add(url);
  }
  for (const url of [...linked].slice(0, 2)) if (!pages.some((page) => page.url === url)) pages.push({ url, title: entity.name, text: "" });
  const top = [...named.slice(0, 3).map((row) => row.url), ...[...linked].slice(0, 2)];
  if (top.length) {
    try {
      const extract = await parallel("/v1/extract", { urls: top, objective: `Opening hours, phone number, website, address/village and a short description of ${entity.name} on Maio island, Cabo Verde.` }, 45_000);
      for (const row of extract.results ?? []) {
        const page = pages.find((item) => item.url === row.url) ?? pages.find((item) => item.url.replace(/^https?:\/\//, "") === String(row.url).replace(/^https?:\/\//, ""));
        const text = [...(row.excerpts ?? []), row.full_content ?? ""].join("\n");
        if (page && text) page.text = `${page.text}\n${text}`.slice(0, 12_000);
      }
    } catch { /* search excerpts are enough to try */ }
  }
  return pages.filter((page) => page.text);
}

const model = languageModel(process.env.ENRICH_MODEL ?? "openai/gpt-5-mini");

async function extract(entity: Entity, pages: Page[]): Promise<Partial<Record<Field, { value: string; url: string; quote: string }>>> {
  if (!pages.length) return {};
  const prompt = `You extract facts about ONE business on Maio island, Cabo Verde: "${entity.name}" (${entity.kind}${entity.village ? `, ${entity.village}` : ""}).
Fill only these fields: ${entity.missing.join(", ")}.
Rules: use only the pages below. A value counts only if the page is clearly about this exact business on Maio island (not another island, not a namesake). For each value give the page url and a SHORT verbatim quote (copied exactly, max 200 chars) from that page that contains the value. hours = opening hours as written; phone = as written; website = the business's own site or social page URL that appears in the quote; description = one plain sentence (max 160 chars) summarising what the page says the business is; village = one of ${ZONES.map((zone) => zone.name).join(", ")} (from the address, or from the page's coordinates for this business — then quote the coordinates). Never infer a village from a "nearby places" list. If unsure, leave the field out.
Return JSON only: {"phone": {"value": "...", "url": "...", "quote": "..."}, ...}

${pages.map((page, i) => `--- page ${i + 1}: ${page.url}\n${page.title}\n${page.text.slice(0, 5000)}`).join("\n\n")}`;
  const result = await generateText({ model, prompt, maxRetries: 1, abortSignal: AbortSignal.timeout(90_000) });
  try { return JSON.parse(result.text.slice(result.text.indexOf("{"), result.text.lastIndexOf("}") + 1)); } catch { return {}; }
}

const squash = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
const digits = (text: string) => text.replace(/\D+/g, "");

/** Code re-check of every value: quote really on that page, value really in the quote. */
export function verify(field: Field, raw: { value?: string; url?: string; quote?: string }, pages: Page[], name: string): string | null {
  const value = raw.value?.trim();
  const page = pages.find((item) => item.url === raw.url);
  if (!value || !raw.quote || !page) return "no value/page";
  if (!squash(page.text + " " + page.title).includes(squash(raw.quote))) return "quote not on page";
  const quote = squash(raw.quote);
  if (field === "phone") { const d = digits(value); if (d.length < 7 || !digits(raw.quote).includes(d.slice(-7))) return "phone not in quote"; }
  if (field === "website") { try { const host = new URL(value).hostname.replace(/^www\./, ""); if (!quote.includes(host.toLowerCase()) && raw.url !== value) return "site not in quote"; } catch { return "bad url"; } }
  if (field === "hours" && !/\d/.test(value)) return "hours without times";
  if (field === "hours" && !digits(raw.quote).includes(digits(value).slice(0, 2))) return "hours not in quote";
  if (field === "village") {
    const zone = ZONES.find((item) => fold(item.name) === fold(value));
    if (!zone) return "not a Maio village";
    const named = zone.aliases.some((alias) => fold(raw.quote!).includes(alias));
    // Or the page gives the venue's coordinates, and they fall in that village.
    const point = coordinates(page.text);
    const near = point ? nearestZone(point) : null;
    if (!named && !(near && near.zone.id === zone.id && near.km <= 3)) return "village not in quote";
  }
  if (field === "description" && (value.length > 180 || value.length < 15)) return "description length";
  if (!fold(page.text + " " + page.title).includes(fold(name).split(" ")[0])) return "page does not name it";
  // Same-name venues exist on other islands (a "Jet Ski" page on Sal): the page must be about Maio.
  if (!/\bmaio\b/.test(fold(page.text + " " + page.title + " " + page.url))) return "page is not about Maio";
  return null;
}

const places = await loadPlaces(fetch);
const businesses = await loadBusinesses(fetch);
if (!places.length || businesses.source !== "api") throw new Error("Maio API did not load");
const todo = entities(places, businesses.records).filter((item) => !only || only.includes(fold(item.name))).slice(0, limit);
console.log(`${todo.length} entities with empty fields`);
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
const entries: { id: string; name: string; from: string; fields: Partial<Record<Field, Value>>; rejected: Record<string, string> }[] = [];
const reviewRejected = new Set<string>((previous?.review?.rejected ?? []).map((item: { name: string; field: string; value: string }) => `${fold(item.name)}|${item.field}|${item.value}`));
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < todo.length) {
    const entity = todo[next++];
    try {
      const pages = await research(entity);
      const found = await extract(entity, pages);
      if (process.argv.includes("--debug")) writeFileSync(`/tmp/enrich-debug-${fold(entity.name).replace(/ /g, "-")}.json`, JSON.stringify({ pages, found }, null, 2));
      const fields: Partial<Record<Field, Value>> = {};
      const rejected: Record<string, string> = {};
      for (const field of entity.missing) {
        const raw = found[field];
        if (!raw) continue;
        const why = verify(field, raw, pages, entity.name);
        if (why) { rejected[field] = why; continue; }
        // A reviewer's rejection sticks across re-runs.
        if (reviewRejected.has(`${fold(entity.name)}|${field}|${raw.value!.trim()}`)) { rejected[field] = "rejected in review"; continue; }
        fields[field] = { value: raw.value!.trim(), sourceUrl: raw.url!, quote: raw.quote!.trim(), retrievedAt: new Date().toISOString().slice(0, 10) };
      }
      entries.push({ id: entity.id, name: entity.name, from: entity.from, fields, rejected });
      console.log(`${entity.name}: ${Object.keys(fields).join(", ") || "-"}${Object.keys(rejected).length ? ` (rejected ${JSON.stringify(rejected)})` : ""}`);
    } catch (error) {
      console.log(`${entity.name}: error ${(error as Error).message}`);
    }
  }
}));
entries.sort((a, b) => a.name.localeCompare(b.name));
const filled = entries.reduce((sum, entry) => sum + Object.keys(entry.fields).length, 0);
writeFileSync(OUT, JSON.stringify({
  note: "Secondary data from the public web for EMPTY Maio API fields only. The Maio API always wins; nothing here was written to the Maio API.",
  generatedAt: new Date().toISOString(),
  method: "Parallel Search + Extract, model extraction, code re-check that each quote is on the cited page and contains the value.",
  review: previous?.review ?? { status: "pending", notes: [] },
  checked: todo.length,
  filled,
  entries: entries.filter((entry) => Object.keys(entry.fields).length).map(({ rejected: _rejected, ...entry }) => entry),
}, null, 2) + "\n");
console.log(`filled ${filled} fields across ${entries.filter((entry) => Object.keys(entry.fields).length).length} entities → ${OUT}`);
