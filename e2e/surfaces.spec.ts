import { expect, test, type Page } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";

const OUT = "/opt/cursor/artifacts";
mkdirSync(OUT, { recursive: true });
mkdirSync("e2e/output", { recursive: true });

const viewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

type Locale = "en" | "pt" | "fr";

const copy = {
  en: { hi: "hi", about: "what can you tell me about maio first", plan: "3 days, slow pace", date: "not Friday, Saturday", party: "actually we are 2 adults and a 5-year-old", car: "we rented a car", hospital: "what's the hospital number?", first: "the first one", pharmacy: "where is a pharmacy", atm: "is there an ATM", beaches: "best beaches", around: "how do we get around without a car", research: "what was Maio's 2024 guest count?", start: "Start over" },
  pt: { hi: "olá", about: "o que me podes dizer sobre o Maio", plan: "3 dias, ritmo calmo", date: "não sexta, sábado", party: "na verdade somos 2 adultos e uma criança de 5 anos", car: "alugamos um carro", hospital: "qual é o número do hospital?", first: "o primeiro", pharmacy: "há uma farmácia", atm: "há caixa automático", beaches: "melhores praias", around: "como me deslocar sem carro", research: "qual foi o número de visitantes do Maio em 2024?", start: "Recomeçar" },
  fr: { hi: "bonjour", about: "parle-moi de Maio", plan: "3 jours, rythme calme", date: "pas vendredi, samedi", party: "en fait nous sommes 2 adultes et un enfant de 5 ans", car: "on a loué une voiture", hospital: "quel est le numéro de l'hôpital ?", first: "le premier", pharmacy: "où est la pharmacie", atm: "y a-t-il un distributeur", beaches: "meilleures plages", around: "comment se déplacer sans voiture", research: "quel était le nombre de visiteurs de Maio en 2024 ?", start: "Recommencer" },
} as const;

function note(title: string, status: string, detail = "") {
  appendFileSync("e2e/output/matrix.jsonl", JSON.stringify({ title, status, detail, at: new Date().toISOString() }) + "\n");
}

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function send(page: Page, text: string, opts: { wait?: boolean } = {}) {
  const before = await page.getByTestId("assistant-reply").count();
  const input = page.getByTestId("chat-input");
  await input.fill(text);
  await page.getByTestId("chat-send").click();
  if (opts.wait !== false) await expect(page.getByTestId("assistant-reply")).toHaveCount(before + 1);
}

async function lastReply(page: Page) {
  const last = page.getByTestId("assistant-reply").last();
  await expect(last).toBeVisible();
  return last;
}

async function expectClean(page: Page, opts: { long?: boolean; short?: boolean } = {}) {
  const last = await lastReply(page);
  const text = (await last.innerText()).trim();
  expect(text.length).toBeGreaterThan(2);
  expect(text).not.toMatch(/food listing|\(id\b|we list that by id|blue-[a-z0-9]+(?:-[a-z0-9]+)+/i);
  expect(text).not.toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
  expect(text).not.toMatch(/options i can|what would you like next|finish the full day-by-day/i);
  if (opts.long) {
    await expect(last.locator("h2").first()).toBeVisible();
    await expect(last.locator("li").first()).toBeVisible();
    expect(text).toMatch(/\n|Day |Dia |Jour /);
  }
  if (opts.short) expect(text.length).toBeLessThan(520);
  const chips = page.locator("[data-testid='suggestions'] button");
  expect(await chips.count()).toBeLessThanOrEqual(3);
  const leave = await chips.allInnerTexts();
  expect(leave.join(" ")).not.toMatch(/When do you leave|Quando partem|Quand partez/i);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  return text;
}

async function openPlan(page: Page, locale: Locale) {
  await page.goto(`/${locale}/plan`);
  await expect(page.getByTestId("chat-input")).toBeVisible();
}

test.beforeEach(() => {
  note("suite", "model", "PLAN_MOCK=1. No AI_GATEWAY_API_KEY. Ask Maio answers are the local greeting or a Playwright mock of /api/maio-chat.");
});

for (const viewport of viewports) {
  for (const locale of ["en", "pt", "fr"] as const) {
    test(`${viewport.name} ${locale} planner flow`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const c = copy[locale];
      await openPlan(page, locale);
      expect(await overflow(page)).toBeLessThanOrEqual(1);

      await send(page, c.hi);
      let text = await expectClean(page, { short: true });
      expect(text).not.toMatch(/options i can/i);
      note(`${viewport.name}/${locale}/greeting-empty`, "pass", text.slice(0, 140));

      await send(page, c.about);
      text = await expectClean(page, { short: true });
      expect(text.split(/[.!?]/).filter((part) => part.trim()).length).toBeGreaterThan(1);
      expect(text).not.toMatch(/^That is /);
      note(`${viewport.name}/${locale}/about-maio`, "pass", text.slice(0, 160));

      await page.route("**/api/plan", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        await route.continue();
      });
      const beforePlan = await page.getByTestId("assistant-reply").count();
      await send(page, c.plan, { wait: false });
      await expect(page.getByTestId("typing")).toBeVisible();
      await expect(page.getByTestId("chat-input")).toHaveAttribute("readonly", "");
      await expect(page.getByTestId("chat-send")).toBeDisabled();
      await expect(page.getByTestId("assistant-reply")).toHaveCount(beforePlan + 1);
      await page.unroute("**/api/plan");
      text = await expectClean(page, { short: true });
      expect(text).toMatch(locale === "pt" ? /carro/ : locale === "fr" ? /voiture/ : /car/i);
      expect(text.split(/[.!?]+/).filter((part) => part.trim()).length).toBeLessThanOrEqual(2);
      await expect(page.getByTestId("plan-trip-card")).toHaveCount(0);
      const carChips = page.getByTestId("suggestions").getByRole("button");
      await expect(carChips).toHaveCount(3);
      note(`${viewport.name}/${locale}/car-question`, "pass", text.slice(0, 160));

      await send(page, c.hi);
      text = await expectClean(page, { short: true });
      expect(text).toMatch(locale === "pt" ? /Olá/ : locale === "fr" ? /Bonjour/ : /Hi/i);
      await expect(page.getByTestId("plan-trip-card")).toHaveCount(0);
      await expect(carChips).toHaveCount(3);
      note(`${viewport.name}/${locale}/greeting-while-pending`, "pass", text.slice(0, 140));

      await send(page, c.hospital);
      text = await expectClean(page);
      expect(text).toMatch(/255 11 30|\+238/);
      await expect(page.getByTestId("plan-trip-card")).toHaveCount(0);
      await expect(carChips).toHaveCount(3);
      note(`${viewport.name}/${locale}/side-while-pending`, "pass", text.slice(0, 140));

      const answer = viewport.name === "desktop"
        ? (locale === "pt" ? "Sem carro" : locale === "fr" ? "Pas encore sûr" : "Yes, renting a car")
        : (locale === "pt" ? "não" : locale === "fr" ? "oui" : "yes we rent one");
      if (viewport.name === "desktop") await page.getByTestId("suggestions").getByRole("button", { name: answer }).click();
      else await send(page, answer);
      const planReply = page.getByTestId("assistant-reply").last();
      await expect(planReply.getByTestId("plan-trip-card")).toHaveCount(1);
      text = await expectClean(page, { short: true });
      const prose = (await planReply.locator(".chat-markdown").innerText()).trim();
      const order = await page.evaluate(() => {
        const reply = [...document.querySelectorAll("[data-testid='assistant-reply']")].at(-1);
        const card = reply?.querySelector("[data-testid='plan-trip-card']");
        const body = reply?.querySelector(".chat-markdown");
        if (!reply || !card || !body) return false;
        return Boolean(card.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      expect(order).toBe(true);
      expect(prose.split(/[.!?]+/).filter((part) => part.trim()).length).toBeLessThanOrEqual(3);
      expect(prose.length).toBeLessThan(220);
      expect(prose).not.toMatch(/## |08:30/);
      note(`${viewport.name}/${locale}/plan-card-first`, "pass", text.slice(0, 180));
      if (locale === "en" && viewport.name === "desktop") {
        await page.screenshot({ path: `${OUT}/plan-after-desktop.png`, fullPage: false });
      }
      if (locale === "en" && viewport.name === "mobile") {
        await page.screenshot({ path: `${OUT}/plan-after-mobile.png`, fullPage: false });
      }

      await page.setViewportSize({ width: viewport.width, height: 640 });
      const pane = page.locator(".chat-conversation");
      await expect.poll(async () => pane.evaluate((node) => node.scrollHeight > node.clientHeight + 40)).toBe(true);
      await pane.evaluate((node) => { node.scrollTop = 0; });
      await send(page, c.hi);
      await expect.poll(async () => pane.evaluate((node) => {
        const last = [...node.querySelectorAll("[data-testid='user-message']")].at(-1);
        if (!last) return false;
        const paneBox = node.getBoundingClientRect();
        const box = last.getBoundingClientRect();
        return box.top >= paneBox.top - 8 && box.bottom <= paneBox.bottom + 8;
      })).toBe(true);
      text = await expectClean(page, { short: true });
      expect(text).toMatch(locale === "pt" ? /dias/ : locale === "fr" ? /jours/ : /day/i);
      note(`${viewport.name}/${locale}/scroll-after-plan`, "pass", text.slice(0, 140));
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await send(page, c.hi);
      text = await expectClean(page, { short: true });
      expect(text).toMatch(locale === "pt" ? /dias/ : locale === "fr" ? /jours/ : /day/i);
      note(`${viewport.name}/${locale}/greeting-with-plan`, "pass", text.slice(0, 160));

      await send(page, c.date);
      text = await expectClean(page);
      note(`${viewport.name}/${locale}/correct-date`, "pass", text.slice(0, 140));

      await send(page, c.party);
      await expectClean(page);
      note(`${viewport.name}/${locale}/correct-party`, "pass");

      await send(page, c.car);
      await expectClean(page);
      note(`${viewport.name}/${locale}/correct-car`, "pass");

      await send(page, c.hospital);
      text = await expectClean(page);
      expect(text).toMatch(/255 11 30|\+238/);
      note(`${viewport.name}/${locale}/side-hospital`, "pass", text.slice(0, 140));

      await send(page, c.beaches);
      text = await expectClean(page);
      expect(text.length).toBeGreaterThan(40);
      note(`${viewport.name}/${locale}/beaches`, "pass", text.slice(0, 140));

      await send(page, c.pharmacy);
      text = await expectClean(page);
      expect(text).toMatch(/255 11 30|farm|pharm/i);
      note(`${viewport.name}/${locale}/pharmacy`, "pass", text.slice(0, 140));

      await send(page, c.atm);
      text = await expectClean(page);
      expect(text).toMatch(/ATM|caixa|distributeur|won't invent|não vou inventar|n'invente/i);
      note(`${viewport.name}/${locale}/atm`, "pass", text.slice(0, 140));

      await send(page, c.around);
      await expectClean(page);
      note(`${viewport.name}/${locale}/transport`, "pass");

      await send(page, c.first);
      text = await expectClean(page, { short: true });
      expect(text).toMatch(/That is |É |C'est /);
      note(`${viewport.name}/${locale}/ordinal-first`, "pass", text.slice(0, 140));

      await send(page, c.research);
      text = await expectClean(page);
      expect(text).toMatch(/guess|inventar|invente/i);
      expect(text).not.toMatch(/\b\d{4,}\b/);
      note(`${viewport.name}/${locale}/research`, "pass", text.slice(0, 140));

      const taskBefore = await page.evaluate(() => sessionStorage.getItem("maio.plan.task"));
      // Research replaces the trip. A plan that already names the car does not ask again.
      const upfront = locale === "pt" ? "3 dias, ritmo calmo, com carro" : locale === "fr" ? "3 jours, rythme calme, avec une voiture" : "3 days, slow pace, with a car";
      await send(page, upfront);
      await expect(page.getByTestId("assistant-reply").last().getByTestId("plan-trip-card")).toHaveCount(1);
      text = await expectClean(page, { short: true });
      expect(text).not.toMatch(/Will you have a car\?|Vão ter carro\?|Vous aurez une voiture \?/);
      note(`${viewport.name}/${locale}/car-upfront`, "pass", text.slice(0, 160));
      const task = await page.evaluate(() => sessionStorage.getItem("maio.plan.task"));
      expect(task && task.length).toBeGreaterThan(10);
      await page.reload();
      await expect(page.getByTestId("chat-input")).toBeVisible();
      await send(page, c.hi);
      text = await expectClean(page, { short: true });
      expect(text).toMatch(/day|dias|jours/i);
      note(`${viewport.name}/${locale}/reload-task`, "pass", `task ${taskBefore ? "had-prior" : "fresh"} ${text.slice(0, 80)}`);

      await page.getByRole("button", { name: c.start }).click();
      await expect(page.getByTestId("assistant-reply")).toHaveCount(0);
      const cleared = await page.evaluate(() => sessionStorage.getItem("maio.plan.task"));
      expect(cleared).toBeNull();
      note(`${viewport.name}/${locale}/start-over`, "pass");

      await page.route("**/api/plan", (route) => route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Planner unavailable" }) }));
      await send(page, c.plan, { wait: false });
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.getByTestId("chat-input")).toHaveValue(c.plan);
      await page.unroute("**/api/plan");
      note(`${viewport.name}/${locale}/error`, "pass");
    });
  }
}

test("ask maio shell matches on desktop and mobile", async ({ page }) => {
  let live = "not-tried";
  try {
    const probe = await page.request.post("https://portal.maio.cv/api/chat", {
      data: { messages: [{ role: "user", content: "hi" }] },
      timeout: 8000,
    });
    live = `portal ${probe.status()}`;
  } catch (error) {
    live = `portal unreachable (${error instanceof Error ? error.message : "error"})`;
  }
  note("ask/live-probe", "info", live);

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/en/chat");
    await expect(page.getByRole("heading", { name: /Maio/ })).toBeVisible();
    expect(await page.locator(".chat-suggestions button").count()).toBeGreaterThan(0);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${OUT}/chat-${viewport.name}.png`, fullPage: false });

    await send(page, "hi");
    const greet = await expectClean(page, { short: true });
    expect(greet.length).toBeLessThan(400);
    note(`ask/${viewport.name}/greeting`, "pass", greet.slice(0, 120));

    await page.route("**/api/maio-chat", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Maio is a small island.\n\n## Beaches\n\n- Bitche Rotcha is a town beach.\n- Morro is further along the coast.",
        }),
      });
    });
    const beforeAsk = await page.getByTestId("assistant-reply").count();
    await send(page, "what are the beaches like", { wait: false });
    await expect(page.getByTestId("typing")).toBeVisible();
    await expect(page.getByTestId("chat-input")).toHaveAttribute("readonly", "");
    await expect(page.getByTestId("assistant-reply")).toHaveCount(beforeAsk + 1);
    const answer = await expectClean(page, { long: true });
    expect(answer).toMatch(/Bitche Rotcha/);
    expect(answer).not.toMatch(/blue-/);
    await page.unroute("**/api/maio-chat");
    note(`ask/${viewport.name}/markdown`, "pass", `${live}; ${answer.slice(0, 100)}`);
  }
});

test("before rendering was one paragraph", async ({ page }) => {
  await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    body { margin: 0; font: 17px/1.45 sans-serif; background: #fff; color: #111; }
    .plan-msg { margin: 0; max-width: 92%; padding: 24px; }
  </style></head><body>
    <p class="plan-msg">Overview - Length: 3 days - Pace: slow Day 1 — 2026-11-16 - 08:10 — Breakfast: Enzo (food listing) - 09:00 — Experience: Rental Quad (id blue-rental-quad-big-game) we list that by id: blue-rental-quad-big-game 2026-11-16 → 2026-11-18</p>
  </body></html>`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: `${OUT}/plan-before-desktop.png` });
  note("before/flat-paragraph", "pass", "Old single paragraph with ISO dates and catalog ids, captured as the previous renderer.");
});
