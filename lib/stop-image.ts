import type { Locale } from "./locale.ts";
import { experience, food, place } from "./trip.ts";

/** A plan stop or a recommendation card. A listing photo wins; otherwise the glyph follows kind, slot, or category. */
export type StopRef = {
  kind?: string;
  refId?: string;
  slot?: string;
  category?: string;
  /** Listing photo. When the property is present, an empty value means the record has no photo. */
  image?: string | null;
  title?: string;
};

export type StopAlt = Record<Locale, string>;

export type StopImage = {
  /** Photo or placeholder to show. Always a path or http(s) URL the UI can put on an img. */
  src: string;
  /** Shipped icon used when `src` 404s, so a missing file never leaves a broken image. */
  fallback: string;
  alt: StopAlt;
  /** True when `src` is not the listing's own photo. */
  placeholder: boolean;
};

export type StopImageOptions = {
  /**
   * Whether a realistic file under public/placeholders/ is present.
   * Omit it to try the file: the image element falls back to `fallback` if the request fails.
   * Pass a check in tests and on the server when the card cannot probe the network.
   */
  fileExists?: (publicPath: string) => boolean;
};

type IconName = "plane" | "boat" | "rest" | "beach" | "food" | "sight" | "activity";

const ICONS: Record<IconName, string> = {
  plane: "/placeholders/plane.svg",
  boat: "/placeholders/boat.svg",
  rest: "/placeholders/rest.svg",
  beach: "/placeholders/beach.svg",
  food: "/placeholders/food.svg",
  sight: "/placeholders/sight.svg",
  activity: "/placeholders/activity.svg",
};

/**
 * Realistic photos Carlos can drop in public/placeholders/.
 * Breakfast is wired to breakfast-stay.jpg. Lunch, dinner, and time at the stay
 * pick up lunch.jpg, dinner.jpg, and stay.jpg when those files are added.
 * Until a file is there, the matching icon is used.
 */
const REALISTIC: Record<string, { file: string; icon: IconName }> = {
  "breakfast-stay": { file: "breakfast-stay.jpg", icon: "food" },
  "lunch-free": { file: "lunch.jpg", icon: "food" },
  "dinner-free": { file: "dinner.jpg", icon: "food" },
  rest: { file: "stay.jpg", icon: "rest" },
  "free-time": { file: "stay.jpg", icon: "rest" },
};

const STOP_ALT: Record<string, StopAlt> = {
  "breakfast-stay": { en: "Breakfast at your stay", pt: "Pequeno-almoço no alojamento", fr: "Petit-déjeuner à l'hébergement" },
  "lunch-free": { en: "Lunch near your stay", pt: "Almoço perto do alojamento", fr: "Déjeuner près de l'hébergement" },
  "dinner-free": { en: "Dinner near your stay", pt: "Jantar perto do alojamento", fr: "Dîner près de l'hébergement" },
  rest: { en: "Free time at your stay", pt: "Tempo livre no alojamento", fr: "Temps libre à l'hébergement" },
  "free-time": { en: "Free time at your stay", pt: "Tempo livre no alojamento", fr: "Temps libre à l'hébergement" },
  transfer: { en: "Transfer and check-in", pt: "Transfer e check-in", fr: "Transfert et enregistrement" },
  "depart-airport": { en: "Departure to the airport", pt: "Partida para o aeroporto", fr: "Départ pour l'aéroport" },
  "depart-port": { en: "Departure to the port", pt: "Partida para o porto", fr: "Départ pour le port" },
  flight: { en: "Flight arrival", pt: "Chegada de voo", fr: "Arrivée du vol" },
  ferry: { en: "Ferry arrival", pt: "Chegada de barco", fr: "Arrivée du ferry" },
};

const ICON_ALT: Record<IconName, StopAlt> = {
  plane: {
    en: "Plane icon for a flight, transfer, or airport departure",
    pt: "Ícone de avião para um voo, transfer ou partida para o aeroporto",
    fr: "Icône d'avion pour un vol, un transfert ou un départ vers l'aéroport",
  },
  boat: {
    en: "Boat icon for a ferry arrival or departure",
    pt: "Ícone de barco para a chegada ou a partida de ferry",
    fr: "Icône de bateau pour l'arrivée ou le départ du ferry",
  },
  rest: {
    en: "Sun lounger icon for free time at your stay",
    pt: "Ícone de espreguiçadeira para o tempo livre no alojamento",
    fr: "Icône de transat pour le temps libre à l'hébergement",
  },
  beach: { en: "Beach icon", pt: "Ícone de praia", fr: "Icône de plage" },
  food: { en: "Food icon for a meal", pt: "Ícone de uma refeição", fr: "Icône d'un repas" },
  sight: { en: "Sight icon for a place on Maio", pt: "Ícone de um lugar no Maio", fr: "Icône d'un lieu à Maio" },
  activity: { en: "Activity icon", pt: "Ícone de atividade", fr: "Icône d'activité" },
};

const VISIT_MAIO = "https://www.visitmaio.com";

/** Listing photos follow the trip-card rule. Paths like "/experiences/…" live on visitmaio.com. Our own placeholders stay on this origin. Anything else is dropped. */
function listingImage(src: string | null | undefined): string | null {
  if (!src) return null;
  const value = src.trim();
  if (!value) return null;
  if (value.startsWith("/placeholders/")) return value;
  if (value.startsWith("/") && !value.startsWith("//")) return VISIT_MAIO + value;
  return /^https?:\/\//.test(value) ? value : null;
}

function listingPhoto(stop: StopRef): string | null {
  if (Object.prototype.hasOwnProperty.call(stop, "image")) return listingImage(stop.image);
  if (stop.kind === "experience" && stop.refId) return listingImage(experience(stop.refId)?.image);
  if (stop.kind === "food" && stop.refId) return listingImage(food(stop.refId)?.image);
  if (stop.kind === "place" && stop.refId) return listingImage(place(stop.refId)?.image);
  return null;
}

function categoryOf(stop: StopRef): string {
  if (stop.category) return stop.category.toLowerCase();
  if (stop.kind === "place" && stop.refId) return place(stop.refId)?.category?.toLowerCase() ?? "";
  return "";
}

function iconFor(stop: StopRef): IconName {
  const ref = stop.refId ?? "";
  const slot = stop.slot ?? "";
  const kind = stop.kind ?? "";
  if (kind === "transport") return ref === "ferry" ? "boat" : "plane";
  if (ref === "depart-port") return "boat";
  if (ref === "depart-airport" || ref === "transfer" || slot === "transfer") return "plane";
  if (slot === "departure") return "plane";
  if (ref === "rest" || ref === "free-time" || slot === "rest") return "rest";
  if (ref === "breakfast-stay" || ref === "lunch-free" || ref === "dinner-free") return "food";
  if (kind === "food" || slot === "breakfast" || slot === "lunch" || slot === "dinner" || slot === "drinks") return "food";
  if (kind === "experience" || kind === "activity") return "activity";
  const category = categoryOf(stop);
  if (/beach|praia/.test(category)) return "beach";
  if (/food|restaurant|bar|cafe|café|meal|bakery|drink/.test(category)) return "food";
  if (/activity|experience|tour|sport|fishing|water|offroad|quad|hike|trek/.test(category)) return "activity";
  if (/hotel|guest|apartment|accommodation|stay|lodg/.test(category)) return "rest";
  if (slot === "sunset") return "beach";
  return "sight";
}

function altFor(stop: StopRef, icon: IconName): StopAlt {
  if (stop.refId && STOP_ALT[stop.refId]) return STOP_ALT[stop.refId];
  return ICON_ALT[icon];
}

function listingAlt(stop: StopRef, icon: IconName): StopAlt {
  if (stop.kind === "place" && stop.refId) {
    const row = place(stop.refId);
    if (row) {
      const pt = row.name.pt || row.name.en;
      const en = row.name.en || row.name.pt;
      return { en, pt, fr: pt };
    }
  }
  const title = stop.title
    ?? (stop.kind === "experience" && stop.refId ? experience(stop.refId)?.title : undefined)
    ?? (stop.kind === "food" && stop.refId ? food(stop.refId)?.title : undefined);
  if (title) return { en: title, pt: title, fr: title };
  return altFor(stop, icon);
}

/**
 * Photo for a plan stop or recommendation. Real listing photos pass through.
 * Generic rows and records with no photo get a placeholder chosen by kind or category.
 * Breakfast at your stay uses /placeholders/breakfast-stay.jpg when that file exists,
 * and the food icon otherwise.
 */
export function stopImage(stop: StopRef, options: StopImageOptions = {}): StopImage {
  const icon = iconFor(stop);
  const fallback = ICONS[icon];
  const photo = listingPhoto(stop);
  if (photo) return { src: photo, fallback, alt: listingAlt(stop, icon), placeholder: false };

  const realistic = stop.refId ? REALISTIC[stop.refId] : undefined;
  if (realistic) {
    const path = `/placeholders/${realistic.file}`;
    const present = options.fileExists ? options.fileExists(path) : true;
    if (present) return { src: path, fallback, alt: altFor(stop, icon), placeholder: true };
  }
  return { src: fallback, fallback, alt: altFor(stop, icon), placeholder: true };
}

/** First real listing photo in a plan, otherwise the first stop's placeholder. */
export function coverImage(stops: readonly StopRef[], options?: StopImageOptions): StopImage {
  let backup: StopImage | null = null;
  for (const stop of stops) {
    const image = stopImage(stop, options);
    if (!image.placeholder) return image;
    backup ??= image;
  }
  return backup ?? stopImage({ kind: "place", category: "sight" }, options);
}
