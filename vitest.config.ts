import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Root Vitest configuration.
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §2, Vitest is the locked unit/integration
 * test runner. Browser/E2E testing uses Playwright separately (later stage).
 *
 * Workspace packages are aliased to their source entry points so tests resolve
 * against `src` directly — this keeps `pnpm test` independent of `pnpm build`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@buildshift/game-config": path.resolve(here, "packages/game-config/src/index.ts"),
      "@buildshift/protocol": path.resolve(here, "packages/protocol/src/index.ts"),
      "@buildshift/simulation": path.resolve(here, "packages/simulation/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.{ts,tsx}"],
    exclude: [
      // Retired legacy networking test stubs — physically empty (export {} only).
      // These directories/files are scheduled for physical deletion; the vitest
      // exclude prevents them from being discovered as test files in the
      // interim.
      "apps/web/src/net/**",
      "apps/web/src/network/**",
      // Retired empty stub (0 bytes); the rest of game/remote holds live suites.
      "apps/web/src/game/remote/remotePlayerSet.test.ts",
      "apps/web/src/game/GameRuntime.twoPlayer.integration.test.ts",
      // Browser/E2E tests are run via Playwright, not Vitest.
      "**/*.browser.test.ts",
      "apps/web/tests/**",
      "**/node_modules/**",
    ],
    environment: "node",
  },
});
