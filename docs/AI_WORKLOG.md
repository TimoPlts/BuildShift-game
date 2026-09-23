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

---

## 2026-09-23 — Stage 1A — Babylon.js Scene Foundation

- **Babylon package installed:** `@babylonjs/core@9.27.1` as a production dependency of `apps/web` only. No GUI, inspector, loaders, materials library, or physics package was added.
- **Major files created/changed:** Added `apps/web/src/game/GameCanvas.tsx`, `apps/web/src/game/GameRuntime.ts`, and `apps/web/src/game/scene/createFoundationScene.ts`; updated the web app shell, viewport CSS, HTML favicon declaration, web package manifest, and pnpm lockfile.
- **Runtime architecture:** React only mounts the canvas and creates/disposes `GameRuntime`. The runtime exclusively owns the Babylon `Engine`, `Scene`, render callback, resize listener, and disposal lifecycle. Babylon objects are not stored in React state.
- **Temporary camera:** An `ArcRotateCamera` provides development-only orbit and wheel zoom; it is explicitly marked for replacement by the later real game camera.
- **Engine/render-loop lifecycle:** The engine uses antialiasing and Babylon's `runRenderLoop`. Runtime start and disposal are idempotent; disposal removes the window listener, stops the exact render callback, disposes the scene, and disposes the engine.
- **Resize handling:** A live browser resize changed both canvas client and render dimensions from 1422x804 to 1024x640 without reload or scroll overflow.
- **StrictMode verification:** Development browser inspection found one canvas and exactly one active resize listener owned by `GameRuntime` after React's development remount. Orbit interaction changed the rendered frame and the browser reported no console/runtime errors.
- **Typecheck:** Passed for all workspace projects.
- **Build:** Passed for all workspace projects. Vite reports a non-blocking warning for the 1.35 MB Babylon-containing main chunk (342.46 kB gzip).
- **Tests:** Passed; 1 test file and 2 existing tests passed. No artificial Babylon rendering test was added.
- **Development browser smoke test:** `pnpm dev` rendered the full-viewport scene with lit ground, a center box, an orange platform, and a tall reference box. Orbit camera controls and live resize passed.
- **Production preview smoke test:** `pnpm --filter @buildshift/web preview` rendered the same scene successfully from the production build.
- **Server regression smoke test:** `pnpm dev:server` reached the unchanged placeholder startup and reported protocol version `0.1.0`.
- **GitHub Actions result:** Run 35846878143 passed Setup pnpm, Setup Node.js, Install dependencies, Typecheck, Build, and Test.
- **Still unresolved:** No functional Stage 1A issue remains. The Vite chunk-size warning should be reassessed when real asset/loading boundaries exist; no premature code splitting was added in this foundation stage.

---

## 2026-09-23 — Stage 1B — Local Player & Deterministic Movement

- **Files created:** Added `packages/game-config/src/movement.ts`, shared movement types and stepping under `packages/simulation/src/movement/`, browser input tracking in `apps/web/src/game/input/InputManager.ts`, and the local Babylon controller in `apps/web/src/game/player/PlayerController.ts`.
- **Files changed:** Updated the game-config and simulation public exports/tests, web runtime, web workspace dependencies and Vite source aliases, the small development overlay, `pnpm-lock.yaml`, and this worklog.
- **Movement architecture:** WASD intent flows from the browser-only `InputManager` into the platform-independent `stepHorizontalMovement`, then `PlayerController` applies the returned X/Z position to its Babylon mesh. The convention is world-relative `+X = right` and `-Z = forward`.
- **Input architecture:** `InputManager` owns held-key state and all `keydown`, `keyup`, `blur`, and visibility listeners; no React state or controller-owned keyboard listeners are used. Disposal removes every listener and clears held state.
- **Shared simulation function:** `stepHorizontalMovement(position, input, deltaSeconds, config)` is pure, avoids argument mutation, normalizes inputs longer than one unit, and has no browser or Babylon dependency.
- **Game config:** `PLAYER_MOVEMENT.moveSpeed` is `6` metres per second in `@buildshift/game-config`; no future movement values were introduced.
- **Delta handling:** `GameRuntime` converts Babylon milliseconds to seconds and clamps each local frame step to `0.1` seconds before updating the controller, then renders the scene.
- **Focus-loss handling:** Window blur and document hiding clear held movement keys; browser verification confirmed movement stopped at the exact sampled position after blur.
- **Unit tests:** Added no-input, known forward displacement, diagonal normalization, and equivalent-total-time coverage. The suite passes with 1 file and 6 tests.
- **Browser verification:** Development Chrome showed one visible green 1.8 m capsule with its feet on the ground. W/A/S/D and diagonal movement passed measured X/Z checks; release and blur stopped drift; resize matched 1024×640 client/render dimensions; orbit controls still changed the frame; one player, one canvas, and one active keydown/keyup listener remained after StrictMode remount; no browser errors occurred.
- **Production preview:** The built web preview rendered the player, keyboard movement changed the frame, release stabilized it, orbit remained functional, and no console or module-resolution errors occurred.
- **Server regression:** Both `pnpm dev:server` and compiled `pnpm --filter @buildshift/game-server start` reached the unchanged placeholder startup and reported protocol `0.1.0`.
- **Local verification:** `pnpm typecheck`, `pnpm build`, and `pnpm test` passed. Vite retains the known non-blocking Babylon chunk-size warning (1.35 MB main chunk, 342.42 kB gzip).
- **GitHub Actions:** Run 35849447712 passed Checkout, Setup pnpm, Setup Node.js, Install dependencies, Typecheck, Build, and Test for commit `ca26dd2`.
- **Still unresolved:** No Stage 1B functional issue is known. Physics, collision, gravity, jumping, player-facing orientation, the real third-person camera, networking, and authoritative fixed-step movement remain intentionally deferred to their later stages.
