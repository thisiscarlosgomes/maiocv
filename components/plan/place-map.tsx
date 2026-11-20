"use client";

import type { Locale } from "../../lib/locale";
import { mapView } from "../../lib/map-view";
import { placeMeta, type ChatPlaceCard } from "./place-cards";

export type MapHere = { name: string; lat: number; lon: number };

const YOU = { en: "You", pt: "Você", fr: "Vous" } as const;
const LABEL = { en: "Map of the places above", pt: "Mapa dos lugares acima", fr: "Carte des lieux ci-dessus" } as const;
const WIDTH = 384;
const HEIGHT = 216;

/** The recommended places on a small OpenStreetMap view, numbered like the list, with the guest's spot when known. */
export function PlaceMap({ cards, here, locale }: { cards: ChatPlaceCard[]; here?: MapHere | null; locale: Locale }) {
  const located = cards.filter((card): card is ChatPlaceCard & { lat: number; lon: number } => typeof card.lat === "number" && typeof card.lon === "number");
  if (!located.length) return null;
  const points = [...located.map((card) => ({ id: card.id, lat: card.lat, lon: card.lon })), ...(here ? [{ id: "__here", lat: here.lat, lon: here.lon }] : [])];
  const view = mapView(points, WIDTH, HEIGHT);
  if (!view) return null;
  const number = new Map(located.map((card, index) => [card.id, index + 1]));
  return (
    <figure className="plan-map" data-testid="plan-place-map" aria-label={LABEL[locale]}>
      <div className="plan-map-canvas" style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}>
        {view.tiles.map((tile) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={tile.key} className="plan-map-tile" src={tile.url} alt="" aria-hidden loading="lazy" draggable={false}
            style={{ left: `${tile.left}%`, top: `${tile.top}%`, width: `${tile.size}%` }} />
        ))}
        {view.pins.map((pin) => pin.id === "__here" ? (
          <span key={pin.id} className="plan-map-pin plan-map-pin-here" style={{ left: `${pin.left}%`, top: `${pin.top}%` }} title={here?.name}>{YOU[locale]}</span>
        ) : (
          <span key={pin.id} className={`plan-map-pin${located.find((card) => card.id === pin.id)?.approxLocation ? " plan-map-pin-approx" : ""}`} style={{ left: `${pin.left}%`, top: `${pin.top}%` }} data-testid="plan-map-pin">{number.get(pin.id)}</span>
        ))}
        <a className="plan-map-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
      </div>
      <ol className="plan-map-list">
        {located.map((card) => (
          <li key={card.id}><span className="plan-map-num">{number.get(card.id)}</span><span className="plan-map-name">{card.name}</span><span className="plan-map-meta">{placeMeta(card, locale)}</span></li>
        ))}
      </ol>
    </figure>
  );
}
