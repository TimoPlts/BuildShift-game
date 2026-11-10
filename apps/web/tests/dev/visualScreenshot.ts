/**
 * BuildShift — developer visual-regression screenshot harness (Batch 2D D).
 *
 * Repeatable MANUAL capture over the REAL production path:
 *   built web client (Babylon + Rapier + Colyseus SDK, `apps/web/dist`)
 *   → authoritative game server (real `createServer`/`startServer`, in-process)
 *   in headless Chromium, driven by real browser input bindings.
 *
 * It captures representative frames for the visual-polish review targets:
 *   01-idle-local        local humanoid, idle
 *   02-run-local         local humanoid, running
 *   03-opponent          opponent character (second live client, idle at spawn)
 *   04-weapon-ar         assault rifle equipped (model + HUD)
 *   05-weapon-shotgun    shotgun equipped (model + HUD)
 *   06-build             wall + floor + ramp + cone placed (build layer)
 *   07-build-edited      a placed piece edited via the live edit flow
 *   08-arena-overview    overhead view (dev-hook camera override, one shot)
 *   09-hud-active        active-round HUD (weapon/ammo/vitals/round timer)
 *
 * Scene diagnostics are captured alongside every shot: mesh / active-mesh /
 * material / texture / geometry counts and approximate draw-call metrics
 * (`engine._drawCalls`) — read-only, via the EXISTING `?devdiag=1` dev hook
 * (`window.__buildshiftEngine`). No production code is modified by this file.
 *
 * Screenshots and the JSON report are written to the gitignored development
 * artifact directory `apps/web/tests/dev/artifacts/`. No pixel-diff CI tests
 * are added by design.
 *
 * Prerequisites:
 *   - `pnpm install`
 *   - `pnpm --filter @buildshift/web build` (serves `apps/web/dist`)
 *
 * Run (from `apps/game-server`, mirroring the stress harness):
 *   node_modules/.bin/tsx ../web/tests/dev/visualScreenshot.ts
 *
 * Options (environment):
 *   BS_VISUAL_GAME_PORT    game server port (default 25783)
 *   BS_VISUAL_STATIC_PORT  static dist server port (default 41883)
 *   BS_VISUAL_TIMEOUT_MS   overall watchdog (default 150000)
 *
 * Exit code 0 = every scenario captured and verified.
 * NOT part of `pnpm test:browser` (file name does not match
 * `*.browser.test.ts`).
 */
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer, startServer, shutdownServer } from "../../../game-server/src/server.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../../..");
const WEB_DIST = path.join(ROOT, "apps/web/dist");
const GAME_PORT = Number(process.env.BS_VISUAL_GAME_PORT ?? 25783);
const STATIC_PORT = Number(process.env.BS_VISUAL_STATIC_PORT ?? 41883);
const APP_URL = `http://127.0.0.1:${STATIC_PORT}/?devdiag=1&gameServer=ws://127.0.0.1:${GAME_PORT}`;
const ARTIFACTS_DIR = path.join(__dirname, "artifacts");
const REPORT_PATH = path.join(ARTIFACTS_DIR, "visual-report.json");

const wallStart = Date.now();
const t0 = performance.now();
const ts = () => ((performance.now() - t0) / 1000).toFixed(1).padStart(6);
const log = (msg: string) => console.log(`[visual ${ts()}s] ${msg}`);

// ─── Bounded runtime watchdog ────────────────────────────────────────────────

const WATCHDOG_MS = Number(process.env.BS_VISUAL_TIMEOUT_MS ?? 150_000);
const watchdog = setTimeout(() => {
  console.error(`[visual] WATCHDOG: exceeded ${WATCHDOG_MS} ms — forcing exit`);
  process.exit(2);
}, WATCHDOG_MS);
watchdog.unref?.();

// ─── Static dist server (same approach as the stress harness) ────────────────

function startStatic(): Promise<http.Server> {
  const MIME: Record<string, string> = {
    ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
    ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png",
    ".svg": "image/svg+xml", ".woff2": "font/woff2",
  };
  const server = http.createServer((req, res) => {
    const urlPath = (req.url ?? "/").split("?")[0] || "/";
    const file = path.join(WEB_DIST, urlPath === "/" ? "index.html" : urlPath);
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  return new Promise((resolve) => server.listen(STATIC_PORT, "127.0.0.1", () => resolve(server)));
}

// ─── Input helpers (real production input path; mirrors the browser suite) ──

/**
 * Presses one gameplay bind through the production input path:
 *  - keyboard codes via the real keyboard,
 *  - the side mouse buttons (Mouse3/Mouse4) via synthetic DOM mousedown/mouseup
 *    with `button` 3/4 on the game canvas — the same pattern the production
 *    suite uses for the left button. Note: CDP `Input.dispatchMouseEvent` with
 *    `button: "back"|"forward"` is NOT used: in the installed headless
 *    Chromium build the side buttons also drive browser-level history
 *    navigation (the page silently goes back to about:blank).
 */
async function pressCode(page: Page, code: string): Promise<void> {
  if (/^Mouse\d$/.test(code)) {
    const button = Number(code.slice(5)) - 1; // MouseN → DOM button N-1
    await page.evaluate((btn: number) => {
      const el = (document.pointerLockElement ?? document.querySelector("canvas.game-canvas")) as HTMLElement | null;
      if (!el) return;
      el.dispatchEvent(new MouseEvent("mousedown", { button: btn, bubbles: true }));
    }, button);
    await sleep(100);
    await page.evaluate((btn: number) => {
      const el = (document.pointerLockElement ?? document.querySelector("canvas.game-canvas")) as HTMLElement | null;
      if (!el) return;
      el.dispatchEvent(new MouseEvent("mouseup", { button: btn, bubbles: true }));
    }, button);
    return;
  }
  await page.keyboard.press(code);
}

/** Camera look via a synthetic pointer-lock mousemove (suite's `lookBy`). */
const lookBy = async (page: Page, dx: number, dy: number): Promise<void> => {
  await page.evaluate(({ dx, dy }) => {
    document.dispatchEvent(new MouseEvent("mousemove", { movementX: dx, movementY: dy, bubbles: true }));
  }, { dx, dy });
};

/**
 * Fake pointer lock — identical to the production browser suite's
 * `ensurePointerLock`: in headless Chromium requestPointerLock() can cause
 * CDP hangs, so the InputManager's pointerLocked flag is set via a synthetic
 * pointerlockchange event over the game canvas.
 */
async function ensurePointerLock(page: Page): Promise<void> {
  const locked = await page.evaluate(() => document.pointerLockElement !== null);
  if (!locked) {
    await page.evaluate(() => {
      const canvas = document.querySelector("canvas.game-canvas");
      if (!canvas) return;
      // NOTE: tsx (esbuild keepNames) wraps every nameable function literal in
      // this source in a `__name(...)` helper that does not exist in the page.
      // The getter is therefore built from a runtime string, which is untouched.
      const makeGetter = new Function("c", "return function () { return c; }");
      Object.defineProperty(document, "pointerLockElement", { get: makeGetter(canvas), configurable: true });
      document.dispatchEvent(new Event("pointerlockchange"));
    });
    await sleep(50);
  }
}

/**
 * Left-click on the game canvas via SYNTHETIC DOM events — NOT Playwright's
 * virtual mouse. A real mouse move would emit nonzero movement deltas that
 * the (fake) pointer-lock look pipeline would consume and tilt the camera.
 */
async function clickLeft(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = (document.pointerLockElement ?? document.querySelector("canvas.game-canvas")) as HTMLElement | null;
    if (!el) return;
    el.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
  });
  await sleep(100);
  await page.evaluate(() => {
    const el = (document.pointerLockElement ?? document.querySelector("canvas.game-canvas")) as HTMLElement | null;
    if (!el) return;
    el.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true }));
  });
}

async function holdKey(page: Page, code: string, ms: number): Promise<void> {
  await page.keyboard.down(code);
  await sleep(ms);
  await page.keyboard.up(code);
}

// ─── Read-only scene diagnostics via the existing ?devdiag=1 hook ───────────

interface SceneStats {
  meshes: number;
  activeMeshes: number;
  materials: number;
  textures: number;
  geometries: number;
  structureRoots: number;
  drawCalls: { current: number; last: number } | null;
  cameraPos: [number, number, number] | null;
  cameraTarget: [number, number, number] | null;
}

// Note: every function passed to page.evaluate / waitForFunction must be an
// ANONYMOUS arrow constant. tsx (esbuild keepNames) rewrites named function
// declarations to `var f = __name((...)=>{...}, "f")`, and Playwright
// stringifies the assigned value — the `__name` helper does not exist in the
// page, so named declarations would throw `ReferenceError: __name is not
// defined` when evaluated in the browser.
const sceneDiagnostics = async (page: Page): Promise<SceneStats> => {
  return page.evaluate(() => {
    const w = window as any;
    const engine = w.__buildshiftEngine;
    if (!engine) return null as unknown as SceneStats;
    const scene = engine.scenes[0];
    const cam = scene.activeCamera;
    const structures = (scene.meshes ?? []).filter((m: any) => !m.isDisposed() && m.isEnabled() && /^structure-/.test(m.name));
    return {
      meshes: scene.meshes?.length ?? 0,
      activeMeshes: (scene.meshes ?? []).filter((m: any) => !m.isDisposed() && m.isEnabled()).length,
      materials: scene.materials?.length ?? 0,
      textures: scene.textures?.length ?? 0,
      geometries: scene.geometries?.length ?? 0,
      structureRoots: structures.length,
      drawCalls: engine._drawCalls ? { current: engine._drawCalls.current, last: engine._drawCalls.last } : null,
      cameraPos: cam ? [cam.position.x, cam.position.y, cam.position.z] : null,
      cameraTarget: cam?.getTarget ? [cam.getTarget().x, cam.getTarget().y, cam.getTarget().z] : null,
    };
  });
};

/**
 * Captures one named frame from `page`: hides the dev diagnostics overlay
 * (presentational DOM only, so the review frames stay clean), waits one beat
 * for the next rendered frame, screenshots, and collects scene diagnostics.
 */
const capture = async (page: Page, name: string): Promise<string> => {
  await page.evaluate(() => {
    document.querySelectorAll(".devdiag-overlay").forEach((el) => el.remove());
  });
  await sleep(120); // let at least one more frame render after overlay removal
  const file = path.join(ARTIFACTS_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  const scene = await sceneDiagnostics(page);
  return file;
};

interface ScenarioResult {
  name: string;
  file: string;
  ok: boolean;
  notes: string[];
  scene: SceneStats | null;
}

// ─── State probes (real production HUD / state, no faked values) ────────────

const matchPhase = async (page: Page): Promise<string | null> => {
  return page.evaluate(() => {
    const w = window as any;
    const client = w.__buildshiftNetworking?.client?.deref?.();
    const st = client?.room?.state;
    if (!st) return null;
    return st.match?.matchPhase ?? st.matchPhase ?? null;
  });
};

const playerCount = async (page: Page): Promise<number> => {
  return page.evaluate(() => {
    const w = window as any;
    const st = w.__buildshiftNetworking?.client?.deref?.()?.room?.state;
    const players = st?.players;
    return players ? (players.size ?? Object.keys(players).length ?? 0) : 0;
  });
};



/**
 * Dev-only close-up capture: temporarily overrides the active camera via
 * onBeforeRenderObservable (same pattern as 08-arena-overview) to frame the
 * subject. Camera poses, relative to the subject's authoritative position:
 *   - "opponent" (03): frontal — 2.5 m toward +Z, 1.7 m up
 *   - "local" (04/05): three-quarter — 2.0 m toward −X, 1.7 m up, 2.0 m toward +Z
 *     (straight-on foreshortening made the attached weapon read as a small
 *     dark block, so the weapon shots use the angled pose)
 * Both poses look at chest height (subject y+1.0). The observer is removed in
 * a finally block so the third-person controller re-claims the camera.
 *
 * @param subjectId "local" | "opponent" — which player's authoritative
 *                 x/y/z from room state to use as the framing subject.
 */
const captureCloseUp = async (
  page: Page,
  name: string,
  subjectId: "local" | "opponent",
): Promise<{ file: string; subjectPos: [number, number, number] | null; hook: boolean }> => {
  // Read the subject's authoritative position from room state
  const subjectPos = await page.evaluate((sid: "local" | "opponent") => {
    const w = window as any;
    const client = w.__buildshiftNetworking?.client?.deref?.();
    const st = client?.room?.state;
    const players = st?.players;
    if (!players) return null;
    const entries: Array<[string, any]> =
      typeof players.get === "function" && typeof (players as any).keys === "function"
        ? Array.from((players as any).keys()).map((k: string) => [k, players.get(k)] as [string, any])
        : Object.entries(players);
    const localId = client?.sessionId ?? null;
    let target: any;
    if (sid === "local") {
      target = entries.find(([id]) => id === localId)?.[1];
    } else {
      target = (entries.find(([id]) => id !== localId) ?? entries[0])?.[1];
    }
    if (!target) return null;
    const p = (typeof target.x === "number" ? target : target.position) as any;
    if (!p || typeof p.x !== "number") return null;
    return [p.x, p.y, p.z] as [number, number, number];
  }, subjectId);

  if (!subjectPos) {
    log(`captureCloseUp(${name}): subject position unavailable, falling back to normal capture`);
    const file = await capture(page, name);
    return { file, subjectPos: null, hook: false };
  }

  // Install the camera override (same pattern as 08). Local weapon shots
  // (04/05) use the three-quarter pose; 03 keeps the frontal pose.
  const camOffset: [number, number, number] =
    subjectId === "local" ? [-2.0, 1.7, 2.0] : [0, 1.7, 2.5];
  const hook = await page.evaluate(({ pos, off }: { pos: [number, number, number]; off: [number, number, number] }) => {
    const w = window as any;
    const scene = w.__buildshiftEngine?.scenes?.[0];
    const cam = scene?.activeCamera;
    if (!scene || !cam) return false;
    const Vector3ctor = cam.position.constructor;
    const [sx, sy, sz] = pos;
    (w as any).__visualCloseUpObserver = scene.onBeforeRenderObservable.add(() => {
      // Camera: subject position + per-scenario offset
      cam.position.copyFrom(new Vector3ctor(sx + off[0], sy + off[1], sz + off[2]));
      // Look at chest: subject y + 1.0
      cam.setTarget(new Vector3ctor(sx, sy + 1.0, sz));
    });
    return true;
  }, { pos: subjectPos, off: camOffset });

  try {
    await sleep(400);
    const file = await capture(page, name);
    return { file, subjectPos, hook };
  } finally {
    // Remove the observer immediately so the camera controller re-claims
    await page.evaluate(() => {
      const w = window as any;
      const scene = w.__buildshiftEngine?.scenes?.[0];
      scene?.onBeforeRenderObservable?.remove((w as any).__visualCloseUpObserver);
      delete (w as any).__visualCloseUpObserver;
    });
    await sleep(150);
  }
};

const weaponName = async (page: Page): Promise<string> => {
  return page.evaluate(() => document.querySelector(".weapon-hud__name")?.textContent ?? "");
};

const readHud = async (page: Page): Promise<Record<string, string>> => {
  return page.evaluate(() => {
    return {
      weapon: document.querySelector(".weapon-hud__name")?.textContent?.trim() ?? "",
      ammo: document.querySelector(".weapon-hud__ammo-magazine")?.textContent?.trim() ?? "",
      capacity: document.querySelector(".weapon-hud__ammo-capacity")?.textContent?.trim() ?? "",
      health: document.querySelector(".combat-vitals-hud__row .combat-vitals-hud__value")?.textContent?.trim() ?? "",
      roundTimer: document.querySelector(".match-hud__timer-value")?.textContent?.trim() ?? "",
      hudPresent: document.querySelector(".game-hud") ? "yes" : "no",
    };
  });
};

/** Build HUD probe (real production DOM): mode label, selected piece, validity, aimed cell. */
const buildHudState = async (page: Page): Promise<Record<string, string>> => {
  return page.evaluate(() => {
    return {
      mode: document.querySelector(".build-hud__mode-label")?.textContent?.trim() ?? "",
      selected: document.querySelector(".build-hud__selected")?.textContent?.trim() ?? "",
      validity: document.querySelector(".build-hud__validity")?.textContent?.trim() ?? "",
      grid: document.querySelector(".build-hud__grid")?.textContent?.trim() ?? "",
    };
  });
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  if (!existsSync(WEB_DIST)) {
    console.error(`[visual] ${WEB_DIST} missing — run: pnpm --filter @buildshift/web build`);
    return 1;
  }
  mkdirSync(ARTIFACTS_DIR, { recursive: true });

  const staticServer = await startStatic();
  const { server: gameServer } = await startServer(GAME_PORT, createServer());
  const browser = await chromium.launch({ headless: true });
  const results: ScenarioResult[] = [];
  let exitCode = 0;

  const record = (name: string, file: string, notes: string[], ok: boolean) => {
    results.push({ name, file, ok, notes, scene: null });
    if (!ok) exitCode = 1;
  };
  const attachScene = async (name: string, page: Page) => {
    const entry = results[results.length - 1];
    if (entry?.name === name) entry.scene = await sceneDiagnostics(page).catch(() => null);
  };

  const contextA: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const contextB: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const pageEvents: string[] = [];
  for (const [pn, pg] of [["A", a], ["B", b]] as const) {
    pg.on("crash", () => pageEvents.push(`${pn}:crash`));
    pg.on("pageerror", (e) => pageEvents.push(`${pn}:pageerror:${e.message.slice(0, 200)}`));
    pg.on("console", (m) => { if (m.type() === "error") pageEvents.push(`${pn}:console:${m.text().slice(0, 200)}`); });
    pg.on("framenavigated", (f) => { if (f === pg.mainFrame()) pageEvents.push(`${pn}:navigated:${f.url().slice(0, 120)}`); });
  }

  try {
    // ── Real setup: two live clients → authoritative room → round start ──
    log("opening clients (A = shooter/screenshotted, B = idle opponent)");
    await a.goto(APP_URL, { waitUntil: "load" });
    await b.goto(APP_URL, { waitUntil: "load" });

    await a.waitForFunction(
      () => {
        const w = window as any;
        const st = w.__buildshiftNetworking?.client?.deref?.()?.room?.state;
        const phase = st?.match?.matchPhase ?? st?.matchPhase;
        return phase === "IN_PROGRESS";
      },
      undefined,
      { timeout: 30_000 },
    );
    await a.waitForFunction(
      () => {
        const w = window as any;
        const st = w.__buildshiftNetworking?.client?.deref?.()?.room?.state;
        const players = st?.players;
        const n = players ? (players.size ?? Object.keys(players).length ?? 0) : 0;
        return n >= 2;
      },
      undefined,
      { timeout: 15_000 },
    );
    log(`round IN_PROGRESS with ${await playerCount(a)} players in room`);
    await sleep(1_000); // settle: character load, first snapshots, camera placement

    await ensurePointerLock(a);

    // 01 — local humanoid, idle
    {
      const file = await capture(a, "01-idle-local");
      const notes = [`phase=${await matchPhase(a)}`, `players=${await playerCount(a)}`];
      record("01-idle-local", file, notes, (await matchPhase(a)) === "IN_PROGRESS");
      await attachScene("01-idle-local", a);
      log(`01-idle-local → ${path.basename(file)}`);
    }

    // 02 — local humanoid, running (mid-hold screenshot)
    {
      await a.keyboard.down("KeyW");
      await sleep(650);
      const file = await capture(a, "02-run-local");
      await a.keyboard.up("KeyW");
      const hud = await readHud(a);
      record("02-run-local", file, [`held KeyW 650ms before frame`, `weapon=${hud.weapon}`], true);
      await attachScene("02-run-local", a);
      log(`02-run-local → ${path.basename(file)}`);
    }

    // 03 — opponent character: dev-only close-up via onBeforeRenderObservable
    //      camera override (same pattern as 08). Subject = opponent's
    //      authoritative x/y/z from room state. Camera: 2.5 m +Z, 1.7 m up,
    //      looking at chest (y+1.0).
    {
      await holdKey(a, "KeyD", 1_100); // strafe clear of the center box
      await sleep(250);
      const { file, subjectPos, hook } = await captureCloseUp(a, "03-opponent", "opponent");
      const posNote = subjectPos ? `(${subjectPos[0].toFixed(2)}, ${subjectPos[1].toFixed(2)}, ${subjectPos[2].toFixed(2)})` : "n/a";
      record("03-opponent", file, [`dev-only close-up; opponent subject=${posNote}; camera override active=${hook} (removed after shot)`], hook);
      await attachScene("03-opponent", a);
      log(`03-opponent → ${path.basename(file)} (subject=${posNote}, hook=${hook})`);
    }

    // 04 — assault rifle equipped: dev-only close-up of local player holding
    //      the rifle. Subject = local player's authoritative x/y/z. Camera:
    //      three-quarter (−2.0 x, +1.7 y, +2.0 z) so the weapon is not seen
    //      straight-on.
    {
      await pressCode(a, "Digit1");
      await sleep(450);
      const name = await weaponName(a);
      const { file, subjectPos, hook } = await captureCloseUp(a, "04-weapon-ar", "local");
      const posNote = subjectPos ? `(${subjectPos[0].toFixed(2)}, ${subjectPos[1].toFixed(2)}, ${subjectPos[2].toFixed(2)})` : "n/a";
      record("04-weapon-ar", file, [`dev-only close-up; local subject=${posNote}; HUD weapon="${name}"; camera override active=${hook} (removed after shot)`], /Assault/i.test(name) && hook);
      await attachScene("04-weapon-ar", a);
      log(`04-weapon-ar → ${path.basename(file)} (HUD: ${name}, subject=${posNote})`);
    }

    // 05 — shotgun equipped: dev-only close-up of local player holding the
    //      shotgun. Subject = local player's authoritative x/y/z. Camera:
    //      three-quarter (−2.0 x, +1.7 y, +2.0 z) so the weapon is not seen
    //      straight-on.
    {
      await pressCode(a, "Digit2");
      await sleep(550);
      const name = await weaponName(a);
      const { file, subjectPos, hook } = await captureCloseUp(a, "05-weapon-shotgun", "local");
      const posNote = subjectPos ? `(${subjectPos[0].toFixed(2)}, ${subjectPos[1].toFixed(2)}, ${subjectPos[2].toFixed(2)})` : "n/a";
      record("05-weapon-shotgun", file, [`dev-only close-up; local subject=${posNote}; HUD weapon="${name}"; camera override active=${hook} (removed after shot)`], /Shotgun/i.test(name) && hook);
      await attachScene("05-weapon-shotgun", a);
      log(`05-weapon-shotgun → ${path.basename(file)} (HUD: ${name}, subject=${posNote})`);
    }

    // 06 — build: wall / floor / ramp / cone, each via its real bind.
    // The placement preview needs the aim ray to hit the build plane of the
    // player's layer (or an existing structure surface): a level aim has no
    // plane candidate (`no_candidate`), so pitch down at the floor in front
    // first — exactly what a player does — then pan to a fresh cell before
    // each next piece so the four pieces never compete for one slot.
    {
      const notes: string[] = [];
      await lookBy(a, 0, 240); // pitch down ≈ 25°: aim at the floor ahead
      await sleep(250);
      const pieces: Array<[string, string]> = [
        ["KeyQ", "floor"],
        ["Mouse3", "wall"], // MOUSE_BUTTON_4 = "Mouse3", DOM button 3
        ["Mouse4", "ramp"], // MOUSE_BUTTON_5 = "Mouse4", DOM button 4
        ["KeyF", "cone"],
      ];
      let roots = 0;
      for (let i = 0; i < pieces.length; i++) {
        const [code, label] = pieces[i];
        if (i > 0) {
          await lookBy(a, -140, 0); // pan to an adjacent free cell
          await sleep(200);
        }
        // The piece bind SELECTS the piece and enters build mode; placement
        // is the routed primary action (LMB). Wait for the HUD to confirm
        // the selection, then place, then read the structure count back.
        await pressCode(a, code);
        let hud = await buildHudState(a);
        for (let tries = 0; tries < 3 && !hud.selected.toLowerCase().includes(label); tries++) {
          await sleep(300);
          hud = await buildHudState(a);
        }
        await clickLeft(a);
        await sleep(350);
        roots = (await sceneDiagnostics(a))?.structureRoots ?? 0;
        notes.push(`${label} → roots=${roots} mode="${hud.mode}" ${hud.validity} grid=${hud.grid}`);
      }
      const file = await capture(a, "06-build");
      notes.push(`structure roots in scene=${roots}`);
      record("06-build", file, notes, roots >= 4);
      await attachScene("06-build", a);
      log(`06-build → ${path.basename(file)} (${roots} structure roots)`);
      // return to weapon mode so the edited-build flow starts from weapon mode
      await pressCode(a, "Digit1");
      await sleep(300);
    }

    // 07 — edited build: real edit flow (E → LMB tile select → Enter confirm).
    // Pan back onto the floor piece placed first in scenario 06 (it is
    // 3 × 140 px of pan behind the current aim) so the edit aim ray hits a
    // live owned structure before `edit` locks it.
    {
      await lookBy(a, 420, 0);
      await sleep(250);
      await pressCode(a, "KeyE");
      await sleep(600);
      const target = await a.evaluate(() => document.querySelector(".build-edit-hud__target")?.textContent ?? "");
      const editGrid = await buildHudState(a);
      await clickLeft(a);
      await sleep(400);
      const tiles = await a.evaluate(() => document.querySelector(".build-edit-hud__tiles")?.textContent ?? "");
      await a.keyboard.press("Enter");
      let confirmed = false;
      try {
        await a.locator(".build-edit-hud__feedback--accepted").filter({ hasText: /confirmed/i }).first()
          .waitFor({ timeout: 5_000 });
        confirmed = true;
      } catch {
        confirmed = false;
      }
      await sleep(350);
      const file = await capture(a, "07-build-edited");
      const notes = [`edit target="${target.trim()}"`, `tiles="${tiles.trim()}"`, `confirmed=${confirmed}`, `buildHud=${JSON.stringify(editGrid)}`];
      record("07-build-edited", file, notes, confirmed && target.startsWith("Aim:"));
      await attachScene("07-build-edited", a);
      log(`07-build-edited → ${path.basename(file)} (target="${target.trim()}", confirmed=${confirmed})`);
    }

    // 08 — arena overview: one-shot overhead camera via the existing devdiag
    //      engine hook (presentation-only override; the third-person
    //      controller re-claims the camera the moment the observer is removed)
    {
      const hook = await a.evaluate(() => {
        const w = window as any;
        const scene = w.__buildshiftEngine?.scenes?.[0];
        const cam = scene?.activeCamera;
        if (!scene || !cam) return false;
        const Vector3ctor = cam.position.constructor;
        (w as any).__visualOverviewObserver = scene.onBeforeRenderObservable.add(() => {
          cam.position.copyFrom(new Vector3ctor(0, 30, 14));
          cam.setTarget(new Vector3ctor(0, 0, 0));
        });
        return true;
      });
      await sleep(400);
      const file = await capture(a, "08-arena-overview");
      await a.evaluate(() => {
        const w = window as any;
        const scene = w.__buildshiftEngine?.scenes?.[0];
        scene?.onBeforeRenderObservable?.remove((w as any).__visualOverviewObserver);
        delete (w as any).__visualOverviewObserver;
      });
      await sleep(150);
      record("08-arena-overview", file, [`dev-hook camera override active=${hook} (removed after shot)`], hook);
      await attachScene("08-arena-overview", a);
      log(`08-arena-overview → ${path.basename(file)} (dev-hook override=${hook})`);
    }

    // 09 — active-round HUD: read the real production HUD values, then frame
    {
      const hud = await readHud(a);
      const file = await capture(a, "09-hud-active");
      const ok = hud.hudPresent === "yes" && (await matchPhase(a)) === "IN_PROGRESS" && hud.weapon.length > 0;
      record("09-hud-active", file, [`HUD=${JSON.stringify(hud)}`, `phase=${await matchPhase(a)}`], ok);
      await attachScene("09-hud-active", a);
      log(`09-hud-active → ${path.basename(file)} (weapon=${hud.weapon}, ammo=${hud.ammo}/${hud.capacity}, timer=${hud.roundTimer})`);
    }
  } catch (err) {
    log(`ERROR: ${(err as Error).message}`);
    exitCode = 1;
  }

  finally {
    const report = {
      startedAt: new Date(wallStart).toISOString(),
      generatedAt: new Date().toISOString(),
      runtimeSeconds: (performance.now() - t0) / 1000,
      ports: { game: GAME_PORT, static: STATIC_PORT },
      appUrl: APP_URL,
      viewport: { width: 1280, height: 720 },
      scenarios: results,
      ok: exitCode === 0,
    };
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    log(`report → ${REPORT_PATH}`);
    await browser.close().catch(() => {});
    await new Promise<void>((resolve) => staticServer.close(() => resolve()));
    await shutdownServer(gameServer).catch(() => {});
    clearTimeout(watchdog);
  }

  if (pageEvents.length > 0) log(`page events: ${pageEvents.join(" | ")}`);

  log(`done in ${((performance.now() - t0) / 1000).toFixed(1)}s — exit ${exitCode}`);
  return exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`[visual] fatal: ${err}`);
    clearTimeout(watchdog);
    process.exit(1);
  });
