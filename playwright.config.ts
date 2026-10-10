import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration for the BuildShift production browser smoke suite.
 *
 * This suite exercises the real production stack (Babylon + Rapier + Colyseus
 * client → authoritative game server) in headless Chromium. It is independent
 * of the Vitest unit/integration runner and is invoked via:
 *
 *   npx playwright test
 *
 * Prerequisites:
 *   - `pnpm build` must have completed (serves `apps/web/dist`)
 *   - The game server source is compiled to `apps/game-server/dist`
 */
export default defineConfig({
  testDir: "./apps/web/tests",
  testMatch: ["**/*.browser.test.ts"],
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  // Generous default for the two-client live round tests; per-test budgets
  // below cover countdowns, aiming, and kills (input sequences are
  // monotonic per session, so rounds start with immediate, live input).
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
