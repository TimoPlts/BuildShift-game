# AI Development Worklog

This document tracks significant AI-assisted development work.

For each development stage record:

- Date
- Stage / task
- AI model/tool used
- Prompt / objective
- What was implemented
- Developer changes
- Tests performed
- What remains unverified
- Important decisions

---

## 2026-09-23 — Stage 0: Monorepo Foundation

- **Stage / task:** Initial repository structure for BuildShift.
- **AI model/tool used:** GitHub Copilot (Qwen3.8 27B).
- **Prompt / objective:** Create a clean, minimal, production-quality monorepo
  foundation based on `docs/GAME_DESIGN.md` and `docs/TECHNICAL_ARCHITECTURE.md`
  without implementing gameplay, networking, or persistence.
- **What was implemented:**
  - pnpm monorepo root (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `README.md`).
  - `apps/web` — minimal React + TypeScript + Vite app.
  - `apps/game-server` — minimal Node.js + TypeScript entry point.
  - `packages/protocol`, `packages/simulation`, `packages/game-config` — minimal shared TypeScript packages.
  - Documentation placement: `docs/GAME_DESIGN.md`, `docs/TECHNICAL_ARCHITECTURE.md`, `docs/AI_WORKLOG.md`, `docs/adr/README.md`.
  - Root scripts: `dev`, `dev:server`, `build`, `typecheck`, `test`.
  - GitHub Actions CI workflow (`.github/workflows/ci.yml`): install, typecheck, build, test.
- **Developer changes:** _(none yet)_
- **Tests performed:** `pnpm install`, `pnpm typecheck`, `pnpm build` (all packages), `pnpm test`, and a runtime smoke-run of the game server.
- **What remains unverified:** Runtime behavior under load; Babylon/Colyseus/Rapier integration (not yet added); linting (not configured).
- **Important decisions:**
  - Used `tsx` for server dev/build/run (matches the Colyseus/Node ESM toolchain and stays minimal).
  - Deferred linting until a real lint baseline exists, rather than adding a broken script.
  - Babylon.js, Colyseus, Rapier, and Playwright are intentionally **not** installed yet — they are added in their respective stages.
  - pnpm 12 blocks install-time build scripts by default; esbuild (needed by Vite/Vitest) was approved via `allowBuilds: { esbuild: true }` in `pnpm-workspace.yaml`.

---

## 2026-09-23 — Stage 0A — GitHub Actions CI fix

- **Cause of failure:** `actions/setup-node@v4` configured the pnpm cache before pnpm was installed, causing `Unable to locate executable file: pnpm.`
- **File changed:** `.github/workflows/ci.yml`.
- **Fix applied:** Moved `pnpm/action-setup@v4` before `actions/setup-node@v4`; the action uses the root `packageManager` declaration (`pnpm@12.5.1`) without another hardcoded version.
- **Local commands verified:** `pnpm install`, `pnpm typecheck`, `pnpm build`, and `pnpm test` passed. On Windows, `pnpm.cmd` was used because PowerShell script execution blocks the `pnpm.ps1` shim; build and test required running outside the filesystem sandbox so Vite/esbuild could read the repository path.
- **GitHub Actions result:** Run 35841197185 passed Checkout, Setup pnpm, Setup Node.js, and Install dependencies, then reached Typecheck.
- **Still unresolved:** Typecheck failed with `Cannot find module '@buildshift/game-config' or its corresponding type declarations.` Build and Test were skipped. Workspace resolution was not investigated or changed in Stage 0A.

---

## 2026-09-23 — Stage 0B — Clean workspace package resolution

- **Root cause:** pnpm correctly linked workspace dependencies to their package roots, but `main`, `types`, and `exports` exposed only generated `dist` files. TypeScript, Vite, and `tsx` therefore could not resolve workspace entry points before a build.
- **Why local verification previously passed:** The working checkout already contained generated `dist/index.js` and `dist/index.d.ts` files, masking the clean-checkout failure.
- **Resolution strategy:** Added root TypeScript paths to workspace source entry points for development and typechecking, added a Vite alias for the web app's declared protocol dependency, and retained `dist` package exports for production. The simulation and server now use separate build tsconfigs that disable source paths while emitting, allowing pnpm's topological build to consume dependency output deliberately.
- **Files changed:** `tsconfig.base.json`, `apps/web/vite.config.ts`, `apps/game-server/package.json`, `apps/game-server/tsconfig.json`, `apps/game-server/tsconfig.build.json`, `packages/simulation/package.json`, `packages/simulation/tsconfig.json`, and `packages/simulation/tsconfig.build.json`.
- **Clean-checkout commands tested:** In a fresh clone with no `node_modules` or `dist`, `pnpm install`, `pnpm typecheck`, `pnpm build`, and `pnpm test` all passed. Typecheck created no `dist` output; 2 tests passed.
- **Web dev smoke test:** After removing all generated `dist` output again, `pnpm dev` started Vite and transformed `@buildshift/protocol` from `packages/protocol/src/index.ts` successfully.
- **Server dev smoke test:** From the same no-`dist` state, `pnpm dev:server` reached the placeholder startup and reported protocol version `0.1.0`.
- **GitHub Actions result:** Run 35843130055 passed Setup pnpm, Setup Node.js, Install dependencies, Typecheck, Build, and Test. Stage 0 foundation CI is green.
- **Still unresolved:** No functional Stage 0B issue remains. GitHub reports an advisory that the v4 checkout/setup actions target the deprecated Node 20 action runtime and are currently forced to Node 24; this did not affect the successful run.

---

## 2026-09-23 — Stage 0C — Node ESM & production runtime sanity check

- **What was inspected:** Root, web, server, and shared-package TypeScript configs; package `type`, `main`, `types`, and `exports`; all source imports; clean production output for the server, protocol, simulation, and game-config; native Node startup through the workspace package links.
- **Bundler-resolution finding:** Existing output was valid and the compiled server already started successfully, but `bundler` posed a real future server risk. A disposable extensionless relative-import probe compiled unchanged and then failed in native Node with `ERR_MODULE_NOT_FOUND`; `NodeNext` rejected it during compilation with TS2835.
- **Configuration changes:** Added `tsconfig.node.json` with `module` and `moduleResolution` set to `NodeNext`. The game server and all three platform-independent shared packages extend it; the Vite web app remains on the bundler-oriented base config. Documented the `.js` relative-import convention for native ESM targets in `docs/TECHNICAL_ARCHITECTURE.md`.
- **Production emitted-import findings:** The compiled server imports `@buildshift/protocol`, and simulation imports `@buildshift/game-config`. Both are valid bare workspace package specifiers resolved through each package's generated `dist` exports; production uses no TypeScript paths, Vite aliases, `tsx`, or source-only resolution.
- **Clean install result:** Passed from a fresh clone with no `node_modules` or `dist`.
- **Typecheck result:** Passed for all workspace projects under the split bundler/NodeNext configuration.
- **Build result:** Passed; all server/shared JavaScript and declarations were emitted successfully.
- **Test result:** Passed; 1 test file and 2 tests passed.
- **Web dev result:** Passed from a no-`dist` state; Vite resolved protocol source successfully.
- **Server dev result:** Passed from a no-`dist` state; `tsx` reached placeholder startup and reported protocol version `0.1.0`.
- **Compiled server runtime result:** `pnpm --filter @buildshift/game-server start` passed under native Node using compiled JavaScript and package `dist` exports.
- **GitHub Actions result:** Run 35844446087 passed Setup pnpm, Setup Node.js, Install dependencies, Typecheck, Build, and Test.
- **Still unresolved:** No functional Stage 0C issue remains. The existing GitHub advisory about v4 actions' deprecated Node 20 action runtime remains non-blocking.
