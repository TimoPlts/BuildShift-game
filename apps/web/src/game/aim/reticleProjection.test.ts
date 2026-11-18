/**
 * Reticle projection — regression tests.
 *
 * The contract that matters: the crosshair must mark where the AUTHORITATIVE
 * shot ray actually goes at every distance. The authoritative ray and the
 * camera ray are parallel but differently based (shoulder 0.8 m, pivot height
 * 1.6 m vs eye 0.9 m, orbit 5.2 m behind), so screen-centre is NOT the shot
 * ray — these tests pin that the helper's pixel offsets (a) match Babylon's
 * own projection of the same rendered camera (convention truth, including the
 * Stage 1C "screen-right is −X at yaw 0" rule and vertical-FOV mode), and
 * (b) place the reticle on the shot-ray point at near/mid/far distances,
 * where screen-centre would be metres off.
 */
import { describe, expect, it } from "vitest";
import { NullEngine, type NullEngineOptions } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { THIRD_PERSON_CAMERA } from "../camera/cameraConfig";
import { ThirdPersonCameraController } from "../camera/ThirdPersonCameraController";
import {
  projectPointToScreenOffset,
  type ReticleCameraState,
} from "./reticleProjection";
import { authoritativeAimOrigin, type AimVec3 } from "./authoritativeAim";

const VIEW_W = 800;
const VIEW_H = 600;
const FEET = new Vector3(0, 0, 6);

function buildScene() {
  // Sized so Babylon builds its projection with the SAME 4:3 aspect the
  // helper is given (NullEngine defaults to 512x256 otherwise).
  const engine = new NullEngine({
    renderWidth: VIEW_W,
    renderHeight: VIEW_H,
  } as NullEngineOptions);
  const scene = new Scene(engine);
  const controller = new ThirdPersonCameraController(scene);
  return { engine, scene, controller };
}

/** Drive the controller to an exact yaw/pitch through its real input path. */
function look(controller: ThirdPersonCameraController, yaw: number, pitch: number): void {
  // applyLook: yaw -= dx*sens, pitch -= dy*sens (from the current values).
  const cur = { yaw: controller.getYaw(), pitch: controller.getPitch() };
  controller.applyLook(-(yaw - cur.yaw) / THIRD_PERSON_CAMERA.mouseSensitivity, 0);
  controller.applyLook(0, -(pitch - cur.pitch) / THIRD_PERSON_CAMERA.mouseSensitivity);
}

function controllerState(controller: ThirdPersonCameraController): ReticleCameraState {
  const cam = controller.getCamera();
  return {
    position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
    yaw: controller.getYaw(),
    pitch: controller.getPitch() + controller.getPitchOffset(), // rendered pose
    fieldOfView: cam.fov,
  };
}

/** Babylon's ground truth: where the engine actually draws a world point. */
function babylonScreenOffset(scene: Scene, point: AimVec3): { dx: number; dy: number } | null {
  scene.render();
  const cam = scene.activeCamera;
  if (!cam) throw new Error("no active camera");
  const p = Vector3.Project(
    new Vector3(point.x, point.y, point.z),
    Matrix.Identity(),
    scene.getTransformMatrix(),
    cam.viewport.toGlobal(VIEW_W, VIEW_H),
  );
  return { dx: p.x - VIEW_W / 2, dy: p.y - VIEW_H / 2 };
}

const ad = (yaw: number, pitch: number): AimVec3 => {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
};

describe("projectPointToScreenOffset — matches the rendered engine camera", () => {
  it("projects a point on the camera axis to exactly the viewport centre", () => {
    const { dxPx, dyPx } = projectPointToScreenOffset(
      { x: 0, y: 0, z: -10 },
      { position: { x: 0, y: 0, z: 5 }, yaw: 0, pitch: 0, fieldOfView: 1.4 },
      VIEW_W,
      VIEW_H,
    )!;
    expect(dxPx).toBeCloseTo(0, 6);
    expect(dyPx).toBeCloseTo(0, 6);
  });

  it("follows the repo's screen conventions under Babylon for yaw/pitch/recoil combos", () => {
    const { engine, scene, controller } = buildScene();
    try {
      scene.activeCamera = controller.getCamera();
      for (const [yaw, pitch, recoil] of [
        [0, 0, 0],
        [0.9, -0.4, 0],
        [-2.4, 0.55, 0],
        [0.3, 0.2, 0.09], // recoil: rendered pitch ≠ aim pitch
        [Math.PI, 0, 0],
      ] as const) {
        look(controller, yaw, pitch);
        controller.setPitchOffset(recoil);
        controller.update(FEET);
        // Probe points around the view: forward, off-axis left/right/up/down.
        const cam = controller.getCamera().position;
        const probes: AimVec3[] = [
          { x: cam.x + ad(yaw, pitch + recoil).x * 20, y: cam.y + ad(yaw, pitch + recoil).y * 20, z: cam.z + ad(yaw, pitch + recoil).z * 20 },
          { x: cam.x - Math.cos(yaw) * 6 + ad(yaw, pitch + recoil).x * 18, y: cam.y + 2, z: cam.z - Math.sin(yaw) * 6 + ad(yaw, pitch + recoil).z * 18 },
          { x: cam.x + Math.cos(yaw) * 5 + ad(yaw, pitch + recoil).x * 30, y: cam.y - 1.5, z: cam.z + Math.sin(yaw) * 5 + ad(yaw, pitch + recoil).z * 30 },
        ];
        const state = controllerState(controller);
        for (const probe of probes) {
          const mine = projectPointToScreenOffset(probe, state, VIEW_W, VIEW_H);
          expect(mine, `probe behind camera yaw=${yaw} pitch=${pitch}`).not.toBeNull();
          const theirs = babylonScreenOffset(scene, probe)!;
          expect(mine!.dxPx - theirs.dx, `dx yaw=${yaw}`).toBeCloseTo(0, 1);
          expect(mine!.dyPx - theirs.dy, `dy yaw=${yaw}`).toBeCloseTo(0, 1);
        }
      }
    } finally {
      engine.dispose();
    }
  });

  it("uses screen-right = world −X at yaw 0 (Stage 1C convention, engine-verified)", () => {
    const { engine, scene, controller } = buildScene();
    try {
      scene.activeCamera = controller.getCamera();
      look(controller, 0, 0);
      controller.update(FEET);
      const behind = FEET.clone();
      const right = { x: behind.x - 1, y: 0.9, z: behind.z - 14 }; // world −X
      const off = projectPointToScreenOffset(right, controllerState(controller), VIEW_W, VIEW_H)!;
      const bab = babylonScreenOffset(scene, right)!;
      expect(off.dxPx).toBeGreaterThan(0); // −X renders on the RIGHT
      expect(Math.sign(off.dxPx)).toBe(Math.sign(bab.dx));
    } finally {
      engine.dispose();
    }
  });
});

describe("reticle truthfulness vs the authoritative shot ray", () => {
  const shotDirs = [[0, 0], [0.8, -0.35], [-2.0, 0.5], [2.6, 0]] as const;

  it("places the reticle exactly on the shot-ray hit point at near/mid/far ranges", () => {
    for (const [yaw, pitch] of shotDirs) {
      const { engine, scene, controller } = buildScene();
      try {
        scene.activeCamera = controller.getCamera();
        look(controller, yaw, pitch);
        controller.update(FEET);
        const eye = authoritativeAimOrigin({ x: FEET.x, y: FEET.y, z: FEET.z }, false);
        const d = ad(yaw, pitch);
        const state = controllerState(controller);
        let prevMagnitude = Infinity;
        for (const T of [3, 14, 45]) {
          const hit = { x: eye.x + d.x * T, y: eye.y + d.y * T, z: eye.z + d.z * T };
          const off = projectPointToScreenOffset(hit, state, VIEW_W, VIEW_H)!;
          // Truth #1: the reticle sits where the engine renders the hit point.
          const bab = babylonScreenOffset(scene, hit)!;
          expect(off.dxPx - bab.dx, `T=${T} dx`).toBeCloseTo(0, 1);
          expect(off.dyPx - bab.dy, `T=${T} dy`).toBeCloseTo(0, 1);
          // Truth #2: parallax is distance-dependent (no fixed offset could do
          // this) and shrinks with range.
          const mag = Math.hypot(off.dxPx, off.dyPx);
          expect(mag).toBeLessThan(prevMagnitude);
          prevMagnitude = mag;
        }
      } finally {
        engine.dispose();
      }
    }
  });

  it("exposes the real near/mid parallax the centred crosshair was hiding", () => {
    // Camera ray vs shot ray: parallel, offset perpendicular ≈ shoulder and
    // pivot-minus-eye — over 1 m of world error the centre reticle lied by.
    const { engine, scene, controller } = buildScene();
    try {
      scene.activeCamera = controller.getCamera();
      look(controller, 0, 0);
      controller.update(FEET);
      const cam = controller.getCamera().position;
      const eye = authoritativeAimOrigin({ x: FEET.x, y: FEET.y, z: FEET.z }, false);
      const d = ad(0, 0);
      const o = { x: eye.x - cam.x, y: eye.y - cam.y, z: eye.z - cam.z };
      // Perp distance from the camera axis to the parallel shot ray.
      const cross = {
        x: o.y * d.z - o.z * d.y,
        y: o.z * d.x - o.x * d.z,
        z: o.x * d.y - o.y * d.x,
      };
      const perp = Math.hypot(cross.x, cross.y, cross.z);
      const expected = Math.hypot(
        THIRD_PERSON_CAMERA.shoulderOffset,
        THIRD_PERSON_CAMERA.targetHeight - 0.9,
      );
      expect(perp).toBeCloseTo(expected, 2); // ≈ 1.06 m of world offset
      expect(perp).toBeGreaterThan(1); // the bug the reticle now removes
      // At 3 m that is a >5° screen error (~46 px here) — impossible to fix
      // with a static CSS offset, and it decays with range (parallax).
      const off3 = projectPointToScreenOffset(
        { x: eye.x, y: eye.y, z: eye.z - 3 }, controllerState(controller), VIEW_W, VIEW_H,
      )!;
      expect(Math.hypot(off3.dxPx, off3.dyPx)).toBeGreaterThan(40);
    } finally {
      engine.dispose();
    }
  });

  it("crouch lowers the eye origin and the projected reticle accordingly", () => {
    const { engine, scene, controller } = buildScene();
    try {
      scene.activeCamera = controller.getCamera();
      look(controller, 0.4, -0.1);
      controller.setCrouchDip(THIRD_PERSON_CAMERA.crouchDip); // real rendered dip
      controller.update(FEET);
      const standing = authoritativeAimOrigin({ x: FEET.x, y: FEET.y, z: FEET.z }, false);
      const crouched = authoritativeAimOrigin({ x: FEET.x, y: FEET.y, z: FEET.z }, true);
      expect(standing.y - crouched.y).toBeCloseTo(0.9 - 0.6, 6);
      const state = controllerState(controller);
      const d = ad(0.4, -0.1);
      const a = projectPointToScreenOffset({ x: standing.x + d.x * 20, y: standing.y + d.y * 20, z: standing.z + d.z * 20 }, state, VIEW_W, VIEW_H)!;
      const b = projectPointToScreenOffset({ x: crouched.x + d.x * 20, y: crouched.y + d.y * 20, z: crouched.z + d.z * 20 }, state, VIEW_W, VIEW_H)!;
      // Different origins ⇒ the truthful reticle position differs (crouching
      // visibly moves it; screen-centre never did).
      expect(Math.hypot(a.dxPx - b.dxPx, a.dyPx - b.dyPx)).toBeGreaterThan(1);
      for (const p of [a, b]) {
        expect(Number.isFinite(p.dxPx)).toBe(true);
        expect(Number.isFinite(p.dyPx)).toBe(true);
      }
    } finally {
      engine.dispose();
    }
  });
});

describe("projectPointToScreenOffset — invalid frames suppress, never fake", () => {
  const cam: ReticleCameraState = { position: { x: 0, y: 1, z: 8 }, yaw: 0, pitch: 0, fieldOfView: 1.4 };

  it("returns null for points behind or on the camera plane", () => {
    expect(projectPointToScreenOffset({ x: 0, y: 1, z: 20 }, cam, VIEW_W, VIEW_H)).toBeNull();
    expect(projectPointToScreenOffset({ x: 0, y: 1, z: 8 }, cam, VIEW_W, VIEW_H)).toBeNull();
  });

  it("returns null for degenerate viewports", () => {
    const inFront = { x: 0, y: 1, z: -2 };
    expect(projectPointToScreenOffset(inFront, cam, 0, 600)).toBeNull();
    expect(projectPointToScreenOffset(inFront, cam, 800, NaN)).toBeNull();
  });
});
