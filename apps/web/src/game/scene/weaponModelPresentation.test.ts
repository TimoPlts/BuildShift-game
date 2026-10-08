/**
 * Behavioral NullEngine tests for WeaponModelPresentation:
 *  - both weapons build from a bounded set of Babylon primitives (7 meshes,
 *    2 shared materials, no textures)
 *  - the assault rifle silhouette is longer than the shotgun's (z-extent)
 *  - the shotgun silhouette is taller/stockier than the rifle's (y-extent)
 *  - default shows the rifle, hides the shotgun
 *  - setEquippedWeapon toggles visibility without allocation
 *  - setEquippedWeapon with the same weapon is a no-op
 *  - setEnabled(false) hides all meshes; setEnabled(true) restores only the
 *    currently equipped weapon's meshes
 *  - dispose is idempotent and releases every owned mesh/material
 *  - all methods are safe no-ops after dispose
 */
import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { WeaponModelPresentation } from "./WeaponModelPresentation";

const PREFIX = "weapon-model";

function makeScene(): { engine: NullEngine; scene: Scene } {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  return { engine, scene };
}

function weaponMeshes(scene: Scene, prefix: string): Mesh[] {
  return scene.meshes.filter((m): m is Mesh => m.name.startsWith(prefix));
}

function weaponMaterials(scene: Scene, prefix: string): StandardMaterial[] {
  return scene.materials.filter((m) => m.name.startsWith(prefix)) as StandardMaterial[];
}

/**
 * Z-extent (total length along the weapon's forward axis) of a group of
 * meshes positioned in local space (the test keeps the root at origin).
 */
function zExtent(meshes: Mesh[]): number {
  let min = Infinity;
  let max = -Infinity;
  for (const m of meshes) {
    const bb = m.getBoundingInfo().boundingBox;
    const dz = bb.maximum.z - bb.minimum.z;
    min = Math.min(min, m.position.z - dz / 2);
    max = Math.max(max, m.position.z + dz / 2);
  }
  return max - min;
}

/** Y-extent (total height) of a group of meshes in local space. */
function yExtent(meshes: Mesh[]): number {
  let min = Infinity;
  let max = -Infinity;
  for (const m of meshes) {
    const bb = m.getBoundingInfo().boundingBox;
    const dy = bb.maximum.y - bb.minimum.y;
    min = Math.min(min, m.position.y - dy / 2);
    max = Math.max(max, m.position.y + dy / 2);
  }
  return max - min;
}

function rifleMeshesOf(scene: Scene): Mesh[] {
  return scene.meshes.filter((m): m is Mesh => m.name.includes("rifle-"));
}

function shotgunMeshesOf(scene: Scene): Mesh[] {
  return scene.meshes.filter((m): m is Mesh => m.name.includes("shotgun-"));
}

describe("WeaponModelPresentation", () => {
  let engine: NullEngine | undefined;
  let scene: Scene | undefined;
  let wm: WeaponModelPresentation | undefined;

  afterEach(() => {
    wm?.dispose();
    engine?.dispose();
    wm = undefined;
    scene = undefined;
  });

  it("builds both weapons from a bounded set of primitives with no textures", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);

    const meshes = weaponMeshes(scene, PREFIX);
    const materials = weaponMaterials(scene, PREFIX);
    // 3 rifle meshes + 4 shotgun meshes = 7; 2 shared materials.
    expect(meshes).toHaveLength(7);
    expect(materials).toHaveLength(2);
    for (const mat of materials) {
      expect(mat.diffuseTexture).toBeNull();
    }
    for (const mesh of meshes) {
      expect(mesh.isPickable).toBe(false);
      expect(mesh.checkCollisions).toBe(false);
      expect(mesh.parent).toBeTruthy();
    }
  });

  it("assault rifle silhouette is longer than the shotgun's", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);

    const rifleMeshes = rifleMeshesOf(scene);
    const shotgunMeshes = shotgunMeshesOf(scene);
    expect(rifleMeshes.length).toBeGreaterThan(0);
    expect(shotgunMeshes.length).toBeGreaterThan(0);

    const rifleLength = zExtent(rifleMeshes);
    const shotgunLength = zExtent(shotgunMeshes);
    // Rifle is the long weapon; shotgun is shorter.
    expect(rifleLength).toBeGreaterThan(shotgunLength);
  });

  it("shotgun silhouette is taller (stockier) than the rifle's", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);

    const rifleMeshes = rifleMeshesOf(scene);
    const shotgunMeshes = shotgunMeshesOf(scene);

    const rifleHeight = yExtent(rifleMeshes);
    const shotgunHeight = yExtent(shotgunMeshes);
    // Shotgun is taller (pump + wider receiver) than the slim rifle.
    expect(shotgunHeight).toBeGreaterThan(rifleHeight);
  });

  it("default equipped weapon is the assault rifle; shotgun is hidden", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);

    expect(wm.equippedWeapon).toBe("assault_rifle");

    const rifleMeshes = rifleMeshesOf(scene);
    const shotgunMeshes = shotgunMeshesOf(scene);
    for (const m of rifleMeshes) expect(m.isEnabled()).toBe(true);
    for (const m of shotgunMeshes) expect(m.isEnabled()).toBe(false);
  });

  it("setEquippedWeapon switches which weapon silhouette is visible", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);

    const rifleMeshes = rifleMeshesOf(scene);
    const shotgunMeshes = shotgunMeshesOf(scene);

    // Switch to shotgun.
    wm.setEquippedWeapon("shotgun");
    expect(wm.equippedWeapon).toBe("shotgun");
    for (const m of rifleMeshes) expect(m.isEnabled()).toBe(false);
    for (const m of shotgunMeshes) expect(m.isEnabled()).toBe(true);

    // Switch back to rifle.
    wm.setEquippedWeapon("assault_rifle");
    expect(wm.equippedWeapon).toBe("assault_rifle");
    for (const m of rifleMeshes) expect(m.isEnabled()).toBe(true);
    for (const m of shotgunMeshes) expect(m.isEnabled()).toBe(false);
  });

  it("setEquippedWeapon with the same weapon is a no-op", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);

    const rifleMeshes = rifleMeshesOf(scene);
    // Already the rifle.
    expect(() => wm!.setEquippedWeapon("assault_rifle")).not.toThrow();
    for (const m of rifleMeshes) expect(m.isEnabled()).toBe(true);
  });

  it("setEnabled(false) hides all weapon meshes; setEnabled(true) restores only equipped", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);

    const rifleMeshes = rifleMeshesOf(scene);
    const shotgunMeshes = shotgunMeshesOf(scene);

    wm.setEnabled(false);
    for (const m of [...rifleMeshes, ...shotgunMeshes]) {
      expect(m.isEnabled()).toBe(false);
    }

    // Restore: rifle visible (still equipped), shotgun hidden.
    wm.setEnabled(true);
    for (const m of rifleMeshes) expect(m.isEnabled()).toBe(true);
    for (const m of shotgunMeshes) expect(m.isEnabled()).toBe(false);
  });

  it("setEnabled(true) after switching to shotgun shows only the shotgun", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);

    wm.setEquippedWeapon("shotgun");
    wm.setEnabled(false);
    wm.setEnabled(true);

    const rifleMeshes = rifleMeshesOf(scene);
    const shotgunMeshes = shotgunMeshesOf(scene);
    for (const m of rifleMeshes) expect(m.isEnabled()).toBe(false);
    for (const m of shotgunMeshes) expect(m.isEnabled()).toBe(true);
  });

  it("dispose releases every owned mesh and material and is idempotent", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);
    expect(weaponMeshes(scene, PREFIX).length).toBeGreaterThan(0);
    expect(weaponMaterials(scene, PREFIX).length).toBeGreaterThan(0);

    wm.dispose();
    expect(wm.isDisposed).toBe(true);
    expect(() => wm!.dispose()).not.toThrow();
    expect(weaponMeshes(scene, PREFIX)).toHaveLength(0);
    expect(weaponMaterials(scene, PREFIX)).toHaveLength(0);
  });

  it("every method is a safe no-op after dispose", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);
    wm.dispose();

    expect(() => wm!.setEquippedWeapon("shotgun")).not.toThrow();
    expect(() => wm!.setEnabled(false)).not.toThrow();
    expect(wm.equippedWeapon).toBe("assault_rifle"); // unchanged
    expect(weaponMeshes(scene, PREFIX)).toHaveLength(0);
    expect(weaponMaterials(scene, PREFIX)).toHaveLength(0);
  });
});
