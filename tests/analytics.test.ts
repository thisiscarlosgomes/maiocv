import { test } from "node:test";
import assert from "node:assert/strict";
import { analyticsAuthorized } from "../lib/analytics-auth.ts";
import { parseAnalyticsEvent, summarizeAnalytics } from "../lib/analytics-model.ts";
const secret = "a".repeat(64);
const auth = (value: string) => `Basic ${Buffer.from(value).toString("base64")}`;
test("analytics admin access fails closed and validates the full credential", () => {
  assert.equal(analyticsAuthorized(null, secret), false);
  assert.equal(analyticsAuthorized(auth(`admin:${secret}`), ""), false);
  assert.equal(analyticsAuthorized(auth(`admin:${secret}`), secret), true);
  assert.equal(analyticsAuthorized(auth(`guest:${secret}`), secret), false);
  assert.equal(analyticsAuthorized(auth("admin:wrong"), secret), false);
  assert.equal(analyticsAuthorized(auth("admin:short"), "short"), false);
});
test("analytics only accepts known pages and never stores query strings or private routes", () => {
  assert.deepEqual(parseAnalyticsEvent({ event: "pageview", path: "/fr/chat" }), { event: "pageview", page: "/chat", locale: "fr" });
  assert.deepEqual(parseAnalyticsEvent({ event: "pageview", path: "/pt" }), { event: "pageview", page: "/", locale: "pt" });
  for (const path of ["/pt/analytics", "/analytics", "/api/chat", "/pt/chat?message=secret", "/unknown", "https://other.test/pt"]) assert.equal(parseAnalyticsEvent({event:"pageview",path}),null);
  assert.equal(parseAnalyticsEvent({event:"chat_answer",path:"/pt/plan"}),null);
  assert.equal(parseAnalyticsEvent({event:"unknown",path:"/pt"}),null);
});
test("dashboard separates page views and tool use and bounds the selected period", () => {
  const result=summarizeAnalytics([
    {day:"2026-11-02",event:"pageview",page:"/chat",locale:"pt",count:3},
    {day:"2026-11-02",event:"chat_answer",page:"/chat",locale:"pt",count:2},
    {day:"2026-10-01",event:"pageview",page:"/",locale:"pt",count:90},
  ],["2026-11-02","2026-11-03"]);
  assert.equal(result.totals.pageview,3);assert.equal(result.totals.chat_answer,2);
  assert.deepEqual(result.daily.map(d=>d.views),[3,0]);assert.deepEqual(result.pages,[["/chat",3]]);
});
