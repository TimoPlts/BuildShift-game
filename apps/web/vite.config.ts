import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vite configuration for the BuildShift web client.
 *
 * The Babylon render loop will be kept independent of React (see
 * docs/TECHNICAL_ARCHITECTURE.md §3); only the React UI lives here for now.
 *
 * Workspace-package module resolution:
 * The `@buildshift/*` packages are aliased to their TypeScript **source**
 * entry (`packages/<name>/src/index.ts`). This must stay in lockstep with the
 * `paths` mapping in `tsconfig.base.json`, otherwise the Vite production
 * build and the `tsc --noEmit` typecheck would resolve to different modules
 * (a classic build-gate failure: the typecheck passes against source while
 * `vite build` bundles a stale/missing `dist`, or vice-versa). Deriving every
 * alias from a single workspace-root + package list below guarantees the two
 * stay consistent and removes the risk of a hand-typed relative path drifting
 * from the real package location.
 */

/** The monorepo root (two levels up from `apps/web`). */
const workspaceRoot = path.resolve(here, "../..");

/**
 * The workspace packages the web client consumes. These are the exact
 * `@buildshift/*` names whose `paths` entries live in `tsconfig.base.json`.
 */
const WORKSPACE_PACKAGES = ["game-config", "protocol", "simulation"] as const;

/**
 * Resolve the source entry point of a workspace package. Centralising this
 * keeps the alias target derivation in one place so a package added/removed
 * is a single-line change that cannot typo the path.
 */
function workspaceSourceEntry(packageName: (typeof WORKSPACE_PACKAGES)[number]): string {
  return path.resolve(workspaceRoot, `packages/${packageName}/src/index.ts`);
}

/**
 * Build the `resolve.alias` table for the workspace packages.
 * Key: `@buildshift/<name>` (the bare specifier used in source).
 * Value: the absolute path to that package's `src/index.ts`.
 */
function buildWorkspaceAlias(): Record<string, string> {
  const alias: Record<string, string> = {};
  for (const name of WORKSPACE_PACKAGES) {
    alias[`@buildshift/${name}`] = workspaceSourceEntry(name);
  }
  return alias;
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: buildWorkspaceAlias(),
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
