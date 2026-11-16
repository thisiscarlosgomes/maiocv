import { expect, test } from "@playwright/test";
import { encodeTrip } from "../lib/trip-share.ts";
import { samplePlan } from "../lib/trip-sample.ts";

const viewports = [{ name: "mobile", width: 390, height: 844 }, { name: "desktop", width: 1280, height: 800 }];
const copy = { en: { share: "Share", shared: "Shared plan · view only" }, pt: { share: "Partilhar", shared: "Plano partilhado · só leitura" } } as const;

for (const locale of ["en", "pt"] as const) {
  for (const viewport of viewports) {
    test(`${locale} ${viewport.name} share gives a short link that opens the trip`, async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.setViewportSize(viewport);
      await page.goto(`/${locale}/plan?demo=1&screen=trip`, { waitUntil: "networkidle" });
      const title = await page.getByTestId("plan-trip-head").locator("h1").innerText();
      // The headless clipboard outlives the context: start empty so a stale link can't pass.
      await page.evaluate(() => navigator.clipboard.writeText(""));

      await page.getByRole("button", { name: copy[locale].share, exact: true }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/t\/[0-9A-Za-z]{8}$/);
      const link = await page.evaluate(() => navigator.clipboard.readText());
      expect(link.replace(/^https?:\/\/[^/]+/, "maio.cv").length).toBeLessThanOrEqual(30);

      await page.evaluate(() => navigator.clipboard.writeText(""));
      await page.waitForTimeout(2200);
      await page.getByRole("button", { name: copy[locale].share, exact: true }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(link);

      await page.goto(link);
      await expect(page).toHaveURL(new RegExp(`/${locale}/t/[0-9A-Za-z]{8}$`));
      await expect(page.getByText(copy[locale].shared)).toBeVisible();
      await expect(page.getByTestId("plan-trip-head").locator("h1")).toHaveText(title);
      await expect(page.getByTestId("chat-input")).toHaveCount(0);
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", `${title} · maio.cv`);
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", /\/t\/[0-9A-Za-z]{8}$/);
      expect(new URL(page.url()).search).toBe("");
    });
  }
}

test("old long share links still open the read-only trip", async ({ page }) => {
  const plan = samplePlan("en");
  await page.goto(`/en/plan?trip=${encodeTrip(plan)}&view=1`);
  await expect(page.getByText(copy.en.shared)).toBeVisible();
  await expect(page.getByTestId("plan-trip-head").locator("h1")).toHaveText(plan.title);
});

test("an unknown short id is a 404", async ({ page }) => {
  const res = await page.goto("/en/t/Zz9Zz9Zz");
  expect(res?.status()).toBe(404);
});
