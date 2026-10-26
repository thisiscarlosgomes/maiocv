"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Locale } from "../../lib/locale";
import { parseTripPlan, type PlanItem, type TripPlan } from "../../lib/trip";
import { planStrings } from "../../lib/trip-strings";
import { samplePlan } from "../../lib/trip-sample";
import { dayLabel } from "../../lib/trip-view";
import { applyEdits, decodeTrip, encodeTrip, nextAlternative, type EditOp } from "../../lib/trip-edit";
import { DayTimeline, RoughAlert, SeaBadge, TripMap } from "./cards";

type Msg = { role: "user" | "assistant"; content: string };

export function Planner({ locale }: { locale: Locale }) {
  const s = planStrings[locale];
  const [messages, setMessages] = useState<Msg[]>([]);
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [day, setDay] = useState(0);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tripRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shared = params.get("trip") ? parseTripPlan(decodeTrip(params.get("trip")!)) : null;
    if (shared) { setPlan(shared); setDay(Math.min(Number(params.get("day") ?? 0) || 0, shared.days.length - 1)); return; }
    if (params.get("demo") === "1") {
      const sample = samplePlan(locale);
      setPlan(sample);
      setDay(Math.min(Number(params.get("day") ?? 0) || 0, sample.days.length - 1));
      setMessages([{ role: "user", content: s.chips[0] }, { role: "assistant", content: locale === "pt" ? "Sexta está agitada, por isso a saída de mar fica para sábado. Aqui está um plano tranquilo." : locale === "fr" ? "Vendredi est agité, la sortie en mer passe donc à samedi. Voici un plan tranquille." : "Friday looks rough, so the sea outing is on Saturday. Here's a slow plan." }]);
    }
  }, [locale, s.chips]);

  async function send(text: string, nextPlan: TripPlan | null = plan) {
    const content = text.trim();
    if (!content || busy) return;
    const conversation: Msg[] = [...messages, { role: "user", content }];
    setMessages(conversation); setDraft(""); setBusy(true); setError(null);
    try {
      const response = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: conversation.slice(-12), plan: nextPlan }) });
      const data = await response.json();
      if (!response.ok) throw new Error();
      const parsed = data.plan ? parseTripPlan(data.plan) : null;
      if (parsed) { setPlan(parsed); setDay((d) => Math.min(d, parsed.days.length - 1)); }
      setMessages([...conversation, { role: "assistant", content: String(data.reply || "") }]);
    } catch {
      setError(s.error); setMessages(messages); setDraft(content);
    } finally { setBusy(false); }
  }

  // Keep the share link in the address bar so a reload or a shared URL brings the plan back.
  useEffect(() => {
    if (!plan) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("demo");
    url.searchParams.set("trip", encodeTrip(plan));
    window.history.replaceState(null, "", url);
  }, [plan]);

  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  function edit(ops: EditOp[]) {
    if (!plan) return;
    const result = applyEdits(plan, ops);
    setNotice(result.errors[0] ?? null);
    if (!result.errors.length) setPlan(result.plan);
  }
  async function share() {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  }
  function renderActions(item: PlanItem) {
    if (!plan || item.kind === "transport") return null;
    const alt = nextAlternative(plan, item);
    return (
      <div className="plan-actions">
        {alt && <button type="button" className="plan-act" onClick={() => edit([{ op: "swap", itemId: item.id, refId: alt }])}>{s.swap}</button>}
        <label className="plan-act plan-act-select">
          <span className="sr-only">{s.moveTo}</span>
          <select value="" onChange={(e) => e.target.value && edit([{ op: "move", itemId: item.id, toDay: Number(e.target.value) }])}>
            <option value="">{s.move}</option>
            {plan.days.map((d, i) => i !== day && <option key={d.date} value={i}>{s.moveTo} {dayLabel(d.date, locale)}</option>)}
          </select>
        </label>
        <button type="button" className="plan-act" onClick={() => edit([{ op: "remove", itemId: item.id }])}>{s.remove}</button>
      </div>
    );
  }

  function submit(event: FormEvent) { event.preventDefault(); void send(draft); }
  function onRequest(_item: PlanItem, _slot: string) {}

  const current = plan?.days[day];
  return (
    <main id="conteudo" className="plan-main" lang={locale}>
      <section className="plan-chat" aria-label="Concierge">
        <header className="plan-head"><h1 className="plan-title">{s.title}</h1><p className="plan-lede">{s.lede}</p></header>
        <div className="plan-messages" aria-live="polite">
          {messages.map((m, i) => <p key={i} className={`plan-msg plan-msg-${m.role}`}>{m.content}</p>)}
          {busy && <p className="plan-msg plan-msg-assistant plan-busy">{s.thinking}</p>}
          {error && <p className="plan-error" role="alert">{error}</p>}
        </div>
        <div className="plan-chips">
          {s.chips.map((chip) => <button key={chip} type="button" className="plan-pill" onClick={() => void send(chip)} disabled={busy}>{chip}</button>)}
        </div>
        <form className="plan-composer" onSubmit={submit}>
          <label className="sr-only" htmlFor="plan-input">{s.placeholder}</label>
          <input id="plan-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={s.placeholder} autoComplete="off" />
          <button type="submit" className="plan-send" disabled={busy || !draft.trim()}>{s.send}</button>
        </form>
      </section>

      <section className="plan-trip" ref={tripRef} aria-label={s.yourTrip}>
        <div className="plan-trip-head"><h2>{plan?.title ?? s.yourTrip}</h2>
          {plan && <button type="button" className="plan-pill" onClick={() => void share()}>{copied ? s.copied : s.share}</button>}</div>
        {!plan || !current ? <p className="plan-empty">{s.empty}</p> : (
          <>
            <div className="plan-tabs" role="tablist">
              {plan.days.map((d, i) => (
                <button key={d.date} role="tab" type="button" aria-selected={i === day} className={`plan-tab${i === day ? " is-active" : ""}`} onClick={() => setDay(i)}>
                  {dayLabel(d.date, locale)}
                </button>
              ))}
            </div>
            <SeaBadge day={current} s={s} />
            <RoughAlert day={current} s={s} />
            {notice && <p className="plan-error" role="alert">{notice}</p>}
            <DayTimeline day={current} locale={locale} s={s} onRequest={onRequest} renderActions={renderActions} />
            <TripMap day={current} locale={locale} s={s} />
            {plan.unmet.length > 0 && <p className="plan-unmet"><strong>{s.unmet}:</strong> {plan.unmet.join(", ")}</p>}
            <p className="plan-foot">{s.exampleData} {s.source}</p>
          </>
        )}
      </section>
    </main>
  );
}
