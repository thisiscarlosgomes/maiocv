// Phase 1 booking requests: no payment, no real WhatsApp. The operator message is
// built and logged only (see simulateOperatorSend); confirm/decline are simulated.
import { experience, type PlanItem, type TripPlan } from "./trip.ts";

export type RequestInput = { dayIndex: number; itemId: string; slot: string; guests: number; name?: string; whatsapp?: string };
export type OperatorMessage = { to: "operator (simulated)"; channel: "whatsapp"; text: string };

function mapItem(plan: TripPlan, dayIndex: number, itemId: string, fn: (item: PlanItem) => PlanItem): TripPlan {
  return { ...plan, days: plan.days.map((d, i) => i !== dayIndex ? d : { ...d, items: d.items.map((it) => it.id === itemId ? fn(it) : it) }) };
}

export function findItem(plan: TripPlan, dayIndex: number, itemId: string) {
  return plan.days[dayIndex]?.items.find((it) => it.id === itemId);
}

export function sendRequest(plan: TripPlan, input: RequestInput): { plan: TripPlan; message: OperatorMessage } | { error: string } {
  const item = findItem(plan, input.dayIndex, input.itemId);
  if (!item || item.kind !== "experience") return { error: "only experiences can be requested" };
  const exp = experience(item.refId);
  if (!exp) return { error: "unknown experience" };
  if (!exp.example.slots.includes(input.slot)) return { error: "slot not offered" };
  if (input.guests < 1 || input.guests > 20) return { error: "guests out of range" };
  const day = plan.days[input.dayIndex];
  const next = mapItem(plan, input.dayIndex, item.id, (it) => ({ ...it, start: input.slot,
    request: { state: "sent", slot: input.slot, guests: input.guests, name: input.name, whatsapp: input.whatsapp } }));
  return { plan: next, message: operatorMessage(exp.title, day.date, input) };
}

export function operatorMessage(title: string, date: string, input: RequestInput): OperatorMessage {
  const [y, m, d] = date.split("-");
  const lines = [
    `Novo pedido · ${title}`,
    `${d}/${m}/${y} às ${input.slot} · ${input.guests} ${input.guests === 1 ? "pessoa" : "pessoas"}`,
    input.name ? `Nome: ${input.name}` : null,
    input.whatsapp ? `Contacto: ${input.whatsapp}` : null,
    "Pagamento na ilha.",
    "Responda: ✓ SIM, confirmo / NÃO",
  ].filter(Boolean);
  return { to: "operator (simulated)", channel: "whatsapp", text: lines.join("\n") };
}

/** Logs only. Never sends anything. */
export function simulateOperatorSend(message: OperatorMessage, log: (line: string) => void = console.info) {
  log(`[simulated whatsapp → ${message.to}]\n${message.text}`);
}

export function resolveRequest(plan: TripPlan, dayIndex: number, itemId: string, answer: "confirm" | "decline"): TripPlan {
  return mapItem(plan, dayIndex, itemId, (it) => {
    if (!it.request || it.request.state !== "sent") return it;
    if (answer === "confirm") return { ...it, request: { ...it.request, state: "confirmed" } };
    const exp = experience(it.refId);
    const slots = exp?.example.slots ?? [];
    const sameDay = slots.filter((s) => s !== it.request!.slot).map((slot) => ({ date: plan.days[dayIndex].date, slot }));
    // Same slot on other days, skipping rough-sea days for sea-dependent outings.
    const otherDays = plan.days.flatMap((d, i) => i === dayIndex || (exp?.seaDependent && d.sea?.status === "rough") ? []
      : slots.slice(0, 1).map((slot) => ({ date: d.date, slot })));
    const alternatives = [...sameDay, ...otherDays].slice(0, 3);
    return { ...it, request: { ...it.request, state: "declined", alternatives } };
  });
}
