import { parseAnalyticsEvent, type AnalyticsEvent } from "./analytics-model";
export function trackUsage(event: AnalyticsEvent) {
  if (typeof window === "undefined" || navigator.doNotTrack === "1") return;
  if ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return;
  const path = window.location.pathname;
  if (!parseAnalyticsEvent({ event, path })) return;
  void fetch("/api/analytics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, path }), keepalive: true }).catch(() => {});
}
