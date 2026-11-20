"use client";

import type { Locale } from "../../lib/locale";
import { SafeImg } from "../stop-photo";

export type ChatPlaceCard = { id: string; name: string; kind: string; area: string | null; km: number | null; walkMin: number | null; driveMin: number | null; image: string | null; approxLocation?: boolean; lat?: number | null; lon?: number | null; source?: "google"; url?: string | null };
/** An outside source the reply used (Google Maps or a web page). */
export type ChatSource = { label: string; url: string | null; kind: "google" | "web" };

const WALK = { en: "min walk", pt: "min a pé", fr: "min à pied" } as const;
const DRIVE = { en: "min drive", pt: "min de carro", fr: "min en voiture" } as const;

/** Distance line: walking under ~25 min, otherwise driving. Exact spot unknown → area only. */
export function placeMeta(card: ChatPlaceCard, locale: Locale): string {
  const parts: string[] = [];
  if (card.area) parts.push(card.area);
  if (card.source === "google") parts.push("Google Maps");
  if (card.km !== null && !card.approxLocation) {
    if (card.walkMin !== null && card.walkMin <= 25) parts.push(`${card.walkMin} ${WALK[locale]}`);
    else if (card.driveMin !== null) parts.push(`${card.driveMin} ${DRIVE[locale]}`);
  }
  return parts.join(" · ");
}

export function PlaceCards({ cards, locale }: { cards: ChatPlaceCard[]; locale: Locale }) {
  if (!cards.length) return null;
  return (
    <ul className="plan-placecards" data-testid="plan-place-cards">
      {cards.map((card) => (
        <li key={card.id} className="plan-placecard">
          <SafeImg className="plan-placecard-img" src={card.image} alt={card.name} lazy />
          <div>
            <p className="plan-placecard-title">{card.name}</p>
            <p className="plan-placecard-meta mono">{placeMeta(card, locale)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

const SOURCES = { en: "Sources", pt: "Fontes", fr: "Sources" } as const;

/** Outside sources under a reply, so the guest can tell them from the Maio listings. */
export function ReplySources({ sources, locale }: { sources: ChatSource[]; locale: Locale }) {
  if (!sources.length) return null;
  return (
    <p className="plan-sources mono" data-testid="plan-reply-sources">
      {SOURCES[locale]}:{" "}
      {sources.map((source, index) => (
        <span key={`${source.label}-${index}`}>
          {index > 0 && " · "}
          {source.url ? <a href={source.url} target="_blank" rel="noopener noreferrer nofollow">{source.label}</a> : source.label}
        </span>
      ))}
    </p>
  );
}

export function readSources(value: unknown): ChatSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ChatSource[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.label !== "string" || (row.kind !== "google" && row.kind !== "web")) return [];
    const url = typeof row.url === "string" && /^https:\/\//.test(row.url) ? row.url : null;
    return [{ label: row.label.slice(0, 80), url, kind: row.kind === "google" ? "google" : "web" }];
  }).slice(0, 4);
}
