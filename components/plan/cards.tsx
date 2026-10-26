"use client";

import type { Locale } from "../../lib/locale";
import type { PlanDay, PlanItem } from "../../lib/trip";
import type { PlanStrings } from "../../lib/trip-strings";
import { ISLAND_PATH, MAP_H, MAP_W, cardView, contactLinks, dayPins, dayTitle, duration, seaLine } from "../../lib/trip-view";

const icons: Record<PlanItem["kind"], string> = { experience: "◎", food: "◌", place: "◇", transport: "⛴" };

export function SeaBadge({ day, s }: { day: PlanDay; s: PlanStrings }) {
  const status = day.sea?.status ?? "unknown";
  return <span className={`plan-sea plan-sea-${status}`}><span className="plan-sea-dot" aria-hidden="true" /> <strong>{s.sea[status]}</strong>{seaLine(day.sea, s).slice(s.sea[status].length)}</span>;
}

/** Read-only card. The whole card opens the detail sheet. No price, no actions. */
export function PlanCard({ item, locale, s, updated, onOpen }: { item: PlanItem; locale: Locale; s: PlanStrings; updated?: boolean; onOpen?: (item: PlanItem) => void }) {
  const v = cardView(item, locale, s);
  if (!v) return null;
  const body = (
    <>
      {v.image ? <img className="plan-card-img" src={v.image} alt="" loading="lazy" /> : <span className="plan-card-img plan-card-icon" aria-hidden="true">{icons[v.kind]}</span>}
      <span className="plan-card-body">
        <span className="plan-card-title">{v.title}</span>
        <span className="plan-card-meta">{v.meta}</span>
        {updated && <span className="plan-updated">● {s.updated}</span>}
      </span>
      <span className="plan-card-chev" aria-hidden="true">›</span>
    </>
  );
  if (item.kind === "transport" || !onOpen) return <div className={`plan-card plan-card-${v.kind}`} data-testid={`card-${item.kind}`}>{body}</div>;
  return (
    <a href={`#${item.id}`} className={`plan-card plan-card-${v.kind}${updated ? " is-updated" : ""}`} data-testid={`card-${item.kind}`} aria-label={`${v.title}, ${s.openDetails}`}
      onClick={(e) => { e.preventDefault(); onOpen(item); }}>{body}</a>
  );
}

export function DayCards({ day, locale, s, updated, onOpen }: { day: PlanDay; locale: Locale; s: PlanStrings; updated?: Set<string>; onOpen?: (item: PlanItem) => void }) {
  return (
    <ol className="plan-timeline">
      {day.items.map((item) => (
        <li key={item.id} className="plan-timeline-row">
          <time className="plan-time">{item.start}</time>
          <PlanCard item={item} locale={locale} s={s} updated={updated?.has(item.id)} onOpen={onOpen} />
        </li>
      ))}
    </ol>
  );
}

export function RoughAlert({ day, s }: { day: PlanDay; s: PlanStrings }) {
  if (day.sea?.status !== "rough") return null;
  return <p className="plan-alert" role="status">{s.roughAlert}</p>;
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

/** Detail sheet: bottom sheet on mobile, side sheet on desktop. Contact follows the operator rule in lib/trip-view. */
export function PlaceDetail({ item, day, locale, s, onClose, onAsk }: { item: PlanItem; day: PlanDay; locale: Locale; s: PlanStrings; onClose: () => void; onAsk?: (text: string) => void }) {
  const v = cardView(item, locale, s);
  if (!v) return null;
  const contact = contactLinks(v.operator);
  const end = (() => { const m = Number(item.start.slice(0, 2)) * 60 + Number(item.start.slice(3)) + item.durationMin; return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; })();
  const type = v.meta.split(" · ")[0];
  return (
    <div className="plan-sheet-backdrop" onClick={onClose}>
      <div className="plan-sheet" role="dialog" aria-modal="true" aria-labelledby="plan-sheet-title" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="plan-sheet-close" onClick={onClose} aria-label={s.close} autoFocus>×</button>
        {v.image ? <img className="plan-sheet-hero" src={v.image} alt="" /> : <div className="plan-sheet-hero" aria-hidden="true" />}
        <div className="plan-sheet-body">
          <p className="plan-eyebrow">{type} · {dayTitle(day.date, locale)}</p>
          <h2 id="plan-sheet-title">{v.title}</h2>
          {v.description && <p className="plan-sheet-desc">{v.description}</p>}
          {v.seaDependent && <SeaBadge day={day} s={s} />}
          <dl className="plan-facts">
            <div><dt>{s.time}</dt><dd>{item.start} – {end} · {duration(item.durationMin, s)}</dd></div>
            {v.location && <div><dt>{s.meetingPoint}</dt><dd>{v.location}</dd></div>}
            {v.operator && <div><dt>{s.operator}</dt><dd>{v.operator.name}</dd></div>}
          </dl>
          {contact && (
            <p className="plan-contact" data-testid="operator-contact">
              {s.contact}{" "}
              {contact.whatsapp && <a href={contact.whatsapp} target="_blank" rel="noopener noreferrer">{s.whatsapp}</a>}
              {contact.whatsapp && contact.call && " · "}
              {contact.call && <a href={contact.call}>{s.call}</a>}
            </p>
          )}
          <div className="plan-sheet-actions">
            {v.link && <a className="plan-btn" href={v.link} target="_blank" rel="noopener noreferrer">{s.openInMap}</a>}
            {onAsk && <button type="button" className="plan-btn" onClick={() => onAsk(s.askPrefill(v.title))}>{s.askAbout}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
