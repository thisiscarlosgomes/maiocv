import { expect, test, type Page } from "@playwright/test";
import { decodeTrip } from "../lib/trip-share.ts";
import { parseTripPlan, type TripPlan } from "../lib/trip.ts";

const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 700 },
] as const;

const copy = {
  en: {
    open: "3 days, slow pace, with a car",
    ferry: "When is the next ferry to Praia?",
    flight: "Flights from Maio on Wednesday",
    boat: "Add a boat trip",
    relax: "Make day 2 more relaxed",
    short: /short day/i,
  },
  pt: {
    open: "3 dias, ritmo calmo, com carro",
    ferry: "Quando é o próximo barco para a Praia?",
    flight: "Voos do Maio na quarta",
    boat: "Acrescenta um passeio de barco",
    relax: "Deixa o dia 2 mais calmo",
    short: /dia curto/i,
  },
  fr: {
    open: "3 jours, rythme calme, avec une voiture",
    ferry: "Quand est le prochain ferry vers Praia ?",
    flight: "Vols depuis Maio mercredi",
    boat: "Ajoute une sortie en bateau",
    relax: "Rends le jour 2 plus calme",
    short: /journée courte/i,
  },
} as const;

function maioTomorrow(now = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Atlantic/Cape_Verde", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [year, month, day] = today.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

async function readPlan(page: Page): Promise<TripPlan> {
  const raw = new URL(page.url()).searchParams.get("trip");
  expect(raw).toBeTruthy();
  const plan = parseTripPlan(decodeTrip(raw!));
  expect(plan).toBeTruthy();
  return plan!;
}

async function ask(page: Page, text: string) {
  const input = page.getByTestId("chat-input");
  await input.fill(text);
  await page.getByTestId("chat-send").click();
}

for (const locale of ["en", "pt", "fr"] as const) {
  for (const viewport of viewports) {
    test(`${locale} ${viewport.name} last day, dates and side questions`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/${locale}/plan`);
      const text = copy[locale];
      await ask(page, text.open);
      await expect(page.getByTestId("plan-trip-card")).toBeVisible();
      const plan = await readPlan(page);
      expect(plan.days[0].date).toBe(maioTomorrow());
      expect(plan.days.map((day) => day.date)).toEqual([
        maioTomorrow(),
        new Date(Date.parse(`${maioTomorrow()}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10),
        new Date(Date.parse(`${maioTomorrow()}T12:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10),
      ]);
      const last = plan.days.at(-1)!;
      const depart = last.items.find((item) => item.slot === "departure" || item.refId.startsWith("depart-"));
      const reply = await page.getByTestId("assistant-reply").last().innerText();
      expect(reply).not.toMatch(/\b(?:on|o|no|au|le)\s*\n+\s*(?:day|dia|jour)\s+\d/i);
      if (depart?.start && depart.start < "12:00") {
        expect(`${depart.note ?? ""} ${reply}`).toMatch(text.short);
      } else {
        expect(last.items.some((item) => item.kind === "place")).toBe(true);
        expect(last.items.some((item) => item.slot === "lunch")).toBe(true);
      }

      const before = JSON.stringify(plan.days);
      await ask(page, text.ferry);
      await expect(page.getByTestId("assistant-reply").last()).not.toContainText(/Tap the card|Toque no cartão|Touchez la carte/);
      expect(JSON.stringify((await readPlan(page)).days)).toBe(before);
      await ask(page, text.flight);
      expect(JSON.stringify((await readPlan(page)).days)).toBe(before);

      await page.getByRole("button", { name: text.boat, exact: true }).click();
      const boat = await page.getByTestId("assistant-reply").last().innerText();
      expect(boat).not.toMatch(/\bon\s*\n+\s*day\s+\d|\bno\s*\n+\s*dia\s+\d|\bau\s*\n+\s*jour\s+\d/i);
      await page.getByRole("button", { name: text.relax, exact: true }).click();
      const relaxed = await page.getByTestId("assistant-reply").last().innerText();
      expect(relaxed).not.toMatch(/\bO\s*\n+\s*dia\s+\d|\bLe\s*\n+\s*jour\s+\d|\bDay\s+\d\b\s*\n/i);
    });
  }
}
