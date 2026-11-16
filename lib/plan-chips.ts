import { CAR_CHIPS, followUpChips, isCarPending, isGuestChip, relaxChip, type Task, type TaskLocale } from "./awareness/task.ts";
import { toMin } from "./full-day.ts";
import { EXPERIENCES, FOOD, experience, type TripPlan } from "./trip.ts";

export type ChipTurn = {
  locale: TaskLocale;
  plan: TripPlan | null;
  task: Task;
  lastAsk: string;
  reply: string;
  intent: string;
  /** Test seam. Omit to read the listings. */
  boardRental?: boolean;
};

const COPY = {
  en: {
    boat: "Add a boat trip",
    removeBoat: "Remove the boat trip",
    pdf: "Export as PDF",
    beaches: "Show me the best beaches",
    rent: "Where can I rent a car?",
    moveMorning: "Move surf to the morning",
    moveAfternoon: "Move surf to the afternoon",
    anotherSurf: "Add another surf session",
    board: "Where can I rent a board?",
    pharmacy: "Where is a pharmacy?",
    hospital: "Where is the hospital?",
    police: "Where is the police?",
    atm: "Is there an ATM?",
    flight: "What about the flight?",
    ferry: "What about the ferry?",
    around: "How do we get around without a car?",
    swap: (day: number) => `Swap the beach on day ${day}`,
  },
  pt: {
    boat: "Acrescenta um passeio de barco",
    removeBoat: "Tira o passeio de barco",
    pdf: "Exportar em PDF",
    beaches: "Mostra-me as melhores praias",
    rent: "Onde alugo um carro?",
    moveMorning: "Passa o surf para a manhã",
    moveAfternoon: "Passa o surf para a tarde",
    anotherSurf: "Acrescenta outra sessão de surf",
    board: "Onde alugo uma prancha?",
    pharmacy: "Onde fica a farmácia?",
    hospital: "Onde fica o hospital?",
    police: "Onde fica a polícia?",
    atm: "Há um multibanco?",
    flight: "E o voo?",
    ferry: "E o barco?",
    around: "Como nos deslocamos sem carro?",
    swap: (day: number) => `Troca a praia do dia ${day}`,
  },
  fr: {
    boat: "Ajoute une sortie en bateau",
    removeBoat: "Enlève la sortie en bateau",
    pdf: "Exporter en PDF",
    beaches: "Montre-moi les meilleures plages",
    rent: "Où louer une voiture ?",
    moveMorning: "Passe le surf au matin",
    moveAfternoon: "Passe le surf à l'après-midi",
    anotherSurf: "Ajoute une autre session de surf",
    board: "Où louer une planche ?",
    pharmacy: "Où est la pharmacie ?",
    hospital: "Où est l'hôpital ?",
    police: "Où est la police ?",
    atm: "Y a-t-il un distributeur ?",
    flight: "Et le vol ?",
    ferry: "Et le ferry ?",
    around: "Comment se déplacer sans voiture ?",
    swap: (day: number) => `Remplace la plage du jour ${day}`,
  },
} as const;

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Board hire is a chip only when a listing actually offers it. */
export function listingsIncludeBoardRental(): boolean {
  const blob = [...EXPERIENCES, ...FOOD].map((item) => `${item.title} ${item.description.en} ${item.description.pt}`).join("\n");
  return /\b(?:surfboard|board rental|rent a board|aluguer de prancha|location de planche|prancha de surf)\b/i.test(blob);
}

export function boardRentalReply(locale: TaskLocale, listed = listingsIncludeBoardRental()): string {
  if (listed) {
    return locale === "pt"
      ? "Há aluguer de prancha nas listas."
      : locale === "fr"
        ? "La location de planche est dans les listes."
        : "Board rental is in the listings.";
  }
  return locale === "pt"
    ? "Não há aluguer de prancha nas listas. As sessões de surf são da onda azul, na Praia do Morro."
    : locale === "fr"
      ? "La location de planche n'est pas dans les listes. Les sessions de surf sont chez onda azul, à Praia do Morro."
      : "Board rental isn't in the listings. Surf sessions are with onda azul at Morro Beach.";
}

function hasBoat(plan: TripPlan): boolean {
  return plan.days.some((day) => day.items.some((item) => item.kind === "experience" && experience(item.refId)?.boat));
}

function surfStop(plan: TripPlan): { day: number; start: string } | null {
  for (let index = 0; index < plan.days.length; index += 1) {
    const item = plan.days[index].items.find((stop) => stop.kind === "experience" && /surf|ondaazul/i.test(`${stop.refId} ${experience(stop.refId)?.title ?? ""}`));
    if (item) return { day: index + 1, start: item.start ?? "15:00" };
  }
  return null;
}

function gettingAround(ask: string): boolean {
  return /\b(?:get around|getting around|how (?:do|can) (?:we|i)|como (?:nos |eu )?(?:desloc|andar)|comment (?:se deplacer|on se deplace|aller)|where can i rent|onde alugo|ou louer|rent a car|aluguer de carro|location de voiture)\b/.test(fold(ask));
}

function mentions(text: string, pattern: RegExp): boolean {
  return pattern.test(fold(text));
}

function take(chips: string[]): string[] {
  const unique = [...new Set(chips.map((chip) => chip.trim()).filter((chip) => chip && isGuestChip(chip)))];
  return unique.slice(0, 3);
}

function relaxedDays(task: Task, reply: string): Set<number> {
  const days = new Set(task.completed.flatMap((item) => {
    const match = /^relax-day-(\d+)$/.exec(item);
    return match ? [Number(match[1])] : [];
  }));
  const said = reply.match(/\b(?:day|dia|jour)\s+(\d+)\b/i);
  if (said && /lighter|mais leve|plus l[eé]ger|afternoon free|tarde longa|apr[eè]s-midi libre/i.test(reply)) days.add(Number(said[1]));
  return days;
}

function nextRelaxDay(plan: TripPlan, skipped: Set<number>): number | null {
  for (let day = 2; day <= plan.days.length; day += 1) {
    if (!skipped.has(day)) return day;
  }
  for (let day = 1; day <= plan.days.length; day += 1) {
    if (!skipped.has(day)) return day;
  }
  return null;
}

function topicChips(turn: ChipTurn): string[] | null {
  const copy = COPY[turn.locale];
  const ask = fold(turn.lastAsk);
  const reply = fold(turn.reply);
  const heard = `${ask} ${reply}`;
  if (/\b(?:pharmacy|farmacia|pharmacie)\b/.test(ask)) {
    return take([copy.hospital, copy.atm, copy.police].filter((chip) => !reply.includes(fold(chip))));
  }
  if (/\b(?:hospital|hospit|hopital|urgencia|urgence)\b/.test(ask)) {
    return take([copy.pharmacy, copy.police, copy.atm]);
  }
  if (/\b(?:police|policia|gendarmerie)\b/.test(ask)) return take([copy.hospital, copy.pharmacy, copy.atm]);
  if (/\b(?:atm|multibanco|caixa automatica|distributeur)\b/.test(ask)) return take([copy.pharmacy, copy.hospital, copy.police]);
  if (/\b(?:ferry|ferries|horario do barco|horaire du ferry)\b/.test(ask) && !/\b(?:boat trip|passeio de barco|sortie en bateau)\b/.test(ask)) {
    return take([copy.flight, copy.beaches]);
  }
  if (/\b(?:flight|flights|voo|vols|avion)\b/.test(ask)) return take([copy.ferry, copy.beaches]);
  if (/\b(?:beach|beaches|praia|praias|plage|plages)\b/.test(ask) && /\b(?:best|melhor|meilleur|which|qual|quel)\b/.test(ask)) {
    const day = Math.min(2, turn.plan?.days.length ?? 2);
    return take([copy.swap(day), turn.plan && hasBoat(turn.plan) ? copy.removeBoat : copy.boat, copy.beaches]);
  }
  if (/\b(?:surfboard|prancha|planche)\b/.test(ask)) return take([copy.anotherSurf, copy.moveMorning, copy.beaches]);
  if (/\bsurf/.test(ask) && /\b(?:where|onde|ou )\b/.test(ask)) return take([copy.anotherSurf, copy.moveMorning, copy.beaches]);
  if (/\b(?:forecast|wave|previsao|meteo|houle)\b/.test(heard) && turn.intent === "side_question") {
    return take([copy.beaches, turn.plan && hasBoat(turn.plan) ? copy.removeBoat : copy.boat]);
  }
  if (gettingAround(turn.lastAsk)) {
    const rent = turn.plan && !turn.plan.hasCar ? copy.rent : copy.around;
    return take([rent, copy.beaches, copy.ferry]);
  }
  return null;
}

function surfChips(turn: ChipTurn, plan: TripPlan): string[] {
  const copy = COPY[turn.locale];
  const surf = surfStop(plan);
  const chips: string[] = [];
  const reply = fold(turn.reply);
  const offeredAnother = /another session|outra sess|autre session/.test(reply);
  if (surf && toMin(surf.start) >= 12 * 60) chips.push(copy.moveMorning);
  else if (surf) chips.push(copy.moveAfternoon);
  if (!offeredAnother) chips.push(copy.anotherSurf);
  const board = turn.boardRental ?? listingsIncludeBoardRental();
  if (board && !/board rental|aluguer de prancha|location de planche/.test(reply)) chips.push(copy.board);
  const relax = nextRelaxDay(plan, relaxedDays(turn.task, turn.reply));
  if (chips.length < 3 && relax) chips.push(relaxChip(turn.locale, relax));
  if (chips.length < 3) chips.push(copy.beaches);
  return take(chips);
}

function planChips(turn: ChipTurn, plan: TripPlan): string[] {
  const copy = COPY[turn.locale];
  const reply = fold(turn.reply);
  const surf = surfStop(plan);
  const askedSurf = /\bsurf/.test(fold(turn.lastAsk));
  const justSurf = /\bsurf\b/.test(reply) && /added surf|acrescentei surf|ajoute le surf|already on day|ja esta no dia|deja au jour|second surf|segunda sess|deuxieme session/.test(reply);
  if (surf && (justSurf || askedSurf)) return surfChips(turn, plan);
  const chips: string[] = [];
  const boat = hasBoat(plan);
  const justAddedBoat = /added .+fishing|acrescentei .+fishing|ajout/.test(reply) && /fishing|boat|barco|bateau/.test(reply);
  const skipped = relaxedDays(turn.task, turn.reply);
  const relax = nextRelaxDay(plan, skipped);
  if (relax) chips.push(relaxChip(turn.locale, relax));
  if (boat) chips.push(copy.removeBoat);
  else if (!justAddedBoat) chips.push(copy.boat);
  const exported = /pdf|impress|impression/.test(reply) || turn.task.completed.includes("pdf");
  if (!exported) chips.push(copy.pdf);
  else if (turn.plan && !gettingAround(turn.lastAsk)) chips.push(copy.beaches);
  if (plan.hasCar === false && gettingAround(turn.lastAsk)) chips.splice(0, chips.length, copy.rent, copy.around, copy.beaches);
  return take(chips.filter((chip) => !(plan.hasCar === false && !gettingAround(turn.lastAsk) && chip === copy.rent)));
}

/** A bare yes after the greeting. Distinct from the hello line, with chips the planner can apply. */
export function yesChangeOffer(locale: TaskLocale, plan: TripPlan): { reply: string; chips: string[] } {
  const day = plan.days.length >= 2 ? 2 : 1;
  const relax = relaxChip(locale, day);
  const boat = hasBoat(plan) ? COPY[locale].removeBoat : COPY[locale].boat;
  const shift = locale === "pt" ? "Adiar 2 dias" : locale === "fr" ? "Décale de 2 jours" : "Push it 2 days";
  const chips = [relax, boat, shift];
  const reply = locale === "pt"
    ? `Posso deixar o dia ${day} mais calmo, ${hasBoat(plan) ? "tirar o passeio de barco" : "acrescentar um passeio de barco"} ou adiar as datas. O que prefere?`
    : locale === "fr"
      ? `Je peux rendre le jour ${day} plus calme, ${hasBoat(plan) ? "enlever la sortie en bateau" : "ajouter une sortie en bateau"} ou décaler les dates. Que préférez-vous ?`
      : `I can make day ${day} calmer, ${hasBoat(plan) ? "remove the boat trip" : "add a boat trip"}, or shift the dates. Which do you want?`;
  return { reply, chips };
}

/** Chips for this turn: the ask, the reply, and what the plan actually contains. At most three, in the guest's voice. */
export function suggestionChips(turn: ChipTurn): string[] {
  if (isCarPending(turn.task.pendingQuestion)) return [...CAR_CHIPS[turn.locale]];
  if (turn.intent === "side_question") {
    const topic = topicChips(turn);
    if (topic && topic.length) return topic;
  }
  if (!turn.plan) return followUpChips(turn.task).slice(0, 3);
  return planChips(turn, turn.plan);
}
