/**
 * Camera rotation continuity (the "rotates a little, then snaps" report).
 *
 * The camera yaw is driven only by relative pointer-lock deltas
 * (`applyLook`): it is wrapped, never clamped; only pitch is clamped. Every
 * frame, the rendered view direction must turn by exactly the delivered
 * mouse motion × sensitivity — across the ±π wrap, through repeated full
 * turns, for rapid large deltas and for low-frame-rate batches. Nothing else
 * in the runtime may write the camera's orientation (no authoritative
 * snapshot, reconciliation, or mode transition), and corrupt single-event
 * spikes are dropped by the input manager before they reach the camera.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core";
import { ThirdPersonCameraController } from "./ThirdPersonCameraController";
import { THIRD_PERSON_CAMERA } from "./cameraConfig";
import { InputManager, LOOK_SPIKE_MAX_PX_PER_MS, LOOK_SPIKE_MIN_PX } from "../input/InputManager";

const S = THIRD_PERSON_CAMERA.mouseSensitivity;
const FEET = new Vector3(0, 0, 0);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The rendered view yaw (from the Babylon camera's position → target). */
function viewYaw(controller: ThirdPersonCameraController): number {
  controller.update(FEET);
  const cam = controller.getCamera();
  const t = cam.getTarget();
  return Math.atan2(t.x - cam.position.x, -(t.z - cam.position.z));
}

describe("camera yaw continuity", () => {
  let engine: NullEngine;
  let controller: ThirdPersonCameraController;
  beforeEach(() => {
    engine = new NullEngine();
    controller = new ThirdPersonCameraController(new Scene(engine));
  });
  afterEach(() => { controller.dispose(); engine.dispose(); });

  /** Applies per-frame deltas; asserts each frame turns by exactly −dx·S. */
  const turn = (deltas: number[]) => {
    let previous = viewYaw(controller);
    for (const dx of deltas) {
      controller.applyLook(dx, 0);
      const now = viewYaw(controller);
      expect(Math.abs(wrap(now - previous - -dx * S))).toBeLessThan(1e-9);
      expect(Math.abs(now)).toBeLessThanOrEqual(Math.PI + 1e-12); // wrapped, finite
      previous = now;
    }
  };

  it("is continuous across the ±π wrap in both directions", () => {
    controller.applyLook(-(Math.PI - 0.01) / S, 0); // just short of +π
    turn([-10, -10, -10, -10]); // crosses +π → −π
    turn([10, 10, 10, 10, 10, 10, 10, 10]); // and back
  });

  it("stays continuous through repeated full turns (360°, 720°, both ways)", () => {
    const perTurn = Math.round((2 * Math.PI) / S); // ≈ 2856 px per 360°
    const right = Array(Math.round((2 * perTurn) / 40)).fill(40); // two full turns right
    const left = Array(Math.round(perTurn / 20)).fill(-80); // more than a turn left, big steps
    const start = viewYaw(controller); // includes the constant shoulder-aim offset
    turn(right);
    turn(left);
    // The view turned by exactly the summed motion (wrapped): no drift, no snap.
    const total = [...right, ...left].reduce((a, b) => a + b, 0);
    expect(Math.abs(wrap(viewYaw(controller) - start - -total * S))).toBeLessThan(1e-6);
  });

  it("applies rapid large deltas and low-frame-rate batches in full (no clamping of yaw)", () => {
    turn([900, -1400, 2856, 640, -3000]); // flicks, a 360° in one frame, more
  });

  it("clamps only pitch", () => {
    controller.applyLook(0, -1e6);
    expect(controller.getPitch()).toBeCloseTo(THIRD_PERSON_CAMERA.maximumPitch, 9);
    controller.applyLook(0, 1e6);
    expect(controller.getPitch()).toBeCloseTo(THIRD_PERSON_CAMERA.minimumPitch, 9);
    turn([50, 50]);
  });
});

describe("nothing else writes the camera orientation", () => {
  it("the camera exposes no yaw/pitch setter and the runtime only feeds it relative look", () => {
    const camera = readFileSync(new URL("./ThirdPersonCameraController.ts", import.meta.url), "utf8");
    expect(camera).not.toMatch(/public set(Yaw|Pitch|Orientation|Rotation)\(/);
    expect(camera.match(/this\.yaw\s*[-+]?=/g)).toEqual(["this.yaw -=", "this.yaw ="]); // applyLook + its wrap
    const runtime = readFileSync(new URL("../GameRuntime.ts", import.meta.url), "utf8");
    const calls = new Set([...runtime.matchAll(/this\.cameraController\.([a-zA-Z]+)\(/g)].map((m) => m[1]));
    // Authoritative state / reconciliation / mode transitions never reach the
    // camera's orientation: the only orientation input is applyLook.
    expect([...calls].sort()).toEqual(["applyLook", "getAimDirection", "getCamera", "getPitch", "getYaw", "setBuildMode", "setCrouchDip", "setObstacles", "setPitchOffset", "setTransientVerticalOffset", "update"]);
    expect(runtime).toContain("const ld=this.inputManager.consumeLookDelta();this.cameraController.applyLook(ld.x,ld.y);");
  });
});

describe("pointer-lock look input guard", () => {
  type Listener = (event: unknown) => void;
  class Target {
    private readonly l = new Map<string, Set<Listener>>();
    addEventListener(t: string, f: Listener) { (this.l.get(t) ?? this.l.set(t, new Set()).get(t)!).add(f); }
    removeEventListener(t: string, f: Listener) { this.l.get(t)?.delete(f); }
    dispatch(t: string, e: unknown) { this.l.get(t)?.forEach((f) => f(e)); }
  }
  let input: InputManager;
  let win: Target;
  let doc: Target;
  let canvas: Target;
  let lockElement: unknown = null;
  beforeEach(() => {
    win = new Target(); doc = new Target(); canvas = new Target(); lockElement = null;
    (globalThis as any).window = { addEventListener: win.addEventListener.bind(win), removeEventListener: win.removeEventListener.bind(win) };
    (globalThis as any).document = { hidden: false, get pointerLockElement() { return lockElement; }, addEventListener: doc.addEventListener.bind(doc), removeEventListener: doc.removeEventListener.bind(doc) };
    input = new InputManager(canvas as unknown as HTMLCanvasElement);
    lockElement = canvas;
    doc.dispatch("pointerlockchange", {});
  });
  afterEach(() => input.dispose());
  const move = (dx: number, timeStamp: number) => win.dispatch("mousemove", { movementX: dx, movementY: 0, timeStamp });

  it("applies fast flicks and low-FPS batches in full", () => {
    move(40, 1000);
    move(640, 1016); // a very fast flick, one 60 FPS frame later
    move(1400, 1083); // a low-FPS (15 FPS) batch
    expect(input.consumeLookDelta().x).toBe(2080);
    expect(input.getLookStats()).toMatchObject({ events: 3, rejectedSpikes: 0, maxEventPx: 1400 });
  });

  it("drops a physically impossible single-event spike and keeps the motion around it", () => {
    move(30, 2000);
    move(-1800, 2001); // 1800 px in 1 ms: corrupt sample
    move(30, 2017);
    expect(input.consumeLookDelta().x).toBe(60);
    const stats = input.getLookStats();
    expect(stats.rejectedSpikes).toBe(1);
    expect(stats.maxRejectedPx).toBe(1800);
    expect(LOOK_SPIKE_MIN_PX / LOOK_SPIKE_MAX_PX_PER_MS).toBeLessThan(16); // a 60 FPS frame is never too fast for a real flick of that size
  });

  it("counts pointer-lock acquisitions and ignores motion while unlocked", () => {
    expect(input.getLookStats().lockAcquisitions).toBe(1);
    lockElement = null;
    doc.dispatch("pointerlockchange", {});
    move(500, 5000);
    expect(input.consumeLookDelta().x).toBe(0);
  });
});
