import { expect, test, type Page } from "@playwright/test";
import { decodeTrip } from "../lib/trip-share.ts";
import { parseTripPlan } from "../lib/trip.ts";

const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 700 },
] as const;

async function ask(page: Page, text: string) {
  const before = await page.getByTestId("assistant-reply").count();
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("assistant-reply")).toHaveCount(before + 1);
}

async function planDates(page: Page) {
  const raw = new URL(page.url()).searchParams.get("trip");
  expect(raw).toBeTruthy();
  const plan = parseTripPlan(decodeTrip(raw!));
  expect(plan).toBeTruthy();
  return plan!.days.map((day) => day.date);
}

test("moving to the 18th keeps four days and sends a new card", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/en/plan");
  await ask(page, "4 days, no car");
  await expect(page.getByTestId("plan-trip-card")).toHaveCount(1);
  const before = await planDates(page);
  expect(before).toHaveLength(4);
  await ask(page, "am actually going on the 18th");
  await expect(page.getByTestId("plan-trip-card")).toHaveCount(2);
  const after = await planDates(page);
  expect(after).toHaveLength(4);
  expect(after[0]?.endsWith("-18")).toBe(true);
  expect(after[0]).not.toBe(before[0]);
  await expect(page.getByTestId("assistant-reply").last()).toContainText(/Moved your 4 days/);
  await expect(page.getByTestId("assistant-reply").last()).not.toContainText(/didn't change|All set/);
});

for (const viewport of viewports) {
  for (const [locale, open, extra, flight, relax] of [
    ["en", "3 days from wed 18, with a car", "add another day", "whens the next flight", "make day 2 more relaxed"],
    ["pt", "3 dias a partir de quarta 18, com carro", "mais um dia", "qual é o próximo voo", "deixa o dia 2 mais relaxado"],
    ["fr", "3 jours à partir du mercredi 18, avec une voiture", "un jour de plus", "prochain vol", "rends le jour 2 plus détendu"],
  ] as const) {
    test(`${locale} ${viewport.name} keeps wed 18 and grows the plan`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/${locale}/plan`);
      const fresh = page.getByTestId("suggestions").getByRole("button");
      await expect(fresh).toHaveCount(3);
      await ask(page, open);
      await expect(page.getByTestId("plan-trip-card")).toBeVisible();
      await expect.poll(() => planDates(page)).toEqual(["2026-11-18", "2026-11-19", "2026-11-20"]);
      const cards = await page.getByTestId("plan-trip-card").count();
      await ask(page, flight);
      await expect(page.getByTestId("assistant-reply").last()).not.toContainText(/Tap the card|Toque no cartão|Touchez la carte/);
      expect(await planDates(page)).toEqual(["2026-11-18", "2026-11-19", "2026-11-20"]);
      expect(await page.getByTestId("plan-trip-card").count()).toBe(cards);
      await ask(page, extra);
      await expect.poll(() => planDates(page)).toEqual(["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"]);
      await expect(page.getByTestId("assistant-reply").last()).not.toContainText(/Done —/);
      await expect(page.getByTestId("plan-trip-card").last()).toBeVisible();
      await ask(page, relax);
      await expect(page.getByTestId("assistant-reply").last()).not.toContainText(/Tap the card|Toque no cartão|Touchez la carte/);
      expect(await planDates(page)).toEqual(["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"]);
    });
  }
}
