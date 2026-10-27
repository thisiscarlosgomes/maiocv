"use client";

import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import type { Locale } from "../../lib/locale";
import { parseTripPlan, type PlanDay, type PlanItem, type TripPlan } from "../../lib/trip";
import { planStrings, type PlanStrings } from "../../lib/trip-strings";
import { samplePlan } from "../../lib/trip-sample";
import { cardView, dateRange, dayParts, seaLine, timeSpan } from "../../lib/trip-view";
import { decodeTrip, encodeTrip } from "../../lib/trip-share";
import { DayMap, DayStops, PlaceDetail, RoughAlert, SafeImg, SeaText } from "./cards";

// v3.3: conversational start, compact rows, mono dates. One vertical trip. The plan is fixed once generated; the chat only answers questions.
type Msg = { role: "user" | "assistant"; content: string; trip?: boolean };
type Screen = "chat" | "trip";

const cover = (plan: TripPlan, locale: Locale, s: PlanStrings) => {
  for (const d of plan.days) for (const i of d.items) { const v = cardView(i, locale, s); if (v?.image) return v.image; }
  return null;
};
const meta = (plan: TripPlan, locale: Locale, s: PlanStrings) => `${dateRange(plan.days, locale)} · ${s.people(plan.party.adults + plan.party.kids)}`;
const stopCount = (plan: TripPlan) => plan.days.reduce((n, d) => n + d.items.filter((i) => i.kind !== "transport").length, 0);

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
  const [mapDay, setMapDay] = useState<PlanDay | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
  }, [locale, s]);

  // Keep the plan and the view in the address bar so a reload (or a screenshot) lands in the same place.
  useEffect(() => {
    if (!plan) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("demo");
    url.searchParams.set("trip", encodeTrip(plan));
    if (screen === "trip" && !shared) url.searchParams.set("screen", "trip"); else url.searchParams.delete("screen");
    window.history.replaceState(null, "", url);
  }, [plan, screen, shared]);

  function setScreen(next: Screen) { setScreenState(next); window.scrollTo(0, 0); }

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy || shared) return;
    const conversation: Msg[] = [...messages, { role: "user", content }];
    setMessages(conversation); setDraft(""); setBusy(true); setError(null);
    if (screen === "trip") setScreen("chat");
    try {
      const response = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: conversation.slice(-12).map(({ role, content: c }) => ({ role, content: c })), plan }) });
      const data = await response.json();
      if (!response.ok) throw new Error();
      // Fixed plan: only the first plan is accepted. Anything the server sends later is ignored.
      const next = !plan && data.plan ? parseTripPlan(data.plan) : null;
      if (next) setPlan(next);
      setMessages([...conversation, { role: "assistant", content: String(data.reply || ""), trip: !!next }]);
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
  function submit(event: FormEvent) { event.preventDefault(); void send(draft); }

  const asked = new Set(messages.filter((m) => m.role === "user").map((m) => m.content));
  const suggestions = plan ? s.questions.filter((q) => !asked.has(q)).slice(0, 2) : s.startChips;
  const detailDay = detail && plan ? plan.days.find((d) => d.items.some((i) => i.id === detail.id)) : null;

  const composer = !shared && (
    <div className="plan-dock">
      <form className="plan-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="plan-input">{plan ? s.ask : s.placeholder}</label>
        <input id="plan-input" ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={plan ? s.ask : s.placeholder} autoComplete="off" />
        <button type="submit" className="plan-send" disabled={busy || !draft.trim()} aria-label={s.send}>↑</button>
      </form>
    </div>
  );

  return (
    <main id="conteudo" className={`plan-main plan-screen-${screen}${shared ? " is-shared" : ""}`} lang={locale}>
      {screen === "chat" && !shared && (
        <section className="plan-chat" aria-label="Concierge">
          <h1 className="sr-only">{s.title}</h1>
          <div className="plan-messages" aria-live="polite">
            {!messages.length && <p className="plan-msg plan-msg-assistant plan-greet">{s.greeting}</p>}
            {messages.map((m, i) => (
              <Fragment key={i}>
                <p className={`plan-msg plan-msg-${m.role}`}>{m.content}</p>
                {m.trip && plan && <TripCard plan={plan} locale={locale} s={s} onOpen={() => setScreen("trip")} />}
              </Fragment>
            ))}
            {busy && !plan && <PlanProgress steps={s.progress} />}
            {busy && plan && <p className="plan-thinking" role="status"><span className="plan-spinner" aria-hidden="true" />{s.thinking}</p>}
            {error && <p className="plan-msg is-failed" role="alert">{error}</p>}
          </div>
          {!busy && suggestions.length > 0 && (
            <div className={`plan-chips${plan ? " is-questions" : ""}`} aria-label={plan ? s.ask : s.try}>
              {suggestions.map((chip) => <button key={chip} type="button" className="plan-chip" onClick={() => void send(chip)}>{chip}</button>)}
            </div>
          )}
        </section>
      )}

      {screen === "trip" && plan && (
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
            <section key={d.date} className="plan-day" aria-labelledby={`day-${d.date}`}>
              <div className="plan-day-head">
                <h2 id={`day-${d.date}`}><span className="mono">{dayParts(d.date, locale).short}</span> <span className="plan-weekday">{dayParts(d.date, locale).weekday}</span></h2>
                <SeaText day={d} s={s} />
              </div>
              <RoughAlert day={d} s={s} />
              <DayStops day={d} locale={locale} s={s} onOpen={(item) => setDetail(item)} />
              <button type="button" className="plan-daymap" onClick={() => setMapDay(d)}>{s.viewDayMap}</button>
            </section>
          ))}
          {plan.unmet.length > 0 && <p className="plan-unmet"><strong>{s.unmet}:</strong> {plan.unmet.join(", ")}</p>}
          <p className="plan-foot">{s.foot} · {s.forecast}</p>
        </section>
      )}

      {composer}

      {shared && plan && (
        <div className="plan-sharebar">
          <p>{s.wantOwn}</p>
          <a className="plan-primary" href={window.location.pathname}>{s.planMine}</a>
        </div>
      )}

      {detail && detailDay && <PlaceDetail item={detail} day={detailDay} locale={locale} s={s}
        onClose={() => setDetail(null)} onAsk={shared ? undefined : (text) => { setDetail(null); setDraft(text); setTimeout(() => inputRef.current?.focus(), 0); }} />}
      {mapDay && <DayMap day={mapDay} locale={locale} s={s} onClose={() => setMapDay(null)} />}

      {plan && <PrintPlan plan={plan} locale={locale} />}
    </main>
  );
}

/** The trip in the chat (v3.3 mini card): 64 thumbnail, title, mono dates · stops, "Open trip". */
function TripCard({ plan, locale, s, onOpen }: { plan: TripPlan; locale: Locale; s: PlanStrings; onOpen: () => void }) {
  const img = cover(plan, locale, s);
  return (
    <div className="plan-tripcard">
      <SafeImg className="plan-tripcard-img" src={img} />
      <div><p className="plan-tripcard-title">{plan.title}</p><p className="plan-tripcard-meta mono">{dateRange(plan.days, locale)} · {stopCount(plan)} {s.stops}</p></div>
      <button type="button" className="plan-primary" onClick={onOpen}>{s.openTrip}</button>
    </div>
  );
}

/** Building state: steps tick off on a timer while the first plan is made, then a cover skeleton. */
function PlanProgress({ steps }: { steps: string[] }) {
  const [done, setDone] = useState(0);
  useEffect(() => { const t = setInterval(() => setDone((n) => Math.min(n + 1, steps.length - 1)), 1200); return () => clearInterval(t); }, [steps.length]);
  return (
    <div className="plan-progress" role="status">
      <ol>
        {steps.map((step, i) => (
          <li key={step} className={i < done ? "is-done" : i === done ? "is-now" : ""}>
            {i < done ? <span className="plan-tick" aria-hidden="true">✓</span> : i === done ? <span className="plan-spinner" aria-hidden="true" /> : <span className="plan-tick" aria-hidden="true" />}
            {step}
          </li>
        ))}
      </ol>
      <span className="plan-skel" aria-hidden="true" />
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
