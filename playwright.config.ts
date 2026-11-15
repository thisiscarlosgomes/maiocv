import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3017",
    trace: "off",
  },
  webServer: {
    command: "npm run dev -- --port 3017",
    url: "http://127.0.0.1:3017/en/plan",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { MAIO_PLAN: "1", PLAN_MOCK: "1" },
  },
});
