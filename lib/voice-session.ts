import { createHash } from "node:crypto";
import { isIP } from "node:net";

const TOKEN_ENDPOINT = "https://api.elevenlabs.io/v1/convai/conversation/token";
const MAX_REQUEST_BYTES = 1024;
const COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_ENTRIES = 1024;
const MAX_DURATION_SECONDS = 60;

type VoiceSessionConfig = {
  apiKey?: string;
  agentId?: string;
  trustVercelHeaders?: boolean;
};

type Dependencies = {
  fetcher?: typeof fetch;
  now?: () => number;
  getConfig?: () => VoiceSessionConfig;
  upstreamTimeoutMs?: number;
};

function json(body: object, status = 200, retryAfter?: number) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Vary": "Origin",
      ...(retryAfter === undefined ? {} : { "Retry-After": String(retryAfter) }),
    },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return origin === new URL(request.url).origin && (!fetchSite || fetchSite === "same-origin");
}

async function readBoundedJson(message: Request | Response, maxBytes: number): Promise<unknown> {
  const contentLength = message.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) {
    throw new Error("Body exceeds limit");
  }
  if (!message.body) throw new Error("Missing body");
  const reader = message.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("Body exceeds limit");
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

function clientKey(request: Request, trustVercelHeaders: boolean) {
  // Only trust forwarding headers when Vercel is the ingress. Local requests
  // share a bucket because Web Request does not expose the socket address.
  const forwarded = trustVercelHeaders
    ? request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for")
    : null;
  const ip = forwarded?.split(",")[0]?.trim();
  return createHash("sha256").update(ip && isIP(ip) ? ip : "shared-unknown-client").digest("hex");
}

export function createVoiceSessionHandler(dependencies: Dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? Date.now;
  const getConfig = dependencies.getConfig ?? (() => ({
    apiKey: process.env.ELEVENLABS_API_KEY,
    agentId: process.env.ELEVENLABS_AGENT_ID,
    trustVercelHeaders: process.env.VERCEL === "1",
  }));
  // A bounded, per-process cooldown only. Cold starts and multiple instances
  // reset or split this state; production spending controls need shared storage.
  const cooldowns = new Map<string, number>();

  return async function handleVoiceSession(request: Request): Promise<Response> {
    if (request.method !== "POST") return json({ error: "invalid_request" }, 405);
    if (!sameOrigin(request)) return json({ error: "invalid_request" }, 403);
    if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
      return json({ error: "invalid_request" }, 415);
    }

    let body: unknown;
    try {
      body = await readBoundedJson(request, MAX_REQUEST_BYTES);
    } catch {
      return json({ error: "invalid_request" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).length !== 1 || !("locale" in body) ||
        typeof body.locale !== "string" || !["pt", "en", "fr"].includes(body.locale)) {
      return json({ error: "invalid_request" }, 400);
    }

    const config = getConfig();
    const apiKey = config.apiKey?.trim();
    const agentId = config.agentId?.trim();
    if (!apiKey || /[\r\n]/.test(apiKey) || !agentId || !/^[A-Za-z0-9_-]{1,200}$/.test(agentId)) {
      return json({ error: "unavailable" }, 503);
    }

    const time = now();
    for (const [key, expires] of cooldowns) {
      if (expires <= time) cooldowns.delete(key);
    }
    const key = clientKey(request, config.trustVercelHeaders === true);
    const expires = cooldowns.get(key);
    if (expires !== undefined) {
      return json({ error: "rate_limited" }, 429, Math.ceil((expires - time) / 1000));
    }
    if (cooldowns.size >= MAX_COOLDOWN_ENTRIES) return json({ error: "rate_limited" }, 429, 30);
    // Reserve before awaiting the vendor so concurrent requests cannot mint
    // multiple tokens. Failed attempts also retain the short cooldown.
    cooldowns.set(key, time + COOLDOWN_MS);

    const url = new URL(TOKEN_ENDPOINT);
    url.searchParams.set("agent_id", agentId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), dependencies.upstreamTimeoutMs ?? 10_000);
    try {
      // The locale is applied by the browser's conversation-start override;
      // ElevenLabs' token endpoint does not accept a language parameter.
      const response = await fetcher(url, {
        method: "GET",
        headers: { "xi-api-key": apiKey, "Accept": "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status === 429) return json({ error: "rate_limited" }, 429, 30);
      if (!response.ok) return json({ error: "upstream" }, 502);
      const result = await readBoundedJson(response, 32_768);
      const token = result && typeof result === "object" && "token" in result ? result.token : null;
      if (typeof token !== "string" || !token || token.length > 16_384 || /\s/.test(token)) {
        return json({ error: "upstream" }, 502);
      }
      // This is the UI limit. Set the same limit on the ElevenLabs agent to
      // enforce conversation duration independently of browser timers.
      return json({ token, maxDurationSeconds: MAX_DURATION_SECONDS });
    } catch {
      return json({ error: "upstream" }, controller.signal.aborted ? 504 : 502);
    } finally {
      clearTimeout(timeout);
    }
  };
}
