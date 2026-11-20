"use client";

import type { Locale } from "../../lib/locale";
import { SafeImg } from "../stop-photo";

export type ChatPlaceCard = { id: string; name: string; kind: string; area: string | null; km: number | null; walkMin: number | null; driveMin: number | null; image: string | null; approxLocation?: boolean };

const WALK = { en: "min walk", pt: "min a pé", fr: "min à pied" } as const;
const DRIVE = { en: "min drive", pt: "min de carro", fr: "min en voiture" } as const;

/** Distance line: walking under ~25 min, otherwise driving. Exact spot unknown → area only. */
export function placeMeta(card: ChatPlaceCard, locale: Locale): string {
  const parts: string[] = [];
  if (card.area) parts.push(card.area);
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
