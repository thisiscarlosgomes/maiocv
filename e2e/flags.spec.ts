import { expect, test, type Page } from "@playwright/test";

const viewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function flagLast(page: Page, note: string) {
  await page.getByTestId("thumbs-down").last().click();
  const field = page.getByTestId("flag-note");
  await expect(field).toBeVisible();
  if (note) await field.fill(note);
  const [request] = await Promise.all([
    page.waitForRequest((req) => req.url().includes("/api/flags") && req.method() === "POST"),
    page.getByTestId("flag-send").click(),
  ]);
  return request;
}

for (const viewport of viewports) {
  test(`${viewport.name} planner thumbs-down sends a note and no request identity`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/en/plan");
    await page.getByTestId("chat-input").fill("hi");
    await page.getByTestId("chat-send").click();
    await expect(page.getByTestId("assistant-reply").last()).toBeVisible();
    const request = await flagLast(page, "wrong date");
    const body = request.postDataJSON() as Record<string, unknown>;
    expect(body.surface).toBe("plan");
    expect(body.locale).toBe("en");
    expect(body.userMessage).toBe("hi");
    expect(body.note).toBe("wrong date");
    expect(String(body.botReply).length).toBeGreaterThan(1);
    expect(body).not.toHaveProperty("ip");
    expect(body).not.toHaveProperty("userAgent");
    expect(body).not.toHaveProperty("cookie");
    expect(body).not.toHaveProperty("userId");
    expect(request.headers()["user-agent"]).toBeTruthy();
    const response = await request.response();
    expect(response?.status()).toBe(204);
    await expect(page.getByTestId("flag-thanks")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
  });

  test(`${viewport.name} Ask Maio thumbs-down works without a note`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/en/chat");
    await page.getByTestId("chat-input").fill("hi");
    await page.getByTestId("chat-send").click();
    await expect(page.getByTestId("assistant-reply").last()).toBeVisible();
    const request = await flagLast(page, "");
    const body = request.postDataJSON() as Record<string, unknown>;
    expect(body.surface).toBe("ask");
    expect(body.locale).toBe("en");
    expect(body.userMessage).toBe("hi");
    expect(body.note ?? "").toBe("");
    expect(body).not.toHaveProperty("userId");
    const response = await request.response();
    expect(response?.status()).toBe(204);
    await expect(page.getByTestId("flag-thanks")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
  });
}
