/**
 * Services the Maio data rarely lists (gym, dentist, pharmacy, laundry, yoga, car hire, doctor, ATM, SIM).
 * When the guest asks for one and the Maio API has no match, the guide searches outside the listings
 * in code, every time (Google Places, then Parallel), instead of hoping the model calls the tool.
 * Outside hits are cleaned first: already-listed places, generic names and off-category results are dropped.
 */
import { fold } from "./geo.ts";
import type { FallbackHit } from "./fallback.ts";

export type OutsideNeed = {
  id: string;
  /** Short query for Google Places / Parallel. */
  query: string;
  /** A hit's name, Google types or web text must match this to count as that service. */
  relevant: RegExp;
  googleTypes: string[];
  /** Stricter: a Maio listing whose name or category matches this already covers the need. */
  listed: RegExp;
  /** How the reply names the service. */
  label: { en: string; pt: string; fr: string };
  /** Said alongside the results (pharmacy/doctor: the hospital). */
  extra?: string;
};

const HOSPITAL = "For urgent care, Hospital do Maio (Vila do Maio) is +238 255 11 30.";

const NEEDS: (OutsideNeed & { ask: RegExp })[] = [
  { id: "dentist", listed: /\b(?:dent\w*|odonto\w*)\b/, label: { en: "dentist", pt: "dentista", fr: "dentiste" }, query: "dentist", ask: /\b(?:dentist\w*|dental|dentista\w*|dentiste\w*|clinica dentaria|tooth|teeth|dente|dentes|dent)\b/, relevant: /dent|odonto|smile|sorriso/, googleTypes: ["dentist", "dental_clinic"] },
  { id: "pharmacy", listed: /\b(?:pharmac\w*|farmac\w*)\b/, label: { en: "pharmacy", pt: "farmácia", fr: "pharmacie" }, query: "pharmacy", ask: /\b(?:pharmac\w*|farmacia\w*|chemist\w*|drugstore|medicine|medicamento\w*|medicament\w*)\b/, relevant: /farmac|pharmac|drug|botica/, googleTypes: ["pharmacy", "drugstore"], extra: HOSPITAL },
  { id: "doctor", listed: /\b(?:clinic\w*|medic\w*|centro de saude|health cent\w*|hospital)\b/, label: { en: "doctor or clinic", pt: "médico ou clínica", fr: "médecin ou clinique" }, query: "medical clinic doctor", ask: /\b(?:doctor|medico|medica|clinic|clinica|centro de saude|health centre|health center|medecin)\b/, relevant: /clinic|medic|saude|health|hospital|centro|doctor|medecin/, googleTypes: ["doctor", "hospital", "medical_clinic", "medical_lab"], extra: HOSPITAL },
  { id: "gym", listed: /\b(?:gym\w*|ginasio\w*|fitness|crossfit|academia)\b/, label: { en: "gym", pt: "ginásio", fr: "salle de sport" }, query: "gym fitness", ask: /\b(?:gym|gyms|ginasio\w*|fitness|workout|musculacao|salle de sport|crossfit)\b/, relevant: /gym|gina|fitness|crossfit|muscula|sport|academia|training|treino/, googleTypes: ["gym", "fitness_center", "sports_club", "sports_complex"] },
  { id: "laundry", listed: /\b(?:laund\w*|lavandaria\w*|lavanderia\w*|laverie)\b/, label: { en: "laundry", pt: "lavandaria", fr: "laverie" }, query: "laundry", ask: /\b(?:laundry|laundromat|lavandaria\w*|lavanderia\w*|laverie|pressing|wash (?:my )?clothes|lavar roupa)\b/, relevant: /laund|lavand|lavander|laver|pressing|wash|lava/, googleTypes: ["laundry", "dry_cleaner"] },
  { id: "yoga", listed: /\b(?:yoga|ioga|pilates)\b/, label: { en: "yoga", pt: "ioga", fr: "yoga" }, query: "yoga", ask: /\b(?:yoga|ioga|pilates|meditation|meditacao)\b/, relevant: /yoga|ioga|pilates|medita|wellness|bem estar/, googleTypes: ["yoga_studio", "wellness_center", "fitness_center", "gym", "spa"] },
  { id: "car", listed: /\b(?:rent a car|car rental|car hire|aluguer de (?:carro|viatura)\w*|location de voiture)\b/, label: { en: "car hire", pt: "aluguer de carro", fr: "location de voiture" }, query: "car rental", ask: /\b(?:rent(?:al)? (?:a )?car|car (?:hire|rental)|hire (?:a )?car|rent-a-car|aluguer de (?:carro|viatura)\w*|alugar (?:um )?carro|location de voiture|louer une voiture|4x4 rental)\b/, relevant: /car|rent|aluguer|auto|viatura|location|4x4|jeep/, googleTypes: ["car_rental"] },
  { id: "atm", listed: /\b(?:atm|bank|banks|banco|bancos|caixa economica|multibanco|vinti4)\b/, label: { en: "ATM or bank", pt: "multibanco ou banco", fr: "distributeur ou banque" }, query: "ATM bank", ask: /\b(?:atm|cash machine|cashpoint|multibanco|vinti4|caixa (?:automatica|multibanco)|bank|banco|banque|distributeur)\b/, relevant: /atm|bank|banco|banque|caixa|vinti|bca|bcn|bai|ecobank|multibanco/, googleTypes: ["atm", "bank"] },
  { id: "sim", listed: /\b(?:unitel|cvmovel|cv movel|telecom|sim)\b/, label: { en: "SIM card shop", pt: "loja de cartões SIM", fr: "boutique de cartes SIM" }, query: "SIM card mobile phone shop", ask: /\b(?:sim card|sim cards|esim|mobile data|cvmovel|unitel|carte sim|cartao sim|chip de telemovel)\b/, relevant: /sim|movel|unitel|alou|telecom|mobile|cv ?movel/, googleTypes: ["cell_phone_store", "electronics_store"] },
];

/** The outside-only service a question asks for, if any. */
export function outsideNeed(question: string): OutsideNeed | null {
  const n = fold(question);
  const hit = NEEDS.find((need) => need.ask.test(n));
  if (!hit) return null;
  const { ask: _ask, ...need } = hit;
  return need;
}

const GENERIC = /^(?:maio|maio cabo verde|maio cape verde|ilha do maio|maio island|vila do maio|cidade do maio|porto ingles|cabo verde|cape verde|calheta|morro|morrinho|santo antonio|pedro vaz|ribeira dom joao|figueira|cascabulho|barreiro|praia)$/;

/**
 * Outside hits worth showing: on topic for the need, not a bare place name, and not a place Maio already lists.
 * `isListed` says whether a name is already a Maio listing (those must never be labelled "Google Maps").
 */
export function cleanOutsideHits(hits: FallbackHit[], need: OutsideNeed | null, isListed: (name: string) => boolean): FallbackHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const name = fold(hit.name);
    if (!name || GENERIC.test(name) || seen.has(name)) return false;
    if (isListed(hit.name)) return false;
    seen.add(name);
    if (!need) return true;
    const types = (hit.types ?? []).map((type) => type.toLowerCase());
    if (types.some((type) => need.googleTypes.includes(type))) return true;
    const text = fold(`${hit.name} ${hit.source === "web" ? hit.snippet ?? "" : ""}`);
    return need.relevant.test(text);
  });
}
