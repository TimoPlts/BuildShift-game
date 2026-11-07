/**
 * NullEngine tests for the Batch 2C per-weapon hand-seating transform table:
 *  - the immutable table covers exactly the two supported weapon ids
 *  - values are finite, positive-scale, and hand-joint-local metres/radians
 *  - the table (and every nested vector) is deep-frozen
 *  - getWeaponAttachmentTransform returns the frozen record entry and fails
 *    loudly for unknown weapon types
 *  - applyWeaponAttachmentTransform writes position/rotation/scale on the
 *    weapon root without reparenting or allocating
 *  - the shipped values seat the weapon correctly in the AUTHORED ANIMATED
 *    ready poses (batch-2A idle / crouch): muzzle axis forward-and-down
 *    along the aim axis, weapon up ≈ world up, rear grip under the palm,
 *    stock behind the hand at shoulder height
 *
 * The animated-pose checks are authoritative: the production character
 * always presents an authored animation (idle on settle), so the hand
 * frame the table must seat against is the animated ready hand, not the
 * GLB rest pose. The rest-pose hand frame rotates substantially relative
 * to it, and the same table values are only required to keep the weapon
 * attached sensibly there (root hugging the joint, no displacement) —
 * see the rest-pose sanity test.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene, Matrix } from "@babylonjs/core";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CharacterAsset } from "./characterAsset";
import { CharacterModel } from "./CharacterModel";
import { WeaponModelPresentation } from "../WeaponModelPresentation";
import type { WeaponType } from "@buildshift/protocol";
import {
  WEAPON_ATTACHMENT_TRANSFORMS,
  applyWeaponAttachmentTransform,
  getWeaponAttachmentTransform,
  type WeaponAttachmentTransform,
} from "./weaponAttachmentTransforms";

const GLB_PATH = fileURLToPath(
  new URL("../../../../public/assets/character/BuildShiftBaseCharacter.glb", import.meta.url),
);

let engine: NullEngine;
let scene: Scene;

function makeScene(): void {
  engine = new NullEngine();
  scene = new Scene(engine);
}

afterEach(() => {
  scene?.dispose();
  engine?.dispose();
});

/** Loads the real asset from the public directory into a fresh scene. */
async function loadAsset(): Promise<CharacterAsset> {
  const bytes = readFileSync(GLB_PATH);
  const buffer = new Uint8Array(bytes).buffer;
  return CharacterAsset.fromBuffer(buffer, scene);
}

/** Builds a real rigged character instance under the given prefix. */
async function buildCharacter(prefix: string): Promise<CharacterModel> {
  const asset = await loadAsset();
  return CharacterModel.create(scene, asset, "local", prefix);
}

function isFiniteVector(v: { x: number; y: number; z: number }): void {
  expect(Number.isFinite(v.x)).toBe(true);
  expect(Number.isFinite(v.y)).toBe(true);
  expect(Number.isFinite(v.z)).toBe(true);
}

describe("WEAPON_ATTACHMENT_TRANSFORMS — table structure", () => {
  it("covers exactly the two supported weapon ids", () => {
    expect(Object.keys(WEAPON_ATTACHMENT_TRANSFORMS).sort()).toEqual([
      "assault_rifle",
      "shotgun",
    ]);
    for (const key of Object.keys(WEAPON_ATTACHMENT_TRANSFORMS) as WeaponType[]) {
      expect(WEAPON_ATTACHMENT_TRANSFORMS[key].weaponType).toBe(key);
    }
  });

  it("holds finite hand-joint-local values with positive unit scale", () => {
    for (const transform of Object.values(WEAPON_ATTACHMENT_TRANSFORMS)) {
      isFiniteVector(transform.position);
      isFiniteVector(transform.rotation);
      expect(transform.scale).toBeGreaterThan(0);
      // Positions are small offsets around the hand joint (asset metres).
      expect(Math.abs(transform.position.x)).toBeLessThan(0.2);
      expect(Math.abs(transform.position.y)).toBeLessThan(0.2);
      expect(Math.abs(transform.position.z)).toBeLessThan(0.2);
      // The rotations are compound (the animated ready hand frame is far
      // from the rest-pose frame, so no fixed base mount roll is baked in);
      // each component is at most a half-turn.
      expect(Math.abs(transform.rotation.x)).toBeLessThan(Math.PI);
      expect(Math.abs(transform.rotation.y)).toBeLessThan(Math.PI);
      expect(Math.abs(transform.rotation.z)).toBeLessThan(Math.PI);
    }
  });

  it("uses a distinct seat per weapon", () => {
    const ar = WEAPON_ATTACHMENT_TRANSFORMS.assault_rifle;
    const sg = WEAPON_ATTACHMENT_TRANSFORMS.shotgun;
    const distinct =
      ar.position.x !== sg.position.x ||
      ar.position.y !== sg.position.y ||
      ar.position.z !== sg.position.z ||
      ar.rotation.x !== sg.rotation.x ||
      ar.rotation.y !== sg.rotation.y ||
      ar.rotation.z !== sg.rotation.z;
    expect(distinct).toBe(true);
  });
});

describe("WEAPON_ATTACHMENT_TRANSFORMS — immutability", () => {
  it("freezes the record, every transform, and every nested vector", () => {
    expect(Object.isFrozen(WEAPON_ATTACHMENT_TRANSFORMS)).toBe(true);
    for (const transform of Object.values(WEAPON_ATTACHMENT_TRANSFORMS)) {
      expect(Object.isFrozen(transform)).toBe(true);
      expect(Object.isFrozen(transform.position)).toBe(true);
      expect(Object.isFrozen(transform.rotation)).toBe(true);
    }
  });

  it("rejects mutations at runtime (strict mode)", () => {
    const rifle = getWeaponAttachmentTransform("assault_rifle");
    expect(() => {
      (rifle.position as unknown as { x: number }).x = 123;
    }).toThrow();
    expect(() => {
      (rifle.rotation as unknown as { z?: number }).z = 123;
    }).toThrow();
    expect(() => {
      (WEAPON_ATTACHMENT_TRANSFORMS as unknown as {
        shotgun?: WeaponAttachmentTransform;
      }).shotgun = void 0;
    }).toThrow();
    // Nothing was written.
    expect(rifle.position.x).toBeCloseTo(0.0316, 5);
    expect(Object.keys(WEAPON_ATTACHMENT_TRANSFORMS)).toHaveLength(2);
  });
});

describe("getWeaponAttachmentTransform", () => {
  it("returns the exact frozen record entry for each weapon", () => {
    expect(getWeaponAttachmentTransform("assault_rifle")).toBe(
      WEAPON_ATTACHMENT_TRANSFORMS.assault_rifle,
    );
    expect(getWeaponAttachmentTransform("shotgun")).toBe(
      WEAPON_ATTACHMENT_TRANSFORMS.shotgun,
    );
  });

  it("throws for an unknown weapon type", () => {
    expect(() =>
      getWeaponAttachmentTransform("plasma_cannon" as never),
    ).toThrow(/plasma_cannon/);
  });
});

describe("applyWeaponAttachmentTransform", () => {
  it("writes position, rotation, and scale on the weapon root", () => {
    makeScene();
    const weapon = WeaponModelPresentation.create(scene, "wApply1");
    const transform = getWeaponAttachmentTransform("assault_rifle");
    applyWeaponAttachmentTransform(weapon.root, transform);
    expect(weapon.root.position.x).toBeCloseTo(transform.position.x, 5);
    expect(weapon.root.position.y).toBeCloseTo(transform.position.y, 5);
    expect(weapon.root.position.z).toBeCloseTo(transform.position.z, 5);
    expect(weapon.root.rotation.x).toBeCloseTo(transform.rotation.x, 5);
    expect(weapon.root.rotation.y).toBeCloseTo(transform.rotation.y, 5);
    expect(weapon.root.rotation.z).toBeCloseTo(transform.rotation.z, 5);
    expect(weapon.root.scaling.x).toBeCloseTo(transform.scale, 5);
    expect(weapon.root.scaling.y).toBeCloseTo(transform.scale, 5);
    expect(weapon.root.scaling.z).toBeCloseTo(transform.scale, 5);
    weapon.dispose();
  });

  it("does not reparent, allocate, or touch visibility", () => {
    makeScene();
    const weapon = WeaponModelPresentation.create(scene, "wApply2");
    const socket = new TransformNode("apply-socket", scene);
    weapon.attachTo(socket, { x: 0, y: 0, z: 0 });
    const meshCount = scene.meshes.length;
    const nodeCount = scene.transformNodes.length;
    applyWeaponAttachmentTransform(
      weapon.root,
      getWeaponAttachmentTransform("shotgun"),
    );
    expect(weapon.root.parent).toBe(socket);
    expect(scene.meshes.length).toBe(meshCount);
    expect(scene.transformNodes.length).toBe(nodeCount);
    expect(weapon.root.isEnabled()).toBe(true);
    weapon.dispose();
  });

  it("is idempotent for repeated application", () => {
    makeScene();
    const weapon = WeaponModelPresentation.create(scene, "wApply3");
    const transform = getWeaponAttachmentTransform("assault_rifle");
    applyWeaponAttachmentTransform(weapon.root, transform);
    applyWeaponAttachmentTransform(weapon.root, transform);
    expect(weapon.root.position.x).toBeCloseTo(transform.position.x, 5);
    expect(weapon.root.scaling.x).toBeCloseTo(transform.scale, 5);
    weapon.dispose();
  });
});

describe("shipped values — geometric seating in the authored ready poses", () => {
  /**
   * Full 4×4 WORLD matrices of the real `hand_r` joint (column-major,
   * row-major Babylon `Matrix.m` layout: 3 rotation/scale rows, translation
   * in elements 12-14), captured 2026-11-07 in a NullEngine scene playing
   * the batch-2A authored idle / crouch clips (breathing-neutral frame 0)
   * against the real 65-joint GLB, character root at the origin and default
   * target height.
   *
   * The matrices carry the character scale (~0.989) and a mirrored
   * (negative-determinant) ancestor transform, so they are NOT expressible
   * as position + unit quaternion; the full matrix is the faithful fixture.
   * The static table's known max muzzle swing (≈0.15°) across a full idle
   * breathing loop is far below every tolerance asserted here, so the
   * breathing-neutral frame is the correct reference.
   */
  const READY_HAND_WORLD_MATRIX = {
    idle: [
      0.804180562, 0.576046944, 0.007153422, 0,
      0.028362349, -0.051857341, 0.987468421, 0,
      -0.575392783, 0.802538633, 0.058672275, 0,
      0.220529854, 1.257811904, 0.321143508, 1,
    ],
    crouch: [
      0.681652129, 0.716861725, -0.006873302, 0,
      0.041758481, -0.030235581, 0.987891555, 0,
      -0.715677440, 0.681015968, 0.051095217, 0,
      0.220529854, 0.922504306, 0.393900871, 1,
    ],
  } as const;

  type ReadyPose = keyof typeof READY_HAND_WORLD_MATRIX;

  interface Measured {
    handPos: Vector3;
    barrel: Vector3;
    up: Vector3;
    rootPos: Vector3;
    grip: Vector3;
    stock: Vector3;
  }

  /**
   * Builds a scene-root socket whose world frame equals the captured
   * `hand_r` world matrix for `pose`, then verifies the round-trip
   * (a socket at the scene root has local == world). The uniform scale is
   * factored out with the mirror on the socket's local Z axis, so the
   * weapon parented under it scales exactly as it does under the real
   * hand joint.
   */
  function readyHandSocket(pose: ReadyPose, prefix: string): TransformNode {
    const H = READY_HAND_WORLD_MATRIX[pose];
    const c0 = new Vector3(H[0], H[1], H[2]);
    const c1 = new Vector3(H[4], H[5], H[6]);
    const c2 = new Vector3(H[8], H[9], H[10]);
    const s = c0.length();
    const det3 =
      c0.x * (c1.y * c2.z - c1.z * c2.y) -
      c0.y * (c1.x * c2.z - c1.z * c2.x) +
      c0.z * (c1.x * c2.y - c1.y * c2.x);
    const detSign = Math.sign(det3);
    // The captured hand frame is uniformly scaled with a mirror; factoring
    // the mirror onto local Z leaves a proper (det +1) rotation.
    const r0 = c0.scale(1 / s);
    const r1 = c1.scale(1 / s);
    const r2 = c2.scale(detSign / s);
    const rotation = Matrix.FromValues(
      r0.x, r0.y, r0.z, 0,
      r1.x, r1.y, r1.z, 0,
      r2.x, r2.y, r2.z, 0,
      0, 0, 0, 1,
    );
    expect(Math.abs(rotation.determinant() - 1)).toBeLessThan(1e-4);

    const socket = new TransformNode(`${prefix}-fixture-hand-${pose}`, scene);
    // A scene-root node's own scale does not scale its own position, so the
    // measured world translation is applied directly.
    socket.position = new Vector3(H[12], H[13], H[14]);
    socket.scaling.set(s, s, detSign * s);
    socket.rotation.copyFrom(Quaternion.FromRotationMatrix(rotation).toEulerAngles());
    socket.computeWorldMatrix(true);

    // Round-trip: the socket must reproduce the captured hand world frame.
    const W = socket.getWorldMatrix();
    for (let i = 0; i < 16; i++) {
      expect(W.m[i]).toBeCloseTo(H[i], 5);
    }
    return socket;
  }

  /** Seats `weaponType` under the captured ready hand frame and measures world geometry. */
  function seatInReadyPose(
    pose: ReadyPose,
    weaponType: "assault_rifle" | "shotgun",
    prefix: string,
  ): Measured {
    const socket = readyHandSocket(pose, prefix);
    const weapon = WeaponModelPresentation.create(scene, `${prefix}w`);
    if (weaponType === "shotgun") weapon.setEquippedWeapon("shotgun");
    const transform = getWeaponAttachmentTransform(weaponType);
    weapon.attachTo(socket, transform.position, transform.rotation);
    weapon.root.computeWorldMatrix(true);

    const wm = weapon.root.getWorldMatrix();
    const barrel = Vector3.TransformNormal(new Vector3(0, 0, -1), wm).normalize();
    const up = Vector3.TransformNormal(new Vector3(0, 1, 0), wm).normalize();
    const rootPos = weapon.root.getAbsolutePosition();
    // Rear (trigger) grip: rifle box centred (0,-0.043,-0.075), shotgun
    // (0,-0.05,-0.075) — transform through the weapon root world matrix.
    const gripLocal =
      weaponType === "assault_rifle"
        ? new Vector3(0, -0.043, -0.075)
        : new Vector3(0, -0.05, -0.075);
    const grip = Vector3.TransformCoordinates(gripLocal, wm);
    const stockLocal =
      weaponType === "assault_rifle"
        ? new Vector3(0, -0.01, 0.17)
        : new Vector3(0, -0.01, 0.15);
    const stock = Vector3.TransformCoordinates(stockLocal, wm);
    const H = READY_HAND_WORLD_MATRIX[pose];
    const handPos = new Vector3(H[12], H[13], H[14]);

    weapon.dispose();
    socket.dispose();
    return { handPos, barrel, up, rootPos, grip, stock };
  }

  it("idle ready pose: seats the assault rifle muzzle forward, ~7° down", () => {
    makeScene();
    const m = seatInReadyPose("idle", "assault_rifle", "atm-r-idle");
    // Muzzle along the aim axis: world -Z dominates, small downward pitch.
    expect(m.barrel.z).toBeLessThan(-0.98);
    expect(m.barrel.y).toBeLessThan(-0.08);
    expect(m.barrel.y).toBeGreaterThan(-0.16);
    expect(Math.abs(m.barrel.x)).toBeLessThan(0.05);
    // Weapon up mostly world up.
    expect(m.up.y).toBeGreaterThan(0.95);
    // Rear grip under the palm, very close to the hand joint.
    expect(Vector3.Distance(m.grip, m.handPos)).toBeLessThan(0.03);
    expect(Vector3.Distance(m.rootPos, m.handPos)).toBeLessThan(0.1);
    // Stock behind the hand at shoulder height.
    expect(m.stock.z).toBeGreaterThan(m.handPos.z + 0.1);
    expect(m.stock.y).toBeGreaterThan(m.handPos.y - 0.1);
  });

  it("idle ready pose: seats the shotgun steeper than the rifle", () => {
    makeScene();
    const sg = seatInReadyPose("idle", "shotgun", "atm-s-idle");
    const ar = seatInReadyPose("idle", "assault_rifle", "atm-ar-idle");
    expect(sg.barrel.z).toBeLessThan(-0.98);
    expect(sg.barrel.y).toBeLessThan(-0.1);
    expect(sg.barrel.y).toBeGreaterThan(-0.21);
    expect(Math.abs(sg.barrel.x)).toBeLessThan(0.05);
    expect(sg.up.y).toBeGreaterThan(0.95);
    expect(Vector3.Distance(sg.grip, sg.handPos)).toBeLessThan(0.03);
    expect(Vector3.Distance(sg.rootPos, sg.handPos)).toBeLessThan(0.1);
    // The shotgun is held with a steeper (more downward) pitch than the AR.
    expect(sg.barrel.y).toBeLessThan(ar.barrel.y);
  });

  it("crouch ready pose: holds the same seat for both weapons", () => {
    makeScene();
    for (const weaponType of ["assault_rifle", "shotgun"] as const) {
      const m = seatInReadyPose("crouch", weaponType, `atm-${weaponType}-crouch`);
      expect(m.barrel.z, `${weaponType} muzzle z`).toBeLessThan(-0.98);
      expect(Math.abs(m.barrel.x), `${weaponType} lateral`).toBeLessThan(0.05);
      expect(m.up.y, `${weaponType} up`).toBeGreaterThan(0.9);
      expect(Vector3.Distance(m.grip, m.handPos)).toBeLessThan(0.03);
      expect(Vector3.Distance(m.rootPos, m.handPos)).toBeLessThan(0.1);
    }
  });
});

describe("shipped values — rest-pose sanity (non-authoritative)", () => {
  /**
   * The GLB rest-pose hand frame rotates substantially relative to the
   * animated ready frame (fingers down at the side), so the ready-pose-tuned
   * table does NOT seat the muzzle forward in the rest pose — that is an
   * accepted tradeoff: the production character always presents an authored
   * animation, and the rest pose is only ever an unanimated GLB preview.
   * The rest-pose check therefore only requires that the weapon stays
   * attached sensibly: root hugging the hand joint, no displacement.
   */
  async function seatAtRest(
    weaponType: "assault_rifle" | "shotgun",
    prefix: string,
  ): Promise<{ handPos: Vector3; rootPos: Vector3; barrel: Vector3 }> {
    const model = await buildCharacter(prefix);
    const hand = scene.getTransformNodeByName(`${prefix}-hand_r`);
    expect(hand).not.toBeNull();
    hand!.computeWorldMatrix(true);
    const handPos = hand!.getAbsolutePosition();

    const weapon = WeaponModelPresentation.create(scene, `${prefix}w`);
    if (weaponType === "shotgun") weapon.setEquippedWeapon("shotgun");
    const transform = getWeaponAttachmentTransform(weaponType);
    weapon.attachTo(hand!, transform.position, transform.rotation);
    weapon.root.computeWorldMatrix(true);

    const wm = weapon.root.getWorldMatrix();
    const barrel = Vector3.TransformNormal(new Vector3(0, 0, -1), wm).normalize();
    const rootPos = weapon.root.getAbsolutePosition();

    weapon.dispose();
    model.dispose();
    return { handPos, rootPos, barrel };
  }

  it("keeps both weapons attached to the rest-pose hand joint", async () => {
    makeScene();
    for (const weaponType of ["assault_rifle", "shotgun"] as const) {
      const m = await seatAtRest(weaponType, `atm-${weaponType}-rest`);
      // Weapon root hugs the hand joint (no displacement or explosion).
      expect(Vector3.Distance(m.rootPos, m.handPos)).toBeLessThan(0.1);
      // Muzzle axis stays a finite unit direction.
      isFiniteVector(m.barrel);
      expect(Math.abs(m.barrel.lengthSquared() - 1)).toBeLessThan(1e-6);
    }
  });
});
