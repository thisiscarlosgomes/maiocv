/**
 * Code-side guard for the guide's reply: things the model keeps saying that are not in the data.
 * - a "tourist office" (Maio has none in the listings),
 * - raw listing wording ("location not listed", "(listed)", 'listed as a "…" experience'),
 * - superlatives pinned on other people ("most visitors call X the most beautiful").
 * Phrases are rewritten where the sentence still reads; otherwise the sentence goes.
 */

const SENTENCE_LEAK = /\btourist (?:office|information)|tourism office|posto de turismo|office de tourisme|location not listed|not listed as|listed as an? ["“]/i;

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
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .trim();
  // Sentence-level last resort for anything the rewrites did not reach.
  const sentences = out.split(/(?<=[.!?])\s+/);
  const clean = sentences.filter((sentence) => !SENTENCE_LEAK.test(sentence));
  if (clean.length && clean.length < sentences.length) out = clean.join(" ");
  else if (!clean.length) out = "";
  return out.replace(/^[a-zà-ÿ]/, (c) => c.toUpperCase());
}
