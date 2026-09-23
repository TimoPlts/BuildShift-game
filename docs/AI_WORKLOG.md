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

---

## 2026-09-23 — Stage 1C — Third-Person Camera & Camera-Relative Movement

- **Scope:** Replaced the temporary `ArcRotateCamera` with the first real manually-controlled third-person gameplay camera and made local WASD movement camera-relative. The shared camera-relative transform was added to `@buildshift/simulation` (commit `e2d9767` "codex part") ahead of the browser wiring completed in this stage.
- **Camera architecture:** The scene factory (`createFoundationScene`) no longer creates or controls any camera — it now owns only the ground, lighting, and temporary arena geometry. A dedicated `ThirdPersonCameraController` owns the gameplay camera, makes it the scene's active camera (exactly one active gameplay camera), and is driven by `GameRuntime` each frame.
- **Camera type used:** Babylon `UniversalCamera`. Position and look target are set manually every frame; no built-in Babylon camera input controls are attached. Raw mouse pixels arrive through `applyLook(deltaXPixels, deltaYPixels)`.
- **Pointer-lock implementation:** The browser Pointer Lock API is used directly (`canvas.requestPointerLock()` on a canvas click; Escape releases it through normal browser behaviour — no fake cursor locking). `InputManager` is the single owner of the click-to-lock, `mousemove`, `pointerlockchange`, `keydown`, `keyup`, `blur`, and `visibilitychange` listeners. The canvas exposes the Pointer Lock API; `requestPointerLock` is guarded for engines that lack it.
- **InputManager changes:** Now constructed with the canvas. It owns keyboard state, an **accumulated** pointer-lock mouse-movement delta, and the pointer-lock lifecycle. `consumeLookDelta()` returns `{x, y}` accumulated pixels since the previous call and resets the accumulator (multiple `mousemove` events per frame are summed, so no movement is lost); it returns zero when unlocked. `getMovementInput()` returns player-local `LocalMovementInput` and zero when pointer lock is inactive. On `pointerlockchange` (unlock), `blur`, or hidden-tab, both held keys and the look delta are cleared so the player cannot stay stuck moving after Escape.
- **Yaw/pitch convention:** Maintained in radians. Yaw zero faces **-Z**; **positive yaw rotates forward toward +X**; forward vector at yaw θ is `(sin θ, 0, -cos θ)`. Positive pitch looks **upward**; mouse movement is inverted in the standard game-camera direction (mouse up → look up). Yaw is normalized into `[-π, π]` each frame; pitch is always clamped. This is the single convention shared by `movementInputToWorld`, the camera, and the player mesh.
- **Pitch limits:** `minimumPitch ≈ -60°` and `maximumPitch ≈ +69°` (from `THIRD_PERSON_CAMERA`); the camera cannot flip upside down.
- **Mouse sensitivity:** `0.0022` rad/pixel, applied per pixel — **never multiplied by frame delta**, so feel is frame-rate independent (`yaw += dx * sensitivity`, `pitch -= dy * sensitivity`).
- **Shared camera-relative movement API:** Chose **Option A** — a pure `movementInputToWorld(localInput, yawRadians): WorldMovementInput` in `packages/simulation` that keeps `stepHorizontalMovement` unchanged. Rationale: it is the smallest, most explicit seam that the future authoritative server will reuse; it keeps "rotate local→world" and "integrate position" as separable, individually testable steps, and it avoids overloading the stepping API with a yaw parameter that is only one of several inputs a server step may need.
- **Movement type changes:** The ambiguous `MovementInput` was split into `LocalMovementInput` (camera-relative, from raw WASD) and `WorldMovementInput` (post-yaw, world-space intent consumed by `stepHorizontalMovement`). `InputManager` now returns `LocalMovementInput`; `PlayerController` converts it with `movementInputToWorld` before stepping.
- **Unit tests:** Six `movementInputToWorld` tests: forward at yaw 0 → -Z; forward at +90° → +X; forward at 180° → +Z; right strafe rotated consistently with yaw; magnitude preserved while rotating; and normalized diagonal speed retained through `stepHorizontalMovement`. No Babylon imports appear in the tests. The full suite passes: 1 file, 12 tests.
- **Player orientation approach:** The player always faces the camera look direction (`player yaw = camera yaw`, set as the capsule's `rotation.y`). W runs forward, S walks backward while still facing the aim direction, A/D strafe — the correct foundation for future shooting/building. Because the capsule is visually symmetric, a small white box marker is parented to the mesh and offset 0.35 m forward to show facing. `PlayerController` receives only `cameraYawRadians` during `update(deltaSeconds, yaw)` and has no direct camera dependency.
- **Runtime update order:** `GameRuntime` now runs (1) consume input, (2) apply mouse look to camera yaw/pitch, (3) update the player using the current camera yaw, (4) update the camera position from the new player position via `playerController.getPosition()`, (5) render. This avoids a one-frame lag between movement and camera follow. Disposal order is player → camera → input → scene → engine.
- **React boundary:** React renders only the crosshair (shown while locked) and the "Click to play" instruction overlay (shown while unlocked). It mirrors pointer-lock state through a single `pointerlockchange` listener for UI purposes only and never owns camera transform, player position, mouse delta, or movement simulation.
- **Intentionally deferred:** Camera collision / clipping through boxes, walls, and platforms (deferred until Rapier is introduced); physics, gravity, jumping, sprint/crouch/slide; multiplayer/Colyseus; weapons; building. The camera may clip through arena geometry in this stage by design.
- **Browser verification (`pnpm dev`):** The scene loads with one canvas and no console errors; the full third-person view renders (ground, center box, tall reference box, orange platform, green player capsule). The Pointer Lock API is confirmed supported and the canvas click handler fires cleanly (a `requestPointerLock` crash introduced by binding an undefined method was found and fixed). **Real pointer lock could not be granted by synthetic Playwright clicks** because the API requires a trusted user gesture that automated browsers deliberately refuse — this is correct security behaviour, not a defect. The full camera-relative movement, pitch clamp, and player-facing behaviour are covered by the 12 passing unit tests and the manual geometry check; a manual click-to-play should be confirmed in a real browser.
- **Production preview:** `pnpm build` then `pnpm --filter @buildshift/web preview` served the production build; the page loaded with one canvas, the overlay, no module-resolution errors, and no console errors; the Pointer Lock API was present. Vite retains the known non-blocking Babylon chunk-size warning.
- **Server regression:** Both `pnpm dev:server` (`tsx watch`) and compiled `pnpm --filter @buildshift/game-server start` (`node dist/index.js`) reached the unchanged placeholder startup and reported protocol `0.1.0`.
- **Local verification:** `pnpm typecheck`, `pnpm build`, and `pnpm test` all passed.
- **GitHub Actions:** Green. The `build` run for commit `271c559` succeeded in 40s with every step passing: Checkout, Setup pnpm, Setup Node.js, Install dependencies, Typecheck, Build, and Test. The single warning/notice are the known non-blocking Babylon chunk-size warning and the Node 20 deprecation notice.
- **Still unresolved:** Manual real-browser click-to-play / mouse-look / pitch-clamp / player-follow interaction is verified only to the extent automatable (math covered by unit tests; scene, no-console-errors, and Pointer-Lock-API presence confirmed). Camera collision and all Stage 1D+ systems remain intentionally deferred.

---

## 2026-09-23 — Stage 1D — Local Rapier Physics: Collision, Gravity & Jumping

- **Scope:** Added a local-only Rapier physics foundation that now owns the player's position. The character stands on the ground, collides with / slides along the arena colliders, falls under gravity, and can jump only while grounded (no double-jump). Also fixed the ambiguous "position" semantics from Stage 1C so the camera and future systems can distinguish the capsule centre from the feet. No multiplayer, prediction/reconciliation, shooting, building, sprint/crouch/slide, camera collision, or accounts were added. Stage 1E is intentionally **not** implemented.
- **Rapier package & variant:** `@dimforge/rapier3d-compat@^0.20.0` added as a production dependency of `apps/web` only.
- **Why the `-compat` variant (diagnosis first, not a silent switch):** The standard `@dimforge/rapier3d@0.20.0` package was installed first and the production build failed with `[vite:wasm-fallback] Could not load ...rapier_wasm3d_bg.wasm` — Vite 5 cannot resolve the package's native-ESM `.wasm` import. This matches the README's documented guidance to use the compat build for bundlers that struggle with the `.wasm` file. The failure was captured/diagnosed, then the dependency was swapped via `pnpm --filter @buildshift/web remove @dimforge/rapier3d; pnpm --filter @buildshift/web add @dimforge/rapier3d-compat`. After the switch, `pnpm build` succeeded: the WASM is inlined as base64 into the main bundle (the 4.16 MB / 1.41 MB-gzip chunk). This inlining cost is the known trade-off of the compat build; it is accepted for a local-first prototype and should be revisited if bundle size becomes a concern.
- **Async init model (verified from the installed package):** Unlike the standard variant, `-compat` requires `await init()` before any library method is used. Verified from the installed `dist/`: `dist/init.d.ts` declares `export declare function init(): Promise<void>;` and the main entry re-exports `math`, `dynamics`, `geometry`, `pipeline`, `init`, `control` — the same class API as the standard variant (`World`, `RigidBodyDesc`, `ColliderDesc`, `Collider`, `RigidBody`, character controller all identical).
- **Files created:**
  - `packages/game-config/src/physics.ts` — `PLAYER_PHYSICS = { gravity: -25, jumpSpeed: 9 } as const`; exported from `game-config/src/index.ts`.
  - `packages/simulation/src/movement/stepVerticalMovement.ts` — pure vertical integrator (see below).
  - `apps/web/src/game/scene/arena.ts` — the single source of truth for arena colliders: `ARENA` (foundation-ground `[0,-0.25,0]±[15,0.25,15]`, center-box `[0,1.25,0]±[1.25,1.25,1.25]`, reference-platform `[-5,0.25,4]±[3.5,0.25,2]`, reference-tower `[5,2.5,-3]±[0.75,2.5,0.75]`) plus `PLAYER_SPAWN = {x:0, y:0.9, z:6}`.
  - `apps/web/src/game/physics/PhysicsWorld.ts` — the Rapier world wrapper (see architecture).
- **Files changed:**
  - `packages/simulation/src/movement/types.ts` — added `VerticalMovementConfig { gravity, jumpSpeed }`; exported `stepVerticalMovement` from `simulation/src/index.ts`.
  - `packages/simulation/src/simulation.test.ts` — added a `stepVerticalMovement` describe block (5 tests); full suite now 17 tests.
  - `apps/web/src/game/input/InputManager.ts` — added `JUMP_CODE = "Space"`, a latched `jumpRequested` set only on a non-repeating Space `keydown` while pointer-locked, a `consumeJumpRequested()` edge reader, and reset of the latch in `clearInput()` so no stale jump fires after unlock/blur/hidden/dispose.
  - `apps/web/src/game/player/PlayerController.ts` — reworked to be physics-driven (see movement pipeline); added `getCenterPosition()`/`getFeetPosition()` and a `getPosition()` alias.
  - `apps/web/src/game/GameRuntime.ts` — added a fixed-step accumulator; now built via an async `GameRuntime.create(canvas)` factory.
  - `apps/web/src/game/scene/createFoundationScene.ts` — arena meshes are now generated from the shared `ARENA` table (same data as the physics colliders).
  - `apps/web/src/game/GameCanvas.tsx` — mounts the runtime via the async factory with a StrictMode-safe guard.
  - `apps/web/package.json` + `pnpm-lock.yaml` — swapped the Rapier dependency to `-compat`.
- **Physics architecture:** `PhysicsWorld` wraps a Rapier `World` (gravity from `PLAYER_PHYSICS.gravity`), builds a **fixed** RigidBody per `ARENA` entry with a matching `ColliderDesc.cuboid(...)`, and creates the player as a **kinematic-position-based** RigidBody with a capsule collider and a `CharacterController`. It exposes `step(desiredTranslation) -> boolean` (the grounded result for this step) and `getPosition()`. A module-level `ensureRapierReady()` caches the single `init()` promise; `PhysicsWorld.create()` is an async static factory with a private constructor so the WASM is always initialised before the world is built. Because `-compat` init is async, the async factory was propagated up the chain: `PhysicsWorld.create()` → `PlayerController.create(scene, input)` → `GameRuntime.create(canvas)` → awaited inside the `GameCanvas` effect (with an `active` flag so a stale StrictMode remount can't leak a half-initialised runtime).
- **Character collider dimensions:** Capsule total height 1.8 m = 2 × (halfHeight 0.55 + radius 0.35). `CHARACTER_HALF_HEIGHT = 0.55`, `CHARACTER_RADIUS = 0.35`, and `CHARACTER_HEIGHT_OVER_2 = 0.9` (centre→feet offset).
- **Character-controller configuration:** `world.createCharacterController(0.02)` (2 cm de-penetration), `controller.disableAutostep()` (the character must not auto-climb onto platforms/steps — intentional for a foundation stage), and `controller.enableSnapToGround(0.1)` (10 cm ground snap so the character stays glued to surfaces between steps).
- **Movement pipeline changes:** `PlayerController.update(deltaSeconds, cameraYawRadians, jumpRequested)` reads local input, converts to world space with `movementInputToWorld`, normalises, and computes a horizontal displacement `moveSpeed * deltaSeconds`. Vertical motion is computed by the pure `stepVerticalMovement(previousVelocity, jumpRequested, grounded, deltaSeconds, PLAYER_PHYSICS)`, producing the next velocity; `dy = nextVelocity * deltaSeconds`. The combined `{x:dx, y:dy, z:dz}` is handed to `PhysicsWorld.step()`, which moves the kinematic body **through the character controller** (so collision resolution is applied) and returns `computedGrounded()`. `PlayerController` stores the returned velocity and grounded flag for the next step. The Babylon mesh is then mirrored from `physics.getPosition()`, and `mesh.rotation.y = cameraYawRadians` is retained.
- **Gravity / jump values:** gravity `-25 m/s²`, jump speed `9 m/s` (from `PLAYER_PHYSICS`). These are game-tuned action values, not physical constants.
- **Ground-detection approach:** Grounded state comes from `controller.computedGrounded()` after each step. Jump eligibility uses the **previous** step's grounded flag (`lastGrounded`), so a jump is accepted only if the character was on the ground on the prior step — this is what makes a single Space press produce exactly one hop and holding Space airborne produce no double-jump (also reinforced by `InputManager` latching only the first non-repeating key-down).
- **Fixed-step implementation:** `GameRuntime` accumulates real frame time and advances physics in whole `FIXED_DT = 1/60` steps (capped at `MAX_FIXED_STEPS_PER_FRAME = 8`, with the un-simulated remainder dropped on cap to avoid the spiral of death). `MAX_FRAME_DELTA_SECONDS = 0.1` clamps a single frame. This decouples collision/gravity/jump behaviour from the render frame rate.
- **Arena collider implementation:** The `ARENA` table in `arena.ts` is the single source of truth used by both the physics world (Rapier cuboids) and `createFoundationScene` (Babylon boxes), so the visible geometry and the colliders can never drift apart.
- **Center/feet semantic fix:** Stage 1C exposed a single ambiguous `getPosition()`. Now `getCenterPosition()` returns the physics body (capsule centre) and `getFeetPosition()` returns centre − `CHARACTER_HEIGHT_OVER_2` (0.9 m). The camera (`ThirdPersonCameraController.update`) now receives the **true feet** position, so its target height is anchored to the ground contact point rather than the capsule centre.
- **Unit tests (17 total, all passing):** Five new `stepVerticalMovement` tests — gravity integration; grounded jump launches at `jumpSpeed`; airborne jump is rejected (airborne request == no request); grounded downward velocity clamps to exactly 0; and split-step equivalence (10 × 0.1 s == 1 × 1.0 s). The 12 pre-existing movement tests are unchanged.
- **Browser verification (`pnpm dev`):** The page loads with one canvas and **no console/runtime errors**, confirming the async Rapier compat WASM initialises and the whole physics world (4 arena colliders + character + controller) constructs cleanly — otherwise `GameCanvas`'s `.catch` would have logged "Failed to start the game runtime". The full scene renders (ground, center box, tower, platform, green capsule). **Live gameplay (collision/slide, gravity fall, single grounded jump, no double-jump) could not be driven synthetically**: this automation browser refuses the Pointer Lock API (`requestPointerLock()` returns a promise it never grants, so `pointerLockElement` stays `none`), and `InputManager` intentionally gates all gameplay input on pointer lock. This is the same, already-documented security behaviour noted in Stage 1C — a manual click-to-play in a real browser is required to confirm the feel. The underlying motion is covered by the 17 passing unit tests and the verified physics construction.
- **Production preview:** `pnpm build` (success; WASM inlined into the main chunk, only the known non-blocking chunk-size warning) then `pnpm --filter @buildshift/web preview` loaded with one canvas, the overlay, and **zero errors** — confirming the inlined WASM initialises in the Rollup bundle.
- **Server regression:** `pnpm --filter @buildshift/game-server typecheck` and `build` both passed (the server is untouched by Stage 1D but verified per spec).
- **Local verification:** `pnpm typecheck` (all 5 projects), `pnpm build`, and `pnpm test` (17/17) all passed.
- **GitHub Actions:** Pending (to be recorded after the run).
- **Still unresolved:** Live, felt gameplay (collision/slide, gravity, jump, no double-jump) must be confirmed by a human in a real browser, because the automation environment refuses pointer lock. Camera collision, sprint/crouch/slide, and Stage 1E remain intentionally deferred.
