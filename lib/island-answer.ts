import { EMERGENCY, EMERGENCY_VERIFIED_AT } from "./emergency.ts";
import { verifiedDate } from "./essentials.ts";
import { isWestCoast } from "./full-day.ts";
import { humanPlanDate } from "./plan-reply.ts";
import { FOOD, PLACES, distanceKm, place } from "./trip.ts";
import type { LastPlace, TaskLocale } from "./awareness/task.ts";
import { isFourByFourQuestion, isPlaceListQuestion, normalizeUtterance } from "./awareness/classify.ts";
import { formatCapeVerdePhone } from "./phone.ts";
import { venueType } from "./plan-rules.ts";

function say(locale: TaskLocale, en: string, pt: string, fr: string): string {
  return locale === "pt" ? pt : locale === "fr" ? fr : en;
}

function beaches(locale: TaskLocale, count = 3): { name: string; location: string }[] {
  return PLACES.filter((item) => item.category === "beach").slice(0, count).map((item) => ({
    name: locale === "en" ? item.name.en : item.name.pt,
    location: item.location,
  }));
}

function restaurantNames(): string[] {
  return FOOD.filter((item) => /restaurant|pizzeria|caf[eé]|seafood/i.test(`${item.title} ${item.description.en}`)).slice(0, 3).map((item) => item.title);
}

const hospital = EMERGENCY.find((item) => item.id === "hospital")!;

/** A place by id, only while the Maio API lists it. */
function listedPlace(id: string) {
  return PLACES.find((item) => item.id === id);
}

/** The Maio API did not answer, so the lists are empty. Say so instead of naming a place. */
function listsDown(locale: TaskLocale): string {
  return say(locale,
    "I couldn't open the Maio listings just now, so I won't name a place. Try again in a moment.",
    "Não consegui abrir as listas do Maio agora, por isso não nomeio um sítio. Tenta outra vez daqui a pouco.",
    "Je n'arrive pas à ouvrir les listes de Maio pour l'instant, donc je ne nomme pas d'adresse. Réessaie dans un moment.");
}

/** Dirt-road answer. The rental sentence is only for a guest who asked where to rent. */
export function fourByFourReply(locale: TaskLocale, rentals: { name: string; phone: string }[] | null, mentionRental = false): string {
  const real = listedPlace("praia-real");
  const morrinho = listedPlace("cadjetinha-morrinho-beach");
  const realName = locale === "pt" ? real?.name.pt : real?.name.en;
  const morrinhoName = locale === "pt" ? morrinho?.name.pt : morrinho?.name.en;
  const road = !realName || !morrinhoName ? say(locale,
    "I won't say a 4x4 is required, because the listings don't grade the road. The far beaches are off the paved town roads, on dirt or sand. A rental car is how people get there.",
    "Não digo que um 4x4 é obrigatório, porque as listas não classificam a estrada. As praias mais longe ficam fora das estradas da vila, em terra ou areia. Vai-se de carro alugado.",
    "Je ne dis pas qu'un 4x4 est obligatoire, parce que les listes ne notent pas la route. Les plages éloignées sont hors des routes de la ville, sur terre ou sable. On y va en voiture de location.") : say(locale,
    `I won't say a 4x4 is required, because the listings don't grade the road. ${realName} and ${morrinhoName} are off the paved town roads, on dirt or sand. A rental car is how people get there.`,
    `Não digo que um 4x4 é obrigatório, porque as listas não classificam a estrada. ${realName} e ${morrinhoName} ficam fora das estradas da vila, em terra ou areia. Vai-se de carro alugado.`,
    `Je ne dis pas qu'un 4x4 est obligatoire, parce que les listes ne notent pas la route. ${realName} et ${morrinhoName} sont hors des routes de la ville, sur terre ou sable. On y va en voiture de location.`);
  if (!mentionRental) return road;
  const rental = rentals === null
    ? say(locale,
      "Car-rental names live on the Maio business list. I won't invent a company.",
      "Os nomes de aluguer estão na lista de negócios do Maio. Não invento uma empresa.",
      "Les noms de location sont dans la liste des commerces de Maio. Je n'invente pas d'enseigne.")
    : rentals.length
      ? say(locale,
        `Car rental from the Maio business list: ${rentals.map((item) => item.phone ? `${item.name}, ${formatCapeVerdePhone(item.phone)}` : item.name).join("; ")}.`,
        `Aluguer na lista de negócios do Maio: ${rentals.map((item) => item.phone ? `${item.name}, ${formatCapeVerdePhone(item.phone)}` : item.name).join("; ")}.`,
        `Location dans la liste des commerces de Maio : ${rentals.map((item) => item.phone ? `${item.name}, ${formatCapeVerdePhone(item.phone)}` : item.name).join("; ")}.`)
      : say(locale,
        "The Maio business list has no car-rental name right now, so I won't invent a company.",
        "A lista de negócios do Maio não tem agora um aluguer de carros, por isso não invento uma empresa.",
        "La liste des commerces de Maio n'a pas de location de voiture pour l'instant, donc je n'invente pas d'enseigne.");
  return `${road} ${rental}`;
}

/** "What time is sunset?" Names a clock. "Where is a good sunset?" does not. */
export function isSunsetClockQuestion(text: string): boolean {
  const n = normalizeUtterance(text);
  if (!/\b(?:sunset|por do sol|coucher)\b/.test(n)) return false;
  const clock = /\b(?:time|when|horas?|heures?|quando|quand)\b/.test(n);
  if (/\b(?:where|best|which beach|qual praia|ou voir|meilleur)\b/.test(n) && !clock) return false;
  return clock;
}

/** Times already converted to Atlantic/Cape_Verde HH:MM. No offer to look anything up. */
export function sunsetTimeReply(locale: TaskLocale, rows: { date: string; time: string }[]): string {
  if (!rows.length) {
    return say(locale,
      "I don't have a calculated sunset time for that day.",
      "Não tenho uma hora calculada do pôr do sol para esse dia.",
      "Je n'ai pas d'heure calculée pour le coucher de soleil ce jour-là.");
  }
  const first = humanPlanDate(rows[0].date, locale);
  const last = humanPlanDate(rows[rows.length - 1].date, locale);
  if (rows.length === 1) {
    return say(locale,
      `Sunset on ${first} is ${rows[0].time} (calculated).`,
      `O pôr do sol em ${first} é às ${rows[0].time} (calculado).`,
      `Le coucher du soleil le ${first} est à ${rows[0].time} (calculé).`);
  }
  const times = [...new Set(rows.map((row) => row.time))];
  const clock = times.length === 1 ? times[0] : `${times[0]}–${times[times.length - 1]}`;
  return say(locale,
    `Sunset is about ${clock} on ${first} – ${last} (calculated).`,
    `O pôr do sol é cerca das ${clock} de ${first} a ${last} (calculado).`,
    `Le coucher du soleil est vers ${clock} du ${first} au ${last} (calculé).`);
}

export function sideQuestionFallback(locale: TaskLocale): string {
  return say(locale,
    "I can't reach the model just now. Ask about beaches, food, a ferry, or the hospital and I'll answer from the listings.",
    "Não chego ao modelo agora. Pergunte por praias, comida, um barco ou o hospital e respondo pelas listas.",
    "Je n'atteins pas le modèle pour l'instant. Demandez les plages, un repas, un ferry ou l'hôpital et je réponds d'après les listes.");
}
const TOWN = place("cidade-porto-ingles")!;


function joinNames(names: string[], locale: TaskLocale): string {
  if (names.length <= 1) return names[0] ?? "";
  const conj = locale === "pt" ? "e" : locale === "fr" ? "et" : "and";
  return `${names.slice(0, -1).join(", ")} ${conj} ${names[names.length - 1]}`;
}

function asFoodPlace(item: (typeof FOOD)[number]): LastPlace | null {
  if (venueType(item) !== "restaurant") return null;
  const spot = place(item.placeId);
  return { id: item.id, name: item.title, area: item.location, ...(spot ? { lat: spot.lat, lon: spot.lon } : {}) };
}

/**
 * A numbered list the guest can follow with "the first one".
 * Returns null when this is not a list request.
 */
export function answerPlaceList(text: string, locale: TaskLocale): { reply: string; places: LastPlace[] } | null {
  if (!isPlaceListQuestion(text)) return null;
  const n = normalizeUtterance(text);
  const vila = /\b(?:vila do maio|porto ingles|na vila|in town|en ville)\b/.test(n);
  const wantBeach = /\b(?:beach|beaches|praia|praias|plage|plages)\b/.test(n) && !/\b(?:restaurant|restaurante|pizzeria|cafe)\b/.test(n);
  if (wantBeach) {
    const rows = PLACES.filter((item) => item.category === "beach" && (!vila || distanceKm(item, TOWN) <= 3)).slice(0, 3);
    const places: LastPlace[] = rows.map((item) => ({
      id: item.id,
      name: locale === "en" ? item.name.en : item.name.pt,
      area: item.location,
      lat: item.lat,
      lon: item.lon,
    }));
    const names = joinNames(places.map((item) => item.name), locale);
    return {
      places,
      reply: say(locale,
        `Three beaches to start with are ${names}. I don't rank a single best one.`,
        `Três praias para começar são ${names}. Não escolho uma única melhor.`,
        `Trois plages pour commencer : ${names}. Je n'en classe pas une seule comme la meilleure.`),
    };
  }
  // Only tables the Maio API lists right now, in listing order. In Vila, the ones within walking distance.
  const rows = FOOD.filter((item) => {
    const spot = place(item.placeId);
    return !vila || (spot ? distanceKm(spot, TOWN) <= 3 : false);
  }).map(asFoodPlace).filter((item): item is LastPlace => !!item).slice(0, 3);
  if (!rows.length) return null;
  const names = joinNames(rows.map((item) => item.name), locale);
  const where = vila ? "Vila do Maio" : "Maio";
  return {
    places: rows,
    reply: say(locale,
      `In ${where}, three places to eat are ${names}. The listings have no menus and no prices, so you arrange the meal with the place.`,
      `Em ${where}, três sítios para comer são ${names}. As listas não têm menus nem preços, por isso combinam a refeição com o sítio.`,
      `À ${where}, trois adresses pour manger sont ${names}. Les listes n'ont ni menus ni prix, donc vous voyez le repas avec l'adresse.`),
  };
}

/**
 * A few sentences drawn from Visit Maio listings and the emergency card.
 * Returns null when the question is not a general island question.
 */
export function answerIslandQuestion(text: string, locale: TaskLocale): string | null {
  if (isPlaceListQuestion(text)) return null;
  const n = normalizeUtterance(text);
  const spots = beaches(locale, 3);
  const names = spots.map((item) => item.name);
  const listed = names.join(", ");
  const beachCount = PLACES.filter((item) => item.category === "beach").length;
  const verified = verifiedDate(EMERGENCY_VERIFIED_AT, locale);
  const rotcha = listedPlace("praia-bitche-rotcha");
  const morro = listedPlace("praia-do-morro");
  const rotchaName = locale === "pt" ? rotcha?.name.pt : rotcha?.name.en;
  const morroName = locale === "pt" ? morro?.name.pt : morro?.name.en;

  const about = /\b(?:maio|island|ilha|ile)\b/.test(n) && /\b(?:tell|about|what|whats|how|like|fale|fala|conta|o que|como|parle|comment|quel|quelle|c'est|qu'est|quest)\b/.test(n);
  const turtles = /\b(?:turtles?|tartarugas?|tortues?)\b/.test(n);
  const coffee = /\b(?:coffee|cafe|espresso|bica)\b/.test(n);
  const sunset = /\b(?:sunset|por do sol|coucher)\b/.test(n);
  const airportTown = /\b(?:airport|aeroporto|aeroport)\b/.test(n) && /\b(?:town|vila|porto|cidade|ville|centre|center)\b/.test(n);
  const beachQ = /\b(?:beach|beaches|praia|praias|plage|plages)\b/.test(n);
  const safe = (/\b(?:safe|safety|seguro|segura|seguranca|surete|securite)\b/.test(n) || /\b(?:c'est|est-ce|est ce)\s+sur\b/.test(n)) && !/\b(?:beach|praia|plage)\b/.test(n);
  const pharmacy = /\b(?:pharmacy|pharmacies|farmacia|pharmacie)\b/.test(n);
  const atm = /\b(?:atm|atms|multibanco|caixas? automatic[oa]s?|distributeurs?)\b/.test(n);
  const eat = /\b(?:eat|food|lunch|dinner|restaurant|comer|almoco|jantar|manger|dejeuner|diner)\b/.test(n)
    && !/\b(?:around there|por ali|la-bas|la bas|pres de la)\b/.test(n);
  const around = /\b(?:get around|getting around|desloc\w*|deplac\w*|aluguer|without a car|sem carro|sans voiture|bus|autocarro)\b/.test(n);

  if (isFourByFourQuestion(text)) return fourByFourReply(locale, null);
  if (turtles) {
    return say(locale,
      `I don't list turtle trips, so I won't invent one. Beaches in the Visit Maio list include ${listed}.`,
      `Não tenho passeios de tartarugas nas listas, por isso não invento. As praias do Visit Maio incluem ${listed}.`,
      `Je ne liste pas de sorties tortues, donc je n'en invente pas. Les plages Visit Maio comprennent ${listed}.`);
  }
  if (coffee) {
    const cafes = FOOD.filter((item) => /caf[eé]|coffee|breakfast|bakery|pastelaria/i.test(`${item.title} ${item.description.en}`)).slice(0, 3).map((item) => item.title);
    const names = cafes.length ? cafes.join(", ") : restaurantNames().join(", ");
    if (!names) return listsDown(locale);
    return say(locale,
      `Places for coffee in the Visit Maio listings include ${names}. The listings have no menus and no prices.`,
      `Sítios para um café nas listas do Visit Maio incluem ${names}. As listas não têm menus nem preços.`,
      `Les adresses pour un café dans les listes Visit Maio comprennent ${names}. Les listes n'ont ni menus ni prix.`);
  }
  if (sunset && !isSunsetClockQuestion(text) && !/\b(?:days?|dias?|jours?)\b/.test(n)) {
    const west = PLACES.filter((item) => item.category === "beach" && isWestCoast(item)).slice(0, 3);
    const names = west.map((item) => locale === "pt" ? item.name.pt : item.name.en).join(", ");
    return say(locale,
      `Sunset on Maio is on the west coast. Beaches that face it include ${names}. I don't rank a single best one.`,
      `O pôr do sol no Maio é na costa oeste. Praias viradas para ele incluem ${names}. Não escolho uma única melhor.`,
      `Le coucher de soleil à Maio est sur la côte ouest. Les plages qui y font face comprennent ${names}. Je n'en classe pas une seule comme la meilleure.`);
  }
  if (airportTown) {
    return say(locale,
      "The airport sits outside Vila do Maio, between the port and Morro. People make that ride by aluguer taxi. I don't have a published transfer time or fare, so I won't invent one.",
      "O aeroporto fica fora da Vila do Maio, entre o porto e o Morro. Esse percurso faz-se de táxi aluguer. Não tenho tempo nem preço publicado, por isso não invento.",
      "L'aéroport est hors de Vila do Maio, entre le port et Morro. On fait ce trajet en taxi aluguer. Je n'ai pas de durée ni de tarif publié, donc je n'en invente pas.");
  }
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
    if (!spots.length) return listsDown(locale);
    const detail = spots.map((item) => `${item.name} (${item.location})`).join(", ");
    return say(locale,
      `Visit Maio lists ${beachCount} beaches, including ${detail}. I don't rank a single best one. With no car, a plan stays with the beaches that are walkable from Porto Inglês.`,
      `O Visit Maio lista ${beachCount} praias, entre elas ${detail}. Não escolho uma única melhor. Sem carro, o plano fica nas praias a que se chega a pé desde o Porto Inglês.`,
      `Visit Maio liste ${beachCount} plages, dont ${detail}. Je n'en classe pas une seule comme la meilleure. Sans voiture, le plan reste sur les plages accessibles à pied depuis Porto Inglês.`);
  }
  if (eat && !/\b(?:days?|dias?|jours?|vegetarian|vegetariano|vegetarien|cheapest|barato)\b/.test(n)) {
    const places = restaurantNames();
    if (!places.length) return listsDown(locale);
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
  if (about && (!rotchaName || !morroName)) {
    return say(locale,
      "Maio is a small, quiet Cape Verdean island, with long beaches and an easy pace. Vila do Maio, also called Porto Inglês, is the harbour town. Around town you walk or take an aluguer taxi, and a car opens the rest of the island.",
      "O Maio é uma ilha pequena e tranquila, com praias longas e um ritmo calmo. Vila do Maio, também chamada Porto Inglês, é a vila do porto. Na vila anda-se a pé ou de aluguer, e um carro abre o resto da ilha.",
      "Maio est une petite île calme, avec de longues plages et un rythme tranquille. Vila do Maio, aussi appelée Porto Inglês, est le bourg du port. En ville on marche ou on prend un aluguer, et une voiture ouvre le reste de l'île.");
  }
  if (about) {
    return say(locale,
      `Maio is a small, quiet Cape Verdean island, with long beaches and an easy pace. Vila do Maio, also called Porto Inglês, is the harbour town, a short walk from ${rotchaName}, with ${morroName} a little further along. Around town you walk or take an aluguer taxi, and a car opens the rest of the island.`,
      `O Maio é uma ilha pequena e tranquila, com praias longas e um ritmo calmo. Vila do Maio, também chamada Porto Inglês, é a vila do porto, a um passo da ${rotchaName}, com a ${morroName} um pouco mais à frente. Na vila anda-se a pé ou de aluguer, e um carro abre o resto da ilha.`,
      `Maio est une petite île calme, avec de longues plages et un rythme tranquille. Vila do Maio, aussi appelée Porto Inglês, est le bourg du port, à une courte marche de ${rotchaName}, avec ${morroName} un peu plus loin. En ville on marche ou on prend un aluguer, et une voiture ouvre le reste de l'île.`);
  }
  return null;
}
