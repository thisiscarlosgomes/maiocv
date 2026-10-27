import type { TripPlan } from "./trip.ts";

// Share link: the whole plan in the URL (no database). base64url of the JSON.
export function encodeTrip(plan: TripPlan): string {
  const bytes = new TextEncoder().encode(JSON.stringify(plan));
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeTrip(value: string): unknown {
  try {
    const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch { return null; }
}
