import data from "../../data/enrichment/maio-places.json" with { type: "json" };
import { fold } from "./geo.ts";

/**
 * Reviewed secondary data from the public web (data/enrichment/maio-places.json, made by
 * scripts/enrich-places.ts). It only fills fields the Maio API leaves empty: when the API has
 * a value, the API wins. Every value carries the page it came from, and the guide names that
 * source when it uses one. Nothing here is written back to the Maio API.
 */
export const WEB_FIELDS = ["hours", "phone", "website", "description", "village"] as const;
export type WebField = (typeof WEB_FIELDS)[number];
export type WebFact = { value: string; source: string; url: string };
export type WebFacts = Partial<Record<WebField, WebFact>>;
type Entry = { name: string; fields: Partial<Record<WebField, { value: string; sourceUrl: string }>> };
export type EnrichmentFile = { entries: Entry[] };

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

/** Web facts for one place or business, only for fields the Maio data has empty. */
export function webFacts(name: string, maio: Partial<Record<WebField, string | null | undefined>>, file: EnrichmentFile = data as EnrichmentFile): WebFacts | null {
  const entry = file.entries.find((item) => fold(item.name) === fold(name));
  if (!entry) return null;
  const out: WebFacts = {};
  for (const field of WEB_FIELDS) {
    const fact = entry.fields[field];
    if (!fact || (maio[field] ?? "").trim()) continue;
    out[field] = { value: fact.value, source: host(fact.sourceUrl), url: fact.sourceUrl };
  }
  return Object.keys(out).length ? out : null;
}

const timeTokens = (text: string) => text.match(/\b\d{1,2}[:h.]\d{2}\b|\b\d{1,2}\s?(?:am|pm)\b/gi) ?? [];
const digits = (text: string) => text.replace(/\D+/g, "");

/** Did the reply use this web fact for this name? Phone by digits, hours by a time, others by the value. */
export function usesFact(reply: string, name: string, field: WebField, value: string): boolean {
  const text = fold(reply);
  if (!text.includes(fold(name))) return false;
  if (field === "phone") return digits(reply).includes(digits(value).slice(-7));
  if (field === "hours") return timeTokens(value).some((token) => text.includes(fold(token)));
  if (field === "website") return text.includes(host(value).toLowerCase());
  if (field === "village") return text.includes(fold(value));
  return false; // descriptions are paraphrased; not cited on their own
}

/** Web facts the reply used get "Source: <site>." and a source link. */
export function citeWebFacts(reply: string, facts: { name: string; facts: WebFacts }[]): { reply: string; sources: { label: string; url: string; kind: "web" }[] } {
  let out = reply;
  const sources: { label: string; url: string; kind: "web" }[] = [];
  for (const { name, facts: byField } of facts) {
    for (const field of WEB_FIELDS) {
      const fact = byField[field];
      if (!fact || !usesFact(reply, name, field, fact.value)) continue;
      if (!fold(out).includes(fold(fact.source))) out = `${out.replace(/\s+$/, "")} Source: ${fact.source}.`;
      if (!sources.some((item) => item.url === fact.url)) sources.push({ label: fact.source, url: fact.url, kind: "web" });
    }
  }
  return { reply: out, sources };
}
