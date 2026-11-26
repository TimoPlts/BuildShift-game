/**
 * Rendered-body feet anchor (anchored-turn 20261126) — the body-side half
 * of the "stationary mouse turn must not swing the character through space"
 * fix, complementary to `ThirdPersonCameraController.feetAnchor.test.ts`.
 *
 * The reported drift: while stationary, moving the mouse rotated the view
 * and visibly dragged the character sideways through the world (floating /
 * off platform). Root cause: the local framing offset
 * (`THIRD_PERSON_CAMERA.localViewOffsetX = 0.8`) was written to
 * `visualRoot.position.x` UNDER the yaw-rotated gameplay root, so the
 * rendered body's world XZ was `colliderFeet + R(yaw)·(0.8, 0, 0)` — a
 * translation offset rotated into apparent player motion. Facing must
 * rotate ABOUT the feet/collider; the feet stay at the collider position.
 *
 * These are behavioral NullEngine transform tests on the production facade
 * (no source-string assertions): with the exact production wiring
 * (`setLocalViewOffset(THIRD_PERSON_CAMERA.localViewOffsetX, ...Z)`), the
 * visualRoot world XZ and the rendered body meshes' world XZ footprint must
 * be invariant across yaw 0/90/180/270 and crouch, while the root yaw still
 * tracks the facing. The final test demonstrates that the old non-zero
 * offset really did orbit the feet, so this suite has teeth if anyone
 * re-introduces a yaw-rotating body translation.
 */
import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { THIRD_PERSON_CAMERA } from "../../camera/cameraConfig";
import { PlayerBodyFacade } from "./playerBodyFacade";

let engine: NullEngine;
let scene: Scene;
const rig: PlayerBodyFacade[] = [];

function makeScene(): void {
  engine = new NullEngine();
  scene = new Scene(engine);
}

afterEach(() => {
  while (rig.length) rig.pop()!.dispose();
  scene?.dispose();
  engine?.dispose();
});

function makeFacade(prefix: string, variant: "local" | "remote"): PlayerBodyFacade {
  const facade = new PlayerBodyFacade(scene, variant, prefix);
  rig.push(facade);
  return facade;
}

/** World XZ of visualRoot after forcing world-matrix evaluation. */
function visualWorldXZ(facade: PlayerBodyFacade): { x: number; z: number } {
  facade.root.computeWorldMatrix(true);
  facade.visualRoot.computeWorldMatrix(true);
  const p = facade.visualRoot.getAbsolutePosition();
  return { x: p.x, z: p.z };
}

/** World XZ centre of every mesh the facade owns (body footprint centre). */
function bodyFootprintXZ(prefix: string): { x: number; z: number } {
  const meshes = scene.meshes.filter(
    (m) => m instanceof Mesh && m.name.startsWith(prefix),
  );
  expect(meshes.length, `owned meshes for ${prefix}`).toBeGreaterThan(0);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    minX = Math.min(minX, box.minimumWorld.x);
    maxX = Math.max(maxX, box.maximumWorld.x);
    minZ = Math.min(minZ, box.minimumWorld.z);
    maxZ = Math.max(maxZ, box.maximumWorld.z);
  }
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
}

const YAWS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

describe("rendered local body is feet-anchored under yaw-only turns", () => {
  it("production wiring: visualRoot world XZ is invariant across yaw 0/90/180/270", () => {
    makeScene();
    const facade = makeFacade("anchor-local", "local");
    // Exactly what GameRuntime.applyLocalViewOffset() drives at startup.
    facade.setLocalViewOffset(
      THIRD_PERSON_CAMERA.localViewOffsetX,
      THIRD_PERSON_CAMERA.localViewOffsetZ,
    );
    // The feet-anchor contract is a NUMERIC config contract: a non-zero
    // value here is a yaw-rotating translation of the rendered body and is
    // re-introduced drift (see cameraConfig FEET ANCHOR note and the demo
    // test at the bottom of this file).
    expect(THIRD_PERSON_CAMERA.localViewOffsetX).toBe(0);
    expect(THIRD_PERSON_CAMERA.localViewOffsetZ).toBe(0);

    const feet = { x: 1.5, y: 0, z: -2.5 };
    for (const yaw of YAWS) {
      facade.setTransform(feet, yaw);
      const world = visualWorldXZ(facade);
      expect(world.x).toBeCloseTo(feet.x, 9);
      expect(world.z).toBeCloseTo(feet.z, 9);
      // Facing still rotates about the anchor (root yaw = -shared yaw).
      expect(facade.root.rotation.y).toBeCloseTo(-yaw, 9);
    }
  });

  it("rendered body mesh footprint stays on the collider XZ column at every yaw", () => {
    makeScene();
    const facade = makeFacade("anchor-body", "local");
    facade.setLocalViewOffset(
      THIRD_PERSON_CAMERA.localViewOffsetX,
      THIRD_PERSON_CAMERA.localViewOffsetZ,
    );
    const feet = { x: -3.25, y: 0, z: 4.75 };
    for (const yaw of YAWS) {
      facade.setTransform(feet, yaw);
      const centre = bodyFootprintXZ("anchor-body");
      // The procedural body is (near) symmetric about the root axis: its
      // world footprint centre must sit ON the collider column. A 0.8 m
      // framing offset pushes the centre up to 0.8 m off (≥ 0.4 m even for
      // the cardinal yaws below), so this bound has real teeth.
      expect(Math.abs(centre.x - feet.x)).toBeLessThan(0.15);
      expect(Math.abs(centre.z - feet.z)).toBeLessThan(0.15);
    }
  });

  it("crouch and idle state never shift the anchor XZ either", () => {
    makeScene();
    const facade = makeFacade("anchor-crouch", "local");
    facade.setLocalViewOffset(
      THIRD_PERSON_CAMERA.localViewOffsetX,
      THIRD_PERSON_CAMERA.localViewOffsetZ,
    );
    const feet = { x: 2, y: 0, z: -1 };
    facade.setTransform(feet, 0.7);
    const standing = visualWorldXZ(facade);
    facade.setCrouchBlend(1);
    const crouched = visualWorldXZ(facade);
    expect(crouched.x).toBeCloseTo(standing.x, 9);
    expect(crouched.z).toBeCloseTo(standing.z, 9);
    expect(crouched.x).toBeCloseTo(feet.x, 9);
    expect(crouched.z).toBeCloseTo(feet.z, 9);
    facade.setCrouchBlend(0);
    const restored = visualWorldXZ(facade);
    expect(restored.x).toBeCloseTo(feet.x, 9);
    expect(restored.z).toBeCloseTo(feet.z, 9);
  });

  it("regression demo: a non-zero root-local view offset DOES orbit the feet (why it must stay 0)", () => {
    makeScene();
    const facade = makeFacade("anchor-demo", "local");
    const feet = { x: 0, y: 0, z: 0 };
    facade.setLocalViewOffset(0.8, 0); // the pre-fix production value
    const shifts: Vector3[] = [];
    for (const yaw of YAWS) {
      facade.setTransform(feet, yaw);
      facade.root.computeWorldMatrix(true);
      facade.visualRoot.computeWorldMatrix(true);
      shifts.push(
        facade.visualRoot.getAbsolutePosition().subtract(facade.root.position),
      );
    }
    // The world-space visual shift rotates with yaw: 0° pushes +X, 90°
    // pushes +Z, 180° pushes -X, 270° pushes -Z — i.e. a 0.8 m circle of
    // rendered-body translation driven purely by moving the mouse. If this
    // ever stops being true the mechanism below changed (good); if the
    // production config value above ever becomes non-zero, the anchor
    // tests in this file fail long before this demo disagrees.
    expect(shifts[0].x).toBeCloseTo(0.8, 6);
    expect(shifts[0].z).toBeCloseTo(0, 6);
    expect(shifts[1].x).toBeCloseTo(0, 6);
    expect(shifts[1].z).toBeCloseTo(0.8, 6);
    expect(shifts[2].x).toBeCloseTo(-0.8, 6);
    expect(shifts[2].z).toBeCloseTo(0, 6);
    expect(shifts[3].x).toBeCloseTo(0, 6);
    expect(shifts[3].z).toBeCloseTo(-0.8, 6);
  });
});
