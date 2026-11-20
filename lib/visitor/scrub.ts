/**
 * Code-side guard for the guide's reply: things the model keeps saying that are not in the data.
 * - a "tourist office" (Maio has none in the listings),
 * - raw listing wording ("location not listed", "(listed)", 'listed as a "…" experience'),
 * - superlatives pinned on other people ("most visitors call X the most beautiful").
 * Phrases are rewritten where the sentence still reads; otherwise the sentence goes.
 */

const SENTENCE_LEAK = /location not listed|not listed as/i;
const OFFICE = /\btourist (?:office|information)|tourism office|posto de turismo|office de tourisme/i;
/** "No tourist office is listed" is the honest answer; only a sentence that sends the guest to one is a leak. */
const NEGATED = /\b(?:no|not|isn't|isnt|there is no|there's no|without|nao|não|nenhum|pas de|aucun|n'y a pas)\b/i;
export function sendsToOffice(sentence: string): boolean {
  return OFFICE.test(sentence) && !NEGATED.test(sentence);
}

export function scrubReply(text: string): string {
  let out = text
    // "(listed)", "(listed as a "location not listed" experience)", "(location not listed)".
    .replace(/\s*\((?:[^()]*\b(?:listed|listing|listings)\b[^()]*)\)/gi, "")
    // ", ask your hotel or the Tourist Office in Vila to book" → ", ask your hotel to book".
    .replace(/\s*(?:,\s*)?(?:or|and|ou|et)\s+(?:the|a|o|a|le|l')?\s*(?:local\s+)?(?:tourist (?:office|information(?: (?:office|centre|center|point))?)|tourism office|posto de turismo|office de tourisme)(?:\s+(?:in|at|on|em|no|na|à|a)\s+[A-ZÀ-Ý][\wÀ-ÿ'-]*(?:\s+(?:do|de|da)\s+[A-ZÀ-Ý][\wÀ-ÿ'-]*)?)?/gi, "")
    // Opinion stays, but as the guide's own, not "most visitors".
    .replace(/\b(?:most|many|all) (?:visitors|people|travell?ers|tourists|guests|locals) (?:call|consider)\b/gi, "I'd call")
    .replace(/\b(?:most|many|all) (?:visitors|people|travell?ers|tourists|guests|locals) (?:say|agree|think|rate)\b(?: that)?/gi, "I'd say")
    .replace(/\beveryone (?:says|agrees)\b(?: that)?/gi, "I'd say")
    .replace(/\beveryone calls\b/gi, "I'd call")
    .replace(/\bwidely (?:considered|regarded)(?: as)?\b/gi, "arguably")
    // "most visitors without a car also stay in Vila" → "you can also stay in Vila".
    .replace(/\b(?:most|many) (?:visitors|people|travell?ers|tourists|guests)(?: (?:without|with) an? \w+)? (?:also )?(stay|go|head|look at|consider|choose|pick|book)\b/gi, "you can also $1")
    // "the local listing shows it as a Calheta restaurant" → "it is a Calheta restaurant".
    .replace(/\b(?:the |its )?(?:local )?listings? (?:shows?|lists?|has) (it|them) as\b/gi, (_m, who: string) => (who.toLowerCase() === "it" ? "it is" : "they are"))
    // "note the listing says the sea…" → "note the sea…".
    .replace(/\b(?:the |its )?(?:local )?listings? (?:says?|notes?|mentions?|describes? it as)(?: that)?\s+/gi, "")
    // "look for operators listed as Big Game…" → "look for Big Game…"; "in the island listings" → "".
    .replace(/\b(?:operators?|places?|businesses|business) listed as\s+/gi, "")
    // 'listed as a "location not listed" experience' → ''; "are listed as dangerous" → "are dangerous".
    .replace(/,?\s*(?:is |are )?listed as an? ["“][^"”]*["”](?:\s+\w+)?/gi, "")
    .replace(/\b(is|are) (?:also )?listed as\b/gi, "$1")
    .replace(/\s*(?:in|on|from) the (?:island |local |maio )?listings\b/gi, "")
    // Any remaining "the listing says/shows/data" or bare "location not listed": cut the words, keep the sentence.
    .replace(/,?\s*\b(?:according to |per |from )?(?:the |its |our )?(?:local |island |maio )?(?:listings?|the data)(?: (?:says?|shows?|notes?|mentions?|data|entry|record))?(?: (?:that|it is|it's))?\s*(?=[,.;:]|$)/gi, "")
    .replace(/\b(?:the |its |our )?(?:local |island |maio )?listings? (?:says?|shows?|notes?|mentions?)(?: that)?\s+/gi, "")
    .replace(/,?\s*\(?location not listed\)?,?/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .trim();
  // Sentence-level last resort for anything the rewrites did not reach.
  const sentences = out.split(/(?<=[.!?])\s+/);
  const clean = sentences.filter((sentence) => !SENTENCE_LEAK.test(sentence) && !sendsToOffice(sentence));
  if (clean.length && clean.length < sentences.length) out = clean.join(" ");
  else if (!clean.length) out = "";
  return out.replace(/^[a-zà-ÿ]/, (c) => c.toUpperCase());
}
