import { EMERGENCY, EMERGENCY_VERIFIED_AT } from "./emergency.ts";
import { verifiedDate } from "./essentials.ts";
import { EXPERIENCES, FOOD, PLACES } from "./trip.ts";
import type { TaskLocale } from "./awareness/task.ts";
import { normalizeUtterance } from "./awareness/classify.ts";

function say(locale: TaskLocale, en: string, pt: string, fr: string): string {
  return locale === "pt" ? pt : locale === "fr" ? fr : en;
}

function beaches(locale: TaskLocale, count = 3): { name: string; location: string }[] {
  return PLACES.filter((item) => item.category === "beach").slice(0, count).map((item) => ({
    name: locale === "pt" ? item.name.pt : item.name.en,
    location: item.location,
  }));
}

function restaurantNames(): string[] {
  return FOOD.filter((item) => /restaurant|pizzeria|caf[eé]|seafood/i.test(`${item.title} ${item.description.en}`)).slice(0, 3).map((item) => item.title);
}

const hospital = EMERGENCY.find((item) => item.id === "hospital")!;

/**
 * A few sentences drawn from Visit Maio listings and the emergency card.
 * Returns null when the question is not a general island question.
 */
export function answerIslandQuestion(text: string, locale: TaskLocale): string | null {
  const n = normalizeUtterance(text);
  const spots = beaches(locale, 3);
  const names = spots.map((item) => item.name);
  const listed = names.join(", ");
  const beachCount = PLACES.filter((item) => item.category === "beach").length;
  const verified = verifiedDate(EMERGENCY_VERIFIED_AT, locale);

  const about = /\b(?:maio|island|ilha|ile)\b/.test(n) && /\b(?:tell|about|what|whats|how|like|fale|fala|conta|o que|como|parle|comment|quel|quelle|c'est|qu'est|quest)\b/.test(n);
  const beachQ = /\b(?:beach|beaches|praia|praias|plage|plages)\b/.test(n);
  const safe = (/\b(?:safe|safety|seguro|segura|seguranca|surete|securite)\b/.test(n) || /\b(?:c'est|est-ce|est ce)\s+sur\b/.test(n)) && !/\b(?:beach|praia|plage)\b/.test(n);
  const pharmacy = /\b(?:pharmacy|pharmacies|farmacia|pharmacie)\b/.test(n);
  const atm = /\b(?:atm|atms|multibanco|caixas? automatic[oa]s?|distributeurs?)\b/.test(n);
  const eat = /\b(?:eat|food|lunch|dinner|restaurant|comer|almoco|jantar|manger|dejeuner|diner)\b/.test(n)
    && !/\b(?:around there|por ali|la-bas|la bas|pres de la)\b/.test(n);
  const around = /\b(?:get around|getting around|desloc|deplacer|déplacer|aluguer|without a car|sem carro como|bus|autocarro)\b/.test(n);

  if (pharmacy) {
    return say(locale,
      `I don't have a pharmacy in the Visit Maio listings, so I won't invent one. For urgent care, Hospital do Maio is ${hospital.number} (verified ${verified}).`,
      `Não tenho uma farmácia nas listas do Visit Maio, por isso não vou inventar. Para urgências, o Hospital do Maio é ${hospital.number} (confirmado em ${verified}).`,
      `Je n'ai pas de pharmacie dans les listes Visit Maio, donc je n'en invente pas. Pour les urgences, l'hôpital de Maio est le ${hospital.number} (vérifié le ${verified}).`);
  }
  if (atm) {
    return say(locale,
      `I don't have ATM addresses in the Visit Maio listings, so I won't invent a cash machine. Payment statistics for the island are a separate official dataset, not a map of machines.`,
      `Não tenho moradas de caixas automáticos nas listas do Visit Maio, por isso não vou inventar uma. As estatísticas de pagamentos da ilha são um conjunto de dados à parte, não um mapa de máquinas.`,
      `Je n'ai pas d'adresses de distributeurs dans les listes Visit Maio, donc je n'invente pas de guichet. Les statistiques de paiement de l'île sont un jeu de données à part, pas une carte des machines.`);
  }
  if (safe) {
    return say(locale,
      `I don't have a safety report in these listings, so I won't guess whether somewhere is safe. For emergencies, Hospital do Maio is ${hospital.number} (verified ${verified}). The beach list includes ${listed}.`,
      `Não tenho um relatório de segurança nestas listas, por isso não vou adivinhar se um sítio é seguro. Para urgências, o Hospital do Maio é ${hospital.number} (confirmado em ${verified}). As praias listadas incluem ${listed}.`,
      `Je n'ai pas de rapport de sécurité dans ces listes, donc je ne devine pas si un endroit est sûr. Pour les urgences, l'hôpital de Maio est le ${hospital.number} (vérifié le ${verified}). Les plages listées comprennent ${listed}.`);
  }
  if (beachQ && !/\b(?:days?|dias?|jours?)\b/.test(n)) {
    const detail = spots.map((item) => `${item.name} (${item.location})`).join(", ");
    return say(locale,
      `Visit Maio lists ${beachCount} beaches, including ${detail}. I don't rank a single best one. With no car, a plan stays with the beaches that are walkable from Porto Inglês.`,
      `O Visit Maio lista ${beachCount} praias, entre elas ${detail}. Não escolho uma única melhor. Sem carro, o plano fica nas praias a que se chega a pé desde o Porto Inglês.`,
      `Visit Maio liste ${beachCount} plages, dont ${detail}. Je n'en classe pas une seule comme la meilleure. Sans voiture, le plan reste sur les plages accessibles à pied depuis Porto Inglês.`);
  }
  if (eat && !/\b(?:days?|dias?|jours?|vegetarian|vegetariano|vegetarien|cheapest|barato)\b/.test(n)) {
    const places = restaurantNames();
    return say(locale,
      `Places to eat in the Visit Maio listings include ${places.join(", ")}. The listings have no menus and no prices, so you arrange the meal with the place.`,
      `Sítios para comer nas listas do Visit Maio incluem ${places.join(", ")}. As listas não têm menus nem preços, por isso combinam a refeição com o sítio.`,
      `Les adresses pour manger dans les listes Visit Maio comprennent ${places.join(", ")}. Les listes n'ont ni menus ni prix, donc vous voyez le repas avec l'adresse.`);
  }
  if (around) {
    return say(locale,
      `Without a car, a plan stays within about 3 km of Porto Inglês, on foot or by aluguer taxi. I don't have a bus timetable. Ferries and flights here are published timetables, not live status.`,
      `Sem carro, o plano fica a cerca de 3 km do Porto Inglês, a pé ou de táxi aluguer. Não tenho um horário de autocarro. Barcos e voos aqui são horários publicados, não estado ao vivo.`,
      `Sans voiture, le plan reste à environ 3 km de Porto Inglês, à pied ou en taxi aluguer. Je n'ai pas d'horaire de bus. Ferries et vols ici sont des horaires publiés, pas un statut en direct.`);
  }
  if (about) {
    return say(locale,
      `Maio is the island these listings describe. Visit Maio lists ${beachCount} beaches, including ${listed}, plus ${FOOD.length} places to eat and ${EXPERIENCES.length} experiences. I use those names and the sea forecast when I build a day, and I don't invent a place that isn't in the list.`,
      `O Maio é a ilha que estas listas descrevem. O Visit Maio lista ${beachCount} praias, entre elas ${listed}, mais ${FOOD.length} sítios para comer e ${EXPERIENCES.length} experiências. Uso esses nomes e a previsão do mar quando monto um dia, e não invento um sítio que não esteja na lista.`,
      `Maio est l'île que ces listes décrivent. Visit Maio liste ${beachCount} plages, dont ${listed}, plus ${FOOD.length} adresses pour manger et ${EXPERIENCES.length} expériences. J'utilise ces noms et la prévision de mer quand je construis une journée, et je n'invente pas un lieu absent de la liste.`);
  }
  return null;
}
