import { expect, test, type Page } from "@playwright/test";
import { buildPlan } from "../lib/trip-planner.ts";
import { encodeTrip } from "../lib/trip-share.ts";

const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 700 },
] as const;

const forecast = [16, 17, 18, 19, 20].map((day) => ({
  date: `2026-11-${day}`,
  waveHeightM: 0.8,
  windKmh: 16,
  tempMaxC: 28,
  sunset: "18:10",
}));

function pdfPages(bytes: Buffer) {
  return bytes.toString("latin1").match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
}

const longAnswer = Array.from({ length: 28 }, (_, i) => `Paragraph ${i + 1}. Maio's coast stays walkable from Vila do Maio, and the afternoon is free.`).join("\n\n");

async function pinMetrics(page: Page) {
  return page.evaluate(() => {
    const pane = document.querySelector(".chat-conversation");
    const question = [...document.querySelectorAll("[data-testid='user-message']")].at(-1);
    const answer = [...document.querySelectorAll("[data-testid='assistant-reply']")].at(-1);
    if (!pane || !question || !answer) return null;
    const paneBox = pane.getBoundingClientRect();
    const questionBox = question.getBoundingClientRect();
    const answerBox = answer.getBoundingClientRect();
    return {
      questionTop: questionBox.top - paneBox.top,
      answerBelow: answerBox.top >= questionBox.bottom - 4,
      answerContinues: answerBox.bottom > paneBox.bottom + 40,
    };
  });
}

for (const locale of ["en", "pt", "fr"] as const) {
  for (const days of [3, 5]) {
    test(`pdf ${locale} ${days} days is more than one page`, async ({ page }) => {
      const plan = buildPlan({
        request: { startDate: "2026-11-16", days, locale, adults: 2, hasCar: true, boatTrips: 0 },
        forecast: forecast.slice(0, days),
        sailings: [],
      });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/${locale}/plan?trip=${encodeTrip(plan)}&screen=trip`);
      await expect(page.getByTestId("plan-day")).toHaveCount(days);
      const pdf = await page.pdf({ format: "A4", printBackground: true });
      expect(pdfPages(pdf)).toBeGreaterThan(1);
    });
  }
}

for (const viewport of viewports) {
  test(`${viewport.name} open trip starts at day 1`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/en/plan");
    const input = page.getByTestId("chat-input");
    await input.fill("3 days, slow pace, no car");
    await page.getByTestId("chat-send").click();
    await expect(page.getByTestId("plan-trip-card")).toBeVisible();
    const pane = page.locator(".chat-conversation");
    await pane.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await page.getByRole("button", { name: "Open trip" }).click();
    await expect(page.getByTestId("plan-day").first()).toBeVisible();
    const place = await page.evaluate(() => {
      const paneNode = document.querySelector(".chat-conversation");
      const day = document.querySelector("[data-testid='plan-day']");
      if (!paneNode || !day) return null;
      const paneBox = paneNode.getBoundingClientRect();
      const dayBox = day.getBoundingClientRect();
      const second = document.querySelectorAll("[data-testid='plan-day']")[1];
      const secondTop = second ? second.getBoundingClientRect().top - paneBox.top : dayBox.bottom;
      return { top: dayBox.top - paneBox.top, paneTop: paneNode.scrollTop, paneHeight: paneBox.height, secondTop };
    });
    expect(place).not.toBeNull();
    expect(place!.paneTop).toBeLessThan(8);
    expect(place!.top).toBeGreaterThan(-4);
    expect(place!.top).toBeLessThan(place!.paneHeight);
    expect(place!.secondTop).toBeGreaterThan(place!.top);
  });

  for (const surface of ["plan", "chat"] as const) {
    test(`${viewport.name} ${surface} pins the question above a long answer`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const url = surface === "plan" ? "**/api/plan" : "**/api/maio-chat";
      let sent = 0;
      await page.route(url, async (route) => {
        sent += 1;
        const body = surface === "plan"
          ? { reply: sent === 1 ? longAnswer : `${longAnswer}\n\nMore after the new question.`, plan: null, chips: [], intent: "side_question", task: null }
          : { message: sent === 1 ? longAnswer : `${longAnswer}\n\nMore after the new question.` };
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      });
      await page.goto(surface === "plan" ? "/en/plan" : "/en/chat");
      const input = page.getByTestId("chat-input");
      await input.fill("Tell me about the coast");
      await page.getByTestId("chat-send").click();
      await expect(page.getByTestId("assistant-reply")).toHaveCount(1);
      const pane = page.locator(".chat-conversation");
      await pane.evaluate((node) => { node.scrollTop = node.scrollHeight; });
      await input.fill("And what about the next afternoon?");
      await page.getByTestId("chat-send").click();
      await expect(page.getByTestId("assistant-reply")).toHaveCount(2);
      await expect.poll(() => pinMetrics(page)).toMatchObject({ answerBelow: true, answerContinues: true });
      const metrics = await pinMetrics(page);
      expect(metrics!.questionTop).toBeLessThanOrEqual(100);
    });
  }
}
