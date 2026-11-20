/**
 * Code-side guard: a venue name in the reply must come from the Maio data (places, business directory,
 * island background, reviewed enrichment) or from this turn's labelled outside results.
 * A sentence naming anything else ("Clínica Dentária do Maio", "check with Barra bars") is dropped.
 */
import { fold } from "./geo.ts";

/** Words that make a capitalised phrase a venue name. */
const VENUE = /^(?:clinica|clinic|dentaria|dental|dentist|restaurante|restaurant|bar|cafe|caffe|hotel|pousada|residencial|pensao|guesthouse|hostel|shop|loja|supermercado|supermarket|minimercado|mercado|market|farmacia|pharmacy|salon|salao|barbearia|barber|studio|estudio|gym|ginasio|fitness|escola|school|lavandaria|laundry|pizzeria|snack|boutique|spa|academia)$/;
/** After these, a lone capitalised word is a place the guest is sent to. */
const LOCATIVE = /^(?:in|at|near|with|to|from|em|no|na|nos|nas|a|chez|pres|vers|dans|ao)$/;
const CONNECTOR = /^(?:de|do|da|dos|das|du|des|of|the|e|&|la|le|el)$/;
const ALWAYS_OK = new Set(["i", "yes", "no", "ok", "google", "google maps", "maps", "source", "sources", "fonte", "fontes", "maio", "cabo verde", "cape verde", "cap vert", "aluguer", "aluguers", "taxi", "uber",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "english", "portuguese", "french", "creole", "kriolu", "europe", "african", "africa", "atlantic"]);

export type NameGuardResult = { reply: string; dropped: string[] };

function runs(sentence: string): { text: string; before: string; first: boolean }[] {
  const tokens = sentence.split(/(\s+|[,;:()/"“”—–]|(?<=\w)\.(?=\s|$))/).filter((item) => item && !/^\s+$/.test(item));
  const out: { text: string; before: string; first: boolean }[] = [];
  let current: string[] = [];
  let before = "";
  let start = 0;
  const flush = (index: number) => {
    while (current.length && CONNECTOR.test(fold(current[current.length - 1]))) current.pop();
    if (current.length) out.push({ text: current.join(" "), before, first: start === 0 });
    current = [];
    void index;
  };
  tokens.forEach((token, index) => {
    const word = token.replace(/^[^\p{L}\d]+|[^\p{L}\d'’&-]+$/gu, "");
    const capital = /^\p{Lu}/u.test(word);
    if (capital) {
      if (!current.length) { before = index > 0 ? fold(tokens[index - 1]) : ""; start = index; }
      current.push(word);
    } else if (current.length && CONNECTOR.test(fold(word)) && /^\p{Lu}/u.test(tokens[index + 1] ?? "")) {
      current.push(word);
    } else {
      flush(index);
    }
  });
  flush(tokens.length);
  return out;
}

export function knownText(names: string[]): string {
  return `| ${names.map(fold).filter(Boolean).join(" | ")} |`;
}

function isKnown(phrase: string, known: string): boolean {
  const n = fold(phrase);
  if (!n || ALWAYS_OK.has(n)) return true;
  return known.includes(` ${n} `) || known.includes(` ${n} |`) || known.includes(`| ${n} `);
}

/** Unknown venue names in one sentence. */
export function unknownNames(sentence: string, known: string): string[] {
  const bad: string[] = [];
  for (const run of runs(sentence)) {
    const words = fold(run.text).split(" ");
    const venue = words.some((word) => VENUE.test(word));
    const sentTo = words.length === 1 && LOCATIVE.test(run.before.split(" ").pop() ?? "") && !run.first;
    if (!venue && !sentTo) continue;
    if (isKnown(run.text, known)) continue;
    // "Restaurante Nha Terra": a venue word in front of a whole listed name is still that listing.
    const rest = words.filter((word) => !VENUE.test(word)).join(" ").replace(/^(?:(?:de|do|da|dos|das|du|des|of|the|e|la|le|el) )+/, "");
    if (venue && rest && !ALWAYS_OK.has(rest) && known.includes(`| ${rest} |`)) continue;
    bad.push(run.text);
  }
  return bad;
}

const HONEST = {
  en: "I don't have that listed for Maio; ask your stay or locals.",
  pt: "Não tenho isso listado para o Maio; pergunte na sua estadia ou aos locais.",
  fr: "Je n'ai pas cela dans les listes de Maio ; demandez à votre hébergement ou aux habitants.",
} as const;

export function dropUnknownNames(reply: string, known: string, locale: "en" | "pt" | "fr"): NameGuardResult {
  const sentences = reply.split(/(?<=[.!?])\s+/).filter(Boolean);
  const dropped: string[] = [];
  const kept = sentences.filter((sentence) => {
    const bad = unknownNames(sentence, known);
    dropped.push(...bad);
    return bad.length === 0;
  });
  if (!dropped.length) return { reply, dropped };
  if (!kept.length) return { reply: HONEST[locale], dropped };
  const lostOpening = unknownNames(sentences[0], known).length > 0;
  return { reply: `${lostOpening ? `${HONEST[locale]} ` : ""}${kept.join(" ")}`.trim(), dropped };
}
