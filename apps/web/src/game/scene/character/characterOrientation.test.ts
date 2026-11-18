/**
 * Character-facing regression (asset anatomical orientation vs the shared
 * gameplay yaw convention).
 *
 * Root cause pinned here: the shipped `BuildShiftBaseCharacter.glb` carries
 * its ANATOMICAL front on the imported rig's local +Z (measured on the real
 * asset via the “Eyes”/“Eyebrows” face landmarks, centred at z ≈ +0.07 in
 * bind space). The shared BuildShift presentation convention shows a
 * body's front on local -Z (yaw 0 faces -Z, positive toward +X; the runtime
 * writes `root.rotation.y = -yaw`). Left uncorrected, the humanoid faces
 * away from its aim — the third-person follow camera sees the face instead
 * of the back. The fix is a single asset-specific 180° normalization
 * (`CHARACTER_ASSET_ORIENTATION_YAW_OFFSET`) written through the model
 * node's `rotationQuaternion` (a plain `rotation.y` write is silently
 * ignored because the glTF importer represents node rotations as
 * quaternions — the second bug pinned here). The shared yaw convention,
 * camera, movement, and network authority are untouched.
 *
 * These checks exercise the PRODUCTION asset path: the real GLB from
 * `public/assets/character/`, the same `CharacterModel` construction
 * `createCharacterPresentation` performs, and the measured face-landmark
 * geometry — not an injected arbitrary offset.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import {
  CHARACTER_ASSET_ORIENTATION_YAW_OFFSET,
  CHARACTER_ASSET_URL,
  CharacterAsset,
  defaultCharacterAssetOrientationYawOffset,
} from "./characterAsset";
import { CharacterModel, type CharacterVariant } from "./CharacterModel";
import { CharacterWeaponAttachment } from "./CharacterWeaponAttachment";
import { WeaponModelPresentation } from "../WeaponModelPresentation";
import { getWeaponAttachmentTransform } from "./weaponAttachmentTransforms";

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

async function loadAsset(): Promise<CharacterAsset> {
  const bytes = readFileSync(GLB_PATH);
  return CharacterAsset.fromBuffer(new Uint8Array(bytes).buffer, scene);
}

/** The production default construction (same options createCharacterPresentation resolves). */
async function buildProductionCharacter(
  prefix: string,
  variant: CharacterVariant = "local",
  orientationYawOffset = defaultCharacterAssetOrientationYawOffset(CHARACTER_ASSET_URL),
): Promise<CharacterModel> {
  const asset = await loadAsset();
  const model = await CharacterModel.create(scene, asset, variant, prefix, {
    orientationYawOffset,
  });
  model.setEnabled(true);
  return model;
}

/**
 * Horizontal anatomical-front direction from the rig's real eye landmark:
 * the instantiated “Eyes” mesh centre offset from the gameplay root axis.
 */
function anatomicalFront(model: CharacterModel, prefix: string): Vector3 {
  const eyes = scene.getMeshByName(`${prefix}-Eyes`) as Mesh | null;
  expect(eyes, `eyes landmark mesh for ${prefix}`).not.toBeNull();
  eyes!.computeWorldMatrix(true);
  const centre = eyes!.getBoundingInfo().boundingBox.centerWorld;
  const dir = new Vector3(
    centre.x - model.root.position.x,
    0,
    centre.z - model.root.position.z,
  );
  expect(dir.length()).toBeGreaterThan(0.02); // the landmark must sit clearly off-axis
  return dir.normalize();
}

/** Shared yaw convention: aim = (sin yaw, 0, -cos yaw) — yaw 0 faces -Z, positive toward +X. */
const aimOf = (yaw: number): Vector3 =>
  new Vector3(Math.sin(yaw), 0, -Math.cos(yaw));

describe("character asset anatomical orientation (measured)", () => {
  it("bind-space face landmarks sit on imported local +Z — the measured 180° mismatch", async () => {
    makeScene();
    // Generic (uncorrected) construction documents the RAW asset truth:
    // the eyes point at imported local +Z, i.e. AWAY from the presented
    // forward. This is the wrong-way-facing bug, pinned as an asset
    // property — asset orientation, not the gameplay yaw sign.
    const model = await buildProductionCharacter("orient-raw", "local", 0);
    const front = anatomicalFront(model, "orient-raw");
    expect(front.z).toBeGreaterThan(0.9);
    model.dispose();
  });

  it("the metadata correction brings the anatomical front onto presented local -Z (yaw 0)", async () => {
    makeScene();
    expect(CHARACTER_ASSET_ORIENTATION_YAW_OFFSET).toBeCloseTo(Math.PI, 12);
    const model = await buildProductionCharacter("orient-fix");
    const front = anatomicalFront(model, "orient-fix");
    // Camera looking from behind along the aim sees the back: front points
    // along -Z, opposite the follow camera's viewing direction.
    expect(front.z).toBeLessThan(-0.9);
    model.dispose();
  });

  it("the corrected rig stays centred on the root axis despite off-axis bounds (cape)", async () => {
    makeScene();
    const model = await buildProductionCharacter("orient-centre");
    const body = scene.getMeshByName("orient-centre-SuperHero_Male") as Mesh | null;
    expect(body).not.toBeNull();
    body!.computeWorldMatrix(true);
    const centre = body!.getBoundingInfo().boundingBox.centerWorld;
    expect(Math.abs(centre.x - model.root.position.x)).toBeLessThan(0.01);
    expect(Math.abs(centre.z - model.root.position.z)).toBeLessThan(0.01);
    model.dispose();
  });
});

describe("cardinal facing under the shared yaw convention (production path)", () => {
  // NO scene.animate() ticks here: the transform mirror alone must orient
  // the presentation, proving the correction lives in the transform
  // hierarchy rather than an animation or a yaw-sign change.
  for (const [name, yaw] of [
    ["yaw 0 → -Z", 0],
    ["yaw π/2 → +X", Math.PI / 2],
    ["yaw π → +Z", Math.PI],
    ["yaw -π/2 → -X", -Math.PI / 2],
  ] as const) {
    it(`local and remote anatomical front tracks aim at ${name}`, async () => {
      makeScene();
      for (const variant of ["local", "remote"] as CharacterVariant[]) {
        const prefix = `face-${name.split(" ")[0]}-${variant}`;
        const model = await buildProductionCharacter(prefix, variant);
        model.setTransform({ x: variant === "remote" ? 4 : 0, y: 0, z: 0 }, yaw);
        const front = anatomicalFront(model, prefix);
        const aim = aimOf(yaw);
        expect(
          Vector3.Dot(front, aim),
          `${variant} front must face the aim`,
        ).toBeGreaterThan(0.99);
        // The root keeps the untouched shared contract: rotation.y = -yaw.
        expect(model.root.rotation.y).toBeCloseTo(-yaw, 12);
        model.dispose();
      }
    });
  }
});

describe("weapon presentation under the corrected facing", () => {
  it("production table keeps the muzzle aim-aligned and gripped at the hand in the ready pose", async () => {
    makeScene();
    scene.useConstantAnimationDeltaTime = true;
    const model = await buildProductionCharacter("orient-w");
    const attachment = CharacterWeaponAttachment.create(scene, "orient-w");
    for (const weaponType of ["assault_rifle", "shotgun"] as const) {
      const weapon = WeaponModelPresentation.create(scene, `orientW${weaponType}`);
      weapon.setEquippedWeapon(weaponType);
      const t = getWeaponAttachmentTransform(weaponType);
      attachment.attach(weapon, {
        localOffset: t.position,
        localRotation: t.rotation,
        localScale: t.scale,
      });
      model.setTransform({ x: 0, y: 0, z: 0 }, 0);
      for (let i = 0; i < 40; i++) {
        scene.onBeforeAnimationsObservable.notifyObservers(scene);
        scene.animate();
      }
      weapon.root.computeWorldMatrix(true);
      const muzzle = Vector3.TransformNormal(
        new Vector3(0, 0, -1),
        weapon.root.getWorldMatrix(),
      ).normalize();
      // Aim axis -Z with a small downward pitch (pre-fix shipped behaviour,
      // preserved exactly by the retuned seating).
      expect(muzzle.z, weaponType).toBeLessThan(-0.97);
      expect(muzzle.y, weaponType).toBeLessThan(-0.08);
      expect(muzzle.y, weaponType).toBeGreaterThan(-0.22);
      expect(Math.abs(muzzle.x), weaponType).toBeLessThan(0.05);
      // Grip preserved: the seat sits at the table's hand-local offset,
      // scaled by the character normalisation scale (~0.989) at the joint.
      const grip = Vector3.Distance(
        weapon.root.getAbsolutePosition(),
        attachment.socket.getAbsolutePosition(),
      );
      const localLen = Math.hypot(t.position.x, t.position.y, t.position.z);
      expect(Math.abs(grip - localLen * model.scale), weaponType).toBeLessThan(0.02);
      weapon.dispose();
    }
    attachment.dispose();
    model.dispose();
  });

  it("the muzzle orbits with the body so aim holds at cardinal yaws", async () => {
    makeScene();
    scene.useConstantAnimationDeltaTime = true;
    const model = await buildProductionCharacter("orient-yaw");
    const attachment = CharacterWeaponAttachment.create(scene, "orient-yaw");
    const weapon = WeaponModelPresentation.create(scene, "orientYawW");
    const t = getWeaponAttachmentTransform("assault_rifle");
    attachment.attach(weapon, {
      localOffset: t.position,
      localRotation: t.rotation,
      localScale: t.scale,
    });
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      model.setTransform({ x: 0, y: 0, z: 0 }, yaw);
      for (let i = 0; i < 60; i++) {
        scene.onBeforeAnimationsObservable.notifyObservers(scene);
        scene.animate();
      }
      weapon.root.computeWorldMatrix(true);
      const muzzle = Vector3.TransformNormal(
        new Vector3(0, 0, -1),
        weapon.root.getWorldMatrix(),
      ).normalize();
      const horizontal = new Vector3(muzzle.x, 0, muzzle.z).normalize();
      expect(
        Vector3.Dot(horizontal, aimOf(yaw)),
        `muzzle horizontal aim at yaw ${yaw}`,
      ).toBeGreaterThan(0.995);
    }
    weapon.dispose();
    attachment.dispose();
    model.dispose();
  });

  it("authored clips still drive the corrected rig: idle plays and crouch lowers the hand", async () => {
    makeScene();
    scene.useConstantAnimationDeltaTime = true;
    const model = await buildProductionCharacter("orient-anim");
    const attachment = CharacterWeaponAttachment.create(scene, "orient-anim");
    model.setTransform({ x: 0, y: 0, z: 0 }, 0);
    const tick = () => {
      for (let i = 0; i < 40; i++) {
        scene.onBeforeAnimationsObservable.notifyObservers(scene);
        scene.animate();
      }
    };
    tick();
    expect(model.animationState).toBe("idle");
    const hand = attachment.socket;
    hand.computeWorldMatrix(true);
    const standing = hand.getAbsolutePosition().clone();
    model.setCrouchBlend(1);
    tick();
    hand.computeWorldMatrix(true);
    expect(hand.getAbsolutePosition().y).toBeLessThan(standing.y - 0.15);
    attachment.dispose();
    model.dispose();
  });
});

describe("orientation metadata scoping (generic convention preserved)", () => {
  it("applies the measured correction only to the shipped default asset", () => {
    expect(defaultCharacterAssetOrientationYawOffset(CHARACTER_ASSET_URL)).toBeCloseTo(
      Math.PI,
      12,
    );
    // Any other asset keeps the neutral -Z-front convention (and explicit
    // caller overrides always win — see createCharacterPresentation).
    expect(defaultCharacterAssetOrientationYawOffset("/assets/other.glb")).toBe(0);
  });
});
