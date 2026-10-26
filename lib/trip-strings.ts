import type { Locale } from "./locale.ts";

const en = {
  title: "Plan your days on Maio", lede: "Test build. Tell the concierge how many days you have, and we'll plan around the sea.",
  placeholder: "e.g. 3 days, calm water, one boat trip", send: "Send", thinking: "Planning…", error: "The planner is unavailable. Try again.",
  yourTrip: "Your trip", empty: "Your plan will appear here as cards.", example: "example", exampleData: "Prices, times and slots are example data.",
  from: "from", requestBooking: "Request booking", payOnIsland: "pay on the island", min: "min", h: "h",
  sea: { calm: "Calm sea", moderate: "Some swell", rough: "Rough sea", unknown: "Sea: no forecast" },
  roughAlert: "Rough sea forecast. No boat or surf this day.", wind: "km/h wind", waves: "m waves",
  ferry: "Ferry arrival", flight: "Flight arrival", map: "Map of the day", openMap: "Open in OpenStreetMap",
  unmet: "Not in our listings yet", source: "Visit Maio data · forecast Open-Meteo",
  lunch: "Lunch", beach: "Beach", place: "Place", chips: ["3 days, calm water, one boat trip", "Family with a toddler, no car", "We arrive by ferry on Friday"],
  dayTab: "Day", share: "Copy share link", copied: "Link copied", swap: "Swap", move: "Move", remove: "Remove", moveTo: "Move to",
  undo: "Undo",
  status: { none: "", sent: "Requested", confirmed: "Booking confirmed", declined: "Not available" },
};
type Strings = typeof en;

const pt: Strings = {
  ...en,
  title: "Planeie os seus dias no Maio", lede: "Versão de teste. Diga ao concierge quantos dias tem e planeamos à volta do mar.",
  placeholder: "ex. 3 dias, mar calmo, uma saída de barco", send: "Enviar", thinking: "A planear…", error: "O planeador não está disponível. Tente de novo.",
  yourTrip: "A sua viagem", empty: "O seu plano aparece aqui em cartões.", example: "exemplo", exampleData: "Preços, horários e vagas são dados de exemplo.",
  from: "desde", requestBooking: "Pedir reserva", payOnIsland: "paga na ilha",
  sea: { calm: "Mar calmo", moderate: "Alguma ondulação", rough: "Mar agitado", unknown: "Mar: sem previsão" },
  roughAlert: "Previsão de mar agitado. Sem barco nem surf neste dia.", wind: "km/h vento", waves: "m ondas",
  ferry: "Chegada de barco", flight: "Chegada de voo", map: "Mapa do dia", openMap: "Abrir no OpenStreetMap",
  unmet: "Ainda não temos na lista", source: "Dados Visit Maio · previsão Open-Meteo",
  lunch: "Almoço", beach: "Praia", place: "Lugar", chips: ["3 dias, mar calmo, uma saída de barco", "Família com bebé, sem carro", "Chegamos de barco na sexta"],
  dayTab: "Dia", share: "Copiar link", copied: "Link copiado", swap: "Trocar", move: "Mover", remove: "Remover", moveTo: "Mover para", undo: "Desfazer",
  status: { none: "", sent: "Pedido enviado", confirmed: "Reserva confirmada", declined: "Indisponível" },
};
const fr: Strings = {
  ...en,
  title: "Planifiez vos jours à Maio", lede: "Version de test. Dites au concierge combien de jours vous avez, on planifie selon la mer.",
  placeholder: "ex. 3 jours, mer calme, une sortie en bateau", send: "Envoyer", thinking: "Planification…", error: "Le planificateur est indisponible. Réessayez.",
  yourTrip: "Votre voyage", empty: "Votre plan apparaîtra ici en cartes.", example: "exemple", exampleData: "Prix, horaires et créneaux sont des exemples.",
  from: "dès", requestBooking: "Demander", payOnIsland: "payé sur l'île",
  sea: { calm: "Mer calme", moderate: "Un peu de houle", rough: "Mer agitée", unknown: "Mer : pas de prévision" },
  roughAlert: "Mer agitée prévue. Ni bateau ni surf ce jour-là.", wind: "km/h vent", waves: "m vagues",
  ferry: "Arrivée en ferry", flight: "Arrivée en avion", map: "Carte du jour", openMap: "Ouvrir dans OpenStreetMap",
  unmet: "Pas encore dans nos listes", source: "Données Visit Maio · prévision Open-Meteo",
  lunch: "Déjeuner", beach: "Plage", place: "Lieu", chips: ["3 jours, mer calme, une sortie en bateau", "Famille avec un bébé, sans voiture", "On arrive en ferry vendredi"],
  dayTab: "Jour", share: "Copier le lien", copied: "Lien copié", swap: "Changer", move: "Déplacer", remove: "Retirer", moveTo: "Déplacer au", undo: "Annuler",
  status: { none: "", sent: "Demande envoyée", confirmed: "Réservation confirmée", declined: "Indisponible" },
};

export const planStrings: Record<Locale, Strings> = { en, pt, fr };
export type PlanStrings = Strings;
