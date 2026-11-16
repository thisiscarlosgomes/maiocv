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
    relax: "Make day 2 more relaxed",
    boat: "Add a boat trip",
    pdf: "Export as PDF",
    openTrip: "Open trip",
    hi: "hi",
    first: "the first one",
    hospital: "what's the hospital number",
    phone: "phone number for Sete Sois Sete Luas",
    sea: /sea forecast/i,
    ferry: /ferries and flights|ferry times/i,
    understand: /Understanding your trip/i,
    thinking: /Thinking/i,
  },
  pt: {
    open: "3 dias, ritmo calmo, com carro",
    relax: "Deixa o dia 2 mais calmo",
    boat: "Acrescenta um passeio de barco",
    pdf: "Exportar em PDF",
    openTrip: "Abrir viagem",
    hi: "olá",
    first: "o primeiro",
    hospital: "qual é o número do hospital",
    phone: "número de telefone do Sete Sois Sete Luas",
    sea: /previsão do mar/i,
    ferry: /barcos e voos|horários do barco/i,
    understand: /A perceber o pedido/i,
    thinking: /pensar/i,
  },
  fr: {
    open: "3 jours, rythme calme, avec une voiture",
    relax: "Rends le jour 2 plus calme",
    boat: "Ajoute une sortie en bateau",
    pdf: "Exporter en PDF",
    openTrip: "Ouvrir le voyage",
    hi: "bonjour",
    first: "le premier",
    hospital: "quel est le numéro de l'hôpital",
    phone: "numéro de téléphone de Sete Sois Sete Luas",
    sea: /prévision de la mer/i,
    ferry: /ferries et des vols|horaires du ferry/i,
    understand: /Je lis votre demande/i,
    thinking: /réfléchis/i,
  },
} as const;

function visibleStops(plan: TripPlan, index: number) {
  return plan.days[index].items.filter((item) => item.kind === "food" || item.kind === "place" || item.kind === "experience").length;
}

async function readPlan(page: Page) {
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
    test(`${locale} ${viewport.name} correction chips`, async ({ page }) => {
      await page.addInitScript(() => {
        const win = window as Window & { __printed?: number };
        win.__printed = 0;
        window.print = () => { win.__printed = (win.__printed ?? 0) + 1; };
      });
      await page.setViewportSize(viewport);
      await page.goto(`/${locale}/plan`);
      const text = copy[locale];
      await ask(page, text.open);
      await expect(page.getByTestId("plan-trip-card")).toBeVisible();
      const before = await readPlan(page);
      const replies = await page.getByTestId("assistant-reply").count();
      await page.getByRole("button", { name: text.relax, exact: true }).click();
      await expect(page.getByTestId("assistant-reply")).toHaveCount(replies + 1);
      await expect.poll(async () => visibleStops(await readPlan(page), 1)).toBeLessThan(visibleStops(before, 1));
      const relaxed = await readPlan(page);
      expect(JSON.stringify(relaxed.days[0].items)).toBe(JSON.stringify(before.days[0].items));
      expect(JSON.stringify(relaxed.days[2].items)).toBe(JSON.stringify(before.days[2].items));
      await expect(page.getByRole("button", { name: text.relax, exact: true })).toHaveCount(0);
      await expect(page.getByTestId("assistant-reply").last()).not.toContainText(/Tap the card|Toque no cartão|Touchez la carte/);

      const food = before.days.flatMap((day) => day.items.filter((item) => item.kind === "food").map((item) => item.refId));
      // Enzo Caffe Pizza (food-006) left the Maio API on Nov 16, so a plan never uses it.
      expect(food).not.toContain("food-006");

      const afterRelax = await page.getByTestId("assistant-reply").count();
      await page.getByRole("button", { name: text.boat, exact: true }).click();
      await expect(page.getByTestId("assistant-reply")).toHaveCount(afterRelax + 1);
      await expect.poll(async () => {
        const plan = await readPlan(page);
        return plan.days.some((day) => day.items.some((item) => item.kind === "experience" && /fishing|boat/i.test(item.refId)));
      }).toBe(true);
      await expect(page.getByRole("button", { name: text.boat, exact: true })).toHaveCount(0);

      await page.getByRole("button", { name: text.openTrip }).last().click();
      await expect(page.getByTestId("plan-day").first()).toBeVisible();
      await expect(page.getByRole("button", { name: /view day on map|ver o dia no mapa|voir la journée sur la carte/i })).toHaveCount(0);
      await page.getByRole("button", { name: /Back to chat|Voltar ao chat|Retour au chat/ }).click();

      await page.getByRole("button", { name: text.pdf, exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as Window & { __printed?: number }).__printed ?? 0)).toBeGreaterThan(0);
      await expect(page.locator(".plan-trip")).toBeVisible();
      await expect(page.getByRole("button", { name: /view day on map|ver o dia no mapa|voir la journée sur la carte/i })).toHaveCount(0);
    });
  }

  test(`${locale} loading status matches the question`, async ({ page }) => {
    let release = () => {};
    await page.route("**/api/plan", async (route) => {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ reply: "Ok.", plan: null, chips: [], intent: "side_question", status: "", task: null }),
      });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/${locale}/plan`);
    const text = copy[locale];
    const typing = page.getByTestId("typing");
    await ask(page, text.hi);
    await expect(typing).toHaveCount(0);
    release();
    await expect(page.getByTestId("assistant-reply").last()).toBeVisible();
    for (const message of [text.first, text.hospital, text.phone]) {
      await ask(page, message);
      await expect(typing).toBeVisible();
      await expect(typing).not.toContainText(text.sea);
      await expect(typing).not.toContainText(text.ferry);
      release();
      await expect(typing).toHaveCount(0);
    }
    await ask(page, text.open);
    await expect(typing).toBeVisible();
    await expect(typing).toContainText(text.understand);
    await expect(typing).not.toContainText(text.sea);
    await expect(typing).not.toContainText(text.ferry);
    release();
  });
}
