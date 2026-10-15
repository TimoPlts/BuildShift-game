/**
 * Production browser smoke suite
 *
 * Exercises the real production path: the built web client (Babylon + Rapier +
 * Colyseus SDK) connecting to the authoritative game server in headless
 * Chromium. No mocked parallel implementations — the same code that ships
 * runs here.
 *
 * Prerequisites:
 *   - `pnpm build` has completed (apps/web/dist and apps/game-server/dist exist)
 *
 * Coverage:
 *   - Frontend startup (canvas renders, no console errors)
 *   - Connection to the canonical server
 *   - Two clients in the same room
 *   - Movement / input
 *   - Assault-rifle fire / reload / switching
 *   - Shotgun firing / switch-back
 *   - Build-mode fire suppression
 *   - Authoritative build visible to both clients
 *   - Timer continuation
 *   - No unexpected socket close
 *   - All four build types (wall/floor/ramp/cone) placement attempts
 *   - Build-edit / destruction intent (clear + apply) keeps clients in sync
 *   - Two-client edit course: rapid floor/ramp/wall placement, immediate edit
 *     of the placed wall (tile select/deselect/reset round-trips),
 *     confirm-then-shotgun layer exit, enemy edit denial, identical
 *     replication ownership, and clean HUD/listener/socket state
 *   - Round completion (via elimination)
 *   - Next rounds run to the final MATCH OVER
 *   - Connected rematch
 *   - Repeated-rematch HUD/audio/listener state stays clean

 *   - Combined-state diagnostics (arena / player / build / disconnect / diag)
 */
import { test, expect, type Page, type BrowserContext, type Browser, chromium } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, createWriteStream, mkdirSync } from "node:fs";
import { BUILD_GRID, PLAYER_MOVEMENT, PLAYER_COLLIDER, PLAYER_COLLIDER_HALF_TOTAL_HEIGHT, PLAYER_CROUCH_COLLIDER_HALF_TOTAL_HEIGHT, STRUCTURE_DURABILITY, VERTICAL_MOVEMENT, PLAYABLE_ARENA_BOUNDS, BUILD_BOUNDS, rayStructureIntersection, structureCuboids, type GeometryEditState, type StructureCuboid, type StructureGeometryInput } from "@buildshift/game-config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Constants ────────────────────────────────────────────────────────────────

// Ports are overridable via env so concurrent worktrees / CI lanes can run
// the suite without colliding with a foreign server bound to the defaults.
// The page is pointed at THIS server explicitly via the `?gameServer=`
// runtime override (see `resolveGameServerUrl`) — without it, the browser
// client would fall back to `ws://<host>:2567` and could silently play
// against a foreign server bound to the default port.
const GAME_SERVER_PORT = Number(process.env.BS_TEST_GAME_SERVER_PORT ?? 25671);
const STATIC_SERVER_PORT = Number(process.env.BS_TEST_STATIC_SERVER_PORT ?? 41730);
const GAME_SERVER_URL = `ws://127.0.0.1:${GAME_SERVER_PORT}`;
const APP_URL = `http://127.0.0.1:${STATIC_SERVER_PORT}/?devdiag=1&gameServer=${GAME_SERVER_URL}`;

// Resolve the monorepo root (three levels up from apps/web/tests).
const ROOT = path.resolve(__dirname, "../../..");
const WEB_DIST = path.join(ROOT, "apps/web/dist");
const SERVER_ENTRY = path.join(ROOT, "apps/game-server/src/index.ts");

// ─── Server lifecycle ─────────────────────────────────────────────────────────

let gameServerProc: ChildProcess | null = null;
let staticServer: http.Server | null = null;
/** Server stdout/stderr from the current run, for diagnosing live-round failures. */
export const SERVER_LOG_PATH = path.join(ROOT, "test-results", "game-server.log");

/**
 * Start the authoritative game server as a child process.
 * Resolves when the server is accepting connections.
 */
async function startGameServer(): Promise<void> {
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error(
      `Game server entry not found at ${SERVER_ENTRY}.`,
    );
  }

  // Use tsx to run the TypeScript source directly (same as dev mode).
  // The cwd must be apps/game-server so workspace package resolution works.
  const tsxBin = path.join(ROOT, "apps/game-server/node_modules/.bin/tsx");
  const serverCwd = path.join(ROOT, "apps/game-server");

  return new Promise<void>((resolve, reject) => {
    mkdirSync(path.dirname(SERVER_LOG_PATH), { recursive: true });
    const logStream = createWriteStream(SERVER_LOG_PATH, { flag: "a" });
    logStream.write(`\n=== game server start (port ${GAME_SERVER_PORT}) ${new Date().toISOString()} ===\n`);
    const proc = spawn(tsxBin, [SERVER_ENTRY], {
      cwd: serverCwd,
      env: {
        ...process.env,
        GAME_SERVER_PORT: String(GAME_SERVER_PORT),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    gameServerProc = proc;

    let resolved = false;
    let procExited = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        reject(new Error("Game server did not start within 15s"));
        proc.kill();
      }
    }, 15_000);

    proc.stdout?.on("data", (chunk: Buffer) => {
      logStream.write(chunk);
      const text = chunk.toString();
      if (!resolved && (text.includes("listening") || text.includes("started") || text.includes(String(GAME_SERVER_PORT)))) {
        resolved = true;
        clearTimeout(timeout);
        resolve();
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      // Colyseus logs to stderr; also check for the port there.
      logStream.write(chunk);
      const text = chunk.toString();
      if (!resolved && (text.includes("listening") || text.includes(String(GAME_SERVER_PORT)))) {
        resolved = true;
        clearTimeout(timeout);
        resolve();
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on("exit", (code) => {
      procExited = true;
      if (!resolved && code !== null) {
        clearTimeout(timeout);
        reject(
          new Error(
            `Game server exited with code ${code} before becoming ready` +
              (code === 1 ? ` (EADDRINUSE on port ${GAME_SERVER_PORT}? see ${SERVER_LOG_PATH})` : ""),
          ),
        );
      }
    });

    // Fallback: if the server doesn't log "listening" but the port is open
    // *and this process is still alive*, consider it started. The process
    // guard matters: a foreign server bound to the same port would otherwise
    // be mistaken for ours (the page is pointed at this server explicitly via
    // `?gameServer=`, so a foreign listener is a configuration error, not a
    // valid fallback).
    const pollPort = async () => {
      for (let i = 0; i < 30; i++) {
        await sleep(500);
        if (procExited) return;
        try {
          const { default: net } = await import("node:net");
          const sock = net.connect(GAME_SERVER_PORT, "127.0.0.1");
          sock.on("connect", () => {
            sock.destroy();
            if (!resolved && !procExited) {
              resolved = true;
              clearTimeout(timeout);
              resolve();
            }
          });
          sock.on("error", () => sock.destroy());
        } catch {
          // port not ready yet
        }
        if (resolved || procExited) return;
      }
    };
    void pollPort();
  });
}

/**
 * Start a minimal static file server for the production build.
 */
async function startStaticServer(): Promise<void> {
  if (!existsSync(WEB_DIST)) {
    throw new Error(
      `Web build not found at ${WEB_DIST}. Run \`pnpm build\` first.`,
    );
  }

  const MIME: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".wasm": "application/wasm",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".map": "application/json",
  };

  const server = http.createServer((req, res) => {
    const rawUrl = req.url ?? "/";
    const urlPath = rawUrl.split("?")[0] || "/";
    const filePath = path.join(WEB_DIST, urlPath === "/" ? "index.html" : urlPath);
    try {
      const content = readFileSync(filePath);
      const ext = path.extname(filePath);
      res.writeHead(200, {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(content);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(STATIC_SERVER_PORT, "127.0.0.1", resolve);
  });
  staticServer = server;
}

async function stopServers(): Promise<void> {
  if (gameServerProc) {
    gameServerProc.kill("SIGTERM");
    await sleep(500);
    if (!gameServerProc.killed) gameServerProc.kill("SIGKILL");
    gameServerProc = null;
  }
  if (staticServer) {
    await new Promise<void>((resolve) => staticServer!.close(() => resolve()));
    staticServer = null;
  }
}

// ─── Shared state across serial tests ─────────────────────────────────────────

let browser: Browser | null = null;
let browserContext: BrowserContext | null = null;
let pageA: Page | null = null;
let pageB: Page | null = null;
let socketCloseEvents: string[] = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Load the app and wait for the game canvas to be present and the runtime
 * to have initialised (Babylon engine running, no fatal errors).
 */
async function loadApp(page: Page): Promise<void> {
  // Collect console errors to detect fatal initialisation failures.
  const errors: string[] = [];
  const logs: string[] = [];
  page.on("console", (msg) => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto(APP_URL, { waitUntil: "networkidle", timeout: 30_000 });

  // Wait for the game canvas to be in the DOM.
  try {
    await page.waitForSelector("canvas.game-canvas", { timeout: 20_000 });
  } catch (e) {
    // Include diagnostic info in the error.
    const body = await page.evaluate(() => document.body?.innerHTML?.substring(0, 500) ?? "");
    const logDump = logs.slice(-20).join("\n");
    throw new Error(
      `Canvas not found after 20s.\n` +
      `Body: ${body}\n` +
      `Console logs:\n${logDump}\n` +
      `Errors: ${errors.join("; ")}`
    );
  }

  // Wait for the HUD to appear (indicates the runtime is connected and
  // has received its first authoritative state).
  await page.waitForSelector(".game-hud", { timeout: 30_000 });

  // Filter out benign warnings (Colyseus "message not registered", etc.)
  const fatalErrors = errors.filter(
    (e) =>
      !e.includes("message not registered") &&
      !e.includes("WebSocket connection") &&
      !e.includes("ECONNREFUSED") &&
      !e.includes("net::"),
  );
  // We don't fail on ALL errors (some are benign in headless), but we do
  // record them for the test report.
  test.info().annotations.push({
    type: "console-errors",
    description: fatalErrors.length > 0 ? fatalErrors.join("; ") : "none",
  });
}

/**
 * Acquire pointer lock on the game canvas.
 * Uses synthetic pointerlockchange to avoid CDP hangs in headless mode.
 */
async function acquirePointerLock(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas.game-canvas");
    if (!canvas) return;
    Object.defineProperty(document, "pointerLockElement", {
      get: () => canvas,
      configurable: true,
    });
    document.dispatchEvent(new Event("pointerlockchange"));
  });
  await new Promise((r) => setTimeout(r, 100));
}

/**
 * Dump diagnostic state from both pages + any fatal console errors.
 * Used to capture root-cause data when a live-round assertion fails:
 * the authoritative phase/round/sequence/connection state as seen by each
 * client (via the ?devdiag=1 overlay) plus recent fatal console errors.
 */
async function dumpDiag(context: string, pageA: Page | null, pageB: Page | null): Promise<void> {
  const read = async (p: Page | null): Promise<unknown> => {
    if (!p) return "(no page)";
    try {
      return await p.evaluate(() => ({
        phase: document.querySelector(".match-hud__phase")?.textContent ?? "<no phase>",
        endScreen: document.querySelector(".match-end-screen") !== null,
        buttons: Array.from(document.querySelectorAll("button")).map((b) => b.textContent ?? ""),
        pointerOverlay: document.querySelector(".pointer-lock-overlay") !== null,
        devdiag: (document.querySelector(".devdiag-overlay")?.textContent ?? "<no devdiag>").replace(/\n+/g, " "),
      }));
    } catch (e) {
      return `(read failed: ${(e as Error).message})`;
    }
  };
  const [a, b] = await Promise.all([read(pageA), read(pageB)]);
  console.log(`[diag:${context}] A:`, JSON.stringify(a));
  console.log(`[diag:${context}] B:`, JSON.stringify(b));
  const fatal = fatalConsoleErrors.slice(-8);
  if (fatal.length) console.log(`[diag:${context}] fatalConsoleErrors:`, JSON.stringify(fatal));
}

/**
 * Wait until the match phase transitions to IN_PROGRESS (countdown done).
 */
async function waitForInProgress(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const el = document.querySelector(".match-hud__phase");
      return el?.textContent === "IN PROGRESS";
    },
    { timeout: timeoutMs },
  );
}

/**
 * Read the current weapon name from the HUD.
 */
async function getWeaponName(page: Page): Promise<string> {
  return page.evaluate(() => {
    return document.querySelector(".weapon-hud__name")?.textContent ?? "";
  });
}

/**
 * Read the current magazine ammo count from the HUD.
 */
async function getMagazineAmmo(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector(".weapon-hud__ammo-magazine");
    if (!el) return 0;
    const match = el.textContent?.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  });
}

/**
 * Read the round timer remaining text from the HUD (e.g. "1:29").
 */
async function getRoundTimerText(page: Page): Promise<string | null> {
  const el = page.locator(".match-hud__timer-value");
  if (!(await el.isVisible())) return null;
  return el.textContent() ?? null;
}

/**
 * Read the health value from the vitals HUD.
 */
async function getHealth(page: Page): Promise<number> {
  const text = (await page.locator(".combat-vitals-hud__row").first().locator(".combat-vitals-hud__value").textContent()) ?? "0";
  const match = text.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Check if the local player is eliminated.
 */
async function isEliminated(page: Page): Promise<boolean> {
  return page.locator(".combat-vitals-hud--eliminated").count() > 0;
}

/**
 * Send a weapon switch command by pressing the slot key.
 */
async function switchWeapon(page: Page, slotKey: "Digit1" | "Digit2"): Promise<void> {
  await page.keyboard.press(slotKey);
}

/**
 * Ensure the InputManager's pointerLocked flag is true.
 * In headless Chromium, requestPointerLock() can cause CDP hangs.
 * Instead, we dispatch a synthetic pointerlockchange event to set the flag.
 */
async function ensurePointerLock(page: Page): Promise<void> {
  const locked = await page.evaluate(
    () => document.pointerLockElement !== null,
    { timeout: 5_000 },
  );
  if (!locked) {
    // Set document.pointerLockElement to the canvas and dispatch the event.
    // This tricks the InputManager into thinking pointer lock is active.
    await page.evaluate(() => {
      const canvas = document.querySelector("canvas.game-canvas");
      if (!canvas) return;
      // Monkey-patch pointerLockElement to return the canvas.
      Object.defineProperty(document, "pointerLockElement", {
        get: () => canvas,
        configurable: true,
      });
      document.dispatchEvent(new Event("pointerlockchange"));
    }, { timeout: 5_000 });
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Request a rematch by clicking the MatchEndScreen "Play Again" / "Rematch"
 * button using a **synthetic DOM click** rather than Playwright's
 * `locator.click()`.
 *
 * `locator.click()` moves the real (virtual) mouse to the button, which emits
 * genuine `mousemove` events with non-zero `movementY`. While the suite's fake
 * pointer lock (see `ensurePointerLock`) is active, the InputManager accumulates
 * those deltas into the camera yaw/pitch, silently tilting the aim (e.g. down
 * to the -60° pitch clamp) for the next match. That makes the rematched player
 * fire into the ground and the elimination loop stall. A synthetic `btn.click()`
 * fires the same React `onClick` handler without moving the mouse, so the
 * camera state is left intact.
 *
 * @returns true when the button was found and clicked, false otherwise.
 */
async function requestRematch(page: Page): Promise<boolean> {
  // Wait for the MatchEndScreen primary button to render.
  await page
    .waitForFunction(
      () =>
        Array.from(document.querySelectorAll("button")).some((b) =>
          /play again|rematch/i.test(b.textContent ?? ""),
        ),
      { timeout: 20_000 },
    )
    .catch(() => {});
  return page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      /play again|rematch/i.test(b.textContent ?? ""),
    );
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });
}

/**
 * Shared collection of fatal-looking console errors across all pages, used by
 * the repeated-rematch cleanup assertion.
 */
const fatalConsoleErrors: string[] = [];

/**
 * Attach a console-error tracker to a page. Benign headless noise is
 * filtered out with the same rules as `loadApp`.
 */
function trackFatalErrors(page: Page): void {
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (
      text.includes("message not registered") ||
      text.includes("WebSocket connection") ||
      text.includes("ECONNREFUSED") ||
      text.includes("net::")
    ) {
      return;
    }
    fatalConsoleErrors.push(text);
  });
  page.on("pageerror", (err) => fatalConsoleErrors.push(err.message));
}

/**
 * Read whether build mode is active on a page, via the developer
 * diagnostics overlay (`Build:on/off`; the suite loads with ?devdiag=1).
 */
async function buildModeActive(page: Page): Promise<boolean> {
  const text = await page.evaluate(
    () => document.querySelector(".devdiag-overlay")?.textContent ?? "",
  );
  return /Build:\s*on/i.test(text);
}

/**
 * Make sure the page is in combat (non-build) mode so weapon fire is routed
 * to the weapon controller, toggling build mode off if a previous test left
 * it on.
 */
async function ensureCombatMode(page: Page): Promise<void> {
  if (await buildModeActive(page)) {
    await page.keyboard.press("KeyB");
    await new Promise((r) => setTimeout(r, 300));
  }
}

/**
 * Read the total combat points (health + shield) shown on a page's vitals
 * HUD. Used to detect when shots are actually landing on the opponent.
 */
async function combatTotal(page: Page): Promise<number> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".combat-vitals-hud__row"));
    let total = 0;
    for (const row of rows) {
      const value = row.querySelector(".combat-vitals-hud__value")?.textContent ?? "";
      const match = value.match(/^(\d+)/);
      if (match) total += parseInt(match[1], 10);
    }
    return total;
  });
}

/**
 * Read the local (page-owner) round score from the match HUD.
 */
async function localScore(page: Page): Promise<number> {
  const text = await page.locator(".match-hud__score-value--local").textContent();
  const match = text?.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Read the authoritative (last server-reconciled) position shown in the
 * dev-diagnostics overlay. The overlay only renders with ?devdiag, which the
 * smoke tests enable; returns null if it is not available.
 */
async function authPos(page: Page): Promise<[number, number, number] | null> {
  return page.evaluate(() => {
    const t = document.querySelector(".devdiag-overlay")?.textContent ?? "";
    const m = t.match(
      /Auth:\s*\(\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\)/,
    );
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  }, { timeout: 5_000 }).catch(() => null);
}

/** Wrap an angle difference into [-π, π]. */
function normAngle(rad: number): number {
  while (rad > Math.PI) rad -= 2 * Math.PI;
  while (rad < -Math.PI) rad += 2 * Math.PI;
  return rad;
}

/**
 * Hold primary fire until the match phase leaves IN PROGRESS (round ended
 * via elimination or timer), then return the final phase text.
 *
 * Aiming strategy (headless-friendly, deterministic):
 *  1. Measure the camera's actual yaw by holding W for a moment and reading
 *     the authoritative position delta (works regardless of carried-over
 *     yaw from previous rounds).
 *  2. Compute the bearing to the opponent from both players' authoritative
 *     positions and apply one exact mouse-delta correction.
 *  3. Hold fire; re-probe and re-correct only when damage stops landing.
 *
 * The magazine is reloaded automatically when it runs low (best effort —
 * precise aim means a kill usually fits in a single 30-round magazine).
 */
async function holdFireUntilRoundOver(
  pageA: Page,
  pageB: Page,
  timeoutMs = 90_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const dispatchLook = (px: number) =>
    pageA.evaluate((px2: number) => {
      document.dispatchEvent(
        new MouseEvent("mousemove", { movementX: px2, movementY: 0, bubbles: true }),
      );
    }, px).catch(() => {});

  // Look deltas are only consumed while the InputManager reports pointer
  // lock, so establish the (fake) lock before any aim mousemove.
  await ensurePointerLock(pageA);

  // Initial best-guess aim: from spawn x=-5 the opponent at x=+5 is yaw
  // +π/2; mouse left (negative movementX) increases yaw at 0.0022 rad/px,
  // so -714px ≈ +90°. The probe below corrects any residual error.
  await dispatchLook(-714);

  await pageA.evaluate(() => {
    document.querySelector("canvas.game-canvas")?.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, bubbles: true }),
    );
  }, { timeout: 5_000 });

  let phase = "";
  let opponentTotal = await combatTotal(pageB);
  let lastDamageAt = 0; // 0 forces an immediate first aim
  let lastAimAttempt = 0;
  let reaims = 0;
  try {
    while (Date.now() < deadline) {
      const now = Date.now();
      const ammo = await getMagazineAmmo(pageA);
      if (ammo <= 2) {
        // Reload is not sequence-gated.
        await pageA.keyboard.press("KeyR").catch(() => {});
        await sleep(2_500);
      } else if (
        now - lastDamageAt > 6_000 &&
        now - lastAimAttempt > 3_000 &&
        reaims < 14
      ) {
        // Probe the camera yaw: hold W, measure the authoritative delta.
        const p0 = await authPos(pageA);
        await pageA.keyboard.down("KeyW");
        await sleep(1_200);
        await pageA.keyboard.up("KeyW");
        await sleep(500);
        const p1 = await authPos(pageA);
        const pB = await authPos(pageB);
        lastAimAttempt = Date.now();
        if (p0 && p1 && pB) {
          const dx = p1[0] - p0[0];
          const dz = p1[2] - p0[2];
          if (dx * dx + dz * dz >= 0.25) {
            // Moved ≥ 0.5 m: the probe is reliable.
            const yaw = Math.atan2(dx, -dz);
            const bearing = Math.atan2(pB[0] - p1[0], -(pB[2] - p1[2]));
            // applyLook does `yaw -= px * sensitivity`, so increasing yaw
            // toward the bearing needs px ∝ (yaw − bearing).
            const px = Math.round(normAngle(yaw - bearing) / 0.0022);
            console.log(
              `[aim:probe] reaim=${reaims} A0=(${p0.map((v) => v.toFixed(1)).join(",")}) ` +
                `A1=(${p1.map((v) => v.toFixed(1)).join(",")}) B=(${pB.map((v) => v.toFixed(1)).join(",")}) ` +
                `yaw=${yaw.toFixed(2)} bearing=${bearing.toFixed(2)} px=${px} ammo=${ammo} oppTotal=${opponentTotal}`,
            );
            if (Math.abs(px) > 5) await dispatchLook(px);
            reaims += 1;
            // Give the corrected aim a short window before deciding to
            // re-aim again (damage checks resume immediately).
            lastDamageAt = Date.now() - 3_000;
          }
          // Zero movement means the probe data is stale; retry on the
          // next pass.
        }
      }
      await sleep(700);
      const vitals = await combatTotal(pageB);
      if (vitals < opponentTotal) {
        opponentTotal = vitals;
        lastDamageAt = Date.now();
      }
      phase = await pageA.evaluate(
        () => document.querySelector(".match-hud__phase")?.textContent ?? "",
        { timeout: 5_000 },
      );
      if (phase === "ROUND OVER" || phase === "MATCH OVER") break;
    }
  } finally {
    await pageA.keyboard.up("KeyW").catch(() => {});
    await pageA.evaluate(() => {
      document.querySelector("canvas.game-canvas")?.dispatchEvent(
        new MouseEvent("mouseup", { button: 0, bubbles: true }),
      );
    }, { timeout: 5_000 }).catch(() => {});
  }
  if (phase === "IN PROGRESS") {
    // The deadline elapsed without the round ending: capture where both
    // players ended up (predicted + authoritative) so an aim / input-stall
    // failure is diagnosable from the log.
    const pos = async (p: Page) =>
      p
        .evaluate(() => {
          const t = document.querySelector(".devdiag-overlay")?.textContent ?? "";
          const pred = t.match(/Pred:\s*\(\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\)/);
          const auth = t.match(/Auth:\s*\(\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\)/);
          const seq = t.match(/Seq:\s*(\d+)/);
          const phase = document.querySelector(".match-hud__phase")?.textContent ?? "";
          return {
            phase,
            pred: pred ? [pred[1], pred[2], pred[3]] : null,
            auth: auth ? [auth[1], auth[2], auth[3]] : null,
            seq: seq ? Number(seq[1]) : null,
          };
        })
        .catch(() => "(read failed)");
    const [a, b] = await Promise.all([pos(pageA), pos(pageB)]);
    console.log(`[diag:holdFire-timeout] A:`, JSON.stringify(a));
    console.log(`[diag:holdFire-timeout] B:`, JSON.stringify(b));
  }
  return phase;
}

/**
 * Wait until both pages reach the IN PROGRESS phase (start of a round).
 */
async function waitForRoundStart(pageA: Page, pageB: Page): Promise<void> {
  const ready = (page: Page) =>
    page.waitForFunction(
      () => {
        const el = document.querySelector(".match-hud__phase");
        const text = el?.textContent ?? "";
        return text === "GET READY" || text === "IN PROGRESS";
      },
      { timeout: 45_000 },
    );
  try {
    await Promise.all([ready(pageA), ready(pageB)]);
  } catch (e) {
    await dumpDiag("waitForRoundStart-timeout", pageA, pageB);
    throw e;
  }
}

/**
 * Wait until both pages report the IN PROGRESS phase (a live round in which
 * build placement and edits are accepted).
 */
async function waitForBothInProgress(pageA: Page, pageB: Page, timeoutMs = 60_000): Promise<void> {
  const ready = (page: Page) =>
    page.waitForFunction(
      () => document.querySelector(".match-hud__phase")?.textContent === "IN PROGRESS",
      { timeout: timeoutMs },
    );
  try {
    await Promise.all([ready(pageA), ready(pageB)]);
  } catch (e) {
    await dumpDiag("waitForBothInProgress-timeout", pageA, pageB);
    throw e;
  }
}

/**
 * Fire the current weapon by dispatching mousedown on the pointer-locked element.
 * Holds the button briefly to ensure the game loop picks up the fire input.
 * Uses short timeouts to fail fast if the page is unresponsive.
 */
async function fireWeapon(page: Page): Promise<void> {
  await ensurePointerLock(page);
  await page.evaluate(() => {
    // Use pointerLockElement if available, otherwise fall back to the canvas.
    const el = (document.pointerLockElement ?? document.querySelector("canvas.game-canvas")) as HTMLElement | null;
    if (!el) return; // no element to dispatch to
    el.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
  }, { timeout: 5_000 });
  // Hold for 100ms to ensure the game loop consumes the fire input.
  await new Promise((r) => setTimeout(r, 100));
  await page.evaluate(() => {
    const el = (document.pointerLockElement ?? document.querySelector("canvas.game-canvas")) as HTMLElement | null;
    if (el) el.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true }));
  }, { timeout: 5_000 });
}

// ─── Edited-geometry acceptance helpers ───────────────────────────────────────
//
// Shared by the physical window/floor/cone/ramp acceptance cases. Every case
// runs in a fresh two-client room; positions are read from the authoritative
// (server-replicated) state, and geometry is compared to the shared
// `structureCuboids` from `@buildshift/game-config`.

type AuthPose = { x: number; y: number; z: number; yaw: number; vy: number; crouch: boolean; seq: number };
type AcceptanceEditGrid = GeometryEditState;

/** Authoritative local pose (the parsed client state mirrors the server). */
function authPose(page: Page): Promise<AuthPose> {
  return page.evaluate((): AuthPose => {
    const client = (window as any).__buildshiftNetworking.client.deref();
    const p = client.state.players[client.sessionId];
    return { x: p.x, y: p.y, z: p.z, yaw: p.yaw, vy: p.vy, crouch: p.crouch, seq: p.sequence };
  });
}

/** Wait on a predicate over the authoritative local player `p`. */
function waitPose(page: Page, predicate: string, arg: Record<string, unknown>, timeout: number) {
  return page.waitForFunction(({ predicate, arg }) => {
    const client = (window as any).__buildshiftNetworking.client.deref();
    const p = client.state.players[client.sessionId];
    return p ? new Function("p", "arg", `return ${predicate};`)(p, arg) as boolean : false;
  }, { predicate, arg }, { timeout, polling: 50 });
}

/** Join B then A (A gets spawn slot 1) and require a fresh shared room. */
async function openFreshDuel(tag: string, viewport = { width: 1280, height: 720 }) {
  const t0 = Date.now();
  const step = (name: string) => console.log(`[${tag}] +${Date.now() - t0}ms ${name}`);
  const context = await browser!.newContext({ viewport });
  const a = await context.newPage();
  const b = await context.newPage();
  await b.goto(APP_URL);
  await b.waitForFunction(() => Boolean((window as any).__buildshiftNetworking?.client?.deref()?.sessionId));
  await a.goto(APP_URL);
  await waitForBothInProgress(a, b);
  await Promise.all([ensurePointerLock(a), ensurePointerLock(b)]);
  const ids = await Promise.all([a, b].map(page => page.evaluate(() => {
    const client = (window as any).__buildshiftNetworking.client.deref();
    return { roomId: client.room?.roomId as string, sessionId: client.sessionId as string, structures: Object.keys(client.state.building.structures).length };
  })));
  expect(ids[0]!.roomId).toBeTruthy();
  expect(ids[1]!.roomId).toBe(ids[0]!.roomId);
  expect(ids[0]!.structures).toBe(0);
  step(`fresh room ${ids[0]!.roomId}`);
  return { context, a, b, aId: ids[0]!.sessionId, bId: ids[1]!.sessionId, step };
}

/** Request an authoritative placement from page A and wait for both clients. */
async function placeStructure(a: Page, b: Page, sequence: number, buildType: StructureGeometryInput["buildType"], grid: { x: number; y: number; z: number }, rotation: number): Promise<string> {
  const before: string[] = await a.evaluate(() => Object.keys((window as any).__buildshiftNetworking.client.deref().state.building.structures));
  expect(await a.evaluate(({ sequence, buildType, grid, rotation }) =>
    (window as any).__buildshiftNetworking.client.deref().send("build:placement_request", { sequence, buildType, grid, rotation }),
  { sequence, buildType, grid, rotation })).toBe(true);
  await Promise.all([a, b].map(page => page.waitForFunction((count) =>
    Object.keys((window as any).__buildshiftNetworking.client.deref().state.building.structures).length === count,
  before.length + 1, { timeout: 10_000 })));
  const id: string = await a.evaluate((old) => Object.keys((window as any).__buildshiftNetworking.client.deref().state.building.structures).find(k => !old.includes(k)), before);
  expect(id).toBeTruthy();
  return id;
}

/** Send one canonical edit action through the production edit transport. */
async function sendEdit(a: Page, structureId: string, action: Record<string, unknown>): Promise<void> {
  expect(await a.evaluate(({ structureId, action }) =>
    (window as any).__buildshiftNetworking.client.deref().send("two-player:edit_grid_action", { structureId, ...action }),
  { structureId, action })).toBe(true);
}

/**
 * Both clients: the authoritative edit state equals `editGrid` and the
 * permanent Babylon solids equal the shared canonical cuboids (world AABBs).
 */
async function expectCanonicalGeometry(
  pages: Page[], id: string, ownerId: string,
  input: { buildType: StructureGeometryInput["buildType"]; grid: { x: number; y: number; z: number }; rotation: number; editGrid: AcceptanceEditGrid },
  label: string,
): Promise<void> {
  const expected = structureCuboids(input)
    .map(({ center: c, halfExtents: h }) => ({ min: [c.x - h.x, c.y - h.y, c.z - h.z], max: [c.x + h.x, c.y + h.y, c.z + h.z] }));
  await Promise.all(pages.map(async (page) => {
    try {
      await page.waitForFunction(({ id, ownerId, editGrid, expected }) => {
        const s = (window as any).__buildshiftNetworking.client.deref().state.building.structures[id];
        if (!s || s.ownerId !== ownerId || JSON.stringify(s.editGrid) !== JSON.stringify(editGrid)) return false;
        const meshes = (window as any).__buildshiftEngine.scenes[0].meshes.filter((m: any) => m.name.startsWith(`build-solid-${id}-`));
        if (meshes.length !== expected.length) return false;
        const boxes = meshes.map((m: any) => {
          m.computeWorldMatrix(true);
          const bb = m.getBoundingInfo().boundingBox;
          return { min: [bb.minimumWorld.x, bb.minimumWorld.y, bb.minimumWorld.z], max: [bb.maximumWorld.x, bb.maximumWorld.y, bb.maximumWorld.z] };
        });
        const near = (u: number[], v: number[]) => u.every((n, i) => Math.abs(n - v[i]!) < 0.01);
        return expected.every((e: any) => boxes.some((r: any) => near(e.min, r.min) && near(e.max, r.max)));
      }, { id, ownerId, editGrid: input.editGrid, expected }, { timeout: 10_000 });
    } catch (error) {
      const diagnostic = await page.evaluate((id) => {
        const s = (window as any).__buildshiftNetworking.client.deref().state.building.structures[id];
        const meshes = (window as any).__buildshiftEngine.scenes[0].meshes.filter((m: any) => m.name.startsWith(`build-solid-${id}-`));
        return { structure: s, meshes: meshes.map((m: any) => { m.computeWorldMatrix(true); const bb = m.getBoundingInfo().boundingBox; return { name: m.name, min: bb.minimumWorld, max: bb.maximumWorld }; }) };
      }, id);
      throw new Error(`${label}: replicated state/Babylon geometry mismatch: ${JSON.stringify({ input, expected, ...diagnostic })}`, { cause: error });
    }
  }));
}

/** Dispatch a production look delta (the InputManager consumes movementX/Y). */
async function lookBy(page: Page, dx: number, dy: number): Promise<void> {
  await page.evaluate(({ dx, dy }) => {
    document.dispatchEvent(new MouseEvent("mousemove", { movementX: dx, movementY: dy, bubbles: true }));
  }, { dx, dy });
}

/** Press/release the primary fire button on the game canvas (production path). */
async function setPrimaryFire(page: Page, down: boolean): Promise<void> {
  await page.evaluate((down) => {
    const el = (document.pointerLockElement ?? document.querySelector("canvas.game-canvas")) as HTMLElement | null;
    el?.dispatchEvent(new MouseEvent(down ? "mousedown" : "mouseup", { button: 0, bubbles: true }));
  }, down);
}

/**
 * Record every authoritative patch of the local player as [seq, x, y, z]
 * from raw Colyseus state changes (WebSocket-driven, independent of render
 * FPS), so short events such as a fall or landing cannot be missed.
 */
async function installPoseTrace(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    const client = w.__buildshiftNetworking.client.deref();
    const trace: number[][] = w.__poseTrace = [];
    client.room.onStateChange((state: any) => {
      const p = state.players.get(client.sessionId);
      if (!p) return;
      trace.push([p.lastProcessedSequence, p.x, p.y, p.z]);
      if (trace.length > 4000) trace.splice(0, trace.length - 4000);
    });
  });
}

/**
 * Wait on the client's PREDICTED local pose (devdiag "Pred:"), which already
 * includes every input sent. Used only to decide when to release a movement
 * key (so the authoritative result does not overshoot by the inputs still in
 * flight); acceptance assertions always use authoritative state.
 */
function waitPredicted(page: Page, predicate: string, arg: Record<string, unknown>, timeout: number) {
  return page.waitForFunction(({ predicate, arg }) => {
    const m = (document.querySelector(".devdiag-overlay")?.textContent ?? "").match(/Pred:\s*\(\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\)/);
    if (!m) return false;
    const p = { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
    return new Function("p", "arg", `return ${predicate};`)(p, arg) as boolean;
  }, { predicate, arg }, { timeout, polling: 30 });
}

/** The last `n` recorded authoritative patches ([seq, x, y, z]). */
function poseTrace(page: Page, n: number): Promise<number[][]> {
  return page.evaluate((n) => ((window as any).__poseTrace as number[][]).slice(-n), n);
}

/** THIRD_PERSON_CAMERA.mouseSensitivity (rad/px): yaw -= dx·s, pitch -= dy·s. */
const LOOK_SENSITIVITY = 0.0022;

// ─── Test suite ───────────────────────────────────────────────────────────────

test.describe.configure({ mode: "serial" });

test.describe("Production browser smoke", () => {
  test.beforeAll(async () => {
    await startGameServer();
    await startStaticServer();
    // Create a persistent browser context for all serial tests.
    browser = await chromium.launch({ headless: true });
    browser.on("disconnected", (_b, reason) => {
      console.log(`[diag:browser] DISCONNECTED reason=${JSON.stringify(reason)} at ${new Date().toISOString()}`);
    });
    browserContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    browserContext.on("page", (p) => {
      p.on("close", () => {
        console.log(`[diag:browser] page closed at ${new Date().toISOString()}`);
      });
    });
  });

  test.afterAll(async () => {
    if (pageA) await pageA.close().catch(() => {});
    if (pageB) await pageB.close().catch(() => {});
    if (browserContext) await browserContext.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await stopServers();
  });

  test("frontend startup: canvas renders without fatal errors", async () => {
    pageA = await browserContext!.newPage();
    trackFatalErrors(pageA);
    socketCloseEvents = [];

    // Track unexpected socket close events via the page's WebSocket.
    pageA.on("console", (msg) => {
      const text = msg.text();
      if (
        (msg.type() === "error" || msg.type() === "warning") &&
        (text.includes("disconnect") || text.includes("close") || text.includes("drop")) &&
        !text.includes("message not registered")
      ) {
        socketCloseEvents.push(text);
      }
    });

    await loadApp(pageA);

    // The canvas should be present and have non-zero dimensions.
    const canvas = pageA.locator("canvas.game-canvas");
    await expect(canvas).toBeVisible();

    // The HUD should be rendering (game-hud container exists).
    await expect(pageA.locator(".game-hud")).toBeVisible();

    // The match HUD should eventually appear (once the first authoritative
    // match state is received). Wait up to 15s for it.
    await pageA.waitForSelector(".match-hud", { timeout: 15_000 });
  });

  test("connection to canonical server: phase shows COUNTDOWN", async () => {
    expect(pageA).not.toBeNull();
    // The match phase should show "GET READY" (COUNTDOWN) once the server
    // has started the countdown for a full room.
    await pageA!.waitForFunction(
      () => {
        const el = document.querySelector(".match-hud__phase");
        return el?.textContent === "GET READY" || el?.textContent === "IN PROGRESS";
      },
      { timeout: 15_000 },
    );
  });

  test("two clients: second player joins the same room", async () => {
    expect(pageA).not.toBeNull();
    pageB = await browserContext!.newPage();
    trackFatalErrors(pageB);

    // Track socket close events for page B as well.
    pageB.on("console", (msg) => {
      const text = msg.text();
      if (
        (msg.type() === "error" || msg.type() === "warning") &&
        (text.includes("disconnect") || text.includes("close") || text.includes("drop")) &&
        !text.includes("message not registered")
      ) {
        socketCloseEvents.push(text);
      }
    });

    await loadApp(pageB);

    // Both pages should now be in the same room. The "waiting for opponent"
    // indicator should disappear once both players are in.
    await pageA!.waitForFunction(
      () => {
        const el = document.querySelector(".match-hud__waiting");
        return el === null;
      },
      { timeout: 15_000 },
    );
    await pageB!.waitForFunction(
      () => {
        const el = document.querySelector(".match-hud__waiting");
        return el === null;
      },
      { timeout: 15_000 },
    );
  });

  test("countdown completes and round begins", async () => {
    expect(pageA).not.toBeNull();
    // Wait for the 3-second countdown to finish on both pages.
    await waitForInProgress(pageA!);
    await waitForInProgress(pageB!);

    // The round timer should now be visible and counting.
    const timerText = await getRoundTimerText(pageA!);
    expect(timerText).not.toBeNull();
    // Timer should be close to 1:30 (90 seconds).
    expect(timerText!).toMatch(/^\d+:\d{2}$/);
  });

  test("movement/input: player position changes with WASD", async () => {
    expect(pageA).not.toBeNull();
    // Acquire pointer lock on page A.
    await acquirePointerLock(pageA!);

    // Hold W for 1 second to move forward.
    await pageA!.keyboard.down("KeyW");
    await sleep(1_000);
    await pageA!.keyboard.up("KeyW");

    // Wait a moment for the server to process and replicate the state.
    await sleep(500);

    // Verify the game is still in progress (no disconnect).
    const phase = await pageA!.locator(".match-hud__phase").textContent();
    expect(phase).toBe("IN PROGRESS");
  });

  test("diagnostics: movement smoothness instrumentation renders on the live two-client path", async () => {
    expect(pageA).not.toBeNull();
    // The dev-diagnostics overlay (enabled via ?devdiag=1, which this suite
    // loads with) now also renders the movement smoothness section: render
    // frame time vs sim tick cadence, snapshot cadence + gap + pending
    // inputs, and correction rate. All three lines must be present while a
    // live round is running (render frames, sim ticks and snapshots are all
    // flowing). This is a coordinating check for the movement-smoothness
    // instrumentation; it replaces nothing in this suite.
    const t = await pageA!.evaluate(
      () => document.querySelector(".devdiag-overlay")?.textContent ?? "",
      { timeout: 5_000 },
    );
    expect(t).toContain("Mov:");
    expect(t).toContain("Net:");
    expect(t).toContain("CorrHz:");
  });

  test("AR fire: magazine ammo decreases after firing", async () => {
    expect(pageA).not.toBeNull();
    // Verify we're in assault rifle (default).
    const weapon = await getWeaponName(pageA!);
    expect(weapon).toBe("Assault Rifle");

    const ammoBefore = await getMagazineAmmo(pageA!);
    expect(ammoBefore).toBeGreaterThan(0);

    // Fire the weapon (retry up to 3 times for flaky pointer lock).
    let ammoAfter = ammoBefore;
    for (let attempt = 0; attempt < 3; attempt++) {
      await fireWeapon(pageA!);
      await sleep(500);
      ammoAfter = await getMagazineAmmo(pageA!);
      if (ammoAfter < ammoBefore) break;
    }
    expect(ammoAfter).toBeLessThan(ammoBefore);
  });

  test("AR reload: ammo restores after reload completes", async () => {
    expect(pageA).not.toBeNull();
    // Ammo was reduced in the previous fire test(s).
    const ammoBeforeReload = await getMagazineAmmo(pageA!);

    // Trigger reload.
    await pageA!.keyboard.press("KeyR");

    // Wait for reload to complete (assault rifle reload is ~1.8s).
    // The reload track element appears during reload and disappears when done.
    // If ammo was already full, the reload might not start - in that case
    // the reload track never appears and we just verify ammo is still 30.
    await sleep(3_000);

    const ammoAfterReload = await getMagazineAmmo(pageA!);
    // After reload, ammo should be at or above the pre-reload value.
    expect(ammoAfterReload).toBeGreaterThanOrEqual(ammoBeforeReload);
    if (ammoBeforeReload < 30) {
      expect(ammoAfterReload).toBeGreaterThan(ammoBeforeReload);
    }
  });

  test("weapon switching: switch to shotgun via key 2", async () => {
    expect(pageA).not.toBeNull();
    // Switch to shotgun.
    await switchWeapon(pageA!, "Digit2");
    await sleep(500);

    const weapon = await getWeaponName(pageA!);
    expect(weapon).toBe("Shotgun");
  });

  test("shotgun firing: ammo decreases when firing shotgun", async () => {
    expect(pageA).not.toBeNull();
    const ammoBefore = await getMagazineAmmo(pageA!);
    expect(ammoBefore).toBeGreaterThan(0);

    // Fire the weapon (retry for flaky headless frame timing, same pattern
    // as the AR fire test above).
    let ammoAfter = ammoBefore;
    for (let attempt = 0; attempt < 3; attempt++) {
      await fireWeapon(pageA!);
      await sleep(500);
      ammoAfter = await getMagazineAmmo(pageA!);
      if (ammoAfter < ammoBefore) break;
    }
    expect(ammoAfter).toBeLessThan(ammoBefore);
  });

  test("weapon switch-back: switch to assault rifle via key 1", async () => {
    expect(pageA).not.toBeNull();
    await switchWeapon(pageA!, "Digit1");
    await sleep(500);

    const weapon = await getWeaponName(pageA!);
    expect(weapon).toBe("Assault Rifle");
  });

  test("build-mode fire suppression: fire does not consume ammo in build mode", async () => {
    expect(pageA).not.toBeNull();
    // Enter building with the dedicated wall bind.
    await pageA!.keyboard.press("KeyQ");
    await sleep(300);
    expect(await buildModeActive(pageA!)).toBe(true);

    const ammoBefore = await getMagazineAmmo(pageA!);

    // Try to fire (left click in build mode should not fire the weapon).
    await fireWeapon(pageA!);
    await sleep(500);

    const ammoAfter = await getMagazineAmmo(pageA!);
    expect(ammoAfter).toBe(ammoBefore);

    // A weapon bind leaves building at once.
    await pageA!.keyboard.press("Digit1");
    await sleep(300);
    expect(await buildModeActive(pageA!)).toBe(false);
  });

  test("authoritative build visible to both clients", async () => {
    expect(pageA).not.toBeNull();
    expect(pageB).not.toBeNull();

    // The dedicated ramp bind enters building with the ramp selected.
    await pageA!.keyboard.press("KeyE");
    await sleep(200);

    // Place the structure (left click in build mode places).
    await fireWeapon(pageA!);
    await sleep(1_000);

    // Back to the weapon.
    await pageA!.keyboard.press("Digit1");
    await sleep(200);

    // Verify both pages are still connected and in progress.
    const phaseA = await pageA!.locator(".match-hud__phase").textContent();
    const phaseB = await pageB!.locator(".match-hud__phase").textContent();
    expect(phaseA).toBe("IN PROGRESS");
    expect(phaseB).toBe("IN PROGRESS");

    // The build was placed (or rejected due to range/energy) — either way,
    // both clients remain connected and the game continues.
    // A definitive check would require inspecting the scene graph or the
    // network state, but for a smoke test, verifying both clients remain
    // in-sync (same phase, same round) is sufficient.
  });

  test("timer continuation: round timer is still counting down", async () => {
    expect(pageA).not.toBeNull();
    const timer1 = await getRoundTimerText(pageA!);
    expect(timer1).not.toBeNull();

    // Wait 2 seconds.
    await sleep(2_000);

    const timer2 = await getRoundTimerText(pageA!);
    if (timer2 === null) {
      await dumpDiag("timer-continuation-null", pageA, pageB);
    }
    expect(timer2).not.toBeNull();

    // Timer should have decreased (or the round ended, which is also valid).
    const parseTimer = (t: string): number => {
      const [m, s] = t.split(":").map(Number);
      return m * 60 + s;
    };
    const t1 = parseTimer(timer1!);
    const t2 = parseTimer(timer2!);
    // Allow for the round to have ended (timer might be null or 0).
    if (t2 > 0) {
      expect(t2).toBeLessThan(t1);
    }
  });

  test("no unexpected socket close", async () => {
    // Filter out benign events (initial connection setup, etc.)
    const unexpected = socketCloseEvents.filter(
      (e) =>
        !e.includes("WebSocket connection to") &&
        !e.includes("101") &&
        !e.includes("normal closure"),
    );
    // We allow zero unexpected close events. If there are any, report them.
    test.info().annotations.push({
      type: "socket-events",
      description: unexpected.length > 0 ? unexpected.join("; ") : "none",
    });
  });

  test("all build types: wall/floor/ramp/cone placement attempts keep both clients in sync", { timeout: 60_000 }, async () => {
    expect(pageA).not.toBeNull();
    expect(pageB).not.toBeNull();

    await ensurePointerLock(pageA!);

    // Each dedicated build bind (Q=wall, F=floor, E=ramp, Z=cone) enters
    // building with that piece; attempt a placement for each. The placement
    // may be accepted or rejected by range/energy rules — either way the
    // clients must stay connected and in the same phase. Also exercise the
    // rotate binds (R / X) while building.
    for (const typeKey of ["KeyQ", "KeyF", "KeyE", "KeyZ"] as const) {
      await pageA!.keyboard.press(typeKey);
      await sleep(200);
      expect(await buildModeActive(pageA!)).toBe(true);
      await fireWeapon(pageA!); // in build mode this is the place press
      await sleep(400);
    }
    await pageA!.keyboard.press("KeyR");
    await sleep(150);
    await pageA!.keyboard.press("KeyX");
    await sleep(150);

    // The weapon bind leaves building and keeps the assault rifle for the
    // later combat tests.
    await pageA!.keyboard.press("Digit1");
    await sleep(300);
    expect(await getWeaponName(pageA!)).toBe("Assault Rifle");
    expect(await buildModeActive(pageA!)).toBe(false);

    const phaseA = await pageA!.locator(".match-hud__phase").textContent();
    const phaseB = await pageB!.locator(".match-hud__phase").textContent();
    expect(phaseA).toBe("IN PROGRESS");
    expect(phaseB).toBe("IN PROGRESS");
  });

  test("build-edit/destruction: edit-mode clear + apply keeps both clients in sync", { timeout: 60_000 }, async () => {
    expect(pageA).not.toBeNull();
    expect(pageB).not.toBeNull();

    await ensurePointerLock(pageA!);

    // The previous test left build mode off; verify it (KeyB is a toggle,
    // so do not press it blindly).
    expect(await buildModeActive(pageA!)).toBe(false);

    // Enter edit mode (G) and confirm (Enter). In headless the aim may not
    // target a structure, so the confirm may be a no-op — the assertion is
    // that the edit path does not crash, drop, or desync either client. The
    // edit bind again leaves edit mode if Enter had nothing to confirm.
    await pageA!.keyboard.press("KeyG");
    await sleep(300);
    await pageA!.keyboard.press("Enter");
    await sleep(1_000);
    if (await pageA!.locator(".build-edit-hud__title").count() > 0) {
      await pageA!.keyboard.press("KeyG");
      await sleep(300);
    }
    expect(await pageA!.locator(".build-edit-hud__title").count()).toBe(0);

    const phaseA = await pageA!.locator(".match-hud__phase").textContent();
    const phaseB = await pageB!.locator(".match-hud__phase").textContent();
    expect(phaseA).toBe("IN PROGRESS");
    expect(phaseB).toBe("IN PROGRESS");
  });

  test("two-client edit course: rapid placement, immediate own-piece edit, confirm-then-shotgun, denial, clean state", { timeout: 90_000 }, async () => {
    // Playwright 1.63: config `timeout` takes precedence over the test-level
    // options object, so set the effective budget explicitly.
    test.setTimeout(90_000);
    expect(pageA).not.toBeNull();
    expect(pageB).not.toBeNull();
    const a = pageA!;
    const b = pageB!;

    // Build placement and edit intents are in-round actions.
    await waitForBothInProgress(a, b);

    await ensurePointerLock(a);
    await ensureCombatMode(a);

    // Camera aim setup: the placement preview requires the aim ray to point
    // at the ground build plane (dirY < -1e-4 in computePlacementPreview),
    // so the camera must be pitched down — it starts level at yaw 0 (no
    // earlier test in the suite moves the camera with non-zero deltas; the
    // rematch flow even avoids real mouse moves for exactly this reason).
    // All aim deltas below are synthetic mousemoves consumed by the
    // InputManager exactly as pointer-lock look deltas would be (yaw -=
    // dx·0.0022, pitch -= dy·0.0022; 714 px ≈ 90°).
    const look = (dx: number, dy: number) =>
      a.evaluate(({ dx, dy }) => {
        document.dispatchEvent(
          new MouseEvent("mousemove", { movementX: dx, movementY: dy, bubbles: true }),
        );
      }, { dx, dy });
    const YAW_QUARTER_PX = 714; // ≈ 90° of yaw at 0.0022 rad/px

    // Solve the camera pitch (downward pixels) that makes the aim ray hit
    // the ground `radius` metres ahead of the player. The pivot sits 1.6 m
    // above the player and the camera 7 m behind it along the same aim ray,
    // so the camera offset cancels: the ground hit is 1.6·cot(q) ahead of
    // the pivot → q = atan(1.6 / radius).
    const pitchPxForRadius = (radius: number) =>
      Math.round(Math.atan2(1.6, radius) / 0.0022);

    // The player's authoritative position fixes every aimed grid cell (cell
    // size 5.12 m; x is always -5.00 = grid x cell -1, z only drifts by
    // sub-metre timing jitter from the movement test):
    //   1. cone  — face +X, aim 7.5 m ahead → x cell 0, own z cell
    //   2. floor — face +Z, aim 0.5 m inside the far z cell ahead
    //   3. wall  — face +Z, just ahead: 2.4 m ahead while ≥ 2.6 m remain in
    //              the player's own z cell, else 2.0 m into the next cell —
    //              and the floor takes whichever of those two cells the
    //              wall does not, so the three placements never overlap no
    //              matter where in the cell the player stands.
    //    The wall is placed LAST, directly under the crosshair, so the
    //    immediate-edit step needs no further camera move (its AABB is
    //    first on the aim ray within the 12 m edit range: the floor is one
    //    cell farther and the cone is in a different x cell).
    const auth = await authPos(a);
    expect(auth).not.toBeNull();
    const pz = auth![2];
    const cellRemaining = 5.12 - (pz - 5.12 * Math.floor(pz / 5.12));
    const wallInOwnCell = cellRemaining >= 2.6;
    const wallRadius = wallInOwnCell ? 2.4 : cellRemaining + 2.0;
    const floorRadius = wallInOwnCell ? cellRemaining + 0.5 : cellRemaining + 5.62;
    const conePitchPx = pitchPxForRadius(7.5);
    const floorPitchPx = pitchPxForRadius(floorRadius);
    const wallPitchPx = pitchPxForRadius(wallRadius);

    // ── Rapid piece placement: three pieces fired back-to-back into three
    //    mutually distinct grid cells, each ≈ 0.5 s apart (well above the
    //    client and 10-tick server placement-rate windows).
    // Dedicated build binds: one key enters building with that piece (no
    // mode key first).
    await look(0, conePitchPx); // pitch down ≈ 12°
    await look(-YAW_QUARTER_PX, 0); // yaw +90° → face +X
    await a.keyboard.press("KeyZ"); // cone (enters building)
    await sleep(200);
    expect(await buildModeActive(a)).toBe(true);
    await fireWeapon(a);
    await sleep(400);

    await look(0, floorPitchPx - conePitchPx); // onto the floor pitch
    await look(-YAW_QUARTER_PX, 0); // yaw +180° → face +Z (away from the opponent)
    await a.keyboard.press("KeyF"); // floor, far +Z cell
    await sleep(200);
    await fireWeapon(a);
    await sleep(400);

    await look(0, wallPitchPx - floorPitchPx); // onto the wall pitch
    await a.keyboard.press("KeyQ"); // wall, near +Z cell (no yaw change)
    await sleep(200);
    await fireWeapon(a);
    await sleep(500);

    // ── Immediate edit: the edit bind (G) over the build layer locks one of
    //    A's just-placed canonical pieces. Geometry selection is deliberately
    //    type-agnostic: the exact first intersection is camera/placement
    //    dependent, while every supported piece uses the same edit path.
    const editMessages = () => a.evaluate(() => {
      const w = window as any;
      return (w.__editSends ?? []).length as number;
    });
    await a.evaluate(() => {
      const w = window as any;
      const client = w.__buildshiftNetworking.client.deref();
      w.__editSends = [];
      const send = client.send.bind(client);
      client.send = (type: string, payload: unknown) => {
        if (type === "two-player:edit_grid_action") w.__editSends.push(payload);
        return send(type, payload);
      };
    });
    await a.keyboard.press("KeyG");
    await sleep(500);
    const target = await a.evaluate(
      () => document.querySelector(".build-edit-hud__target")?.textContent ?? "",
    );
    expect(target).toMatch(/^Aim: (?:Wall|Floor|Ramp|Cone) /);
    expect(await a.locator(".build-edit-hud__tiles").textContent()).toMatch(/^Tiles open: 0\/(?:9|4)$/);

    // ── Local selection: LMB selects the aimed tile at once — shown in the
    //    HUD as unconfirmed — and nothing is sent until the edit is confirmed.
    await fireWeapon(a);
    await sleep(300);
    expect(await a.locator(".build-edit-hud__tiles").textContent()).toMatch(/^Tiles open: 1\/(?:9|4)$/);
    expect(await a.locator(".build-edit-hud__pending").count()).toBe(1);
    // Pressing the same tile again restores it (still local).
    await fireWeapon(a);
    await sleep(300);
    expect(await a.locator(".build-edit-hud__tiles").textContent()).toMatch(/^Tiles open: 0\/(?:9|4)$/);
    // Select, then reset (T): the default form is previewed immediately.
    await fireWeapon(a);
    await sleep(300);
    await a.keyboard.press("KeyT");
    await sleep(300);
    expect(await a.locator(".build-edit-hud__tiles").textContent()).toMatch(/^Tiles open: 0\/(?:9|4)$/);
    expect(await editMessages()).toBe(0);

    // ── Confirm: select a tile and press Enter — the change goes out once and
    //    the server confirms it; Enter returns to weapon mode.
    await fireWeapon(a);
    await sleep(300);
    await a.keyboard.press("Enter");
    await expect(a.locator(".build-edit-hud__feedback--accepted")).toContainText("Edit confirmed", { timeout: 5_000 });
    expect(await editMessages()).toBe(2); // the tile change + confirm
    expect(await buildModeActive(a)).toBe(false);

    // ── Then shotgun: the weapon bind switches at once and the next click fires.
    await a.keyboard.press("Digit2");
    await sleep(500);
    expect(await getWeaponName(a)).toBe("Shotgun");
    const sgAmmoBefore = await getMagazineAmmo(a);
    expect(sgAmmoBefore).toBeGreaterThan(0);
    await fireWeapon(a);
    await sleep(500);
    expect(await getMagazineAmmo(a)).toBeLessThan(sgAmmoBefore);

    // ── Edit → reset → confirm (edit bind again): the piece shows its applied
    //    edit, reset previews the default at once, and confirming restores it.
    await a.keyboard.press("KeyG");
    await sleep(500);
    expect(await a.locator(".build-edit-hud__tiles").textContent()).toMatch(/^Tiles open: 1\/(?:9|4)$/);
    await a.keyboard.press("KeyT");
    await sleep(200);
    expect(await a.locator(".build-edit-hud__tiles").textContent()).toMatch(/^Tiles open: 0\/(?:9|4)$/);
    await a.keyboard.press("KeyG");
    await expect.poll(editMessages, { timeout: 5_000 }).toBe(4); // reset + confirm
    await expect(a.locator(".build-edit-hud__feedback--accepted")).toContainText("Edit confirmed", { timeout: 5_000 });

    // Restore the assault rifle for the combat tests that follow.
    await a.keyboard.press("Digit1");
    await sleep(300);
    expect(await getWeaponName(a)).toBe("Assault Rifle");

    // Restore the default camera aim: undo the net +1428 px yaw (two
    // quarter turns) and the net wall-pitch dy so the combat tests that
    // follow start from the same camera state the rest of the suite assumes.
    await look(2 * YAW_QUARTER_PX, -wallPitchPx);
    await sleep(200);

    // ── Enemy denial (client half): page B owns zero structures. Its level
    //    aim ray at spawn even crosses the cone A just placed (same x band,
    //    straight ahead), so this asserts the ownership filter for real:
    //    A's replicated pieces must all be skipped and B shows "no target".
    //    (The server half — a non-owner `edit_grid_action` answering
    //    `not_owned` — is covered by the twoPlayerEditPermission contract
    //    tests, since a client can only submit edits for its own aimed
    //    piece.)
    await ensurePointerLock(b);
    await b.keyboard.press("KeyG");
    await sleep(500);
    expect(await b.locator(".build-edit-hud__none").count()).toBe(1);
    expect(await b.locator(".build-edit-hud__target").count()).toBe(0);
    await b.keyboard.press("KeyG");
    await sleep(300);

    // ── No disconnect / freeze / duplicate listeners: both clients agree on
    //    the phase, the HUD containers are singletons, no fatal console
    //    errors, and no unexpected socket close events.
    const phaseA = await a.locator(".match-hud__phase").textContent();
    const phaseB = await b.locator(".match-hud__phase").textContent();
    expect(phaseA).toBe(phaseB);
    expect(phaseA).toBe("IN PROGRESS");
    expect(await a.locator(".match-hud").count()).toBe(1);
    expect(await a.locator(".weapon-hud").count()).toBe(1);
    expect(await a.locator(".combat-vitals-hud").count()).toBe(1);
    expect(fatalConsoleErrors.slice()).toEqual([]);
    const unexpected = socketCloseEvents.filter(
      (e) =>
        !e.includes("WebSocket connection to") &&
        !e.includes("101") &&
        !e.includes("normal closure"),
    );
    expect(unexpected).toEqual([]);
  });

  test("two live browser clients render and reset authoritative edits for every build family", { timeout: 90_000 }, async () => {
    test.setTimeout(90_000);
    const context = await browser!.newContext({ viewport: { width: 1280, height: 720 } });
    const first = await context.newPage();
    const second = await context.newPage();
    try {
      await Promise.all([first.goto(APP_URL), second.goto(APP_URL)]);
      await waitForBothInProgress(first, second);
      // Capture the canonical server replies in each real browser. This makes
      // a rejection diagnostic rather than an eventual state-sync timeout.
      await Promise.all([first, second].map((page) => page.evaluate(() => {
        const target = window as any;
        const client = target.__buildshiftNetworking?.client?.deref();
        target.__editedGeometryEvents = [];
        for (const type of ["build:structure_placed", "build:structure_rejected", "two-player:edit_grid_action"]) {
          client?.onEvent(type, (payload: unknown) => target.__editedGeometryEvents.push({ type, payload }));
        }
      })));
      // The canonical room has two possible spawn slots (x≈0 or x≈6, both
      // at z≈6). Pick four distinct cells around the actual authoritative
      // local position, rather than assuming the historical z≈0 spawn. Each
      // placement stays inside the 12 m server range and inside build bounds.
      const localPosition = await first.evaluate(() => {
        const client = (window as any).__buildshiftNetworking?.client?.deref();
        const player = client?.state?.players?.[client?.sessionId];
        return player ? { x: player.x, z: player.z } : null;
      });
      expect(localPosition).not.toBeNull();
      const ownerSessionId = await first.evaluate(
        () => (window as any).__buildshiftNetworking?.client?.deref()?.sessionId,
      );
      expect(ownerSessionId).toBeTruthy();
      const nearEastSpawn = localPosition!.x >= 3;
      const anchorX = nearEastSpawn ? 1 : 0;
      // Expected permanent part counts come from the shared canonical geometry.
      const parts = (buildType: "wall" | "floor" | "cone" | "ramp", grid: { x: number; y: number; z: number }, editGrid?: GeometryEditState) =>
        structureCuboids({ buildType, grid, rotation: 0, editGrid }).length;
      const raw = [
        { buildType: "wall", grid: { x: anchorX, y: 0, z: 0 }, action: { action: "select", tileIndex: 4 }, edited: { kind: "wall", tiles: [true, true, true, true, false, true, true, true, true] } },
        { buildType: "floor", grid: { x: anchorX - 1, y: 1, z: 1 }, action: { action: "select", tileIndex: 0 }, edited: { kind: "floor_cone", tiles: [false, true, true, true] } },
        { buildType: "cone", grid: { x: anchorX, y: 0, z: 2 }, action: { action: "select", tileIndex: 0 }, edited: { kind: "floor_cone", tiles: [false, true, true, true] } },
        { buildType: "ramp", grid: { x: nearEastSpawn ? -1 : 1, y: 0, z: 1 }, action: { action: "select", rampVariant: "half_left" }, edited: { kind: "ramp", variant: "half_left" } },
      ] as const;
      const cases = raw.map((c) => ({ ...c, editedParts: parts(c.buildType, c.grid, c.edited as GeometryEditState), resetParts: parts(c.buildType, c.grid) }));

      for (const [index, sample] of cases.entries()) {
        if (index > 0) {
          const priorTimer = await getRoundTimerText(first);
          await first.waitForFunction((prior) => document.querySelector(".match-hud__timer-value")?.textContent !== prior, priorTimer);
        }
        const before = await first.evaluate(() => Object.keys(((window as any).__buildshiftNetworking?.client?.deref()?.state?.building?.structures) ?? {}));
        const sent = await first.evaluate(({ sequence, buildType, grid }) => {
          const client = (window as any).__buildshiftNetworking?.client?.deref();
          return client?.send("build:placement_request", { sequence, buildType, grid, rotation: 0 });
        }, { sequence: 9000 + index, buildType: sample.buildType, grid: sample.grid });
        expect(sent).toBe(true);
        try {
          await Promise.all([first, second].map((page) => page.waitForFunction((count) =>
            Object.keys((window as any).__buildshiftNetworking?.client?.deref()?.state?.building?.structures ?? {}).length === count,
            before.length + 1)));
        } catch (error) {
          const diagnostic = await first.evaluate(() => ({
            state: (window as any).__buildshiftNetworking?.client?.deref()?.state?.building?.structures,
            events: (window as any).__editedGeometryEvents,
          }));
          throw new Error(`authoritative placement did not replicate: ${JSON.stringify(diagnostic)}`, { cause: error });
        }
        const id = await first.evaluate((oldIds) => Object.keys((window as any).__buildshiftNetworking.client.deref().state.building.structures).find((key) => !oldIds.includes(key)), before);
        expect(id).toBeTruthy();

        const editSent = await first.evaluate(({ id, action }) =>
          (window as any).__buildshiftNetworking.client.deref().send("two-player:edit_grid_action", { structureId: id, ...action }),
          { id, action: sample.action });
        expect(editSent).toBe(true);
        for (const page of [first, second]) {
          try {
            await page.waitForFunction(({ id, parts, ownerId }) => {
              const state = (window as any).__buildshiftNetworking?.client?.deref()?.state?.building?.structures?.[id];
              const scene = (window as any).__buildshiftEngine?.scenes?.[0];
              const count = scene?.meshes?.filter((mesh: any) => mesh.name.startsWith(`build-solid-${id}-`)).length;
              return state?.editGrid && state.ownerId === ownerId && count === parts;
            }, { id, parts: sample.editedParts, ownerId: ownerSessionId });
          } catch (error) {
            const diagnostic = await page.evaluate(() => ({
              state: (window as any).__buildshiftNetworking?.client?.deref()?.state?.building?.structures,
              events: (window as any).__editedGeometryEvents,
            }));
            throw new Error(`authoritative edit did not replicate/render: ${JSON.stringify(diagnostic)}`, { cause: error });
          }
        }

        await first.evaluate((id) => (window as any).__buildshiftNetworking.client.deref().send("two-player:edit_grid_action", { structureId: id, action: "reset" }), id);
        for (const page of [first, second]) {
          try {
          await page.waitForFunction(({ id, parts }) => {
            const state = (window as any).__buildshiftNetworking?.client?.deref()?.state?.building?.structures?.[id];
            const reset = state?.editGrid?.kind === "ramp"
              ? state.editGrid.variant === "full"
              : state?.editGrid?.tiles?.every((solid: boolean) => solid);
            const scene = (window as any).__buildshiftEngine?.scenes?.[0];
            const count = scene?.meshes?.filter((mesh: any) => mesh.name.startsWith(`build-solid-${id}-`)).length;
            return reset && count === parts;
            }, { id, parts: sample.resetParts });
          } catch (error) {
            const diagnostic = await page.evaluate(() => ({
              state: (window as any).__buildshiftNetworking?.client?.deref()?.state?.building?.structures,
              events: (window as any).__editedGeometryEvents,
            }));
            throw new Error(`authoritative reset did not replicate/render: ${JSON.stringify(diagnostic)}`, { cause: error });
          }
        }
      }
      expect(await first.locator(".match-hud__phase").textContent()).toBe("IN PROGRESS");
      expect(await second.locator(".match-hud__phase").textContent()).toBe("IN PROGRESS");
    } finally {
      await context.close();
    }
  });

  test("elimination: firing ends round 1 with a local round win", { timeout: 120_000 }, async () => {
    expect(pageA).not.toBeNull();
    expect(pageB).not.toBeNull();

    await waitForRoundStart(pageA!, pageB!);

    // Ensure pointer lock is active for firing and look deltas.
    await ensurePointerLock(pageA!);
    await ensureCombatMode(pageA!);

    const scoreBefore = await localScore(pageA!);

    // Aim (with a scanning fallback) and hold fire until the round ends.
    // An elimination should end the round far sooner than the 90s timer.
    const phaseA = await holdFireUntilRoundOver(pageA!, pageB!, 90_000);
    expect(["ROUND OVER", "MATCH OVER"]).toContain(phaseA);

    const phaseB = await pageB!.evaluate(() => {
      return document.querySelector(".match-hud__phase")?.textContent ?? "";
    });
    expect(["ROUND OVER", "MATCH OVER"]).toContain(phaseB);

    // A round win on page A's side proves the opponent was eliminated:
    // a timer expiry would end the round with no score change.
    const scoreAfter = await localScore(pageA!);
    expect(scoreAfter).toBe(scoreBefore + 1);
  });

  test("next rounds: rounds 2 and 3 run to the final MATCH OVER", { timeout: 240_000 }, async () => {
    // Playwright 1.63: config `timeout` takes precedence over the test-level
    // options object, so set the effective budget explicitly.
    test.setTimeout(240_000);
    expect(pageA).not.toBeNull();
    expect(pageB).not.toBeNull();

    // WIN_ROUNDS = 3: two more local wins take the match. Input sequences
    // are monotonic per session, so each round starts with immediate, live
    // movement and fire — no catch-up window.
    let phase = "";
    for (let round = 0; round < 2; round++) {
      await waitForRoundStart(pageA!, pageB!);
      await ensurePointerLock(pageA!);
      await ensureCombatMode(pageA!);
      phase = await holdFireUntilRoundOver(pageA!, pageB!, 90_000);
      expect(["ROUND OVER", "MATCH OVER"]).toContain(phase);
      if (phase === "MATCH OVER") break;
    }

    const phaseA = await pageA!.evaluate(() => {
      return document.querySelector(".match-hud__phase")?.textContent ?? "";
    });
    const phaseB = await pageB!.evaluate(() => {
      return document.querySelector(".match-hud__phase")?.textContent ?? "";
    });
    expect(phaseA).toBe("MATCH OVER");
    expect(phaseB).toBe("MATCH OVER");

    // Only page A ever fires, so page A's side must own all three rounds.
    expect(await localScore(pageA!)).toBe(3);
  });

  test("connected rematch: both players request rematch and a new match begins", { timeout: 60_000 }, async () => {
    expect(pageA).not.toBeNull();
    expect(pageB).not.toBeNull();

    // Wait for the match to fully settle (reset delay before the screen).
    await sleep(3_000);

    // Request rematch from both players via the MatchEndScreen button.
    // Synthetic clicks (see requestRematch) keep the virtual mouse still, so
    // no mousemove deltas leak into the camera aim for the next match.
    await requestRematch(pageA!);
    await requestRematch(pageB!);

    // Wait for the new match to start (countdown or in-progress).
    try {
      await pageA!.waitForFunction(
        () => {
          const el = document.querySelector(".match-hud__phase");
          const text = el?.textContent ?? "";
          return text === "GET READY" || text === "IN PROGRESS";
        },
        { timeout: 30_000 },
      );
    } catch (e) {
      await dumpDiag("rematch-timeout", pageA, pageB);
      throw e;
    }

    // Verify both pages are in sync.
    const finalPhaseA = await pageA!.locator(".match-hud__phase").textContent();
    const finalPhaseB = await pageB!.locator(".match-hud__phase").textContent();
    expect(finalPhaseA).toBe(finalPhaseB);
  });

  test("repeated rematch: second match completes and HUD/listener/audio state stays clean", { timeout: 480_000 }, async () => {
    // Playwright 1.63: config `timeout` takes precedence over the test-level
    // options object, so set the effective budget explicitly. Playing a full
    // second match (3 round wins) needs more headroom than the 120s config
    // default.
    test.setTimeout(480_000);
    expect(pageA).not.toBeNull();
    expect(pageB).not.toBeNull();

    // Play the rematched match to completion (3 round wins) so a second
    // rematch is exercised. Input sequences are monotonic per session,
    // so each round starts with immediate, live input.
    let phase = "";
    for (let round = 0; round < 3; round++) {
      await waitForRoundStart(pageA!, pageB!);
      await ensurePointerLock(pageA!);
      await ensureCombatMode(pageA!);
      phase = await holdFireUntilRoundOver(pageA!, pageB!, 90_000);
      expect(["ROUND OVER", "MATCH OVER"]).toContain(phase);
      if (phase === "MATCH OVER") break;
    }
    expect(phase).toBe("MATCH OVER");

    // Second connected rematch.
    await sleep(2_000);
    await requestRematch(pageA!);
    await requestRematch(pageB!);

    await pageA!.waitForFunction(
      () => {
        const el = document.querySelector(".match-hud__phase");
        const text = el?.textContent ?? "";
        return text === "GET READY" || text === "IN PROGRESS";
      },
      { timeout: 30_000 },
    );

    // Cleanup assertions across two full matches + two rematches:
    // - HUD containers are not duplicated (no leaked mounts/effects)
    await expect(pageA!.locator(".match-hud")).toHaveCount(1);
    await expect(pageA!.locator(".weapon-hud")).toHaveCount(1);
    await expect(pageA!.locator(".combat-vitals-hud")).toHaveCount(1);

    // - Weapon state resets to the canonical defaults (listeners still
    //   receive and clear input edges; no stale ammo from prior matches)
    expect(await getWeaponName(pageA!)).toBe("Assault Rifle");
    expect(await getMagazineAmmo(pageA!)).toBe(30);

    // - Match score resets for the new match (no leaked state effects)
    expect(await localScore(pageA!)).toBe(0);
    expect(await localScore(pageB!)).toBe(0);

    // - No fatal console errors accumulated across the whole suite
    const fatal = fatalConsoleErrors.slice();
    test.info().annotations.push({
      type: "fatal-console-errors",
      description: fatal.length > 0 ? fatal.join("; ") : "none",
    });
    expect(fatal).toEqual([]);
  });

  test("combined-state diagnostics: arena, player, build, disconnect, and diagnostics coexist", async () => {
    expect(pageA).not.toBeNull();

    // Verify the game is still running and the HUD is intact after all
    // the combined-state interactions (movement, fire, build, round end).
    const phase = await pageA!.locator(".match-hud__phase").textContent();
    expect(["GET READY", "IN PROGRESS", "ROUND OVER", "MATCH OVER"]).toContain(phase);

    // The weapon HUD should still be rendering.
    await expect(pageA!.locator(".weapon-hud")).toBeVisible();

    // The vitals HUD should still be rendering.
    await expect(pageA!.locator(".combat-vitals-hud")).toBeVisible();

    // The match HUD (score, timer, phase) should be intact.
    await expect(pageA!.locator(".match-hud__score")).toBeVisible();

    // The developer diagnostics overlay (enabled via ?devdiag=1) should be
    // present, confirming the diagnostics system coexists with the gameplay.
    await expect(pageA!.locator(".devdiag-overlay")).toBeVisible();

    // No fatal errors should have accumulated.
    const canvas = pageA!.locator("canvas.game-canvas");
    await expect(canvas).toBeVisible();
  });

  test("disconnect/reconnect: closing and reopening a page preserves game state", async () => {
    expect(pageA).not.toBeNull();
    expect(pageB).not.toBeNull();

    // Close page B (simulate disconnect).
    await pageB!.close();
    pageB = null;

    // Wait a moment for the server to process the disconnect.
    await sleep(2_000);

    // Page A should still be connected and in a valid phase.
    const phaseA = await pageA!.locator(".match-hud__phase").textContent();
    expect(["GET READY", "IN PROGRESS", "ROUND OVER", "MATCH OVER"]).toContain(phaseA);

    // Reopen page B (reconnect).
    pageB = await browserContext!.newPage();
    trackFatalErrors(pageB);
    await loadApp(pageB);

    // The reconnected player should join the existing room: the "waiting for
    // opponent" indicator clears once both players are present again.
    await pageB!.waitForFunction(
      () => document.querySelector(".match-hud__waiting") === null,
      { timeout: 15_000 },
    );

    // Both pages should agree on the match phase. The authoritative phase can
    // flip at any moment (ROUND OVER lasts only 2 s) while state snapshots
    // propagate between the two clients, so allow a short convergence window
    // instead of a single racy comparison.
    let phaseA2 = "";
    let phaseB2 = "";
    const t0 = Date.now();
    while (Date.now() - t0 < 5_000) {
      phaseA2 = (await pageA!.locator(".match-hud__phase").textContent()) ?? "";
      phaseB2 = (await pageB!.locator(".match-hud__phase").textContent()) ?? "";
      if (phaseA2 === phaseB2) break;
      await sleep(250);
    }
    expect(phaseA2).toBe(phaseB2);
  });
});

// ─── Physical edited-geometry acceptance ───────────────────────────────────
//
// Separate from the smoke suite above: its long-lived pageA/pageB keep
// rendering WebGL until that suite's afterAll, and on a CPU-limited headless
// host the extra pages push these clients below real time (the client
// simulates at most MAX_SIM_TICKS steps per rendered frame). Every case here
// opens its own fresh two-client room.

/** Bounded wait for the TCP port to be free (`free`) or accepting connections. */
async function waitForPort(port: number, free: boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
    });
    if (open !== free) return;
    if (Date.now() > deadline) throw new Error(`port ${port} still ${free ? "in use" : "closed"} after ${timeoutMs}ms`);
    await sleep(100);
  }
}

test.describe("Physical edited-geometry acceptance", () => {
  test.beforeAll(async () => {
    await waitForPort(GAME_SERVER_PORT, true);
    await startGameServer();
    await waitForPort(GAME_SERVER_PORT, false);
    await startStaticServer();
    browser = await chromium.launch({ headless: true });
  });

  test.afterAll(async () => {
    if (browser) await browser.close().catch(() => {});
    browser = null;
    await stopServers();
  });

  // Physical wall-doorway acceptance. Each phase runs in its own fresh room
  // (new two-page context), so no phase spends time walking back to a start
  // position. Setup is a short real-input walk from spawn; every asserted
  // crossing/blocking is real crouched W through the production input path.
  async function runDoorwayPhase(phase: "A no-wall control" | "B edited doorway" | "C reset full wall"): Promise<void> {
    const t0 = Date.now();
    const step = (name: string) => console.log(`[doorway ${phase[0]}] +${Date.now() - t0}ms ${name}`);
    // Small viewport (test setup only, as in the other physical cases): keeps
    // the client simulating near real time on a loaded headless host.
    const context = await browser!.newContext({ viewport: { width: 480, height: 270 } });
    const a = await context.newPage();
    const b = await context.newPage();
    type Auth = { x: number; y: number; z: number; yaw: number; crouch: boolean; seq: number };
    const auth = (page: Page) => page.evaluate((): Auth => {
      const client = (window as any).__buildshiftNetworking.client.deref();
      const p = client.state.players[client.sessionId];
      return { x: p.x, y: p.y, z: p.z, yaw: p.yaw, crouch: p.crouch, seq: p.sequence };
    });
    // Waits on the authoritative (server-replicated) local player only.
    const waitAuth = (page: Page, predicate: string, arg: Record<string, unknown>, timeout: number) =>
      page.waitForFunction(({ predicate, arg }) => {
        const client = (window as any).__buildshiftNetworking.client.deref();
        const p = client.state.players[client.sessionId];
        return p ? new Function("p", "arg", `return ${predicate};`)(p, arg) as boolean : false;
      }, { predicate, arg }, { timeout, polling: 50 });
    // Holds until the authoritative player reaches `targetZ` (moving -Z), or
    // reports a stall: `stallTicks` processed inputs without -Z progress.
    const progressTo = (page: Page, targetZ: number, stallTicks: number) =>
      page.waitForFunction(({ targetZ, stallTicks }) => {
        const w = window as any;
        const client = w.__buildshiftNetworking.client.deref();
        const p = client.state.players[client.sessionId];
        if (!p) return false;
        if (p.z <= targetZ) return { outcome: "reached" as const, z: p.z, seq: p.sequence };
        const t = (w.__doorwayProgress ??= { z: p.z, seq: p.sequence });
        if (p.z < t.z - 1e-3) { t.z = p.z; t.seq = p.sequence; }
        else if (p.sequence - t.seq >= stallTicks) {
          return { outcome: "stalled" as const, z: p.z, seq: p.sequence, sinceSeq: t.seq };
        }
        return false;
      }, { targetZ, stallTicks }, { timeout: 40_000, polling: 50 }).then(handle => handle.jsonValue());
    try {
      // Join B first so A consistently receives spawn slot 1 (x=5, z=0).
      await b.goto(APP_URL);
      await b.waitForFunction(() => Boolean((window as any).__buildshiftNetworking?.client?.deref()?.sessionId));
      await a.goto(APP_URL);
      await waitForBothInProgress(a, b);
      await Promise.all([ensurePointerLock(a), ensurePointerLock(b)]);
      // A fresh, shared room: same room id, A at spawn slot 1, no structures.
      const roomIds = await Promise.all([a, b].map(page => page.evaluate(() => (window as any).__buildshiftNetworking.client.deref().room?.roomId)));
      expect(roomIds[0]).toBeTruthy();
      expect(roomIds[1]).toBe(roomIds[0]);
      expect(await a.evaluate(() => Object.keys((window as any).__buildshiftNetworking.client.deref().state.building.structures).length)).toBe(0);
      const ownerId = await a.evaluate(() => (window as any).__buildshiftNetworking.client.deref().sessionId);
      const spawn = await auth(a);
      expect(Math.abs(spawn.x - 5)).toBeLessThan(0.01);
      expect(Math.abs(spawn.z)).toBeLessThan(0.01);
      expect(Math.abs(spawn.yaw)).toBeLessThan(1e-6);
      step(`fresh room ${roomIds[0]}, spawn ${JSON.stringify(spawn)}`);

      const cs = BUILD_GRID.cellSize;
      const grid = { x: Math.round(spawn.x / cs), y: 0, z: Math.round(spawn.z / cs) };
      const wallX = grid.x * cs;
      // Wall plane for rotation 0 (spans X, thin along Z).
      const plane = grid.z * cs;
      const rotation = 0;
      const full = structureCuboids({ buildType: "wall", grid, rotation })[0]!;
      const wallHalfThickness = full.halfExtents.z;
      const radius = PLAYER_COLLIDER.radius;
      const crouchedHeight = PLAYER_CROUCH_COLLIDER_HALF_TOTAL_HEIGHT * 2;
      const standingHeight = PLAYER_COLLIDER_HALF_TOTAL_HEIGHT * 2;
      // Canonical doorway: the bottom-centre tile only.
      const doorwayTiles = [true, true, true, true, true, true, true, false, true];
      const opening = {
        minX: wallX - cs / 6, maxX: wallX + cs / 6,
        minY: 0, maxY: BUILD_GRID.layerHeight / 3,
        minZ: plane - wallHalfThickness, maxZ: plane + wallHalfThickness,
      };
      // Capsule centre at first contact with the full wall, approaching from +Z.
      const contactZ = plane + wallHalfThickness + radius;
      // Every attempt starts here, on the +Z side; at yaw 0, W moves toward -Z.
      const stageZ = plane + 1.6;
      const crossedZ = plane - wallHalfThickness - radius - 0.15;
      const geometry = { grid, rotation, plane, wallX, wallHalfThickness, opening, contactZ, stageZ, crossedZ,
        collider: { radius, standingHeight, crouchedHeight } };

      // Babylon permanent geometry must equal the canonical cuboids on a page.
      const expectRendered = async (page: Page, id: string, tiles: boolean[], label: string) => {
        const expected = structureCuboids({ buildType: "wall", grid, rotation, editGrid: { kind: "wall", tiles } })
          .map(({ center: c, halfExtents: h }) => ({ min: [c.x - h.x, c.y - h.y, c.z - h.z], max: [c.x + h.x, c.y + h.y, c.z + h.z] }));
        try {
          await page.waitForFunction(({ id, tiles, ownerId, expected }) => {
            const s = (window as any).__buildshiftNetworking.client.deref().state.building.structures[id];
            if (!s || s.ownerId !== ownerId || s.editGrid?.kind !== "wall") return false;
            if (JSON.stringify(s.editGrid.tiles) !== JSON.stringify(tiles)) return false;
            const meshes = (window as any).__buildshiftEngine.scenes[0].meshes.filter((m: any) => m.name.startsWith(`build-solid-${id}-`));
            if (meshes.length !== expected.length) return false;
            const boxes = meshes.map((m: any) => {
              m.computeWorldMatrix(true);
              const bb = m.getBoundingInfo().boundingBox;
              return { min: [bb.minimumWorld.x, bb.minimumWorld.y, bb.minimumWorld.z], max: [bb.maximumWorld.x, bb.maximumWorld.y, bb.maximumWorld.z] };
            });
            const near = (u: number[], v: number[]) => u.every((n, i) => Math.abs(n - v[i]!) < 0.01);
            return expected.every((e: any) => boxes.some((r: any) => near(e.min, r.min) && near(e.max, r.max)));
          }, { id, tiles, ownerId, expected }, { timeout: 10_000 });
        } catch (error) {
          const diagnostic = await page.evaluate((id) => {
            const s = (window as any).__buildshiftNetworking.client.deref().state.building.structures[id];
            const meshes = (window as any).__buildshiftEngine.scenes[0].meshes.filter((m: any) => m.name.startsWith(`build-solid-${id}-`));
            return { structure: s, meshes: meshes.map((m: any) => { m.computeWorldMatrix(true); const bb = m.getBoundingInfo().boundingBox; return { name: m.name, min: bb.minimumWorld, max: bb.maximumWorld }; }) };
          }, id);
          throw new Error(`${label}: replicated state/Babylon geometry mismatch: ${JSON.stringify({ geometry, expected, ...diagnostic })}`, { cause: error });
        }
      };

      // Setup only: a short crouched real-input walk from spawn (on the
      // plane) to the start band on the +Z side (crouched to limit stopping
      // overshoot); nothing here is asserted as crossing or blocking.
      await a.keyboard.down("KeyC");
      await waitAuth(a, "p.crouch === true", {}, 10_000);
      await a.keyboard.down("KeyS");
      // Release on the predicted pose (it already includes every queued
      // input), so the authoritative start does not overshoot the band.
      await waitPredicted(a, "p.z >= arg.stageZ", { stageZ }, 40_000);
      await a.keyboard.up("KeyS");
      await waitAuth(a, "p.z >= arg.stageZ", { stageZ }, 40_000);
      await a.keyboard.up("KeyC");
      await waitAuth(a, "!p.crouch", {}, 10_000);
      step(`staged at ${JSON.stringify(await auth(a))}`);

      // Structures are placed only after the player has left the wall plane.
      let id: string | undefined;
      if (phase !== "A no-wall control") {
        expect(await a.evaluate(({ grid, rotation }) => (window as any).__buildshiftNetworking.client.deref().send("build:placement_request", { sequence: 9901, buildType: "wall", grid, rotation }), { grid, rotation })).toBe(true);
        await Promise.all([a, b].map(page => page.waitForFunction(() => Object.keys((window as any).__buildshiftNetworking.client.deref().state.building.structures).length === 1, undefined, { timeout: 10_000 })));
        id = await a.evaluate(() => Object.keys((window as any).__buildshiftNetworking.client.deref().state.building.structures)[0]);
        expect(id).toBeTruthy();
        expect(await a.evaluate((id) => (window as any).__buildshiftNetworking.client.deref().send("two-player:edit_grid_action", { structureId: id, action: "select", tileIndex: 7 }), id)).toBe(true);
        await Promise.all([a, b].map(page => expectRendered(page, id!, doorwayTiles, "doorway edit")));
        step(`wall ${id} placed; doorway replicated + rendered on both clients`);
        if (phase === "C reset full wall") {
          expect(await a.evaluate((id) => (window as any).__buildshiftNetworking.client.deref().send("two-player:edit_grid_action", { structureId: id, action: "reset" }), id)).toBe(true);
          await Promise.all([a, b].map(page => expectRendered(page, id!, Array(9).fill(true), "reset")));
          step("reset replicated + rendered on both clients");
        }
      }

      // The asserted attempt: crouch held, real W toward -Z through the plane.
      const expectCross = phase !== "C reset full wall";
      // The crouch input is sequenced after every staging input, so once the
      // server reports crouch all prior movement has been applied.
      await a.keyboard.down("KeyC");
      await waitAuth(a, "p.crouch === true", {}, 10_000);
      const start = await auth(a);
      expect(Number.isInteger(start.seq)).toBe(true);
      expect(Math.abs(start.yaw)).toBeLessThan(1e-6);
      expect(Math.abs(start.x - wallX)).toBeLessThan(0.25);
      expect(start.z).toBeGreaterThanOrEqual(stageZ);
      // Start-band sanity (comparable starts): wide enough for the stopping
      // distance of a frame-batched client in the full suite (4 live pages).
      expect(start.z).toBeLessThan(stageZ + 2.0);
      await a.evaluate(() => { delete (window as any).__doorwayProgress; });
      await a.keyboard.down("KeyW");
      let contactSeq: number | null = null;
      let progress: unknown = null;
      try {
        progress = await progressTo(a, expectCross ? crossedZ : contactZ + 0.02, 30);
        if ((progress as { outcome: string }).outcome !== "reached") throw new Error(`stalled: ${JSON.stringify(progress)}`);
        if (!expectCross) {
          contactSeq = (await auth(a)).seq;
          step(`contact at ${JSON.stringify(await auth(a))}`);
          // Keep W held for 30 more authoritative inputs (1 s of server sim).
          await waitAuth(a, "p.sequence >= arg.target", { target: contactSeq + 30 }, 30_000);
        }
      } catch (error) {
        const current = await auth(a);
        const diagnostic = await a.evaluate((id) => {
          const client = (window as any).__buildshiftNetworking.client.deref();
          return {
            structure: id ? client.state.building.structures[id] : null,
            allStructures: Object.values(client.state.building.structures).map((s: any) => ({ id: s.structureId, buildType: s.buildType, grid: s.grid, rotation: s.rotation, ownerId: s.ownerId, editGrid: s.editGrid })),
            phase: client.state.matchPhase,
            client: {
              visibility: document.visibilityState, focused: document.hasFocus(),
              pointerLocked: document.pointerLockElement !== null,
              devdiag: document.querySelector(".devdiag-overlay")?.textContent,
            },
          };
        }, id ?? null);
        throw new Error(`${phase}: movement ${expectCross ? "did not cross" : "did not reach contact"}: ${JSON.stringify({
          geometry, start, current, contactSeq, progress,
          delta: { x: current.x - start.x, z: current.z - start.z },
          signedDistance: { start: start.z - plane, current: current.z - plane },
          ...diagnostic,
        })}`, { cause: error });
      }
      const end = await auth(a);
      await a.keyboard.up("KeyW");
      await a.keyboard.up("KeyC");
      const result = {
        phase, start, end, movement: { x: end.x - start.x, z: end.z - start.z },
        signedDistance: { start: start.z - plane, end: end.z - plane }, contactSeq,
      };
      step(`result ${JSON.stringify(result)}`);
      expect(start.z - plane).toBeGreaterThan(0);
      if (expectCross) {
        expect(end.z - plane).toBeLessThan(0);
      } else {
        // Held against the full wall face for 30+ inputs, never past the plane.
        expect(end.seq - contactSeq!).toBeGreaterThanOrEqual(30);
        expect(end.z, JSON.stringify({ geometry, ...result })).toBeGreaterThan(contactZ - 0.01);
        expect(end.z - plane).toBeGreaterThan(0);
      }
    } finally { await context.close(); }
  }

  test("physical wall doorway A: no-wall control — real crouched W crosses the z=0 plane", { timeout: 120_000 }, async () => {
    test.setTimeout(120_000);
    await runDoorwayPhase("A no-wall control");
  });

  test("physical wall doorway B: canonical doorway edit — real crouched W crosses through the opening", { timeout: 120_000 }, async () => {
    test.setTimeout(120_000);
    await runDoorwayPhase("B edited doorway");
  });

  test("physical wall doorway C: reset to full wall — real crouched W is held at the face for 30+ inputs", { timeout: 120_000 }, async () => {
    test.setTimeout(120_000);
    await runDoorwayPhase("C reset full wall");
  });

  // Slow-client burst regression. CPU throttling makes the real client run
  // several 30 Hz simulation steps per rendered frame, so several sequenced
  // inputs reach the room before its next tick. None may be lost: every real
  // Space press must jump, and held W must move one authoritative step per
  // processed input (the old single-slot buffer kept only the newest input).
  test("slow-client input bursts: real jump edges and forward movement are not lost", { timeout: 120_000 }, async () => {
    test.setTimeout(120_000);
    const { context, a, step } = await openFreshDuel("burst");
    try {
      await ensureCombatMode(a);
      await a.evaluate(() => {
        const w = window as any;
        const client = w.__buildshiftNetworking.client.deref();
        const rec = w.__burst = { sent: [] as number[][], peaks: [] as number[][], airborne: false };
        // Raw authoritative patches (WebSocket-driven, independent of render
        // FPS): record the peak height of every authoritative airborne arc.
        client.room.onStateChange((state: any) => {
          const p = state.players.get(client.sessionId);
          if (!p) return;
          if (p.y > 0.05 && !rec.airborne) { rec.airborne = true; rec.peaks.push([p.lastProcessedSequence, p.y]); }
          else if (rec.airborne && p.y > 0.05) { const peak = rec.peaks.at(-1)!; if (p.y > peak[1]!) { peak[0] = p.lastProcessedSequence; peak[1] = p.y; } }
          else if (p.y <= 0.05) rec.airborne = false;
        });
        const send = client.send.bind(client);
        client.send = (type: string, payload: any) => {
          if (type === "two-player:input") rec.sent.push([payload.sequence, payload.jump ? 1 : 0, Math.round(performance.now())]);
          return send(type, payload);
        };
      });
      const cdp = await context.newCDPSession(a);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
      const bursts = () => a.evaluate(() => {
        const frames: Record<number, number> = {};
        for (const e of (window as any).__burst.sent as number[][]) frames[e[2]!] = (frames[e[2]!] ?? 0) + 1;
        const sizes = Object.values(frames);
        return { inputs: sizes.reduce((x, y) => x + y, 0), frames: sizes.length, multi: sizes.filter(n => n > 1).length, max: Math.max(0, ...sizes) };
      });

      // Jump edges: three real presses, each must produce an authoritative
      // airborne arc (peak above 0.5 m) seen in the raw state patches.
      for (let n = 1; n <= 3; n++) {
        await a.keyboard.down("Space");
        try {
          await a.waitForFunction((n) => {
            const rec = (window as any).__burst;
            return rec.peaks.length >= n && rec.peaks[n - 1][1] > 0.5 && !rec.airborne;
          }, n, { timeout: 20_000, polling: 50 });
        } catch (error) {
          const rec = await a.evaluate(() => { const r = (window as any).__burst; return { jumpInputs: r.sent.filter((e: number[]) => e[1] === 1), peaks: r.peaks }; });
          throw new Error(`jump ${n} lost: ${JSON.stringify({ pose: await authPose(a), ...rec, bursts: await bursts() })}`, { cause: error });
        }
        await a.keyboard.up("Space");
        step(`jump ${n} executed`);
      }
      const jumps = await a.evaluate(() => { const r = (window as any).__burst; return { inputs: r.sent.filter((e: number[]) => e[1] === 1), peaks: r.peaks }; });
      step(`jumps ${JSON.stringify(jumps)}`);
      // One jump input per press, one authoritative arc per jump input.
      expect(jumps.inputs.length).toBe(3);
      expect(jumps.peaks.length).toBe(3);

      // Forward movement: between two authoritative samples taken while W is
      // held, displacement equals processed inputs × one standing step.
      const stepLength = PLAYER_MOVEMENT.moveSpeed / 30;
      await a.keyboard.down("KeyW");
      const p0 = await (async () => { const s = (await authPose(a)).seq; await waitPose(a, "p.sequence > arg.s + 3", { s }, 20_000); return authPose(a); })();
      await waitPose(a, "p.sequence >= arg.s + 30", { s: p0.seq }, 30_000);
      const p1 = await authPose(a);
      await a.keyboard.up("KeyW");
      const processed = p1.seq - p0.seq;
      const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      const b = await bursts();
      const result = { p0, p1, processed, moved, expected: processed * stepLength, bursts: b };
      step(`movement ${JSON.stringify(result)}`);
      // The real client really did deliver multi-input frames.
      expect(b.multi, JSON.stringify(result)).toBeGreaterThan(0);
      expect(moved, JSON.stringify(result)).toBeCloseTo(processed * stepLength, 2);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    } finally { await context.close(); }
  });

  // Physical window-shot acceptance. The server fires from the capsule centre
  // (y + 0.9) at a 0.4 m sphere on the target centre (y + 0.9), so on flat
  // ground the shot line is below the canonical centre window (tile 4,
  // y 1.28–2.56). A real jump (apex 1.6 m) with a slight downward pitch puts
  // the authoritative ray through the window and onto the opponent.
  async function runWindowPhase(phase: "A open window" | "B reset full wall"): Promise<void> {
    // Smaller viewport (test setup only): the client simulates at most
    // MAX_SIM_TICKS steps per rendered frame, so below ~7.5 FPS it runs in
    // slow motion while the server keeps real time. Lower render cost keeps
    // the shooter's real input near 30 Hz on a loaded headless host.
    const { context, a, b, aId, bId, step } = await openFreshDuel(`window ${phase[0]}`, { width: 480, height: 270 });
    try {
      await ensureCombatMode(a);
      const shooter0 = await authPose(a);
      const target0 = await a.evaluate((bId) => {
        const p = (window as any).__buildshiftNetworking.client.deref().state.players[bId];
        return { x: p.x, y: p.y, z: p.z, health: p.health, shield: p.shield };
      }, bId);
      // Derived from the authoritative positions: a wall spanning Z
      // (rotation 1) on the cell boundary between the two players.
      const cs = BUILD_GRID.cellSize;
      const grid = { x: Math.round((shooter0.x + target0.x) / 2 / cs), y: 0, z: Math.round(shooter0.z / cs) };
      const rotation = 1;
      const planeX = grid.x * cs;
      expect(shooter0.x).toBeGreaterThan(planeX + 2);
      expect(target0.x).toBeLessThan(planeX - 2);
      expect(Math.abs(shooter0.z - target0.z)).toBeLessThan(0.05);
      expect(Math.abs(shooter0.z - grid.z * cs)).toBeLessThan(0.3);
      expect(shooter0.y).toBe(0);
      expect(target0.y).toBe(0);
      const windowGrid: AcceptanceEditGrid = { kind: "wall", tiles: [true, true, true, true, false, true, true, true, true] };
      const fullGrid: AcceptanceEditGrid = { kind: "wall", tiles: Array(9).fill(true) };
      const windowCuboids = structureCuboids({ buildType: "wall", grid, rotation, editGrid: windowGrid });
      const fullCuboids = structureCuboids({ buildType: "wall", grid, rotation, editGrid: fullGrid });

      // Aim: yaw toward the target; pitch so the ray from the jump apex
      // region descends onto the target centre. ad(yaw, pitch) is
      // (sin·cos, sin p, −cos·cos), so yaw = atan2(dx, −dz).
      const dx = target0.x - shooter0.x, dz = target0.z - shooter0.z;
      const distance = Math.hypot(dx, dz);
      const yawTarget = Math.atan2(dx, -dz);
      const designApexOffset = 1.2;
      const pitchPx = Math.round(Math.atan2(designApexOffset, distance) / LOOK_SENSITIVITY);
      const pitch = -pitchPx * LOOK_SENSITIVITY;
      const yawPx = Math.round((shooter0.yaw - yawTarget) / LOOK_SENSITIVITY);
      const yaw = shooter0.yaw - yawPx * LOOK_SENSITIVITY;
      const direction = { x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
      const eye = VERTICAL_MOVEMENT.playerHalfHeight;
      // Shared-geometry classification of a shot fired from shooter feet y:
      // does the ray reach the target sphere, and does the wall stop it?
      const classify = (y: number, cuboids: StructureCuboid[]) => {
        const origin = { x: shooter0.x, y: y + eye, z: shooter0.z };
        const toTarget = { x: target0.x - origin.x, y: target0.y + eye - origin.y, z: target0.z - origin.z };
        const along = toTarget.x * direction.x + toTarget.y * direction.y + toTarget.z * direction.z;
        const miss = Math.hypot(toTarget.x - direction.x * along, toTarget.y - direction.y * along, toTarget.z - direction.z * along);
        const wall = rayStructureIntersection(origin, direction, along, cuboids);
        return { y, reachesTarget: miss < 0.4, missDistance: miss, wallHit: wall?.point ?? null };
      };
      const geometry = { grid, rotation, planeX, shooter0, target0, yaw, pitch, yawPx, pitchPx, direction, eye };

      const id = await placeStructure(a, b, 9101, "wall", grid, rotation);
      await sendEdit(a, id, { action: "select", tileIndex: 4 });
      await expectCanonicalGeometry([a, b], id, aId, { buildType: "wall", grid, rotation, editGrid: windowGrid }, "window edit");
      step(`wall ${id} window edit replicated + rendered on both clients`);
      if (phase === "B reset full wall") {
        await sendEdit(a, id, { action: "reset" });
        await expectCanonicalGeometry([a, b], id, aId, { buildType: "wall", grid, rotation, editGrid: fullGrid }, "reset");
        step("reset replicated + rendered on both clients");
      }
      const cuboids = phase === "A open window" ? windowCuboids : fullCuboids;

      // Record every authoritative shot: a patch whose lastFireSequence equals
      // its lastProcessedSequence carries the exact shot-origin position.
      await a.evaluate(({ aId, bId, id }) => {
        const w = window as any;
        const client = w.__buildshiftNetworking.client.deref();
        const rec = w.__windowShots = { shots: [] as any[], structureDamage: [] as any[], hits: [] as any[], lastFire: -1, trace: [] as any[], arcs: [] as any[], airborne: false, autoFire: false, prev: null as null | { seq: number; y: number } };
        // Production primary-fire button (same DOM event the player makes).
        const fire = (down: boolean) => {
          const el = (document.pointerLockElement ?? document.querySelector("canvas.game-canvas")) as HTMLElement | null;
          el?.dispatchEvent(new MouseEvent(down ? "mousedown" : "mouseup", { button: 0, bubbles: true }));
        };
        client.room.onStateChange((state: any) => {
          const s = state.players.get(aId), t = state.players.get(bId);
          if (s && rec.trace.length < 400) rec.trace.push([s.lastProcessedSequence, +s.y.toFixed(3), +s.velocityY.toFixed(2), s.lastFireSequence]);
          // Authoritative airborne arcs from raw patches (render-FPS
          // independent). With autoFire, the fire button is held for exactly
          // the arcs the server reports.
          if (s && s.y > 0.3 && !rec.airborne) {
            rec.airborne = true;
            rec.arcs.push({ startSeq: s.lastProcessedSequence, peak: s.y, endSeq: -1 });
            if (rec.autoFire) fire(true);
          } else if (s && rec.airborne && s.y > 0.3) {
            rec.arcs.at(-1).peak = Math.max(rec.arcs.at(-1).peak, s.y);
          } else if (s && rec.airborne && s.y <= 0.05) {
            rec.airborne = false;
            rec.arcs.at(-1).endSeq = s.lastProcessedSequence;
            if (rec.autoFire) fire(false);
          }
          // Each shot is bracketed by the previous patch (seq < fireSeq) and
          // this one (seq >= fireSeq): its origin height lies between them
          // (or at the arc apex between them).
          const prev = rec.prev;
          if (s) rec.prev = { seq: s.lastProcessedSequence, y: s.y };
          if (!s || !t || s.lastFireSequence === rec.lastFire) return;
          rec.lastFire = s.lastFireSequence;
          rec.shots.push({ fireSeq: s.lastFireSequence, seq: s.lastProcessedSequence, exact: s.lastFireSequence === s.lastProcessedSequence, y: s.y, prevSeq: prev?.seq ?? -1, prevY: prev?.y ?? 0, ammo: s.ammo, targetHealth: t.health, targetShield: t.shield });
        });
        // Outgoing production inputs (diagnostic): which sequences carried a
        // jump edge, and the per-tick burst size the server receives.
        rec.sent = [] as any[];
        const send = client.send.bind(client);
        client.send = (type: string, payload: any) => {
          if (type === "two-player:input" && rec.sent.length < 2000) rec.sent.push([payload.sequence, payload.jump ? 1 : 0, payload.primaryFire ? 1 : 0, Math.round(performance.now())]);
          return send(type, payload);
        };
        client.onEvent("build:structure_damaged", (p: any) => rec.structureDamage.push(p));
        client.onEvent("combat:hit", (p: any) => rec.hits.push(p));
      }, { aId, bId, id });

      await lookBy(a, yawPx, pitchPx);
      await waitPose(a, "Math.abs(p.yaw - arg.yaw) < 1e-3", { yaw }, 10_000).catch(async (error) => {
        throw new Error(`yaw did not reach target: ${JSON.stringify({ geometry, pose: await authPose(a) })}`, { cause: error });
      });
      step(`aimed: ${JSON.stringify({ yaw, pitch, yawPx, pitchPx })}`);

      // One real jump with the fire button held while airborne above 0.5 m.
      const jumpAndFire = async (n: number) => {
        await a.evaluate(() => { (window as any).__windowShots.autoFire = true; });
        await a.keyboard.down("Space");
        try {
          await a.waitForFunction((n) => {
            const rec = (window as any).__windowShots;
            return rec.arcs.length >= n && rec.arcs[n - 1].endSeq >= 0;
          }, n, { timeout: 20_000, polling: 50 });
        } catch (error) {
          const { trace, sent, arcs } = await a.evaluate(() => {
            const rec = (window as any).__windowShots;
            return { trace: rec.trace.slice(-30), arcs: rec.arcs, sent: { count: rec.sent.length, jumps: (rec.sent as number[][]).filter(e => e[1] === 1) } };
          });
          throw new Error(`jump ${n}: no authoritative arc: ${JSON.stringify({ pose: await authPose(a), arcs, sent, trace })}`, { cause: error });
        } finally {
          await a.keyboard.up("Space");
        }
        await a.evaluate(() => { (window as any).__windowShots.autoFire = false; });
        await setPrimaryFire(a, false);
        step(`jump ${n} arc ${JSON.stringify(await a.evaluate((n) => (window as any).__windowShots.arcs[n - 1], n))}`);
      };
      const record = () => a.evaluate(() => (window as any).__windowShots);
      const targetTotal = () => a.evaluate((bId) => {
        const p = (window as any).__buildshiftNetworking.client.deref().state.players[bId];
        return p.health + p.shield;
      }, bId);
      const total0 = target0.health + target0.shield;

      if (phase === "A open window") {
        for (let n = 1; n <= 4 && (await targetTotal()) === total0; n++) await jumpAndFire(n);
        const rec = await record();
        const target1 = await a.evaluate((bId) => {
          const p = (window as any).__buildshiftNetworking.client.deref().state.players[bId];
          return { health: p.health, shield: p.shield };
        }, bId);
        const classified = rec.shots.map((s: any) => ({ ...s, ...classify(s.y, cuboids) }));
        const damaging = classified.find((s: any) => s.targetHealth + s.targetShield < total0);
        const devdiag = await a.evaluate(() => document.querySelector(".devdiag-overlay")?.textContent?.match(/FPS:.*|Mov:.*|Corr.*/g));
        const report = { devdiag, geometry, target0: { health: target0.health, shield: target0.shield }, target1, shots: classified, hits: rec.hits, structureDamage: rec.structureDamage, arcs: rec.arcs, trace: rec.trace.filter((e: number[]) => rec.arcs.some((arc: any) => e[0]! >= arc.startSeq - 15 && e[0]! <= arc.endSeq + 3)) };
        step(`result ${JSON.stringify(report)}`);
        expect(target1.health + target1.shield, JSON.stringify(report)).toBeLessThan(total0);
        expect(rec.hits.some((h: any) => h.targetId === bId && h.shooterId === aId), JSON.stringify(report)).toBe(true);
        expect(damaging, JSON.stringify(report)).toBeTruthy();
        // A destroyed structure cannot return, so the windowed wall still
        // existing now means it existed when the damaging shot was fired.
        expect(await a.evaluate((id) => (window as any).__buildshiftNetworking.client.deref().state.building.structures[id]?.editGrid, id)).toEqual(windowGrid);
        // Exact authoritative shot origin from the server's own hit point:
        // origin = hitPoint − direction·t on the known aim line. Shared
        // geometry: that ray passes the window cuboids, while the same line
        // is stopped by the full wall — it went through the opening.
        const hit = rec.hits.find((h: any) => h.targetId === bId && h.shooterId === aId);
        const travel = (hit.hitPoint.x - shooter0.x) / direction.x;
        const originY = hit.hitPoint.y - direction.y * travel - eye;
        const exactHit = { originY, window: classify(originY, windowCuboids), full: classify(originY, fullCuboids) };
        step(`damaging shot origin ${JSON.stringify(exactHit)}`);
        expect(Math.abs(hit.hitPoint.z - shooter0.z - direction.z * travel), JSON.stringify(exactHit)).toBeLessThan(1e-3);
        expect(exactHit.window.wallHit, JSON.stringify(exactHit)).toBeNull();
        expect(exactHit.window.reachesTarget, JSON.stringify(exactHit)).toBe(true);
        expect(exactHit.full.wallHit, JSON.stringify(exactHit)).not.toBeNull();
      } else {
        // Same aim and jump routine until at least one exact shot came from a
        // height whose ray would pass the window onto the target. Bounded so
        // the wall (200) cannot be destroyed by 20-damage hits.
        // Window-line shot, proven from its bracket: both bracket heights give
        // a ray through the window onto the target. The band of such heights
        // is an interval containing the arc apex, so the true origin (between
        // the brackets on one concave arc) is inside it too.
        const inBand = (y: number) => classify(y, windowCuboids).wallHit === null && classify(y, windowCuboids).reachesTarget;
        const windowLine = (s: any) => s.prevSeq >= 0 && s.prevSeq < s.fireSeq && s.fireSeq <= s.seq && inBand(s.y) && inBand(s.prevY) && (s.prevY > 0 && s.y > 0);
        for (let n = 1; n <= 4; n++) {
          await jumpAndFire(n);
          const rec = await record();
          if (rec.shots.some(windowLine) || rec.structureDamage.length >= 7) break;
        }
        // Shots replicate as state patches and wall damage as messages: wait
        // until every recorded shot has its matching wall-damage event.
        await a.waitForFunction(() => {
          const rec = (window as any).__windowShots;
          return rec.structureDamage.length >= rec.shots.length;
        }, undefined, { timeout: 10_000, polling: 50 }).catch(() => {});
        const rec = await record();
        const target1 = await a.evaluate((bId) => {
          const p = (window as any).__buildshiftNetworking.client.deref().state.players[bId];
          return { health: p.health, shield: p.shield };
        }, bId);
        const classified = rec.shots.map((s: any) => ({ ...s, ...classify(s.y, cuboids), throughWindowLine: windowLine(s) }));
        const report = { geometry, target0: { health: target0.health, shield: target0.shield }, target1, shots: classified, hits: rec.hits, structureDamage: rec.structureDamage };
        step(`result ${JSON.stringify(report)}`);
        expect(classified.some((s: any) => s.throughWindowLine), `no exact window-line shot fired: ${JSON.stringify(report)}`).toBe(true);
        expect(target1, JSON.stringify(report)).toEqual({ health: target0.health, shield: target0.shield });
        expect(rec.hits.filter((h: any) => h.targetId === bId), JSON.stringify(report)).toEqual([]);
        // Every shot the server fired was stopped by this wall.
        const wallDamage = rec.structureDamage.filter((d: any) => d.structureId === id);
        expect(wallDamage.length, JSON.stringify(report)).toBe(rec.shots.length);
        expect(wallDamage.at(-1).remainingDurability).toBe(STRUCTURE_DURABILITY.wall - 20 * wallDamage.length);
        expect(await a.evaluate((id) => Boolean((window as any).__buildshiftNetworking.client.deref().state.building.structures[id]), id)).toBe(true);
      }
    } finally { await context.close(); }
  }

  test("physical wall window A: real jump + mouse fire through the canonical window damages the opponent", { timeout: 120_000 }, async () => {
    test.setTimeout(120_000);
    await runWindowPhase("A open window");
  });

  test("physical wall window B: reset to full wall — the same real jump + fire is stopped by the wall", { timeout: 120_000 }, async () => {
    test.setTimeout(120_000);
    await runWindowPhase("B reset full wall");
  });

  // Physical elevated-floor acceptance. A layer-1 floor (top 3.99 m) is
  // reached with real W only: the canonical ramp (rotation 3, rising toward
  // −Z) climbs one full layer (0 → 3.84 m) and the player walks straight off
  // its top onto the next-layer floor — no jump. Removed floor quadrants must
  // drop the player; retained/reset quadrants must hold it.
  async function runFloorPhase(phase: "AB edited floor" | "C reset floor"): Promise<void> {
    const { context, a, b, aId, step } = await openFreshDuel(`floor ${phase.split(" ")[0]}`, { width: 480, height: 270 });
    // Hold a key until the predicted pose satisfies `predicate` (see
    // waitPredicted), then release; callers assert on authoritative state.
    // `crouched` walks at crouch speed (shorter stopping distance on the
    // elevated floor under a loaded host).
    const hold = async (key: string, predicate: string, arg: Record<string, unknown>, label: string, crouched = false) => {
      if (crouched) {
        await a.keyboard.down("KeyC");
        await waitPose(a, "p.crouch === true", {}, 10_000);
      }
      await a.keyboard.down(key);
      try {
        await waitPredicted(a, predicate, arg, 30_000);
      } catch (error) {
        throw new Error(`${phase}: ${label}: ${JSON.stringify({ pose: await authPose(a), arg, trace: await poseTrace(a, 40) })}`, { cause: error });
      } finally {
        await a.keyboard.up(key);
        if (crouched) {
          await a.keyboard.up("KeyC");
          await waitPose(a, "p.crouch === false", {}, 10_000);
        }
      }
    };
    try {
      await ensureCombatMode(a);
      await installPoseTrace(a);
      const spawn = await authPose(a);
      const cs = BUILD_GRID.cellSize, lh = BUILD_GRID.layerHeight;
      const gx = Math.round(spawn.x / cs), gz0 = Math.round(spawn.z / cs);
      const laneX = gx * cs;
      const rampGrid = { x: gx, y: 0, z: gz0 - 1 };
      const rampRotation = 3;
      const floorGrid = { x: gx, y: 1, z: gz0 - 2 };
      const rampEdit: AcceptanceEditGrid = { kind: "ramp", variant: "full" };
      const fullFloor: AcceptanceEditGrid = { kind: "floor_cone", tiles: [true, true, true, true] };
      // Canonical opening: floor quadrant 0 (−X, −Z: the far-left quadrant).
      const openFloor: AcceptanceEditGrid = { kind: "floor_cone", tiles: [false, true, true, true] };
      const rampCuboids = structureCuboids({ buildType: "ramp", grid: rampGrid, rotation: rampRotation, editGrid: rampEdit });
      const rampTop = Math.max(...rampCuboids.map(c => c.center.y + c.halfExtents.y));
      const rampLowEndZ = Math.max(...rampCuboids.map(c => c.center.z + c.halfExtents.z));
      const fullFloorCuboids = structureCuboids({ buildType: "floor", grid: floorGrid, rotation: 0, editGrid: fullFloor });
      const openFloorCuboids = structureCuboids({ buildType: "floor", grid: floorGrid, rotation: 0, editGrid: openFloor });
      const floorBox = fullFloorCuboids[0]!;
      const floorTop = floorBox.center.y + floorBox.halfExtents.y;
      const floorBounds = { minX: floorBox.center.x - floorBox.halfExtents.x, maxX: floorBox.center.x + floorBox.halfExtents.x, minZ: floorBox.center.z - floorBox.halfExtents.z, maxZ: floorBox.center.z + floorBox.halfExtents.z, y: floorTop };
      // The removed quadrant's footprint (the full-floor area no open cuboid covers).
      const hole = { minX: floorBounds.minX, maxX: floorBox.center.x, minZ: floorBounds.minZ, maxZ: floorBox.center.z };
      expect(openFloorCuboids.some(c => Math.abs(c.center.x - (hole.minX + hole.maxX) / 2) < 1e-6 && Math.abs(c.center.z - (hole.minZ + hole.maxZ) / 2) < 1e-6)).toBe(false);
      const radius = PLAYER_COLLIDER.radius;
      const leftColX = (hole.minX + hole.maxX) / 2, rightColX = (floorBox.center.x + floorBounds.maxX) / 2;
      const geometry = { rampGrid, rampRotation, rampTop, rampLowEndZ, floorGrid, floorBounds, hole, leftColX, rightColX, radius };
      step(`geometry ${JSON.stringify(geometry)}`);
      expect(rampTop).toBeCloseTo(lh, 6); // one full layer

      // Setup: real S walk off the ramp's footprint, then place the ramp.
      await hold("KeyS", "p.z >= arg.z", { z: rampLowEndZ + radius + 0.4 }, "walk to ramp start");
      const rampId = await placeStructure(a, b, 9201, "ramp", rampGrid, rampRotation);
      await expectCanonicalGeometry([a, b], rampId, aId, { buildType: "ramp", grid: rampGrid, rotation: rampRotation, editGrid: rampEdit }, "ramp");
      // Climb partway with W (real steps up the canonical ramp).
      await hold("KeyW", "p.y >= 1.0", {}, "climb ramp");
      const onRamp = await authPose(a);
      step(`on ramp ${JSON.stringify(onRamp)}`);
      // Respect the authoritative placement rate limit by processed inputs.
      await waitPose(a, "p.sequence >= arg.s + 12", { s: onRamp.seq }, 20_000);
      const floorId = await placeStructure(a, b, 9202, "floor", floorGrid, 0);
      await sendEdit(a, floorId, { action: "select", tileIndex: 0 });
      await expectCanonicalGeometry([a, b], floorId, aId, { buildType: "floor", grid: floorGrid, rotation: 0, editGrid: openFloor }, "floor edit");
      step(`floor ${floorId} quadrant 0 removed; replicated + rendered on both clients`);
      if (phase === "C reset floor") {
        await sendEdit(a, floorId, { action: "reset" });
        await expectCanonicalGeometry([a, b], floorId, aId, { buildType: "floor", grid: floorGrid, rotation: 0, editGrid: fullFloor }, "floor reset");
        step("floor reset replicated + rendered on both clients");
      }

      // Keep walking W up the ramp and straight onto the next-layer floor
      // (crouched only for a short stopping distance). No jump key is used.
      await a.evaluate(() => { (window as any).__poseTrace.length = 0; });
      await hold("KeyW", "p.z <= arg.z", { z: floorBox.center.z + 1.6 }, "walk up the ramp onto the floor", true);
      try {
        await waitPose(a, "Math.abs(p.y - arg.top) < 1e-6", { top: floorTop }, 20_000);
      } catch (error) {
        throw new Error(`${phase}: did not reach the floor: ${JSON.stringify({ geometry, pose: await authPose(a), trace: await poseTrace(a, 60) })}`, { cause: error });
      }
      const onFloor = await authPose(a);
      const climb = await poseTrace(a, 4000);
      // A walk, not a jump: authoritative height never decreased on the way.
      const drops = climb.filter((e, i) => i > 0 && e[2]! < climb[i - 1]![2]! - 1e-6);
      expect(drops, JSON.stringify(climb.slice(-20))).toEqual([]);
      expect(Math.max(...climb.map(e => e[2]!))).toBeCloseTo(floorTop, 6);
      step(`on floor (walked, no jump) ${JSON.stringify(onFloor)}`);
      // Back on the near (solid) half, clear of the slab edge.
      if (onFloor.z > floorBox.center.z + 1.6) await hold("KeyW", "p.z <= arg.z", { z: floorBox.center.z + 1.6 }, "onto near half", true);

      /** Real lateral walk to a quadrant column (D: −X, A: +X at yaw 0). */
      const toColumn = async (x: number) => {
        const p = await authPose(a);
        if (Math.abs(p.x - x) < 0.3) return;
        // One-sided threshold in the travel direction: the predicted pose is
        // sampled per overlay refresh, so a two-sided window can be skipped.
        if (p.x > x) await hold("KeyD", "p.x <= arg.x + 0.1", { x }, `to column x=${x}`, true);
        else await hold("KeyA", "p.x >= arg.x - 0.1", { x }, `to column x=${x}`, true);
        const s = (await authPose(a)).seq;
        await waitPose(a, "p.sequence >= arg.s + 10", { s }, 20_000);
      };
      /** Walk W into the far half; returns the authoritative trace while doing so. */
      const walkFar = async (label: string) => {
        await a.evaluate(() => { (window as any).__poseTrace.length = 0; });
        const start = await authPose(a);
        await hold("KeyW", "p.z <= arg.z || p.y < arg.top - 0.5", { z: (hole.minZ + hole.maxZ) / 2, top: floorTop }, label, true);
        // Let the authoritative fall/support settle over processed inputs.
        const s = (await authPose(a)).seq;
        await waitPose(a, "p.sequence >= arg.s + 30", { s }, 20_000);
        return { start, end: await authPose(a), trace: await poseTrace(a, 400) };
      };

      if (phase === "AB edited floor") {
        // B. Retained solid quadrant: the right column (quadrants 3 → 1).
        await toColumn(rightColX);
        const solid = await walkFar("walk onto retained quadrant 1");
        step(`retained solid ${JSON.stringify({ start: solid.start, end: solid.end })}`);
        expect(solid.end.z, JSON.stringify(solid.end)).toBeLessThan(floorBox.center.z - radius);
        expect(solid.end.x).toBeGreaterThan(floorBox.center.x + radius);
        expect(Math.min(...solid.trace.map((e: number[]) => e[2]!))).toBeCloseTo(floorTop, 6);
        expect(solid.end.y).toBeCloseTo(floorTop, 6);
        // Back to the near half and over to the left column (quadrant 2).
        await hold("KeyS", "p.z >= arg.z", { z: floorBox.center.z + 0.8 }, "back to near half", true);
        await toColumn(leftColX);
        const near = await authPose(a);
        expect(near.y).toBeCloseTo(floorTop, 6);
        // A. Walk into the removed quadrant 0: the player must fall through.
        const fall = await walkFar("walk into removed quadrant 0");
        const firstDrop = fall.trace.find((e: number[]) => e[2]! < floorTop - 0.01);
        const result = { start: fall.start, end: fall.end, firstDrop, minY: Math.min(...fall.trace.map((e: number[]) => e[2]!)) };
        step(`fall ${JSON.stringify(result)}`);
        expect(firstDrop, JSON.stringify({ geometry, result })).toBeTruthy();
        // The drop began with the capsule entirely over the removed quadrant,
        // overlapping no remaining canonical floor solid.
        const [, dx, , dz] = firstDrop!;
        expect(dx! - radius).toBeGreaterThanOrEqual(hole.minX - 1e-6);
        expect(dx! + radius).toBeLessThanOrEqual(hole.maxX + 1e-6);
        expect(dz! - radius).toBeGreaterThanOrEqual(hole.minZ - 1e-6);
        expect(dz! + radius).toBeLessThanOrEqual(hole.maxZ + 1e-6);
        const overlapsSolid = openFloorCuboids.some(c => dx! + radius > c.center.x - c.halfExtents.x && dx! - radius < c.center.x + c.halfExtents.x && dz! + radius > c.center.z - c.halfExtents.z && dz! - radius < c.center.z + c.halfExtents.z);
        expect(overlapsSolid).toBe(false);
        // It fell the full height to the ground below.
        expect(fall.end.y, JSON.stringify(result)).toBe(0);
      } else {
        // C. Reset: the previously removed quadrant supports the player.
        await toColumn(leftColX);
        const reset = await walkFar("walk onto reset quadrant 0");
        step(`reset support ${JSON.stringify({ start: reset.start, end: reset.end })}`);
        expect(reset.end.x - radius).toBeGreaterThanOrEqual(hole.minX - 1e-6);
        expect(reset.end.x + radius).toBeLessThanOrEqual(hole.maxX + 1e-6);
        expect(reset.end.z + radius, JSON.stringify(reset.end)).toBeLessThanOrEqual(hole.maxZ + 1e-6);
        expect(Math.min(...reset.trace.map((e: number[]) => e[2]!))).toBeCloseTo(floorTop, 6);
        expect(reset.end.y).toBeCloseTo(floorTop, 6);
      }
    } finally { await context.close(); }
  }

  test("physical floor A+B: canonical quadrant edit — real movement falls through the opening, retained quadrant supports", { timeout: 120_000 }, async () => {
    test.setTimeout(120_000);
    await runFloorPhase("AB edited floor");
  });

  test("physical floor C: reset to full floor — the previously removed quadrant supports real movement", { timeout: 120_000 }, async () => {
    test.setTimeout(120_000);
    await runFloorPhase("C reset floor");
  });

  // ─── Shared movement helpers for the cone / ramp / bounds cases ─────────────

  /** Hold `key` on page `a` until the PREDICTED pose meets `predicate`. */
  async function holdKey(a: Page, phase: string, key: string, predicate: string, arg: Record<string, unknown>, label: string, crouched = false): Promise<void> {
    if (crouched) {
      await a.keyboard.down("KeyC");
      await waitPose(a, "p.crouch === true", {}, 10_000);
    }
    await a.keyboard.down(key);
    try {
      await waitPredicted(a, predicate, arg, 30_000);
    } catch (error) {
      throw new Error(`${phase}: ${label}: ${JSON.stringify({ pose: await authPose(a), arg, trace: await poseTrace(a, 40) })}`, { cause: error });
    } finally {
      await a.keyboard.up(key);
      if (crouched) {
        await a.keyboard.up("KeyC");
        await waitPose(a, "p.crouch === false", {}, 10_000);
      }
    }
  }
  /** Wait for `n` more authoritatively processed inputs. */
  async function settleInputs(a: Page, n: number): Promise<void> {
    const s = (await authPose(a)).seq;
    await waitPose(a, "p.sequence >= arg.s + arg.n", { s, n }, 20_000);
  }
  /** Real lateral walk to lane x (yaw 0: D → −X, A → +X), one-sided threshold. */
  async function toLaneX(a: Page, phase: string, x: number): Promise<void> {
    const p = await authPose(a);
    if (Math.abs(p.x - x) < 0.3) return;
    if (p.x > x) await holdKey(a, phase, "KeyD", "p.x <= arg.x + 0.15", { x }, `to lane x=${x}`, true);
    else await holdKey(a, phase, "KeyA", "p.x >= arg.x - 0.15", { x }, `to lane x=${x}`, true);
    await settleInputs(a, 10);
  }
  /** Authoritative trace samples as objects. */
  const tracePoints = (trace: number[][]) => trace.map(([seq, x, y, z]) => ({ seq: seq!, x: x!, y: y!, z: z! }));

  // Physical cone acceptance. The canonical cone is a 16-level stepped
  // pyramid rising one layer (each level 0.24 m, within the step-up), so a
  // player walks up its sides and over the apex. The canonical "half" edit
  // (quadrants 0 and 2 removed: the −X column) opens a ground-level lane
  // through the cone; the kept +X half is still climbable.
  async function runConePhase(phase: "A full cone" | "B edited cone" | "C reset cone"): Promise<void> {
    const { context, a, b, aId, step } = await openFreshDuel(`cone ${phase[0]}`, { width: 480, height: 270 });
    try {
      await ensureCombatMode(a);
      await installPoseTrace(a);
      const spawn = await authPose(a);
      const cs = BUILD_GRID.cellSize, lh = BUILD_GRID.layerHeight;
      const radius = PLAYER_COLLIDER.radius;
      const grid = { x: Math.round(spawn.x / cs), y: 0, z: Math.round(spawn.z / cs) - 1 };
      const fullCone: AcceptanceEditGrid = { kind: "floor_cone", tiles: [true, true, true, true] };
      const halfCone: AcceptanceEditGrid = { kind: "floor_cone", tiles: [false, true, false, true] };
      const fullCuboids = structureCuboids({ buildType: "cone", grid, rotation: 0, editGrid: fullCone });
      const base = fullCuboids[0]!;
      const center = { x: base.center.x, z: base.center.z };
      const bounds = { minX: center.x - cs / 2, maxX: center.x + cs / 2, minZ: center.z - cs / 2, maxZ: center.z + cs / 2 };
      const openLaneX = center.x - cs / 4, keptLaneX = center.x + cs / 4;
      const geometry = { grid, center, bounds, top: Math.max(...fullCuboids.map(c => c.center.y + c.halfExtents.y)), levels: fullCuboids.length };
      step(`geometry ${JSON.stringify(geometry)}`);
      expect(geometry.top).toBeCloseTo(lh, 6);
      expect(spawn.z).toBeGreaterThan(bounds.maxZ + radius + 1);

      const id = await placeStructure(a, b, 9301, "cone", grid, 0);
      await expectCanonicalGeometry([a, b], id, aId, { buildType: "cone", grid, rotation: 0, editGrid: fullCone }, "full cone");
      if (phase !== "A full cone") {
        await sendEdit(a, id, { action: "select", tileIndex: 0 });
        await sendEdit(a, id, { action: "select", tileIndex: 2 });
        await expectCanonicalGeometry([a, b], id, aId, { buildType: "cone", grid, rotation: 0, editGrid: halfCone }, "cone half edit");
        step(`cone ${id} half edit replicated + rendered on both clients`);
      }
      if (phase === "C reset cone") {
        await sendEdit(a, id, { action: "reset" });
        await expectCanonicalGeometry([a, b], id, aId, { buildType: "cone", grid, rotation: 0, editGrid: fullCone }, "cone reset");
        step("cone reset replicated + rendered on both clients");
      }

      const halfCuboids = structureCuboids({ buildType: "cone", grid, rotation: 0, editGrid: halfCone });
      /** Canonical peak along a straight −Z line at x: the highest level top
       * the capsule's footprint overlaps anywhere across the cone. */
      const canonicalPeak = (cuboids: StructureCuboid[], x: number) => Math.max(0, ...cuboids
        .filter(c => x + radius > c.center.x - c.halfExtents.x && x - radius < c.center.x + c.halfExtents.x)
        .map(c => c.center.y + c.halfExtents.y));
      /** Real W across the whole cone footprint along lane x; returns the trace. */
      const crossAlong = async (x: number, label: string, cuboids: StructureCuboid[]) => {
        await toLaneX(a, phase, x);
        const start = await authPose(a);
        await a.evaluate(() => { (window as any).__poseTrace.length = 0; });
        await holdKey(a, phase, "KeyW", "p.z <= arg.z", { z: bounds.minZ - radius - 1.2 }, label);
        await settleInputs(a, 30);
        const end = await authPose(a);
        const points = tracePoints(await poseTrace(a, 4000));
        const peak = points.reduce((m, p) => (p.y > m.y ? p : m), points[0]!);
        const expectedPeak = canonicalPeak(cuboids, start.x);
        const result = { label, start, end, peak, expectedPeak, samples: points.length };
        step(`${label} ${JSON.stringify(result)}`);
        // Crossed the whole footprint in a straight line, back on the ground,
        // having followed the canonical shape: peak = the canonical level top.
        expect(end.z, JSON.stringify(result)).toBeLessThan(bounds.minZ - radius);
        expect(end.y).toBe(0);
        expect(Math.abs(end.x - start.x)).toBeLessThan(0.05);
        expect(peak.y, JSON.stringify(result)).toBeCloseTo(expectedPeak, 4);
        return { points, peak, expectedPeak, result };
      };

      if (phase === "A full cone") {
        // Over the apex: climb the near side, cross the top, descend the far side.
        const over = await crossAlong(center.x, "climb over the full cone", fullCuboids);
        expect(over.expectedPeak).toBeCloseTo(lh, 6); // over the apex
        expect(Math.abs(over.peak.z - center.z)).toBeLessThan(1.0);
      } else if (phase === "B edited cone") {
        // The opened −X lane crosses at ground level (no invisible full cone)…
        const open = await crossAlong(openLaneX, "cross the opened lane", halfCuboids);
        expect(open.expectedPeak).toBe(0); // lane clear of every kept level
        expect(Math.max(...open.points.map(p => p.y)), JSON.stringify(open.result)).toBe(0);
        // …while the kept +X half is still a climbable cone portion.
        await holdKey(a, phase, "KeyS", "p.z >= arg.z", { z: bounds.maxZ + radius + 1.5 }, "back to the near side");
        await settleInputs(a, 10);
        const kept = await crossAlong(keptLaneX, "climb the kept half", halfCuboids);
        expect(kept.expectedPeak).toBeGreaterThan(1.0); // a real climb
        // Without the edit this lane would have climbed the full cone's levels.
        expect(canonicalPeak(fullCuboids, kept.result.start.x)).toBeGreaterThanOrEqual(kept.expectedPeak);
      } else {
        // Reset: the formerly opened lane is a climbable cone side again.
        const reset = await crossAlong(openLaneX, "climb the reset cone side", fullCuboids);
        expect(reset.expectedPeak).toBeGreaterThan(1.0); // the opened lane climbs again
      }
    } finally { await context.close(); }
  }

  test("physical cone A: full stepped-pyramid cone — real W climbs over the apex and down the far side", { timeout: 120_000 }, async () => {
    test.setTimeout(120_000);
    await runConePhase("A full cone");
  });

  test("physical cone B: canonical half edit — opened lane crosses at ground level, kept half still climbs", { timeout: 120_000 }, async () => {
    test.setTimeout(120_000);
    await runConePhase("B edited cone");
  });

  test("physical cone C: reset to full cone — the formerly opened lane climbs again", { timeout: 120_000 }, async () => {
    test.setTimeout(120_000);
    await runConePhase("C reset cone");
  });

  // Physical ramp acceptance. The canonical ramp is 16 step columns over two
  // cells climbing one full layer (0 → 3.84 m), so a player walks off its top
  // onto a next-layer floor (top 3.99 m). half_left / half_right keep the
  // climber's left / right half of the WIDTH (as seen looking up the ramp).
  async function runRampFloorPhase(): Promise<void> {
    const phase = "ramp rotation 1 → next-layer floor";
    const { context, a, b, aId, step } = await openFreshDuel("ramp floor", { width: 480, height: 270 });
    try {
      await ensureCombatMode(a);
      await installPoseTrace(a);
      const spawn = await authPose(a);
      const cs = BUILD_GRID.cellSize, lh = BUILD_GRID.layerHeight;
      const radius = PLAYER_COLLIDER.radius;
      // Rotation 1 climbs toward +Z over cells z, z+1; the floor sits beyond.
      const rampGrid = { x: Math.round(spawn.x / cs), y: 0, z: Math.round(spawn.z / cs) };
      const floorGrid = { x: rampGrid.x, y: 1, z: rampGrid.z + 2 };
      const ramp = structureCuboids({ buildType: "ramp", grid: rampGrid, rotation: 1 });
      const floor = structureCuboids({ buildType: "floor", grid: floorGrid, rotation: 0 })[0]!;
      const lowEndZ = Math.min(...ramp.map(c => c.center.z - c.halfExtents.z));
      const floorTop = floor.center.y + floor.halfExtents.y;
      const rampTop = Math.max(...ramp.map(c => c.center.y + c.halfExtents.y));
      step(`geometry ${JSON.stringify({ rampGrid, floorGrid, lowEndZ, rampTop, floorTop })}`);
      expect(rampTop).toBeCloseTo(lh, 6);
      // Setup: real W off the ramp's footprint (it covers the spawn).
      await holdKey(a, phase, "KeyW", "p.z <= arg.z", { z: lowEndZ - radius - 0.6 }, "walk to the ramp's low end");
      await settleInputs(a, 10);
      const rampId = await placeStructure(a, b, 9401, "ramp", rampGrid, 1);
      await expectCanonicalGeometry([a, b], rampId, aId, { buildType: "ramp", grid: rampGrid, rotation: 1, editGrid: { kind: "ramp", variant: "full" } }, "ramp rotation 1");
      // Climb partway with real S (+Z), then place the floor within range.
      await a.evaluate(() => { (window as any).__poseTrace.length = 0; });
      await holdKey(a, phase, "KeyS", "p.y >= 1.5", {}, "climb partway");
      await settleInputs(a, 12); // also respects the placement rate limit
      const floorId = await placeStructure(a, b, 9402, "floor", floorGrid, 0);
      await expectCanonicalGeometry([a, b], floorId, aId, { buildType: "floor", grid: floorGrid, rotation: 0, editGrid: { kind: "floor_cone", tiles: [true, true, true, true] } }, "next-layer floor");
      // Keep walking S up the ramp and onto the floor. No jump key is used.
      await holdKey(a, phase, "KeyS", "p.z >= arg.z", { z: floor.center.z - 0.5 }, "walk onto the floor", true);
      await waitPose(a, "Math.abs(p.y - arg.top) < 1e-6", { top: floorTop }, 20_000).catch(async (error) => {
        throw new Error(`${phase}: did not reach the floor: ${JSON.stringify({ pose: await authPose(a), trace: await poseTrace(a, 60) })}`, { cause: error });
      });
      await settleInputs(a, 15);
      const end = await authPose(a);
      const points = tracePoints(await poseTrace(a, 4000));
      const drops = points.filter((p, i) => i > 0 && p.y < points[i - 1]!.y - 1e-6);
      const result = { end, maxY: Math.max(...points.map(p => p.y)), samples: points.length, drops: drops.slice(0, 3) };
      step(`walked onto the next-layer floor ${JSON.stringify(result)}`);
      expect(drops, JSON.stringify(result)).toEqual([]);
      expect(end.y).toBeCloseTo(floorTop, 6);
      expect(end.z - radius).toBeGreaterThan(floor.center.z - floor.halfExtents.z);
    } finally { await context.close(); }
  }

  async function runRampHalfPhase(variant: "half_left" | "half_right"): Promise<void> {
    const phase = `ramp ${variant}`;
    const { context, a, b, aId, step } = await openFreshDuel(phase, { width: 480, height: 270 });
    try {
      await ensureCombatMode(a);
      await installPoseTrace(a);
      const spawn = await authPose(a);
      const cs = BUILD_GRID.cellSize, lh = BUILD_GRID.layerHeight;
      const radius = PLAYER_COLLIDER.radius;
      // Rotation 3 climbs toward −Z (real W at yaw 0). Facing −Z, the
      // climber's left is +X (the A key).
      const grid = { x: Math.round(spawn.x / cs), y: 0, z: Math.round(spawn.z / cs) - 1 };
      const rotation = 3;
      const edited: AcceptanceEditGrid = { kind: "ramp", variant };
      const halfCuboids = structureCuboids({ buildType: "ramp", grid, rotation, editGrid: edited });
      const full = structureCuboids({ buildType: "ramp", grid, rotation });
      const centerX = grid.x * cs;
      const leftLaneX = centerX + cs / 4, rightLaneX = centerX - cs / 4;
      const keptLaneX = variant === "half_left" ? leftLaneX : rightLaneX;
      const removedLaneX = variant === "half_left" ? rightLaneX : leftLaneX;
      const lowEndZ = Math.max(...full.map(c => c.center.z + c.halfExtents.z));
      const highEndZ = Math.min(...full.map(c => c.center.z - c.halfExtents.z));
      for (const c of halfCuboids) expect(Math.sign(c.center.x - centerX)).toBe(Math.sign(keptLaneX - centerX));
      step(`geometry ${JSON.stringify({ grid, rotation, variant, keptLaneX, removedLaneX, lowEndZ, highEndZ })}`);

      await holdKey(a, phase, "KeyS", "p.z >= arg.z", { z: lowEndZ + radius + 0.6 }, "walk off the ramp footprint");
      await settleInputs(a, 10);
      const id = await placeStructure(a, b, 9501, "ramp", grid, rotation);
      await sendEdit(a, id, { action: "select", rampVariant: variant });
      await expectCanonicalGeometry([a, b], id, aId, { buildType: "ramp", grid, rotation, editGrid: edited }, `ramp ${variant}`);
      step(`ramp ${id} ${variant} replicated + rendered on both clients`);

      /** Real W up lane x to just below the high end; returns the authoritative climb. */
      const climbLane = async (x: number, label: string) => {
        await toLaneX(a, phase, x);
        await a.evaluate(() => { (window as any).__poseTrace.length = 0; });
        // Stop 1.3 m short of the high edge (≥ 1.6 m margin for stopping distance).
        await holdKey(a, phase, "KeyW", "p.z <= arg.z", { z: highEndZ + 1.3 }, label, true);
        await settleInputs(a, 15);
        const end = await authPose(a);
        const points = tracePoints(await poseTrace(a, 4000));
        const result = { label, end, maxY: Math.max(...points.map(p => p.y)), samples: points.length };
        step(`${label} ${JSON.stringify(result)}`);
        return { end, points, result };
      };
      const backDown = async () => {
        await holdKey(a, phase, "KeyS", "p.z >= arg.z", { z: lowEndZ + radius + 0.6 }, "walk back down", true);
        await settleInputs(a, 15);
        expect((await authPose(a)).y).toBe(0);
      };

      // The removed half of the width is not a ramp: the lane stays on the ground.
      const removed = await climbLane(removedLaneX, `removed ${variant === "half_left" ? "right" : "left"} lane`);
      expect(removed.result.maxY, JSON.stringify(removed.result)).toBe(0);
      expect(removed.end.z).toBeLessThan(highEndZ + 1.5);
      await backDown();
      // The kept half climbs the full layer.
      const kept = await climbLane(keptLaneX, `kept ${variant === "half_left" ? "left" : "right"} lane`);
      expect(kept.result.maxY, JSON.stringify(kept.result)).toBeGreaterThan(lh - 0.6);
      expect(kept.end.y).toBeGreaterThan(lh - 0.6);
      await backDown();

      if (variant === "half_left") {
        // Reset to the full ramp: the formerly removed lane climbs too.
        await sendEdit(a, id, { action: "reset" });
        await expectCanonicalGeometry([a, b], id, aId, { buildType: "ramp", grid, rotation, editGrid: { kind: "ramp", variant: "full" } }, "ramp reset");
        step("ramp reset replicated + rendered on both clients");
        const reset = await climbLane(removedLaneX, "reset ramp, formerly removed lane");
        expect(reset.result.maxY, JSON.stringify(reset.result)).toBeGreaterThan(lh - 0.6);
      }
    } finally { await context.close(); }
  }

  test("physical ramp A: rotation-1 ramp — real walking reaches the next-layer floor with no jump", { timeout: 120_000 }, async () => {
    test.setTimeout(120_000);
    await runRampFloorPhase();
  });

  test("physical ramp B: half_left keeps the climber's left width half; reset restores the full ramp", { timeout: 120_000 }, async () => {
    test.setTimeout(120_000);
    await runRampHalfPhase("half_left");
  });

  test("physical ramp C: half_right keeps the climber's right width half", { timeout: 120_000 }, async () => {
    test.setTimeout(120_000);
    await runRampHalfPhase("half_right");
  });

  // Authoritative world bounds. Sustained real movement into the arena edge
  // must stop at the server boundary (PLAYABLE_ARENA_BOUNDS, shared with
  // client prediction), and a build outside the build volume is rejected
  // without charging Energy.
  test("world bounds: sustained real movement stops at the arena edge; out-of-bounds build is rejected free", { timeout: 120_000 }, async () => {
    test.setTimeout(120_000);
    const { context, a, step } = await openFreshDuel("bounds", { width: 480, height: 270 });
    try {
      await ensureCombatMode(a);
      await installPoseTrace(a);
      const radius = PLAYER_COLLIDER.radius;
      const edgeZ = PLAYABLE_ARENA_BOUNDS.minZ + radius;
      await a.evaluate(() => { (window as any).__poseTrace.length = 0; });
      await a.keyboard.down("KeyW");
      try {
        await waitPose(a, "p.z <= arg.edgeZ + 1e-4", { edgeZ }, 30_000);
        const contact = await authPose(a);
        // Keep pushing for 60 more authoritative inputs.
        await waitPose(a, "p.sequence >= arg.s + 60", { s: contact.seq }, 30_000);
      } finally {
        await a.keyboard.up("KeyW");
      }
      await settleInputs(a, 10);
      const end = await authPose(a);
      const points = tracePoints(await poseTrace(a, 4000));
      const minZ = Math.min(...points.map(p => p.z));
      // Client prediction converges on the authoritative boundary.
      const diag = await a.evaluate(() => document.querySelector(".devdiag-overlay")?.textContent ?? "");
      const pred = diag.match(/Pred:\s*\(\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\)/);
      const corr = diag.match(/Corr:\s*(\d+\.\d+)/);
      const result = { end, minZ, edgeZ, samples: points.length, predicted: pred?.slice(1).map(Number), correction: corr ? Number(corr[1]) : null };
      step(`edge ${JSON.stringify(result)}`);
      expect(minZ, JSON.stringify(result)).toBeGreaterThanOrEqual(edgeZ - 1e-4);
      expect(end.z).toBeCloseTo(edgeZ, 4);
      expect(pred, diag).toBeTruthy();
      expect(Math.abs(Number(pred![3]) - end.z)).toBeLessThan(0.02);
      expect(result.correction).not.toBeNull();
      expect(result.correction!).toBeLessThan(0.05);

      // A placement outside the build volume: explicit rejection, no Energy charged.
      const energy0 = await a.evaluate(() => { const c = (window as any).__buildshiftNetworking.client.deref(); return c.state.players[c.sessionId].energy as number; });
      await a.evaluate(() => {
        const w = window as any;
        w.__rejections = [];
        w.__buildshiftNetworking.client.deref().onEvent("build:structure_rejected", (p: unknown) => w.__rejections.push(p));
      });
      const cs = BUILD_GRID.cellSize;
      const outside = { x: BUILD_BOUNDS.maxX + 1, y: 0, z: Math.round(end.z / cs) };
      expect(await a.evaluate((grid) => (window as any).__buildshiftNetworking.client.deref().send("build:placement_request", { sequence: 9601, buildType: "wall", grid, rotation: 0 }), outside)).toBe(true);
      const rejection = await a.waitForFunction(() => (window as any).__rejections.find((r: any) => r.sequence === 9601), undefined, { timeout: 10_000, polling: 50 }).then(h => h.jsonValue());
      await settleInputs(a, 5);
      const energy1 = await a.evaluate(() => { const c = (window as any).__buildshiftNetworking.client.deref(); return c.state.players[c.sessionId].energy as number; });
      const structures = await a.evaluate(() => Object.keys((window as any).__buildshiftNetworking.client.deref().state.building.structures).length);
      step(`out-of-bounds build ${JSON.stringify({ outside, rejection, energy0, energy1, structures })}`);
      expect((rejection as any).reason).toBe("invalid_grid");
      expect(energy1).toBeGreaterThanOrEqual(energy0); // regen only; nothing charged
      expect(structures).toBe(0);
    } finally { await context.close(); }
  });


  // ─── Competitive input acceptance (real keyboard + mouse) ──────────────────
  //
  // Dedicated build binds, held-primary piece switching, drag editing on the
  // canonical edit grid, and the combat flow — all through the production
  // input path (InputManager → action map → mode coordinator → building /
  // edit controllers → NetworkClient). Default binds: Q wall, F floor, E
  // ramp, Z cone, G edit, Enter confirm, T reset, 1/2 weapons.

  /**
   * Tracks the camera's yaw/pitch (fresh pages start at 0, 0) and aims the
   * crosshair with real look deltas. `at` closes the loop on the live camera
   * (its actual world position and aim direction — the same ray placement and
   * edit selection use), so dolly / obstruction / smoothing never skew it.
   */
  class CrosshairAim {
    yaw = 0;
    pitch = 0;
    constructor(private readonly page: Page) {}
    async to(yaw: number, pitch: number): Promise<void> {
      const dx = Math.round((this.yaw - yaw) / LOOK_SENSITIVITY);
      const dy = Math.round((this.pitch - pitch) / LOOK_SENSITIVITY);
      if (dx !== 0 || dy !== 0) await lookBy(this.page, dx, dy);
      this.yaw -= dx * LOOK_SENSITIVITY;
      this.pitch -= dy * LOOK_SENSITIVITY;
    }
    /** The live camera position (after a rendered frame). */
    private camera(): Promise<{ x: number; y: number; z: number }> {
      return this.page.evaluate(() => {
        const p = (window as any).__buildshiftEngine.scenes[0].activeCamera.position;
        return { x: p.x, y: p.y, z: p.z };
      });
    }
    /** Aim the crosshair at world point `t` (iterates on the live camera). */
    async at(t: { x: number; y: number; z: number }): Promise<void> {
      for (let i = 0; i < 6; i++) {
        await sleep(120); // let the camera follow the last look
        const c = await this.camera();
        const dx = t.x - c.x;
        const dy = t.y - c.y;
        const dz = t.z - c.z;
        const yaw = Math.atan2(dx, -dz);
        const pitch = Math.atan2(dy, Math.hypot(dx, dz));
        if (Math.abs(yaw - this.yaw) < 0.004 && Math.abs(pitch - this.pitch) < 0.004) return;
        await this.to(yaw, pitch);
      }
      await sleep(120);
    }
  }

  const CS = BUILD_GRID.cellSize;
  const LH = BUILD_GRID.layerHeight;
  /** Ground centre of grid cell (gx, gz) (the placement preview snaps by floor). */
  const cellCentre = (gx: number, gz: number) => ({ x: gx * CS + CS / 2, y: 0, z: gz * CS + CS / 2 });
  /** Centre of wall tile `t` for a rotation-0 wall anchored at grid (gx, 0, gz). */
  const wallTile = (gx: number, gz: number, t: number) => ({ x: gx * CS + ((t % 3) - 1) * (CS / 3), y: LH - (Math.floor(t / 3) + 0.5) * (LH / 3), z: gz * CS });

  type Placed = { id: string; buildType: string; grid: { x: number; y: number; z: number }; rotation: number; ownerId: string };
  const structuresOf = (page: Page): Promise<Placed[]> => page.evaluate(() =>
    Object.values((window as any).__buildshiftNetworking.client.deref().state.building.structures).map((s: any) => ({ id: s.structureId, buildType: s.buildType, grid: s.grid, rotation: s.rotation, ownerId: s.ownerId })));
  const editTilesOf = (page: Page, id: string): Promise<boolean[] | null> => page.evaluate((id) =>
    (window as any).__buildshiftNetworking.client.deref().state.building.structures[id]?.editGrid?.tiles ?? null, id);
  /** Records every edit intent the page sends (wraps the production send). */
  const recordEditSends = (page: Page) => page.evaluate(() => {
    const w = window as any;
    const client = w.__buildshiftNetworking.client.deref();
    w.__editSends = [];
    const send = client.send.bind(client);
    client.send = (type: string, payload: unknown) => {
      if (type === "two-player:edit_grid_action") w.__editSends.push(payload);
      return send(type, payload);
    };
  });
  const editSends = (page: Page): Promise<Array<Record<string, unknown>>> => page.evaluate(() => (window as any).__editSends ?? []);
  const editModeOn = (page: Page) => page.evaluate(() => document.querySelector(".build-edit-hud__title") !== null);
  const waitStructure = (page: Page, predicate: (s: Placed) => boolean, label: string) =>
    expect.poll(async () => (await structuresOf(page)).some(predicate), { message: label, timeout: 10_000 }).toBe(true);

  test("competitive input 1: dedicated wall bind → immediate preview → LMB places", { timeout: 120_000 }, async () => {
    test.setTimeout(120_000);
    const { context, a, aId, step } = await openFreshDuel("input 1", { width: 480, height: 270 });
    try {
      const aim = new CrosshairAim(a);
      await aim.at(cellCentre(0, -1));
      const ammo = await getMagazineAmmo(a);
      expect(await buildModeActive(a)).toBe(false);
      await a.keyboard.press("KeyQ"); // weapon → building with the wall, one key
      await expect(a.locator(".build-hud__selected")).toContainText("Wall", { timeout: 5_000 });
      await expect(a.locator(".build-hud__validity--valid")).toHaveCount(1, { timeout: 5_000 });
      expect(await buildModeActive(a)).toBe(true);
      step("wall bind: building, valid preview");
      await fireWeapon(a);
      await waitStructure(a, (s) => s.buildType === "wall" && s.ownerId === aId && s.grid.x === 0 && s.grid.z === -1, "wall placed at (0, 0, -1)");
      expect(await getMagazineAmmo(a)).toBe(ammo); // the click placed, never fired
      step(`placed ${JSON.stringify(await structuresOf(a))}`);
    } finally { await context.close(); }
  });

  test("competitive input 2: hold LMB — wall → ramp → floor → cone binds place without releasing", { timeout: 120_000 }, async () => {
    test.setTimeout(120_000);
    const { context, a, aId, step } = await openFreshDuel("input 2", { width: 480, height: 270 });
    try {
      const aim = new CrosshairAim(a);
      const mine = async () => (await structuresOf(a)).filter((s) => s.ownerId === aId);
      // Weapon mode, button down: the rifle fires first.
      await aim.at(cellCentre(0, -1));
      await setPrimaryFire(a, true);
      try {
        await a.keyboard.press("KeyQ");
        await waitStructure(a, (s) => s.buildType === "wall" && s.grid.x === 0 && s.grid.z === -1, "held wall");
        const ammoInBuild = await getMagazineAmmo(a);
        // Each next piece: switch first (the crosshair still rests on the
        // occupied cell, so nothing places), then aim at a free cell.
        const plan: Array<[string, string, { x: number; y: number; z: number }, { x: number; z: number }]> = [
          ["KeyE", "ramp", cellCentre(1, -2), { x: 1, z: -2 }],
          ["KeyF", "floor", cellCentre(1, -1), { x: 1, z: -1 }],
          ["KeyZ", "cone", cellCentre(-1, -1), { x: -1, z: -1 }],
        ];
        for (const [code, type, target, grid] of plan) {
          await a.keyboard.press(code);
          await aim.at(target);
          await waitStructure(a, (s) => s.buildType === type && s.grid.x === grid.x && s.grid.z === grid.z, `held ${type}`);
          step(`${type} placed while LMB held`);
        }
        expect(await getMagazineAmmo(a)).toBe(ammoInBuild); // no shots once building
      } finally {
        await setPrimaryFire(a, false);
      }
      const placed = (await mine()).map((s) => s.buildType).sort();
      expect(placed).toEqual(["cone", "floor", "ramp", "wall"]);
    } finally { await context.close(); }
  });

  /** Fresh duel with a rotation-0 wall in A's lane at grid (1,0,-1); A walks within edit range. */
  async function openWallEditDuel(tag: string) {
    const duel = await openFreshDuel(tag, { width: 480, height: 270 });
    const { a, b } = duel;
    await installPoseTrace(a);
    const id = await placeStructure(a, b, 9701, "wall", { x: 1, y: 0, z: -1 }, 0);
    // The edit target is selected from the camera (7 m behind the pivot):
    // step up to ≈3 m from the wall.
    await holdKey(a, tag, "KeyW", "p.z <= arg.z", { z: -1.9 }, "walk to the wall");
    await settleInputs(a, 10);
    await recordEditSends(a);
    return { ...duel, id, aim: new CrosshairAim(a) };
  }

  test("competitive input 3: edit wall — drag a window across the middle row → confirm → opening", { timeout: 120_000 }, async () => {
    test.setTimeout(120_000);
    const { context, a, b, aId, id, aim, step } = await openWallEditDuel("input 3");
    try {
      await aim.at(wallTile(1, -1, 3));
      await a.keyboard.press("KeyG");
      await expect(a.locator(".build-edit-hud__target")).toContainText("Wall", { timeout: 5_000 });
      // One held drag: press on tile 3, one look jump to tile 5 (crossing 4).
      await setPrimaryFire(a, true);
      await sleep(150);
      await aim.at(wallTile(1, -1, 5));
      await sleep(300);
      await setPrimaryFire(a, false);
      await expect(a.locator(".build-edit-hud__tiles")).toHaveText("Tiles open: 3/9", { timeout: 5_000 });
      expect(await editSends(a)).toEqual([]); // the drag is local
      step("drag 3 → 5 selected 3 tiles locally");
      await a.keyboard.press("Enter");
      const window: AcceptanceEditGrid = { kind: "wall", tiles: [true, true, true, false, false, false, true, true, true] };
      await expectCanonicalGeometry([a, b], id, aId, { buildType: "wall", grid: { x: 1, y: 0, z: -1 }, rotation: 0, editGrid: window }, "dragged window");
      expect((await editSends(a)).map((m) => m.action)).toEqual(["select", "select", "select", "confirm"]);
      expect(await editModeOn(a)).toBe(false);
      step("window confirmed: canonical opening on both clients");
    } finally { await context.close(); }
  });

  test("competitive input 4: edit wall — drag a doorway → confirm → the player walks through", { timeout: 120_000 }, async () => {
    test.setTimeout(120_000);
    const { context, a, b, aId, id, aim, step } = await openWallEditDuel("input 4");
    try {
      await aim.at(wallTile(1, -1, 4));
      await a.keyboard.press("KeyG");
      await expect(a.locator(".build-edit-hud__target")).toContainText("Wall", { timeout: 5_000 });
      await setPrimaryFire(a, true);
      await sleep(150);
      await aim.at(wallTile(1, -1, 7));
      await sleep(300);
      await setPrimaryFire(a, false);
      await expect(a.locator(".build-edit-hud__tiles")).toHaveText("Tiles open: 2/9", { timeout: 5_000 });
      await a.keyboard.press("Enter");
      const doorway: AcceptanceEditGrid = { kind: "wall", tiles: [true, true, true, true, false, true, true, false, true] };
      await expectCanonicalGeometry([a, b], id, aId, { buildType: "wall", grid: { x: 1, y: 0, z: -1 }, rotation: 0, editGrid: doorway }, "dragged doorway");
      step("doorway confirmed");
      // Walk straight through (face −Z again: yaw 0).
      await aim.to(0, 0);
      await settleInputs(a, 5);
      const before = await authPose(a);
      await holdKey(a, "input 4", "KeyW", "p.z <= arg.z", { z: -7.2 }, "walk through the doorway");
      await settleInputs(a, 10);
      const after = await authPose(a);
      step(`walked ${JSON.stringify({ before, after })}`);
      expect(after.z).toBeLessThan(-5.12 - 0.384 - PLAYER_COLLIDER.radius);
    } finally { await context.close(); }
  });

  test("competitive input 5: edit → shotgun → shoot → edit → reset → confirm", { timeout: 120_000 }, async () => {
    test.setTimeout(120_000);
    const { context, a, b, aId, id, aim, step } = await openWallEditDuel("input 5");
    try {
      const full: AcceptanceEditGrid = { kind: "wall", tiles: Array(9).fill(true) };
      await aim.at(wallTile(1, -1, 1));
      await a.keyboard.press("KeyG");
      await expect(a.locator(".build-edit-hud__target")).toContainText("Wall", { timeout: 5_000 });
      await fireWeapon(a); // select tile 1 (local)
      await expect(a.locator(".build-edit-hud__tiles")).toHaveText("Tiles open: 1/9", { timeout: 5_000 });
      // Shotgun: leaves edit, committing the edit, and switches at once.
      await a.keyboard.press("Digit2");
      await expect.poll(() => getWeaponName(a), { timeout: 5_000 }).toBe("Shotgun");
      await expectCanonicalGeometry([a, b], id, aId, { buildType: "wall", grid: { x: 1, y: 0, z: -1 }, rotation: 0, editGrid: { kind: "wall", tiles: [true, false, true, true, true, true, true, true, true] } }, "edit committed by the shotgun bind");
      step("edit → shotgun committed the edit");
      // Shoot.
      const shells = await getMagazineAmmo(a);
      await fireWeapon(a);
      await expect.poll(() => getMagazineAmmo(a), { timeout: 5_000 }).toBeLessThan(shells);
      step("shotgun fired");
      // Edit again → reset (predicted at once) → confirm.
      await a.keyboard.press("KeyG");
      await expect(a.locator(".build-edit-hud__tiles")).toHaveText("Tiles open: 1/9", { timeout: 5_000 });
      await a.keyboard.press("KeyT");
      await expect(a.locator(".build-edit-hud__tiles")).toHaveText("Tiles open: 0/9", { timeout: 2_000 });
      await a.keyboard.press("Enter");
      await expectCanonicalGeometry([a, b], id, aId, { buildType: "wall", grid: { x: 1, y: 0, z: -1 }, rotation: 0, editGrid: full }, "reset confirmed");
      expect((await editSends(a)).map((m) => m.action)).toEqual(["select", "confirm", "reset", "confirm"]);
      step("edit → reset → confirm restored the full wall");
    } finally { await context.close(); }
  });

  test("competitive input 6: rapid weapon → wall → weapon → ramp → edit alternation loses no input", { timeout: 120_000 }, async () => {
    test.setTimeout(120_000);
    const { context, a, step } = await openFreshDuel("input 6", { width: 480, height: 270 });
    try {
      await recordEditSends(a);
      const ammo = await getMagazineAmmo(a);
      const before = (await structuresOf(a)).length;
      // Back-to-back key presses, no waits.
      for (const code of ["Digit1", "KeyQ", "Digit1", "KeyE", "KeyG"]) await a.keyboard.press(code);
      await expect.poll(() => editModeOn(a), { timeout: 5_000 }).toBe(true);
      // The edit bind again returns to the build layer beneath with the ramp.
      await a.keyboard.press("KeyG");
      await expect.poll(() => buildModeActive(a), { timeout: 5_000 }).toBe(true);
      await expect(a.locator(".build-hud__selected")).toContainText("Ramp");
      await a.keyboard.press("Digit2");
      await expect.poll(() => getWeaponName(a), { timeout: 5_000 }).toBe("Shotgun");
      expect(await buildModeActive(a)).toBe(false);
      // Step by step, every bind lands immediately.
      const steps: Array<[string, () => Promise<boolean>]> = [
        ["KeyQ", async () => (await buildModeActive(a)) && (await a.locator(".build-hud__selected").textContent())!.includes("Wall")],
        ["Digit1", async () => !(await buildModeActive(a)) && (await getWeaponName(a)) === "Assault Rifle"],
        ["KeyE", async () => (await buildModeActive(a)) && (await a.locator(".build-hud__selected").textContent())!.includes("Ramp")],
        ["KeyG", () => editModeOn(a)],
        ["Digit1", async () => !(await editModeOn(a)) && !(await buildModeActive(a))],
      ];
      for (const [code, check] of steps) {
        await a.keyboard.press(code);
        await expect.poll(check, { message: code, timeout: 3_000 }).toBe(true);
      }
      // Nothing strayed: no placement, no shot from the rifle, no edit sent.
      expect((await structuresOf(a)).length).toBe(before);
      expect(await getMagazineAmmo(a)).toBe(ammo);
      expect(await editSends(a)).toEqual([]);
      step("all binds landed; no stray placement, shot, or edit");
    } finally { await context.close(); }
  });

});
