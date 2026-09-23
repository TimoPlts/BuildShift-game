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
