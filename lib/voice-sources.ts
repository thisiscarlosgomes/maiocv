export type VoiceSource = { title: string; url: string };

// Maio properties, existing transport citations, and original-source hosts
// verified in the public Open API source registry. New domains need review;
// a valid HTTPS URL alone does not establish that it is a Maio data source.
const sourceHosts = new Set([
  "maio.cv",
  "portal.maio.cv",
  "api.maio.cv",
  "visitmaio.com",
  "cvinterilhas.cv",
  "info.flightmapper.net",
  "open-meteo.com",
  "api.open-meteo.com",
  "marine-api.open-meteo.com",
  "air-quality-api.open-meteo.com",
  "edec.cv",
  "enapor.cv",
  "ingtgeo.gov.cv",
  "esmap.org",
  "inforpress.cv",
]);

function sourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\s\u0000-\u001f\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const isAstronomySource = host === "github.com" &&
      (url.pathname === "/cosinekitty/astronomy" || url.pathname.startsWith("/cosinekitty/astronomy/"));
    if (!sourceHosts.has(host) && !isAstronomySource) return null;
    return url.href.length <= 2048 ? url.href : null;
  } catch {
    return null;
  }
}

const maxEvidenceUrls = 64;
const maxPendingCalls = 64;
const maxResultChars = 65_536;
const maxResultNodes = 1024;
const maxResultDepth = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Evidence belongs to one session attempt; reset it on each new user turn. */
export function createVoiceSourceEvidence() {
  const urls = new Set<string>();
  const pending = new Map<string, { service: string; tool: string }>();

  function record(event: unknown) {
    if (!isRecord(event)) return;
    const { tool_call_id: id, service_id: service, tool_name: tool } = event;
    if (typeof id !== "string" || !id || id.length > 256 ||
      typeof service !== "string" || !service || service.length > 256 ||
      typeof tool !== "string" || !tool || tool.length > 256) return;
    if (event.state === "loading") {
      if (pending.size < maxPendingCalls && !pending.has(id)) pending.set(id, { service, tool });
      return;
    }
    if (event.state !== "success" && event.state !== "failure") return;
    const call = pending.get(id);
    pending.delete(id);
    // A completion from an earlier turn, a different call, or a failed tool
    // cannot establish provenance. Tool parameters are never evidence.
    if (!call || call.service !== service || call.tool !== tool || event.state !== "success" || !Array.isArray(event.result)) return;

    let charsLeft = maxResultChars;
    let nodesLeft = maxResultNodes;
    function collect(value: unknown, depth: number) {
      if (depth > maxResultDepth || nodesLeft-- <= 0 || urls.size >= maxEvidenceUrls) return;
      if (typeof value === "string") {
        // Keep the exact returned string, so a model cannot add a path, query,
        // or fragment to a genuine source and have the new URL accepted.
        if (sourceUrl(value)) urls.add(value);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (nodesLeft <= 0 || urls.size >= maxEvidenceUrls) break;
          collect(item, depth + 1);
        }
      } else if (isRecord(value) && value.ok !== false && value.isError !== true) {
        for (const item of Object.values(value)) {
          if (nodesLeft <= 0 || urls.size >= maxEvidenceUrls) break;
          collect(item, depth + 1);
        }
      }
    }

    // The provider sends MCP content blocks, including JSON wrapped in text.
    // Parse only bounded JSON; prose, malformed content and error envelopes
    // cannot supply citations.
    for (const content of event.result.slice(0, 32)) {
      if (charsLeft <= 0 || nodesLeft <= 0 || urls.size >= maxEvidenceUrls) break;
      if (!isRecord(content) || content.type !== "text" || typeof content.text !== "string") continue;
      if (content.text.length > charsLeft) break;
      charsLeft -= content.text.length;
      try {
        collect(JSON.parse(content.text), 0);
      } catch {
        // Invalid or non-JSON text supplies no evidence.
      }
    }
  }

  return {
    urls: urls as ReadonlySet<string>,
    record,
    reset() { urls.clear(); pending.clear(); },
  };
}

/** Require current-turn tool evidence as well as a safe, reviewed host. */
export function parseVoiceSources(parameters: unknown, evidence?: ReadonlySet<string>): VoiceSource[] {
  if (!evidence?.size) return [];
  if (!parameters || typeof parameters !== "object" || !("sources" in parameters) || !Array.isArray(parameters.sources)) return [];
  const sources: VoiceSource[] = [];
  const seen = new Set<string>();
  // Bound both processing and output, even if an agent supplies a huge array.
  for (const item of parameters.sources.slice(0, 10)) {
    if (!item || typeof item !== "object" || typeof item.title !== "string" || typeof item.url !== "string" || !evidence.has(item.url)) continue;
    const title = item.title.slice(0, 200)
      .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
      .replace(/\s+/g, " ").trim();
    const url = sourceUrl(item.url);
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    sources.push({ title, url });
  }
  return sources;
}
