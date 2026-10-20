/**
 * Camera-rotation diagnostic probe (real headed Chromium, real pointer lock).
 *
 * Loads the production app against an in-process production game server,
 * acquires REAL pointer lock with a real click, drives genuine mouse motion
 * through the browser input pipeline (`page.mouse.move`), and records every
 * raw `movementX` the page receives plus the camera's actual yaw each frame.
 * A "snap" is a frame whose camera yaw change does not match the raw motion
 * delivered in that frame.
 *
 * Run (needs a display, e.g. `Xvfb :97 &` then DISPLAY=:97):
 *   node_modules/.bin/tsx ../web/tests/stress/cameraProbe.ts [out.json]
 * from apps/game-server, after `pnpm build`.
 */
import { chromium } from "@playwright/test";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer, startServer, shutdownServer } from "../../../game-server/src/server.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, "../../dist");
const GAME_PORT = 25695;
const STATIC_PORT = 41795;
const APP_URL = `http://127.0.0.1:${STATIC_PORT}/?devdiag=1&gameServer=ws://127.0.0.1:${GAME_PORT}`;
const OUT = process.argv[2] ?? "/tmp/camera-probe.json";

async function main() {
  const staticServer = http.createServer((req, res) => {
    const urlPath = (req.url ?? "/").split("?")[0] || "/";
    const file = path.join(WEB_DIST, urlPath === "/" ? "index.html" : urlPath);
    try {
      const body = readFileSync(file);
      const type = file.endsWith(".js") ? "application/javascript" : file.endsWith(".wasm") ? "application/wasm" : file.endsWith(".css") ? "text/css" : "text/html";
      res.writeHead(200, { "Content-Type": type }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((r) => staticServer.listen(STATIC_PORT, "127.0.0.1", () => r()));
  const { server } = await startServer(GAME_PORT, createServer());
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
    await context.addInitScript("globalThis.__name = (f) => f;");
    const page = await context.newPage();
    await page.goto(APP_URL);
    await page.waitForFunction(() => Boolean((window as any).__buildshiftNetworking?.client?.deref()?.sessionId), undefined, { timeout: 30_000 });
    // Record raw events + per-frame camera yaw.
    await page.evaluate(() => {
      const w = window as any;
      w.__probe = { events: [] as number[][], frames: [] as number[][] };
      window.addEventListener("mousemove", (e) => w.__probe.events.push([performance.now(), e.movementX, e.movementY, document.pointerLockElement ? 1 : 0]), { capture: true });
      const cam = w.__buildshiftEngine.scenes[0].activeCamera;
      const tick = () => {
        const t = cam.getTarget();
        const p = cam.position;
        w.__probe.frames.push([performance.now(), Math.atan2(t.x - p.x, -(t.z - p.z))]);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    // Real pointer lock through a real click on the canvas.
    const box = (await page.locator("canvas.game-canvas").boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => document.pointerLockElement !== null, undefined, { timeout: 10_000 }).catch(() => {});
    const locked = await page.evaluate(() => document.pointerLockElement !== null);
    console.log(`pointer locked: ${locked}`);
    // Fast repeated 360° turns: one turn = 2π / 0.0022 ≈ 2856 px.
    let x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    for (let turn = 0; turn < 4; turn++) {
      for (let i = 0; i < 20; i++) {
        x += 143 * (turn % 2 === 0 ? 1 : -1);
        await page.mouse.move(x, y, { steps: 1 });
        await sleep(8);
      }
    }
    await sleep(300);
    const data = await page.evaluate(() => (window as any).__probe);
    writeFileSync(OUT, JSON.stringify({ locked, ...data }));
    const big = data.events.filter((e: number[]) => Math.abs(e[1]) > 400);
    console.log(`events ${data.events.length}, frames ${data.frames.length}, events with |movementX|>400: ${big.length}`);
  } finally {
    await browser.close();
    await shutdownServer(server).catch(() => {});
    staticServer.close();
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
