"use client";

import { trackUsage } from "../../lib/analytics-client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Locale } from "../../lib/locale";
import { parseTripPlan, type PlanItem, type TripPlan } from "../../lib/trip";
import { planStrings, type PlanStrings } from "../../lib/trip-strings";
import { samplePlan } from "../../lib/trip-sample";
import { cardView, dateRange, dayParts, seaLine, timeSpan, visibleStops } from "../../lib/trip-view";
import { decodeTrip, encodeTrip } from "../../lib/trip-share";
import { DayStops, PlaceDetail, RoughAlert, SafeImg, SeaText } from "./cards";
import { ChatShell } from "../chat/shell";
import { emptyTask, parseGuestChip, refreshTask } from "../../lib/awareness/task";
import { keepAssistantReply } from "../../lib/plan-edits";
import { loadingStatus, turnWork } from "../../lib/plan-status";

// The signed task lives in this tab. Corrections replace the plan; the share link stays ?trip=.
const TASK_KEY = "maio.plan.task";
type Msg = { role: "user" | "assistant"; content: string; trip?: boolean };
type Screen = "chat" | "trip";

const cover = (plan: TripPlan, locale: Locale, s: PlanStrings) => {
  for (const d of plan.days) for (const i of d.items) { const v = cardView(i, locale, s); if (v?.image) return v.image; }
  return null;
};
const meta = (plan: TripPlan, locale: Locale, s: PlanStrings) => `${dateRange(plan.days, locale)} · ${s.people(plan.party.adults + plan.party.kids)}`;
const stopCount = (plan: TripPlan) => plan.days.reduce((n, day) => n + visibleStops(day.items), 0);

export function Planner({ locale }: { locale: Locale }) {
  const s = planStrings[locale];
  const [messages, setMessages] = useState<Msg[]>([]);
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [screen, setScreenState] = useState<Screen>("chat");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState(false);
  const [detail, setDetail] = useState<PlanItem | null>(null);
  const hadPlan = useRef(false);
  const printOnOpen = useRef(false);
  const [printNonce, setPrintNonce] = useState(0);
  const [busyLabel, setBusyLabel] = useState(s.thinking);
  const [copied, setCopied] = useState(false);
  const [taskBlob, setTaskBlob] = useState<string | null>(null);
  const [chips, setChips] = useState<string[]>([]);

  function writeTask(value: string | null) {
    setTaskBlob(value);
    try {
      if (value) window.sessionStorage.setItem(TASK_KEY, value);
      else window.sessionStorage.removeItem(TASK_KEY);
    } catch { /* private mode: the tab simply has no task */ }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromLink = params.get("trip") ? parseTripPlan(decodeTrip(params.get("trip")!)) : null;
    const start = fromLink ?? (params.get("demo") === "1" ? samplePlan(locale) : null);
    if (!start) return;
    setPlan(start);
    const isShared = !!fromLink && params.get("view") === "1";
    setShared(isShared);
    setScreenState(isShared || params.get("screen") === "trip" ? "trip" : "chat");
    if (!isShared) setMessages([{ role: "user", content: s.chips[0] }, { role: "assistant", content: s.demoReply, trip: true }]);
    const open = params.get("stop");
    if (open) setDetail(start.days.flatMap((d) => d.items).find((i) => i.id === open) ?? null);
    try { setTaskBlob(window.sessionStorage.getItem(TASK_KEY)); } catch { /* ignore */ }
  }, [locale, s]);

  // Keep the plan and the view in the address bar so a reload (or a screenshot) lands in the same place.
  useEffect(() => {
    if (plan) hadPlan.current = true;
    else if (hadPlan.current) {
      hadPlan.current = false;
      const url = new URL(window.location.href);
      url.searchParams.delete("trip");
      url.searchParams.delete("screen");
      window.history.replaceState(null, "", url);
    }
    if (!plan) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("demo");
    url.searchParams.set("trip", encodeTrip(plan));
    if (screen === "trip" && !shared) url.searchParams.set("screen", "trip"); else url.searchParams.delete("screen");
    window.history.replaceState(null, "", url);
  }, [plan, screen, shared]);

  function setScreen(next: Screen) { setScreenState(next); window.scrollTo(0, 0); }

  useLayoutEffect(() => {
    if (screen !== "trip") return;
    const pane = document.querySelector<HTMLElement>(".plan-main .chat-conversation");
    if (pane) pane.scrollTop = 0;
    window.scrollTo(0, 0);
  }, [screen]);

  function hintTask() {
    if (!plan) return emptyTask(locale);
    return refreshTask({
      ...emptyTask(plan.locale),
      objective: plan.title,
      constraints: {
        dates: { start: plan.days[0]?.date, days: plan.days.length },
        party: plan.party,
        car: plan.hasCar,
        pace: plan.pace === "normal" ? "packed" : "slow",
      },
      completed: ["itinerary"],
    });
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy || shared) return;
    const exporting = parseGuestChip(content)?.kind === "pdf" && !!plan;
    if (exporting) {
      printOnOpen.current = true;
      setScreen("trip");
      setPrintNonce((nonce) => nonce + 1);
    }
    const conversation: Msg[] = [...messages, { role: "user", content }];
    setMessages(conversation); setDraft(""); setBusyLabel(loadingStatus(locale, turnWork(content, hintTask(), new Date().toISOString().slice(0, 10)))); setBusy(true); setError(null);
    if (!exporting && screen === "trip") setScreen("chat");
    try {
      const response = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: conversation.slice(-25).map(({ role, content: c }) => ({ role, content: c })), plan, locale, ...(taskBlob ? { task: taskBlob } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error();
      if (typeof data.task === "string") writeTask(data.task);
      if (Array.isArray(data.chips)) setChips(data.chips.filter((chip: unknown): chip is string => typeof chip === "string"));
      const next = data.plan ? parseTripPlan(data.plan) : null;
      const changed = !!next && JSON.stringify(next) !== JSON.stringify(plan);
      if (data.intent === "new_objective" && !next) setPlan(null);
      else if (changed && next) { if (!plan) trackUsage("plan_generated"); setPlan(next); }
      const reply = String(data.reply || "");
      const previous = [...messages].reverse().find((message) => message.role === "assistant")?.content ?? null;
      if (keepAssistantReply(previous, reply, changed)) {
        setMessages([...conversation, { role: "assistant", content: reply, trip: changed }]);
      }
    } catch {
      setError(s.error); setMessages(messages); setDraft(content);
    } finally { setBusy(false); }
  }

  function shareUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("demo"); url.searchParams.delete("screen"); url.searchParams.delete("stop");
    if (plan) url.searchParams.set("trip", encodeTrip(plan));
    url.searchParams.set("view", "1");
    return url.toString();
  }
  async function share() {
    try { await navigator.clipboard.writeText(shareUrl()); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { window.prompt(s.share, shareUrl()); }
  }
  function exportPdf() {
    const title = document.title;
    if (plan) document.title = `${plan.title} · maio.cv`;
    window.print();
    document.title = title;
  }

  useEffect(() => {
    if (!printOnOpen.current || screen !== "trip") return;
    printOnOpen.current = false;
    const id = window.setTimeout(() => exportPdf(), 50);
    return () => window.clearTimeout(id);
  }, [screen, printNonce]);
  function startOver() {
    writeTask(null);
    setMessages([]);
    setPlan(null);
    setChips([]);
    setError(null);
    setDraft("");
    setScreenState("chat");
    const url = new URL(window.location.href);
    url.searchParams.delete("trip");
    url.searchParams.delete("screen");
    url.searchParams.delete("stop");
    url.searchParams.delete("demo");
    window.history.replaceState(null, "", url);
  }

  const suggestions = messages.length === 0 && !plan ? s.startChips : chips;
  const detailDay = detail && plan ? plan.days.find((d) => d.items.some((i) => i.id === detail.id)) : null;

  return (
    <ChatShell
      id="plan"
      locale={locale}
      welcome={s.greeting}
      logLabel={s.title}
      placeholder={plan ? s.ask : s.placeholder}
      thinking={busyLabel}
      sendLabel={s.send}
      sendingLabel={s.thinking}
      inputId="plan-input"
      note={s.foot}
      suggestions={suggestions.map((label) => ({ label }))}
      suggestionsWhen={messages.length > 0 ? "always" : "empty"}
      messages={messages.map((m) => ({
        role: m.role,
        content: m.content,
        lead: m.trip && plan ? <TripCard plan={plan} locale={locale} s={s} onOpen={() => setScreen("trip")} /> : undefined,
      }))}
      draft={draft}
      busy={busy}
      error={error ?? undefined}
      onDraft={setDraft}
      onSend={(text) => { void send(text); }}
      onClear={!shared && (messages.length > 0 || plan) ? startOver : undefined}
      clearLabel={s.startOver}
      clearVariant="text"
      composer={!shared}
      className={`plan-main plan-screen-${screen}${shared ? " is-shared" : ""}`}
      stage={screen === "trip" && plan ? (
        <section className="plan-trip" aria-label={s.yourTrip}>
          {!shared && <button type="button" className="plan-back" onClick={() => setScreen("chat")}>← {s.backToChat}</button>}
          {shared && <p className="plan-eyebrow">{s.sharedPlan}</p>}
          <div className="plan-trip-head">
            <div>
              <h1>{plan.title}</h1>
              <p className="plan-sub mono">{meta(plan, locale, s)}</p>
            </div>
            <div className="plan-trip-tools">
              {!shared && <button type="button" className="plan-btn" onClick={() => void share()}>{copied ? s.copied : s.share}</button>}
              <button type="button" className="plan-btn" onClick={exportPdf}>{s.exportPdf}</button>
            </div>
          </div>
          {plan.days.map((d) => (
            <section key={d.date} className="plan-day" data-testid="plan-day" aria-labelledby={`day-${d.date}`}>
              <div className="plan-day-head">
                <h2 id={`day-${d.date}`}><span className="mono">{dayParts(d.date, locale).short}</span> <span className="plan-weekday">{dayParts(d.date, locale).weekday}</span></h2>
                <SeaText day={d} s={s} />
              </div>
              <RoughAlert day={d} s={s} />
              <DayStops day={d} hasCar={plan.hasCar} locale={locale} s={s} onOpen={(item) => setDetail(item)} />
            </section>
          ))}
          {plan.unmet.length > 0 && <p className="plan-unmet"><strong>{s.unmet}:</strong> {plan.unmet.join(", ")}</p>}
          <p className="plan-foot">{s.foot} · {s.forecast}</p>
        </section>
      ) : undefined}
    >
      {shared && plan && (
        <div className="plan-sharebar">
          <p>{s.wantOwn}</p>
          <a className="plan-primary" href={window.location.pathname}>{s.planMine}</a>
        </div>
      )}
      {detail && detailDay && <PlaceDetail item={detail} day={detailDay} locale={locale} s={s}
        onClose={() => setDetail(null)} onAsk={shared ? undefined : (text) => { setDetail(null); setDraft(text); setTimeout(() => document.getElementById("plan-input")?.focus(), 0); }} />}
      {plan && <PrintPlan plan={plan} locale={locale} />}
    </ChatShell>
  );
}

/** The trip in the chat (v3.3 mini card): 64 thumbnail, title, mono dates · stops, "Open trip". */
function TripCard({ plan, locale, s, onOpen }: { plan: TripPlan; locale: Locale; s: PlanStrings; onOpen: () => void }) {
  const img = cover(plan, locale, s);
  return (
    <div className="plan-tripcard" data-testid="plan-trip-card">
      <SafeImg className="plan-tripcard-img" src={img} />
      <div><p className="plan-tripcard-title">{plan.title}</p><p className="plan-tripcard-meta mono">{dateRange(plan.days, locale)} · {stopCount(plan)} {s.stops}</p></div>
      <button type="button" className="plan-primary" onClick={onOpen}>{s.openTrip}</button>
    </div>
  );
}

/** Printable itinerary for Export PDF (window.print → Save as PDF). Hidden on screen. No prices, no maps:
 *  each row carries its location text. Normal flow so @page margins hold; rows never split. */
function PrintPlan({ plan, locale }: { plan: TripPlan; locale: Locale }) {
  const s = planStrings[locale];
  return (
    <section className="plan-print" aria-hidden="true">
      <style>{`@media print { @page { @bottom-left { content: ${JSON.stringify(`${plan.title} · maio.cv`)}; } } }`}</style>
      <header className="plan-print-head">
        <p className="plan-eyebrow">maio.cv · {s.tripPlan}</p>
        <h1>{plan.title}</h1>
        <p className="mono">{meta(plan, locale, s)} · {stopCount(plan)} {s.stops}</p>
      </header>
      {plan.days.map((d) => {
        const p = dayParts(d.date, locale);
        return (
          <article key={d.date} className="plan-print-day">
            <div className="plan-print-dayhead">
              <h2><span className="mono">{p.short}</span> <span className="plan-weekday">{p.weekday}</span></h2>
              <p>{seaLine(d.sea, s)}{d.sea?.status === "rough" ? ` · ${s.noBoat}` : ""}</p>
            </div>
            <ol>
              {d.items.map((item) => {
                const v = cardView(item, locale, s);
                if (!v) return null;
                return (
                  <li key={item.id}>
                    <span className="plan-print-time mono">{timeSpan(item)}</span>
                    <div><strong>{v.title}</strong><span>{v.meta}</span></div>
                  </li>
                );
              })}
            </ol>
          </article>
        );
      })}
      {plan.unmet.length > 0 && <p className="plan-print-unmet"><strong>{s.unmet}:</strong> {plan.unmet.join(", ")}</p>}
      <footer className="plan-print-foot">{s.foot} · {s.forecast} · maio.cv</footer>
    </section>
  );
}
