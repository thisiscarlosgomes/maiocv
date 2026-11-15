/**
 * Public shape of the live-flights payload.
 * This file has no network calls and does not read the API key.
 */

export const ADSB_SOURCE = "adsb.lol" as const;
export const ADSB_LICENSE =
  "Open Data Commons Open Database License (ODbL) v1.0" as const;

export type FlightStatus = "available" | "unavailable" | "unconfigured";

export type LiveAircraft = {
  hex: string;
  callsign: string | null;
  registration: string | null;
  aircraftType: string | null;
  latitude: number;
  longitude: number;
  altitudeFeet: number | null;
  onGround: boolean;
  groundSpeedKnots: number | null;
  trackDegrees: number | null;
  distanceNauticalMiles: number | null;
  seenSeconds: number | null;
  emergency: string | null;
};

export type LiveFlightsPayload = {
  status: FlightStatus;
  stale: boolean;
  source: typeof ADSB_SOURCE;
  license: typeof ADSB_LICENSE;
  location: {
    name: "Ilha do Maio";
    latitude: number;
    longitude: number;
  };
  region: "Cabo Verde";
  radiusNauticalMiles: number;
  retrievedAt: string | null;
  aircraft: LiveAircraft[];
  truncated: boolean;
  caveats: string[];
  retryAfterSeconds: number | null;
};
