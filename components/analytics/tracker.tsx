"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Analytics } from "@vercel/analytics/react";
import { trackUsage } from "../../lib/analytics-client";
import { parseAnalyticsEvent } from "../../lib/analytics-model";
export function SiteAnalytics() {
  const path = usePathname();
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (path === previous.current) return;
    previous.current = path;
    trackUsage("pageview");
  }, [path]);
  return <Analytics beforeSend={event => {
    if (navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return null;
    const url = new URL(event.url);
    if (!parseAnalyticsEvent({ event: "pageview", path: url.pathname })) return null;
    url.search = ""; url.hash = "";
    return { ...event, url: url.toString() };
  }} />;
}
