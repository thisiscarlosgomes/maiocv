"use client";

import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import type { Locale } from "../../lib/locale";
import { parseTripPlan, type PlanItem, type TripPlan } from "../../lib/trip";
import { planStrings } from "../../lib/trip-strings";
import { samplePlan } from "../../lib/trip-sample";
import { cardView, dateRange, dayLabel, dayTitle, daySummary, seaLine } from "../../lib/trip-view";
import { decodeTrip, encodeTrip } from "../../lib/trip-edit";
import { describeChanges, type PlanChanges } from "../../lib/trip-changes";
import { DayCards, PlaceDetail, RoughAlert, SeaBadge, TripMap } from "./cards";

type Msg = { role: "user" | "assistant"; content: string; changes?: PlanChanges; failed?: boolean };
const MAX_VERSIONS = 10;

export function Planner({ locale }: { locale: Locale }) {
  const s = planStrings[locale];
  const [messages, setMessages] = useState<Msg[]>([]);
  const [versions, setVersions] = useState<TripPlan[]>([]);
  const plan = versions.length ? versions[versions.length - 1] : null;
  const [updated, setUpdated] = useState<Set<string>>(new Set());
  const [day, setDay] = useState(0);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState(false);
  const [detail, setDetail] = useState<PlanItem | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromLink = params.get("trip") ? parseTripPlan(decodeTrip(params.get("trip")!)) : null;
    const start = fromLink ?? (params.get("demo") === "1" ? samplePlan(locale) : null);
    if (!start) return;
    setVersions([start]);
    setDay(Math.min(Number(params.get("day") ?? 0) || 0, start.days.length - 1));
    setShared(!!fromLink && params.get("view") === "1");
    if (!fromLink) setMessages([{ role: "user", content: s.chips[0] }, { role: "assistant", content: locale === "pt" ? "Um plano tranquilo. O barco fica para sábado, com o mar calmo." : locale === "fr" ? "Un plan tranquille. Le bateau est samedi, mer calme." : "A slow plan. The boat is on Saturday, when the sea is calm." }]);
  }, [locale, s.chips]);

  // Keep the plan in the address bar so a reload brings it back (the share link adds view=1).
  useEffect(() => {
    if (!plan) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("demo");
    url.searchParams.set("trip", encodeTrip(plan));
    url.searchParams.set("day", String(day));
    window.history.replaceState(null, "", url);
  }, [plan, day]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy || shared) return;
    const before = plan;
    const conversation: Msg[] = [...messages, { role: "user", content }];
    setMessages(conversation); setDraft(""); setBusy(true); setError(null);
    try {
      const response = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: conversation.slice(-12).map(({ role, content: c }) => ({ role, content: c })), plan: before }) });
      const data = await response.json();
      if (!response.ok) throw new Error();
      const next = data.plan ? parseTripPlan(data.plan) : null;
      const editFailed = !!before && (data.toolEvents ?? []).some((e: { name: string; ok: boolean }) => e.name === "edit_itinerary" && !e.ok);
      const changes = before && next ? describeChanges(before, next, locale, s) : null;
      if (next && (!before || changes)) {
        setVersions((v) => [...v, next].slice(-MAX_VERSIONS));
        setUpdated(new Set(changes?.ids ?? []));
        setDay(changes ? changes.firstDay : 0);
      }
      const reply = editFailed && !changes ? s.editFailed : String(data.reply || "");
      setMessages([...conversation, { role: "assistant", content: reply, changes: changes ?? undefined, failed: editFailed && !changes }]);
    } catch {
      if (before) setMessages([...conversation, { role: "assistant", content: s.editFailed, failed: true }]);
      else { setError(s.error); setMessages(messages); setDraft(content); }
    } finally { setBusy(false); }
  }

  function undo(index: number) {
    if (versions.length < 2) return;
    setVersions((v) => v.slice(0, -1));
    setUpdated(new Set());
    setMessages((m) => m.map((msg, i) => (i === index ? { ...msg, changes: undefined } : msg)));
  }

  function open(item: PlanItem) {
    setDetail(item);
    setUpdated((u) => { if (!u.has(item.id)) return u; const n = new Set(u); n.delete(item.id); return n; });
  }

  function shareUrl(view: boolean) {
    const url = new URL(window.location.href);
    url.searchParams.delete("demo");
    if (plan) url.searchParams.set("trip", encodeTrip(plan));
    if (view) url.searchParams.set("view", "1"); else url.searchParams.delete("view");
    return url.toString();
  }
  async function share() {
    try { await navigator.clipboard.writeText(shareUrl(true)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { window.prompt(s.share, shareUrl(true)); }
  }
  function copyPlan() { window.location.assign(shareUrl(false)); }
  function exportPdf() {
    const title = document.title;
    if (plan) document.title = `${plan.title} · maio.cv`;
    window.print();
    document.title = title;
  }

  function submit(event: FormEvent) { event.preventDefault(); void send(draft); }
  const current = plan?.days[day];
  const lastChangeIndex = messages.reduce((last, m, i) => (m.changes ? i : last), -1);

  const tools = plan && (
    <div className="plan-trip-tools">
      {!shared && <button type="button" className="plan-btn" onClick={() => void share()}>{copied ? s.copied : s.share}</button>}
      <button type="button" className="plan-btn" onClick={exportPdf}>{s.exportPdf}</button>
    </div>
  );

  return (
    <main id="conteudo" className={`plan-main${shared ? " is-shared" : ""}`} lang={locale}>
      {!shared && (
        <section className="plan-chat" aria-label="Concierge">
          <header className="plan-head"><p className="plan-eyebrow">{s.eyebrow}</p><h1 className="plan-title">{s.title}</h1>{!messages.length && <p className="plan-lede">{s.lede}</p>}</header>
          <div className="plan-messages" aria-live="polite">
            {messages.map((m, i) => (
              <Fragment key={i}>
                <p className={`plan-msg plan-msg-${m.role}${m.failed ? " is-failed" : ""}`}>{m.content}</p>
                {m.changes && (
                  <div className="plan-change">
                    <strong>{m.changes.summary}</strong> · {m.changes.details.join(" · ")}.{" "}
                    {i === lastChangeIndex && versions.length > 1 && <button type="button" className="plan-undo" onClick={() => undo(i)}>{s.undo}</button>}
                  </div>
                )}
              </Fragment>
            ))}
            {busy && <div className="plan-building" role="status"><span className="plan-spinner" aria-hidden="true" />{s.thinking}<span className="plan-skel" /><span className="plan-skel" /></div>}
            {error && <p className="plan-msg is-failed" role="alert">{error}</p>}
          </div>
        </section>
      )}

      {!shared && (
        <section className="plan-compose" aria-label={s.refine}>
          {!plan && <p className="plan-eyebrow">{s.try}</p>}
          <div className="plan-chips">
            {(plan ? s.refineChips : s.chips).map((chip) => <button key={chip} type="button" className="plan-chip" onClick={() => void send(chip)} disabled={busy}>{chip}</button>)}
          </div>
          <form className="plan-composer" onSubmit={submit}>
            <label className="sr-only" htmlFor="plan-input">{plan ? s.followUp : s.placeholder}</label>
            <input id="plan-input" ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={plan ? s.followUp : s.placeholder} autoComplete="off" />
            <button type="submit" className="plan-send" disabled={busy || !draft.trim()} aria-label={s.send}>↑</button>
          </form>
        </section>
      )}

      <section className="plan-trip" aria-label={s.yourTrip}>
        {shared && plan && <p className="plan-eyebrow">{s.sharedPlan}</p>}
        <div className="plan-trip-head">
          <h2>{plan?.title ?? s.yourTrip}</h2>
          {tools}
        </div>
        {shared && plan && <p className="plan-sub">{dateRange(plan.days, locale)} · {s.plannedWith}</p>}
        {!plan || !current ? <p className="plan-empty">{s.empty}</p> : (
          <>
            <div className="plan-tabs" role="tablist">
              {plan.days.map((d, i) => (
                <button key={d.date} role="tab" type="button" aria-selected={i === day} className={`plan-tab${i === day ? " is-active" : ""}`} onClick={() => setDay(i)}>
                  {dayLabel(d.date, locale)} <small>{s.seaShort[d.sea?.status ?? "unknown"]}</small>
                </button>
              ))}
            </div>
            <div className="plan-day">
              <div className="plan-day-head">
                <h3>{dayTitle(current.date, locale)}</h3>
                <span className="plan-day-sum">{daySummary(current, s, plan.hasCar)}</span>
                <SeaBadge day={current} s={s} />
              </div>
              <RoughAlert day={current} s={s} />
              <div className="plan-day-map"><TripMap day={current} locale={locale} s={s} /></div>
              <div className="plan-day-cards"><DayCards day={current} locale={locale} s={s} updated={updated} onOpen={open} /></div>
              {plan.unmet.length > 0 && <p className="plan-unmet"><strong>{s.unmet}:</strong> {plan.unmet.join(", ")}</p>}
              <p className="plan-foot">{s.foot} · {s.forecast}</p>
            </div>
          </>
        )}
      </section>

      {shared && plan && (
        <div className="plan-sharebar">
          <p>🔒 {s.viewOnly}</p>
          <button type="button" className="plan-primary" onClick={copyPlan}>{s.copyPlan}</button>
        </div>
      )}

      {detail && current && <PlaceDetail item={detail} day={plan!.days.find((d) => d.items.some((i) => i.id === detail.id)) ?? current} locale={locale} s={s}
        onClose={() => setDetail(null)} onAsk={shared ? undefined : (text) => { setDetail(null); setDraft(text); setTimeout(() => inputRef.current?.focus(), 0); }} />}

      {plan && <PrintPlan plan={plan} locale={locale} />}
    </main>
  );
}

/** Printable itinerary for Export PDF (window.print → Save as PDF). Hidden on screen. No prices. */
function PrintPlan({ plan, locale }: { plan: TripPlan; locale: Locale }) {
  const s = planStrings[locale];
  return (
    <section className="plan-print" aria-hidden="true">
      <header className="plan-print-head">
        <p className="plan-eyebrow">maio.cv · {s.eyebrow}</p>
        <h1>{plan.title}</h1>
        <p>{dateRange(plan.days, locale)}</p>
      </header>
      {plan.days.map((d) => (
        <article key={d.date} className="plan-print-day">
          <div className="plan-print-dayhead">
            <h2>{dayTitle(d.date, locale)}</h2>
            <p>{daySummary(d, s, plan.hasCar)} · {seaLine(d.sea, s)}</p>
            {d.sea?.status === "rough" && <p className="plan-print-rough">{s.roughAlert}</p>}
          </div>
          <div className="plan-print-grid">
            <ol>
              {d.items.map((item, n) => {
                const v = cardView(item, locale, s);
                if (!v) return null;
                return (
                  <li key={item.id}>
                    <span className="plan-print-time">{item.start}</span>
                    <span className="plan-print-n">{v.lat !== null ? n + 1 : ""}</span>
                    <div><strong>{v.title}</strong><span>{v.meta}</span>{v.description && <span className="plan-print-desc">{v.description}</span>}</div>
                  </li>
                );
              })}
            </ol>
            <TripMap day={d} locale={locale} s={s} caption={false} />
          </div>
        </article>
      ))}
      {plan.unmet.length > 0 && <p><strong>{s.unmet}:</strong> {plan.unmet.join(", ")}</p>}
      <footer className="plan-print-foot">{s.foot} · {s.forecast} · maio.cv</footer>
    </section>
  );
}
