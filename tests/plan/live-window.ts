/**
 * Recorded portal.maio.cv timetable, fetched 2026-11-15.
 * Boats: /api/schedules/boats. Flights: /api/schedules/flights.
 * This is a fixture for the planner, not a live call.
 */

export const LIVE_RETRIEVED = "2026-11-02T14:32:44.512102+00:00";

export const LIVE_BOATS = {
  retrievedAt: LIVE_RETRIEVED,
  schedules: [
    { date: "2026-11-15", from: "Santiago", to: "Maio", departure: "17:00" },
    { date: "2026-11-15", from: "Maio", to: "Santiago", departure: "20:00" },
    { date: "2026-11-18", from: "Santiago", to: "Maio", departure: "07:00" },
    { date: "2026-11-18", from: "Maio", to: "Santiago", departure: "10:00" },
    { date: "2026-11-20", from: "Santiago", to: "Maio", departure: "17:00" },
    { date: "2026-11-20", from: "Maio", to: "Santiago", departure: "20:00" },
  ],
};

export const LIVE_FLIGHTS = {
  retrievedAt: "2026-11-02T14:10:27.461439+00:00",
  routes: {
    rai_mmo: [
      { date: "2026-11-15", from: "RAI", to: "MMO", departure: "16:00", flight: "7B-170" },
      { date: "2026-11-17", from: "RAI", to: "MMO", departure: "11:50", flight: "7B-170" },
      { date: "2026-11-19", from: "RAI", to: "MMO", departure: "14:35", flight: "7B-170" },
      { date: "2026-11-20", from: "RAI", to: "MMO", departure: "16:15", flight: "7B-170" },
      { date: "2026-11-22", from: "RAI", to: "MMO", departure: "16:00", flight: "7B-170" },
    ],
    mmo_rai: [
      { date: "2026-11-15", from: "MMO", to: "RAI", departure: "16:55", flight: "7B-171" },
      { date: "2026-11-17", from: "MMO", to: "RAI", departure: "12:45", flight: "7B-171" },
      { date: "2026-11-19", from: "MMO", to: "RAI", departure: "15:30", flight: "7B-171" },
      { date: "2026-11-20", from: "MMO", to: "RAI", departure: "17:10", flight: "7B-171" },
      { date: "2026-11-22", from: "MMO", to: "RAI", departure: "16:55", flight: "7B-171" },
    ],
  },
  upcoming: {},
};
