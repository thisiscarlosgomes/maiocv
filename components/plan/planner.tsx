"use client";

import { trackUsage } from "../../lib/analytics-client";
import { summarizePlan } from "../../lib/chat-flags";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Locale } from "../../lib/locale";
import { parseTripPlan, type PlanItem, type TripPlan } from "../../lib/trip";
import { planStrings, type PlanStrings } from "../../lib/trip-strings";
import { samplePlan } from "../../lib/trip-sample";
import { coverImage, stopImage } from "../../lib/stop-image";
import { cardView, dateRange, dayParts, seaLine, timeSpan, visibleStops } from "../../lib/trip-view";
import { decodeTrip, encodeTrip } from "../../lib/trip-share";
import { SafeImg } from "../stop-photo";
import { DayStops, PlaceDetail, RoughAlert, SeaText } from "./cards";
import { ChatShell } from "../chat/shell";
import { PlaceCards, type ChatPlaceCard } from "./place-cards";
import { PlaceMap, type MapHere } from "./place-map";
import { emptyTask, parseGuestChip, refreshTask } from "../../lib/awareness/task";
import { keepAssistantReply } from "../../lib/plan-edits";
import { paceLines, planTurn, pushStatusPlay, readPlanEvents, startStatusPlay, tickStatusPlay, type StatusPlay } from "../../lib/plan-status";

// The signed task lives in this tab. Corrections replace the plan; the share link stays ?trip=.
const TASK_KEY = "maio.plan.task";
type Msg = { role: "user" | "assistant"; content: string; trip?: boolean; cards?: ChatPlaceCard[]; here?: MapHere | null; flag?: { planBefore: ReturnType<typeof summarizePlan>; planAfter: ReturnType<typeof summarizePlan>; chips: string[] } };
type Screen = "chat" | "trip";

const cover = (plan: TripPlan) => coverImage(plan.days.flatMap((day) => day.items));
const meta = (plan: TripPlan, locale: Locale, s: PlanStrings) => `${dateRange(plan.days, locale)} · ${s.people(plan.party.adults + plan.party.kids)}`;
const stopCount = (plan: TripPlan) => plan.days.reduce((n, day) => n + visibleStops(day.items), 0);

/** `sharedPlan`: a stored trip from a short /t/<id> link, shown read-only like ?trip=…&view=1. */
export function Planner({ locale, sharedPlan }: { locale: Locale; sharedPlan?: TripPlan }) {
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
  const [busyLabel, setBusyLabel] = useState("");
  const play = useRef<StatusPlay | null>(null);
  const shownLabel = useRef("");
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

  const shortLinks = useRef(new Map<string, string>());

  useEffect(() => {
    if (sharedPlan) {
      setPlan(sharedPlan);
      setShared(true);
      setScreenState("trip");
      return;
    }
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
  }, [locale, s, sharedPlan]);

  // Keep the plan and the view in the address bar so a reload (or a screenshot) lands in the same place.
  useEffect(() => {
    if (sharedPlan) return; // The short link is already the address.
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
  }, [plan, screen, shared, sharedPlan]);

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
    const today = new Date().toISOString().slice(0, 10);
    const paced = paceLines(locale, planTurn(content, hintTask(), today, { hasPlan: Boolean(plan), plan }));
    const showStatus = (next: StatusPlay) => {
      play.current = next;
      if (next.label === shownLabel.current) return;
      shownLabel.current = next.label;
      setBusyLabel(next.label);
    };
    showStatus(startStatusPlay(paced.lines, paced.blocked, performance.now()));
    setMessages(conversation); setDraft(""); setBusy(true); setError(null);
    if (!exporting && screen === "trip") setScreen("chat");
    let stopped = false;
    const timer = window.setInterval(() => {
      if (stopped || !play.current) return;
      const next = tickStatusPlay(play.current, performance.now());
      if (next !== play.current) showStatus(next);
    }, 80);
    try {
      const response = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({ messages: conversation.slice(-25).map(({ role, content: c }) => ({ role, content: c })), plan, locale, stream: true, ...(taskBlob ? { task: taskBlob } : {}) }) });
      const data = await readPlanEvents(response, (text) => {
        if (stopped || !play.current) return;
        showStatus(pushStatusPlay(play.current, text, performance.now()));
      });
      if (typeof data.task === "string") writeTask(data.task);
      const nextChips = Array.isArray(data.chips) ? data.chips.filter((chip: unknown): chip is string => typeof chip === "string") : chips;
      if (Array.isArray(data.chips)) setChips(nextChips);
      const next = data.plan ? parseTripPlan(data.plan) : null;
      const changed = !!next && JSON.stringify(next) !== JSON.stringify(plan);
      const cleared = data.intent === "new_objective" && !next;
      if (cleared) setPlan(null);
      else if (changed && next) { if (!plan) trackUsage("plan_generated"); setPlan(next); }
      const reply = String(data.reply || "");
      const previous = [...messages].reverse().find((message) => message.role === "assistant")?.content ?? null;
      if (keepAssistantReply(previous, reply, changed)) {
        const planAfter = cleared ? null : changed && next ? next : plan;
        const cards = Array.isArray(data.cards) ? (data.cards as ChatPlaceCard[]).filter((card) => card && typeof card.name === "string").slice(0, 4) : [];
        const here = readHere(data.here);
        setMessages([...conversation, { role: "assistant", content: reply, trip: changed, ...(cards.length ? { cards, here } : {}), flag: { planBefore: summarizePlan(plan), planAfter: summarizePlan(planAfter), chips: nextChips } }]);
      }
    } catch {
      setError(s.error); setMessages(messages); setDraft(content);
    } finally {
      stopped = true;
      window.clearInterval(timer);
      play.current = null;
      shownLabel.current = "";
      setBusy(false);
    }
  }

  function shareUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("demo"); url.searchParams.delete("screen"); url.searchParams.delete("stop");
    if (plan) url.searchParams.set("trip", encodeTrip(plan));
    url.searchParams.set("view", "1");
    return url.toString();
  }
  /** maio.cv/t/<id>: the plan stored server-side. The same plan reuses its id. Falls back to the long link. */
  async function shortShareUrl(): Promise<string> {
    if (!plan) return shareUrl();
    const key = JSON.stringify(plan);
    const known = shortLinks.current.get(key);
    if (known) return known;
    try {
      const res = await fetch("/api/trips", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan, locale }) });
      const data = res.ok ? await res.json() as { path?: string } : null;
      if (!data?.path) return shareUrl();
      const url = `${window.location.origin.replace("://www.", "://")}${data.path}`; // https://maio.cv/t/<id>
      shortLinks.current.set(key, url);
      return url;
    } catch { return shareUrl(); }
  }
  async function share() {
    const pending = shortShareUrl();
    try {
      // Safari only lets a click write the clipboard if the write starts inside the click.
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": pending.then((text) => new Blob([text], { type: "text/plain" })) })]);
      } else {
        await navigator.clipboard.writeText(await pending);
      }
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch { window.prompt(s.share, await pending); }
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
      sendingLabel={busyLabel || s.send}
      inputId="plan-input"
      note={s.foot}
      suggestions={suggestions.map((label) => ({ label }))}
      suggestionsWhen={messages.length > 0 ? "always" : "empty"}
      messages={messages.map((m) => ({
        role: m.role,
        content: m.content,
        lead: m.trip && plan ? <TripCard plan={plan} locale={locale} s={s} onOpen={() => setScreen("trip")} /> : m.cards?.length ? <><PlaceCards cards={m.cards} locale={locale} /><PlaceMap cards={m.cards} here={m.here} locale={locale} /></> : undefined,
        flag: m.flag,
      }))}
      draft={draft}
      busy={busy}
      error={error ?? undefined}
      onDraft={setDraft}
      onSend={(text) => { void send(text); }}
      clearLabel={s.startOver}
      composer={!shared}
      aboveComposer={!shared && screen === "trip" && plan ? (
        <div className="plan-actions" data-testid="plan-actions">
          <button type="button" className="plan-primary" onClick={() => setScreen("chat")}>{s.backToChat}</button>
          <button type="button" className="plan-btn" onClick={startOver}>{s.startOver}</button>
        </div>
      ) : undefined}
      className={`plan-main plan-screen-${screen}${shared ? " is-shared" : ""}`}
      stage={screen === "trip" && plan ? (
        <section className="plan-trip" aria-label={s.yourTrip}>
          {shared && <p className="plan-eyebrow">{s.sharedPlan}</p>}
          <div className="plan-trip-head" data-testid="plan-trip-head">
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
          <a className="plan-primary" href={sharedPlan ? `/${locale}/plan` : window.location.pathname}>{s.planMine}</a>
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
  const img = cover(plan);
  return (
    <div className="plan-tripcard" data-testid="plan-trip-card">
      <SafeImg className="plan-tripcard-img" src={img.src} fallback={img.fallback} alt={img.alt[locale]} />
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
                const img = stopImage(item);
                return (
                  <li key={item.id}>
                    <SafeImg className="plan-print-img" src={img.src} fallback={img.fallback} alt={img.alt[locale]} />
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

/** The guest's spot for the map, only when the server sent real coordinates. */
function readHere(value: unknown): MapHere | null {
  if (!value || typeof value !== "object") return null;
  const here = value as Record<string, unknown>;
  return typeof here.name === "string" && typeof here.lat === "number" && typeof here.lon === "number" ? { name: here.name, lat: here.lat, lon: here.lon } : null;
}
