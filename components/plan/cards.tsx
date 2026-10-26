"use client";

import type { ReactNode } from "react";
import { Chip } from "maio-ui";
import type { Locale } from "../../lib/locale";
import type { PlanDay, PlanItem } from "../../lib/trip";
import type { PlanStrings } from "../../lib/trip-strings";
import { ISLAND_PATH, MAP_H, MAP_W, cardView, dayPins, seaLine } from "../../lib/trip-view";

const icons: Record<PlanItem["kind"], string> = { experience: "◎", food: "◌", place: "◇", transport: "⛴" };

export function SeaBadge({ day, s }: { day: PlanDay; s: PlanStrings }) {
  const status = day.sea?.status ?? "unknown";
  return <span className={`plan-sea plan-sea-${status}`}><span aria-hidden="true">≋</span> {seaLine(day.sea, s)}</span>;
}

export function ItemCard({ item, locale, s, actions, onRequest }: {
  item: PlanItem; locale: Locale; s: PlanStrings; actions?: ReactNode; onRequest?: (item: PlanItem, slot: string) => void;
}) {
  const v = cardView(item, locale, s);
  if (!v) return null;
  const state = item.request?.state ?? "none";
  return (
    <article className={`plan-card plan-card-${v.kind}`} data-testid={`card-${item.kind}`} aria-label={v.title}>
      {v.image
        ? <img className="plan-card-img" src={v.image} alt="" loading="lazy" />
        : <span className="plan-card-icon" aria-hidden="true">{icons[v.kind]}</span>}
      <div className="plan-card-body">
        <h3>{v.title}</h3>
        <p className="plan-card-meta">{v.meta}</p>
        {v.price && <p className="plan-card-price">{v.price} <Chip tone="estimate">{s.example}</Chip></p>}
        {state !== "none" && <p className={`plan-status plan-status-${state}`}>{s.status[state]} · {item.request!.slot}</p>}
        {v.kind === "experience" && state === "none" && (
          <div className="plan-card-row">
            {v.slots.map((slot) => (
              <button key={slot} type="button" className={`plan-pill${slot === item.start ? " is-selected" : ""}`} aria-pressed={slot === item.start}
                onClick={() => onRequest?.(item, slot)}>{slot}</button>
            ))}
            <button type="button" className="plan-pill plan-pill-action" onClick={() => onRequest?.(item, item.start)}>{s.requestBooking}</button>
          </div>
        )}
        {actions}
      </div>
    </article>
  );
}

export function DayTimeline({ day, locale, s, renderActions, onRequest }: {
  day: PlanDay; locale: Locale; s: PlanStrings; renderActions?: (item: PlanItem) => ReactNode; onRequest?: (item: PlanItem, slot: string) => void;
}) {
  return (
    <ol className="plan-timeline">
      {day.items.map((item) => (
        <li key={item.id} className="plan-timeline-row">
          <time className="plan-time">{item.start}</time>
          <ItemCard item={item} locale={locale} s={s} actions={renderActions?.(item)} onRequest={onRequest} />
        </li>
      ))}
    </ol>
  );
}

export function RoughAlert({ day, s }: { day: PlanDay; s: PlanStrings }) {
  if (day.sea?.status !== "rough") return null;
  return <div className="plan-alert" role="status"><strong>{s.sea.rough}</strong><span>{s.roughAlert}</span></div>;
}

export function TripMap({ day, locale, s }: { day: PlanDay; locale: Locale; s: PlanStrings }) {
  const pins = dayPins(day, locale, s);
  const first = pins[0];
  // Zoom to the day's pins (at least a 120-unit window) so close-by stops stay readable.
  const xs = pins.map((p) => p.x), ys = pins.map((p) => p.y);
  const span = Math.max(120, ...(pins.length ? [Math.max(...xs) - Math.min(...xs) + 60, Math.max(...ys) - Math.min(...ys) + 60] : [MAP_W]));
  const cx = pins.length ? (Math.max(...xs) + Math.min(...xs)) / 2 : MAP_W / 2, cy = pins.length ? (Math.max(...ys) + Math.min(...ys)) / 2 : MAP_H / 2;
  const view = `${cx - span * 0.9} ${cy - span / 2} ${span * 1.8} ${span}`;
  const scale = span / 300;
  return (
    <figure className="plan-map">
      <svg viewBox={view} role="img" aria-label={`${s.map}: ${pins.map((p) => p.title).join(", ")}`}>
        <rect x="-1000" y="-1000" width="3000" height="3000" className="plan-map-sea" /><path d={ISLAND_PATH} className="plan-map-island" style={{ strokeWidth: 1.5 * scale }} />
        {pins.length > 1 && <polyline points={pins.map((p) => `${p.x},${p.y}`).join(" ")} className="plan-map-route" style={{ strokeWidth: 1.5 * scale, strokeDasharray: `${4 * scale} ${4 * scale}` }} />}
        {pins.map((p) => (
          <g key={p.n} transform={`translate(${p.x} ${p.y})`}>
            <g transform={`scale(${scale})`}><circle r="11" className="plan-map-pin" /><text y="4" textAnchor="middle">{p.n}</text></g>
          </g>
        ))}
      </svg>
      <figcaption>
        <span>{s.map}</span>
        {first && <a className="plan-link" href={`https://www.openstreetmap.org/#map=12/15.22/-23.17`} target="_blank" rel="noopener noreferrer">{s.openMap}</a>}
      </figcaption>
    </figure>
  );
}
