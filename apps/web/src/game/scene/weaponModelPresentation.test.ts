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
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
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

/** The owned per-weapon group transform (drives the held-weapon dip). */
function rifleGroupOf(scene: Scene): TransformNode {
  const node = scene.transformNodes.find(
    (t) => t.name === `${PREFIX}-rifle-group`,
  );
  expect(node, "rifle group").toBeDefined();
  return node as TransformNode;
}

/** The owned per-weapon group transform (drives the held-weapon dip). */
function shotgunGroupOf(scene: Scene): TransformNode {
  const node = scene.transformNodes.find(
    (t) => t.name === `${PREFIX}-shotgun-group`,
  );
  expect(node, "shotgun group").toBeDefined();
  return node as TransformNode;
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
    expect(() => wm!.setReload(true, 0.5)).not.toThrow();
    expect(() => wm!.update(1 / 60)).not.toThrow();
    expect(wm.equippedWeapon).toBe("assault_rifle"); // unchanged
    expect(weaponMeshes(scene, PREFIX)).toHaveLength(0);
    expect(weaponMaterials(scene, PREFIX)).toHaveLength(0);
  });

  it(
    "registers exactly one before-render observer and removes it on dispose",
    async () => {
      ({ engine, scene } = makeScene());
      wm = WeaponModelPresentation.create(scene, PREFIX);
      expect(scene.onBeforeRenderObservable.observers).toHaveLength(1);
      wm.dispose();
      // Babylon defers observer removal to the next tick.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(scene.onBeforeRenderObservable.observers).toHaveLength(0);
    },
  );

  it("reloading dips the held weapon at mid-reload and returns it to rest", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);

    const rifle = rifleGroupOf(scene);
    expect(rifle.position.y).toBeCloseTo(0, 6);

    // Mid-reload the weapon is lowered (negative Y).
    wm.setReload(true, 0.5);
    expect(rifle.position.y).toBeLessThan(0);

    // The dip peaks at the middle, not near the start.
    const midDip = -rifle.position.y;
    wm.setReload(true, 0.15);
    expect(-rifle.position.y).toBeLessThan(midDip);

    // Back to rest at the end of the reload and when idle.
    wm.setReload(true, 1);
    expect(rifle.position.y).toBeCloseTo(0, 6);
    wm.setReload(false, 0.5);
    expect(rifle.position.y).toBeCloseTo(0, 6);
  });

  it("switching weapons dips the newly-equipped weapon, then eases it to rest", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);

    const shotgun = shotgunGroupOf(scene);
    // Switch to the shotgun: it starts dipped (low) ...
    wm.setEquippedWeapon("shotgun");
    expect(shotgun.position.y).toBeLessThan(0);

    // ... and eases back to rest over a short, deliberate settle.
    for (let i = 0; i < 120; i += 1) wm.update(1 / 60);
    expect(shotgun.position.y).toBeCloseTo(0, 6);
  });

  it("applies the held-weapon dip only to the equipped weapon group", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);

    const rifle = rifleGroupOf(scene);
    const shotgun = shotgunGroupOf(scene);

    wm.setReload(true, 0.5);
    expect(rifle.position.y).toBeLessThan(0); // equipped rifle is dipped
    expect(shotgun.position.y).toBeCloseTo(0, 6); // hidden shotgun stays at rest
  });

  it("does not advance the switch-dip settle on a zero or negative delta", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);

    wm.setEquippedWeapon("shotgun");
    const shotgun = shotgunGroupOf(scene);
    const dipped = shotgun.position.y;
    expect(dipped).toBeLessThan(0);

    wm.update(0);
    wm.update(-1);
    expect(shotgun.position.y).toBeCloseTo(dipped, 6);
  });
});
