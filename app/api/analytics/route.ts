import { parseAnalyticsEvent } from "../../../lib/analytics-model";
import { recordAnalytics } from "../../../lib/analytics-store";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 512) return new Response(null, { status: 413 });
  const raw = await request.text();
  if (raw.length > 512) return new Response(null, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
  const event = parseAnalyticsEvent(body);
  if (!event) return new Response(null, { status: 400 });
  try {
    await recordAnalytics(event);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch {
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
