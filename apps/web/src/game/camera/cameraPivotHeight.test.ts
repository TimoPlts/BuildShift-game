/**
 * Third-person camera pivot height (online follow point).
 *
 * Online, the runtime writes the interpolated predicted pose to the local
 * presentation root in the server's FEET convention (the presentation lifts
 * only the visible body into the capsule envelope). The camera must therefore
 * follow that root as the feet — not subtract the collider half height again,
 * which put the pivot ~0.9 m low. Offline the root is the capsule centre.
 *
 * Pinned here:
 *  - standing pivot = rendered feet + `targetHeight`;
 *  - crouched pivot = rendered feet + `targetHeight` − `crouchDip`;
 *  - standing → crouched → standing eases with no per-frame snap;
 *  - the pivot correction never touches yaw / pitch / aim direction;
 *  - build / edit / weapon mode switches do not move the pivot;
 *  - the runtime feeds the camera (and spectator anchor) this follow point.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core";
import { PLAYER_COLLIDER_HALF_TOTAL_HEIGHT } from "@buildshift/game-config";
import { ThirdPersonCameraController } from "./ThirdPersonCameraController";
import { THIRD_PERSON_CAMERA } from "./cameraConfig";
import { PlayerPresentation } from "../scene/PlayerPresentation";
import { presentationFeetInto } from "../player/presentationFeet";

const { targetHeight, crouchDip } = THIRD_PERSON_CAMERA;
/** A predicted pose standing on a next-layer floor (server feet convention). */
const PREDICTED = { x: 5, y: 3.99, z: -10.68 };
/** The runtime's crouch easing (GameRuntime `_easeCrouch`, CROUCH_EASE = 14). */
/** The orbit pivot (the camera's look target; `getTarget()` refreshes only on render). */
const pivotOf = (c: ThirdPersonCameraController) => (c as unknown as { lookTarget: Vector3 }).lookTarget;
const ease = (current: number, target: number, dt: number) => current + (target - current) * (1 - Math.exp(-14 * dt));

describe("third-person camera pivot height", () => {
  let engine: NullEngine;
  let scene: Scene;
  let camera: ThirdPersonCameraController;
  let body: PlayerPresentation;
  const feet = new Vector3();

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    camera = new ThirdPersonCameraController(scene);
    body = PlayerPresentation.create(scene, "local", "local-player");
  });
  afterEach(() => {
    body.dispose();
    camera.dispose();
    engine.dispose();
  });

  /** One online frame: presentation at the predicted pose, camera follows it. */
  const frame = (pose = PREDICTED, crouchBlend = 0) => {
    body.setCrouchBlend(crouchBlend);
    body.setTransform(pose, camera.getYaw());
    camera.setCrouchDip(crouchBlend * crouchDip);
    camera.update(presentationFeetInto(feet, body.root.position, true));
    return pivotOf(camera).y;
  };

  /** Lowest point of the rendered body (world Y). */
  const renderedFeetY = () => {
    scene.meshes.forEach((m) => m.computeWorldMatrix(true));
    return Math.min(...scene.meshes.filter((m) => m.name.startsWith("local-player") && m.getTotalVertices() > 0).map((m) => m.getBoundingInfo().boundingBox.minimumWorld.y));
  };

  it("standing: the pivot is the rendered feet + targetHeight (no extra half-height drop)", () => {
    const pivotY = frame();
    expect(pivotY).toBeCloseTo(PREDICTED.y + targetHeight, 9);
    // The predicted root IS the feet of the visible body online.
    expect(renderedFeetY()).toBeGreaterThan(PREDICTED.y - 0.05);
    expect(renderedFeetY()).toBeLessThan(PREDICTED.y + 0.3);
    // The old follow point (root − half height) was ~0.9 m lower.
    expect(pivotY - (PREDICTED.y - PLAYER_COLLIDER_HALF_TOTAL_HEIGHT + targetHeight)).toBeCloseTo(PLAYER_COLLIDER_HALF_TOTAL_HEIGHT, 9);
  });

  it("crouched: the pivot dips by crouchDip about the same planted feet", () => {
    frame();
    const standingFeet = renderedFeetY();
    expect(frame(PREDICTED, 1)).toBeCloseTo(PREDICTED.y + targetHeight - crouchDip, 9);
    expect(renderedFeetY()).toBeCloseTo(standingFeet, 2); // the squash is about the feet
  });

  it("standing → crouched → standing eases without a per-frame snap", () => {
    let blend = 0;
    let previous = frame();
    const dt = 1 / 60;
    const maxStep = crouchDip * (1 - Math.exp(-14 * dt)) + 1e-9; // one easing step of the full dip
    const run = (target: number, frames: number) => {
      for (let i = 0; i < frames; i++) {
        blend = ease(blend, target, dt);
        const y = frame(PREDICTED, blend);
        expect(Math.abs(y - previous)).toBeLessThanOrEqual(maxStep);
        previous = y;
      }
    };
    run(1, 60);
    expect(previous).toBeCloseTo(PREDICTED.y + targetHeight - crouchDip, 2);
    run(0, 60);
    expect(previous).toBeCloseTo(PREDICTED.y + targetHeight, 2);
  });

  it("the pivot correction leaves yaw, pitch and the aim direction unchanged", () => {
    camera.applyLook(400, -120);
    const yaw = camera.getYaw();
    const pitch = camera.getPitch();
    camera.update(new Vector3(PREDICTED.x, PREDICTED.y - PLAYER_COLLIDER_HALF_TOTAL_HEIGHT, PREDICTED.z)); // old (low) pivot
    const oldAim = camera.getAimDirection(new Vector3());
    frame(); // corrected pivot
    const newAim = camera.getAimDirection(new Vector3());
    expect(camera.getYaw()).toBe(yaw);
    expect(camera.getPitch()).toBe(pitch);
    expect(Vector3.Distance(oldAim, newAim)).toBeLessThan(1e-9);
  });

  it("build / edit / weapon mode switches do not move the pivot", () => {
    const base = frame();
    for (const build of [true, false, true, false]) {
      camera.setBuildMode(build);
      expect(frame()).toBeCloseTo(base, 9);
    }
  });

  it("offline, the root is the capsule centre and the pivot is still feet + targetHeight", () => {
    const centre = { x: 0, y: PLAYER_COLLIDER_HALF_TOTAL_HEIGHT, z: 0 };
    camera.update(presentationFeetInto(feet, centre, false));
    expect(pivotOf(camera).y).toBeCloseTo(targetHeight, 9);
  });
});

describe("runtime wiring of the camera follow point", () => {
  const runtime = readFileSync(new URL("../GameRuntime.ts", import.meta.url), "utf8");
  it("feeds the camera and the spectator anchor the presentation feet (feet convention while connected)", () => {
    expect(runtime).toContain("this.cameraController.update(this.playerController.getPresentationFeetInto(this._feetPos,this.isConnected))");
    expect(runtime).toContain("const fp=this.playerController.getPresentationFeetInto(this._feetPos,this.isConnected);this.spectatorAnchor=");
    expect(runtime).not.toContain("this.cameraController.update(this.playerController.getFeetPositionInto(");
  });
  it("weapon switching never reaches the camera pivot", () => {
    // The only camera inputs are look, aim/pose reads, build mode, crouch dip,
    // recoil pitch offset, transient movement offset, obstacles and the follow point.
    const calls = new Set([...runtime.matchAll(/this\.cameraController\.([a-zA-Z]+)\(/g)].map((m) => m[1]));
    expect([...calls].sort()).toEqual(["applyLook", "getAimDirection", "getCamera", "getPitch", "getYaw", "setBuildMode", "setCrouchDip", "setObstacles", "setPitchOffset", "setTransientVerticalOffset", "update"]);
  });
});
