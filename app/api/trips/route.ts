import { saveSharedTrip, tripShareStore } from "../../../lib/trip-share-store";

export const runtime = "nodejs";

/** POST { plan, locale } -> { id, path: "/t/<id>" }. The same plan returns the same id. */
export async function POST(request: Request) {
  let body: { plan?: unknown; locale?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "invalid" }, { status: 400 }); }
  try {
    const result = await saveSharedTrip(await tripShareStore(), body?.plan, body?.locale);
    if ("error" in result) return Response.json({ error: result.error }, { status: result.error === "too_large" ? 413 : 400 });
    return Response.json({ id: result.id, path: `/t/${result.id}` }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn(`trip share failed (${error instanceof Error ? error.message : "error"})`);
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
