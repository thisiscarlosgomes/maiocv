import { NextResponse } from "next/server";
import {
  cacheControlFor,
  emptyFlights,
  loadCaboVerdeFlights,
  sharedAdsbCache,
} from "../../../lib/adsb/flights";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = Date.now();
  try {
    const payload = await loadCaboVerdeFlights({
      now,
      env: process.env,
      fetchImpl: fetch,
      cache: sharedAdsbCache,
    });
    return NextResponse.json(payload, {
      status: 200,
      headers: { "Cache-Control": cacheControlFor(payload) },
    });
  } catch {
    const payload = emptyFlights("unavailable", now);
    return NextResponse.json(payload, {
      status: 200,
      headers: { "Cache-Control": cacheControlFor(payload) },
    });
  }
}
