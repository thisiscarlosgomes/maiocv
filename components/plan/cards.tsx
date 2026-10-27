"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Locale } from "../../lib/locale";
import type { PlanDay, PlanItem } from "../../lib/trip";
import type { PlanStrings } from "../../lib/trip-strings";
import { ISLAND_PATH, MAP_H, MAP_W, cardView, contactLinks, dayParts, dayPins, dayTitle, driveMin, partOfDay, timeSpan } from "../../lib/trip-view";

/** A photo that falls back to the plain placeholder tile if it fails to load, so a bad URL never shows a broken-image icon. */
export function SafeImg({ src, className, lazy }: { src: string | null; className?: string; lazy?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return <span className={className} aria-hidden="true" />;
  return <img className={className} src={src} alt="" loading={lazy ? "lazy" : undefined} onError={() => setFailed(src)} />;
}

export function RoughAlert({ day, s }: { day: PlanDay; s: PlanStrings }) {
  if (day.sea?.status !== "rough") return null;
  return <p className="plan-alert" role="status">{s.roughAlert}</p>;
}

/** Day header sea state as plain text with a dot. Rough days say so in words, not colour alone. */
export function SeaText({ day, s }: { day: PlanDay; s: PlanStrings }) {
  const status = day.sea?.status ?? "unknown";
  if (status === "unknown") return null;
  return <span className={`plan-seal plan-seal-${status}`}><i aria-hidden="true" />{s.sea[status]}{status === "rough" ? ` · ${s.noBoat}` : ""}</span>;
}

/** v3.3 stop: compact row, 64×64 thumbnail, title, meta, mono time. The whole row opens the detail. */
export function PlanStop({ item, locale, s, onOpen }: { item: PlanItem; locale: Locale; s: PlanStrings; onOpen?: (item: PlanItem, el: HTMLElement) => void }) {
  const v = cardView(item, locale, s);
  if (!v) return null;
  if (item.kind === "transport") {
    return <li className="plan-ferry" data-testid="card-transport"><time className="mono">{item.start}</time><span>{v.title}</span>{v.meta && <span className="plan-ferry-note">· {v.meta}</span>}</li>;
  }
  const body = (
    <>
      <SafeImg className="plan-stop-img" src={v.image} lazy />
      <span className="plan-stop-m">
        <span className="plan-stop-title">{v.title}</span>
        <span className="plan-stop-meta">{v.meta}</span>
        <span className="plan-stop-time"><time className="mono">{timeSpan(item)}</time> · {partOfDay(item.start, s)}</span>
      </span>
    </>
  );
  if (item.kind === "free") onOpen = undefined;
  return (
    <li className="plan-stop-row" data-slot={item.slot}>
      {onOpen
        ? <a href={`#${item.id}`} className="plan-stop" data-testid={`card-${item.kind}`} aria-label={`${v.title}, ${s.openDetails}`} onClick={(e) => { e.preventDefault(); onOpen(item, e.currentTarget); }}>{body}</a>
        : <div className="plan-stop" data-testid={`card-${item.kind}`}>{body}</div>}
    </li>
  );
}

export function DayStops({ day, locale, s, onOpen }: { day: PlanDay; locale: Locale; s: PlanStrings; onOpen?: (item: PlanItem, el: HTMLElement) => void }) {
  const ferries = day.items.filter((i) => i.kind === "transport");
  const stops = day.items.filter((i) => i.kind !== "transport");
  return (
    <>
      {ferries.length > 0 && <ol className="plan-ferries">{ferries.map((item) => <PlanStop key={item.id} item={item} locale={locale} s={s} />)}</ol>}
      <ol className="plan-stops">{stops.map((item, k) => {
        const drive = k > 0 ? driveMin(stops[k - 1], item) : null;
        return [
          drive ? <li key={`${item.id}-hop`} className="plan-hop mono" aria-label={s.drive(drive)}>{s.drive(drive)}</li> : null,
          <PlanStop key={item.id} item={item} locale={locale} s={s} onOpen={onOpen} />,
        ];
      })}</ol>
    </>
  );
}

/** Dialog shell: full-screen sheet on mobile, centred 600px modal on desktop. Esc closes, Tab stays inside, focus returns. */
export function Dialog({ label, onClose, children, className = "" }: { label: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab" || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled])")];
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; back?.focus?.(); };
  }, [onClose]);
  return (
    <div className="plan-sheet-backdrop" onClick={onClose}>
      <div ref={ref} className={`plan-sheet ${className}`} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

export function TripMap({ day, locale, s, caption = true }: { day: PlanDay; locale: Locale; s: PlanStrings; caption?: boolean }) {
  const pins = dayPins(day, locale, s);
  const xs = pins.map((p) => p.x), ys = pins.map((p) => p.y);
  const span = Math.max(120, ...(pins.length ? [Math.max(...xs) - Math.min(...xs) + 60, Math.max(...ys) - Math.min(...ys) + 60] : [MAP_W]));
  const cx = pins.length ? (Math.max(...xs) + Math.min(...xs)) / 2 : MAP_W / 2, cy = pins.length ? (Math.max(...ys) + Math.min(...ys)) / 2 : MAP_H / 2;
  const view = `${cx - span * 0.9} ${cy - span / 2} ${span * 1.8} ${span}`;
  const scale = span / 300;
  const first = pins[0];
  return (
    <figure className="plan-map">
      <svg viewBox={view} role="img" aria-label={`${s.map}: ${pins.map((p) => p.title).join(", ")}`}>
        <rect x="-1000" y="-1000" width="3000" height="3000" className="plan-map-sea" />
        <path d={ISLAND_PATH} className="plan-map-island" style={{ strokeWidth: 1.5 * scale }} />
        {pins.length > 1 && <polyline points={pins.map((p) => `${p.x},${p.y}`).join(" ")} className="plan-map-route" style={{ strokeWidth: 1.5 * scale, strokeDasharray: `${4 * scale} ${4 * scale}` }} />}
        {pins.map((p) => (
          <g key={p.n} transform={`translate(${p.x} ${p.y})`}>
            <g transform={`scale(${scale})`}><circle r="11" className="plan-map-pin" /><text y="4" textAnchor="middle">{p.n}</text></g>
          </g>
        ))}
      </svg>
      {caption && (
        <figcaption>
          <span>{s.map}</span>
          <a className="plan-link" href={first ? `https://www.openstreetmap.org/#map=12/15.22/-23.17` : "https://www.openstreetmap.org/#map=11/15.22/-23.17"} target="_blank" rel="noopener noreferrer">{s.openMap}</a>
        </figcaption>
      )}
    </figure>
  );
}

/** Detail: hero, type · day, title, description, facts, the quiet operator contact (rule in lib/trip-view). No price, no booking. */
export function PlaceDetail({ item, day, locale, s, onClose, onAsk }: { item: PlanItem; day: PlanDay; locale: Locale; s: PlanStrings; onClose: () => void; onAsk?: (text: string) => void }) {
  const v = cardView(item, locale, s);
  if (!v) return null;
  const contact = contactLinks(v.operator);
  const end = (() => { const m = Number(item.start.slice(0, 2)) * 60 + Number(item.start.slice(3)) + item.durationMin; return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; })();
  const type = v.meta.split(" · ")[0];
  const sea = day.sea;
  return (
    <Dialog label={v.title} onClose={onClose}>
      <button type="button" className="plan-sheet-close" onClick={onClose} aria-label={s.close} autoFocus>×</button>
      <SafeImg className="plan-sheet-hero" src={v.image} />
      <div className="plan-sheet-body">
        <p className="plan-eyebrow">{type} · {dayTitle(day.date, locale)}</p>
        <h2 id="plan-sheet-title">{v.title}</h2>
        {v.description && <p className="plan-sheet-desc">{v.description}</p>}
        <dl className="plan-facts">
          <div><dt>{s.time}</dt><dd className="mono">{dayParts(day.date, locale).short} · {item.start} – {end}</dd></div>
          {v.location && <div><dt>{s.meet}</dt><dd>{v.location}</dd></div>}
          {v.operator && <div><dt>{s.operator}</dt><dd>{v.operator.name}</dd></div>}
          {v.seaDependent && <div><dt>{s.seaFact}</dt><dd>{s.seaFactLine[sea?.status ?? "unknown"]}{sea?.waveHeightM != null ? ` · ${sea.waveHeightM.toFixed(1)} ${s.waves}` : ""}</dd></div>}
        </dl>
        {contact && (
          <p className="plan-contact" data-testid="operator-contact">
            <span>{s.contact}</span>
            {contact.whatsapp && <a href={contact.whatsapp} target="_blank" rel="noopener noreferrer">{s.whatsapp}</a>}
            {contact.whatsapp && contact.call && <span aria-hidden="true">·</span>}
            {contact.call && <a href={contact.call}>{s.call}</a>}
          </p>
        )}
        <div className="plan-sheet-actions">
          {v.link && <a className="plan-btn" href={v.link} target="_blank" rel="noopener noreferrer">{s.openInMap}</a>}
          {onAsk && <button type="button" className="plan-btn" onClick={() => onAsk(s.askPrefill(v.title))}>{s.askAbout}</button>}
        </div>
      </div>
    </Dialog>
  );
}

/** "View day on map": the day's pins in the same dialog shell. */
export function DayMap({ day, locale, s, onClose }: { day: PlanDay; locale: Locale; s: PlanStrings; onClose: () => void }) {
  return (
    <Dialog label={`${s.map} · ${dayTitle(day.date, locale)}`} onClose={onClose} className="plan-sheet-map">
      <button type="button" className="plan-sheet-close" onClick={onClose} aria-label={s.close} autoFocus>×</button>
      <div className="plan-sheet-body">
        <p className="plan-eyebrow">{s.map}</p>
        <h2>{dayTitle(day.date, locale)}</h2>
        <TripMap day={day} locale={locale} s={s} />
      </div>
    </Dialog>
  );
}
