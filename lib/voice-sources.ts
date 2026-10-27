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

/** Validate the show_sources client-tool payload; never fetch or render HTML. */
export function parseVoiceSources(parameters: unknown): VoiceSource[] {
  if (!parameters || typeof parameters !== "object" || !("sources" in parameters) || !Array.isArray(parameters.sources)) return [];
  const sources: VoiceSource[] = [];
  const seen = new Set<string>();
  // Bound both processing and output, even if an agent supplies a huge array.
  for (const item of parameters.sources.slice(0, 10)) {
    if (!item || typeof item !== "object" || typeof item.title !== "string") continue;
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
