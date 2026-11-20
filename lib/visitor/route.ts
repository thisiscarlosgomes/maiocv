import { fold } from "./geo.ts";

export type VisitorSignals = {
  planShaping: boolean;
  intent: string;
  research: boolean;
  carPending: boolean;
  hasPlan: boolean;
  planEdit: boolean;
  businessLookup?: boolean;
  /** The planner already has a data-built answer for this kind of turn. */
  scripted?: boolean;
};

const EMERGENCY = /\b(hospital|hospit|hopital|emergenc\w*|urgencia|urgence|police|policia|gendarmerie|ambulanc\w*)\b/;
const PLAN_WORDS = /\b(plan (?:my|our|a|the|around|from|with|for)|plan it|itinerary|itinerario|roteiro|itineraire|planeia|planear|planifie|build (?:a|my|our) (?:plan|trip)|day by day|dia a dia|\d+\s*(?:days?|dias?|jours?|nights?|noites?|nuits?))\b/;
const QUESTION = /^(?:what|where|which|how|is|are|can|could|should|do|does|any|anything|tell|recommend|suggest|best|o que|onde|qual|quais|como|ha|tem|existe|pode|recomenda|sugere|melhor|que|ou|quel|quelle|quels|comment|est ce|y a t il|peut on|conseill\w*)\b/;
/** With a plan on screen these words mean an edit of the plan, not a new question. */
const PLAN_EDIT = /\b(day|days|dia|dias|jour|jours|first|last|ultimo|dernier|primeiro|premier|tomorrow|amanha|demain|monday|tuesday|wednesday|thursday|friday|saturday|sunday|segunda|terca|quarta|quinta|sexta|sabado|domingo|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|morning|afternoon|evening|manha|tarde|noite|matin|apres midi|soir|plan|trip|viagem|voyage|itinerary|easier|calmer|slower|busier|relax|swap|replace|add|remove|move|drop|shift|trocar|troca|adiciona|tira|remove|muda|mudar|ajoute|enleve|change|changer)\b/;
const VISITOR_TOPIC = /\b(near|nearby|close|around|walk|walking|eat|food|restaurant|lunch|dinner|breakfast|bar|drink|beach|beaches|swim|snorkel|surf|kite|turtle|best|recommend|things? to do|visit|see|get to|get there|getting to|fly|flight from|from lisbon|lisbon|lisboa|sal |boa vista|praia|ferry|car|taxi|aluguer|without a car|no car|safe|season|weather|when to|culture|music|cheese|grogue|stay|hotel|perto|comer|almoco|jantar|praia|praias|nadar|visitar|ver |chegar|como ir|sem carro|melhor|manger|plage|plages|pres|proche|visiter|voir|sans voiture|aller)\b/;

/**
 * True when the turn is a visitor question for the guide agent rather than plan building or a plan edit.
 * Keeps the scripted car question, plan builds and edits, emergencies and research figures where they were.
 */
export function isVisitorQuestion(text: string, signals: VisitorSignals): boolean {
  const n = fold(text);
  if (!n) return false;
  if (signals.carPending || signals.planShaping || signals.planEdit || signals.scripted) return false;
  // Visitor figures (how many tourists, population) keep the planner's no-guess answer.
  if (signals.research && /\b(how many|quantos|quantas|combien|number of|numero de|statistic\w*|estatistic\w*|count|figures?|20\d\d)\b/.test(n)) return false;
  if (EMERGENCY.test(n)) return false;
  // Phones, contacts and named-business lookups keep the directory answer, which quotes published numbers only.
  if (signals.businessLookup || /\b(phone|telefone|telephone|numero|number|contact|contacto|contato|whatsapp|email|pharmacy|farmacia|pharmacie)\b/.test(n)) return false;
  if (PLAN_WORDS.test(n)) return false;
  if (/\b(sunset time|por do sol (?:e |as )?que horas|heure du coucher)\b/.test(n)) return false;
  // With a plan on screen, only clear questions go to the guide; short replies are plan follow-ups.
  const asked = text.includes("?") || QUESTION.test(n);
  if (signals.hasPlan && (!asked || PLAN_EDIT.test(n))) return false;
  return asked || VISITOR_TOPIC.test(n);
}
