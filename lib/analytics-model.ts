export const ANALYTICS_EVENTS = ["pageview", "chat_answer", "voice_connected", "plan_generated"] as const;
export type AnalyticsEvent = typeof ANALYTICS_EVENTS[number];
const pages = new Set(["/", "/chat", "/plan", "/search", "/essentials", "/faq", "/sources", "/privacy", "/terms"]);
export function parseAnalyticsEvent(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const { event, path } = input as Record<string, unknown>;
  if (!ANALYTICS_EVENTS.includes(event as AnalyticsEvent) || typeof path !== "string" || path.length > 120) return null;
  const match = path.match(/^\/(pt|en|fr)(\/.*)?$/);
  const locale = match?.[1] ?? "pt";
  let page = (match ? match[2] || "/" : path).replace(/\/$/, "") || "/";
  if (["essenciais", "essentiels"].includes(page.slice(1))) page = "/essentials";
  if (!pages.has(page)) return null;
  if (event === "chat_answer" && page !== "/chat") return null;
  if (event === "plan_generated" && page !== "/plan") return null;
  return { event: event as AnalyticsEvent, page, locale };
}
export type MetricRow = { day: string; event: AnalyticsEvent; page: string; locale: string; count: number };
export function summarizeAnalytics(rows: MetricRow[], days: string[]) {
  const totals = Object.fromEntries(ANALYTICS_EVENTS.map(event => [event, 0])) as Record<AnalyticsEvent, number>;
  const daily = days.map(day => ({ day, views: 0, actions: 0 }));
  const byDay = new Map(daily.map(d => [d.day, d]));
  const pages = new Map<string, number>();
  const languages = new Map<string, number>();
  for (const row of rows) {
    if (!byDay.has(row.day) || !Number.isFinite(row.count) || row.count < 0 || !ANALYTICS_EVENTS.includes(row.event)) continue;
    totals[row.event] += row.count;
    const day = byDay.get(row.day)!;
    if (row.event === "pageview") {
      day.views += row.count;
      pages.set(row.page, (pages.get(row.page) ?? 0) + row.count);
      languages.set(row.locale, (languages.get(row.locale) ?? 0) + row.count);
    } else day.actions += row.count;
  }
  return { totals, daily, pages: [...pages].sort((a,b) => b[1]-a[1]), languages: [...languages].sort((a,b) => b[1]-a[1]) };
}
