/**
 * THE centred-aim invariant (NullEngine, math-level).
 *
 * The crosshair is a static CSS-centred DOM element for every weapon, mode,
 * range and viewport size. For it to be honest, the rendered screen-centre
 * ray must equal the authoritative server shot ray. The camera therefore
 * sits ON the server shot line (behind the exact server eye origin, forward
 * = raw `ad(yaw, pitch)`), and every per-frame effect (recoil kickback,
 * movement bob, floor/structure guards, crouch pivot) only changes the
 * scalar along-line distance.
 *
 * Pinned here:
 *  - camera forward == `ad(yaw, pitch)` exactly, for cardinal/diagonal yaws,
 *    several pitches, standing and crouched, and with recoil/bob active;
 *  - the eye origin is ON the camera forward ray (cross-product zero) — so
 *    every point of the shot ray, at 3/10/15/60 m, projects to the exact
 *    CSS screen centre (explicit pinhole projection at a non-square
 *    viewport, sub-pixel);
 *  - both weapon ranges (AR 60 m, SG 15 m) resolve their shot-ray endpoints
 *    through the same camera (weapon choice never moves the camera);
 *  - discrete crouch eye heights match the server constants exactly.
 */
import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core";
import { ASSAULT_RIFLE, SHOTGUN } from "@buildshift/game-config";
import { ThirdPersonCameraController } from "./ThirdPersonCameraController";
import { THIRD_PERSON_CAMERA } from "./cameraConfig";
import {
  AIM_EYE_HEIGHT_STANDING,
  AIM_EYE_HEIGHT_CROUCHED,
  resolveAuthoritativeAimPoint,
} from "../aim/authoritativeAim";

const FEET = new Vector3(2, 0, -7);
const YAWS = [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4, -0.7];
const PITCHES = [0, 0.35, -0.5, THIRD_PERSON_CAMERA.minimumPitch, THIRD_PERSON_CAMERA.maximumPitch];
const RANGES = [3, 10, SHOTGUN.range, ASSAULT_RIFLE.range];

function build() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const controller = new ThirdPersonCameraController(scene);
  return { engine, scene, controller };
}

function aimAt(controller: ThirdPersonCameraController, yaw: number, pitch: number) {
  // Absolute aim helper: feed the DELTA to the relative-only applyLook.
  controller.applyLook(
    (controller.getYaw() - yaw) / THIRD_PERSON_CAMERA.mouseSensitivity,
    (pitch - controller.getPitch()) / THIRD_PERSON_CAMERA.mouseSensitivity,
  );
}

function serverAimDirection(yaw: number, pitch: number): Vector3 {
  const c = Math.cos(pitch);
  return new Vector3(Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
}

function eyeOf(controller: ThirdPersonCameraController): Vector3 {
  return new Vector3(FEET.x, FEET.y + controller.eyeHeight(), FEET.z);
}

/**
 * Offset of a world point from the CSS screen centre (pixels), using the
 * exact rendered camera pose (position + forward) and a pinhole projection
 * through the real viewport size. Mirrors Babylon's look-At/viewport math
 * closely enough to pin sub-pixel centring (the invariant is exactness, not
 * pixel rounding).
 */
function screenOffsetFromCentre(
  camPos: Vector3,
  camForward: Vector3,
  point: Vector3,
  fovRad: number,
  widthPx: number,
  heightPx: number,
): { dxPx: number; dyPx: number } | null {
  const up = new Vector3(0, 1, 0);
  const right = Vector3.Cross(up, camForward).normalize();
  const camUp = Vector3.Cross(camForward, right).normalize();
  const d = point.subtract(camPos);
  const z = d.dot(camForward);
  void widthPx; // horizontal aspect derived from the same non-square viewport below
  if (z <= 1e-9) return null; // behind the camera plane
  const halfH = Math.tan(fovRad / 2);
  const dxPx = (d.dot(right) / z) / halfH * (heightPx / 2);
  const dyPx = (d.dot(camUp) / z) / halfH * (heightPx / 2);
  return { dxPx, dyPx };
}

describe("centred-aim invariant: screen centre IS the authoritative shot line", () => {
  it("camera forward equals raw ad(yaw,pitch) for all yaw/pitch/crouch combinations (with recoil + bob active)", () => {
    const { engine, controller } = build();
    try {
      for (const crouched of [false, true]) {
        controller.setCrouched(crouched);
        for (const yaw of YAWS) {
          for (const pitch of PITCHES) {
            aimAt(controller, yaw, pitch);
            controller.setRecoilKickback(0.11);
            controller.setTransientVerticalOffset(-0.07);
            controller.update(FEET);
            const expected = serverAimDirection(controller.getYaw(), controller.getPitch());
            const fwd = controller.getCamera().getForwardRay().direction;
            expect(fwd.x).toBeCloseTo(expected.x, 4);
            expect(fwd.y).toBeCloseTo(expected.y, 4);
            expect(fwd.z).toBeCloseTo(expected.z, 4);
          }
        }
      }
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("the eye origin lies on the camera forward ray, and shot-ray endpoints at 3/10/15/60 m project to the exact CSS centre (non-square viewport)", () => {
    const { engine, controller } = build();
    const VIEW_W = 1377; // deliberately non-square
    const VIEW_H = 689;
    try {
      for (const crouched of [false, true]) {
        controller.setCrouched(crouched);
        for (const yaw of YAWS) {
          for (const pitch of [0, 0.3, -0.45]) {
            aimAt(controller, yaw, pitch);
            controller.setRecoilKickback(0.09);
            controller.setTransientVerticalOffset(0.05);
            controller.update(FEET);
            const cam = controller.getCamera();
            const fwd = cam.getForwardRay().direction;
            const dir = serverAimDirection(controller.getYaw(), controller.getPitch());
            const eye = eyeOf(controller);
            for (const range of RANGES) {
              const endpoint = eye.add(dir.scale(range));
              const off = screenOffsetFromCentre(cam.position, fwd, endpoint, cam.fov, VIEW_W, VIEW_H);
              // Points beyond 5.2 m are in FRONT of the camera; nearer ones
              // can fall behind the eye but must still be on the line.
              if (off) {
                expect(Math.abs(off.dxPx)).toBeLessThan(0.01);
                expect(Math.abs(off.dyPx)).toBeLessThan(0.01);
              } else {
                // Behind the camera plane: still exactly collinear with the
                // forward ray (the CSS centre's infinite ray is the shot
                // line — occlusion, not parallax).
                const toPoint = endpoint.subtract(cam.position);
                expect(Vector3.Cross(toPoint, fwd).length()).toBeLessThan(1e-4);
              }
            }
          }
        }
      }
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("weapon choice cannot move the reticle: AR (60 m) and SG (15 m) endpoints resolve on the SAME camera ray", () => {
    const { engine, controller } = build();
    try {
      aimAt(controller, 0.25, 0.1);
      controller.update(FEET);
      const cam = controller.getCamera();
      const dir = controller.getAimDirection();
      for (const weapon of [
        { range: ASSAULT_RIFLE.range },
        { range: SHOTGUN.range },
      ]) {
        const resolved = resolveAuthoritativeAimPoint({
          feet: { x: FEET.x, y: FEET.y, z: FEET.z },
          crouched: false,
          aimDirection: dir,
          weaponRange: weapon.range,
          remotePlayers: [],
          structures: [],
        });
        // The range-end endpoint is exactly eye + dir * range …
        expect(resolved.kind).toBe("range-end");
        const endpoint = new Vector3(resolved.point.x, resolved.point.y, resolved.point.z);
        // … which lies on the rendered camera forward ray (screen centre).
        const toPoint = endpoint.subtract(cam.position);
        expect(Vector3.Cross(toPoint, cam.getForwardRay().direction).length()).toBeLessThan(1e-4);
      }
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("the crouch pivot uses the exact server eye heights, discretely", () => {
    const { engine, controller } = build();
    try {
      controller.setCrouched(false);
      expect(controller.eyeHeight()).toBe(AIM_EYE_HEIGHT_STANDING);
      controller.setCrouched(true);
      expect(controller.eyeHeight()).toBe(AIM_EYE_HEIGHT_CROUCHED);
      controller.setCrouched(false);
      expect(controller.eyeHeight()).toBe(AIM_EYE_HEIGHT_STANDING);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("same-frame turn+fire: update after applyLook leaves camera forward on the FRESH raw aim", () => {
    const { engine, controller } = build();
    try {
      aimAt(controller, 0, 0);
      controller.update(FEET);
      // A fast turn within one frame, then the fire path reads aim and the
      // camera are refreshed: both must observe the SAME fresh raw yaw/pitch.
      controller.applyLook(-0.9 / THIRD_PERSON_CAMERA.mouseSensitivity, 0.4 / THIRD_PERSON_CAMERA.mouseSensitivity);
      const raw = serverAimDirection(controller.getYaw(), controller.getPitch());
      controller.update(FEET);
      const camFwd = controller.getCamera().getForwardRay().direction;
      expect(camFwd.x).toBeCloseTo(raw.x, 4);
      expect(camFwd.y).toBeCloseTo(raw.y, 4);
      expect(camFwd.z).toBeCloseTo(raw.z, 4);
      const runtime = controller.getAimDirection();
      expect(runtime.x).toBeCloseTo(raw.x, 9);
      expect(runtime.y).toBeCloseTo(raw.y, 9);
      expect(runtime.z).toBeCloseTo(raw.z, 9);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });
});
