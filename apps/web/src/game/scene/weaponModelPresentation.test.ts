/**
 * Behavioral NullEngine tests for WeaponModelPresentation:
 *  - both weapons build from a bounded set of Babylon primitives (13 boxes,
 *    2 shared materials, no textures)
 *  - the assault rifle silhouette is longer than the shotgun's (z-extent)
 *  - the shotgun silhouette is taller/chunkier than the rifle's (y-extent)
 *  - default shows the rifle, hides the shotgun
 *  - setEquippedWeapon toggles visibility without allocation
 *  - setEquippedWeapon with the same weapon is a no-op
 *  - setEnabled(false) hides all meshes; setEnabled(true) restores only the
 *    currently equipped weapon's meshes
 *  - each weapon group carries a geometry-free muzzle anchor at its tip
 *  - getMuzzlePosition reports the equipped weapon's barrel tip in world
 *    space (follows the root transform, the dip, and the aim tilt)
 *  - the held weapon tilts with the active camera's aim pitch, clamped
 *  - reload dips the held weapon (position + muzzle-down tilt) at
 *    mid-reload; switching dips the new weapon and eases it back to rest
 *  - dispose is idempotent and releases every owned mesh/material/node
 *  - all methods are safe no-ops after dispose
 */
import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
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

function prefixNodes(scene: Scene, prefix: string): TransformNode[] {
  return scene.transformNodes.filter((t) => t.name.startsWith(prefix));
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

/** The geometry-free muzzle anchor of a weapon group. */
function muzzleAnchorOf(scene: Scene, name: string): TransformNode {
  const node = scene.transformNodes.find((t) => t.name === name);
  expect(node, name).toBeDefined();
  return node as TransformNode;
}

/**
 * Settles the switch dip + aim follow to rest by feeding fixed frames.
 * (No camera in the test scene, so the aim target is 0.)
 */
function settleToRest(wm: WeaponModelPresentation, frames = 120): void {
  for (let i = 0; i < frames; i += 1) wm.update(1 / 60);
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
    // 6 rifle boxes + 7 shotgun boxes = 13; 2 shared materials.
    expect(meshes).toHaveLength(13);
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
    // The light rifle keeps a slim barrel (thinnest rifle box < 0.02).
    const rifleBarrel = rifleMeshes.find((m) => m.name.includes("barrel"))!;
    const rifleBb = rifleBarrel.getBoundingInfo().boundingBox;
    expect(rifleBb.maximum.x - rifleBb.minimum.x).toBeCloseTo(0.016, 3);
  });

  it("shotgun silhouette is taller (chunkier) than the rifle's", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);

    const rifleMeshes = rifleMeshesOf(scene);
    const shotgunMeshes = shotgunMeshesOf(scene);

    const rifleHeight = yExtent(rifleMeshes);
    const shotgunHeight = yExtent(shotgunMeshes);
    // Shotgun is taller (pump + wide receiver) than the slim rifle.
    expect(shotgunHeight).toBeGreaterThan(rifleHeight);
    // The heavy shotgun keeps a thick, wide barrel.
    const shotgunBarrel = shotgunMeshes.find((m) => m.name.includes("barrel"))!;
    const shotgunBb = shotgunBarrel.getBoundingInfo().boundingBox;
    expect(shotgunBb.maximum.x - shotgunBb.minimum.x).toBeCloseTo(0.045, 3);
  });

  it("carries two accent hand grips on each weapon (two-handed hold)", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);

    for (const name of [
      `${PREFIX}-rifle-hand-rear`,
      `${PREFIX}-rifle-hand-front`,
      `${PREFIX}-shotgun-hand-rear`,
      `${PREFIX}-shotgun-hand-front`,
    ]) {
      const hand = scene.meshes.find((m) => m.name === name);
      expect(hand, name).toBeTruthy();
      // Hands sit below the weapon axis, gripping it.
      expect(hand!.position.y).toBeLessThan(0);
    }
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

  it("dispose releases every owned mesh, material, and node and is idempotent", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);
    expect(weaponMeshes(scene, PREFIX).length).toBeGreaterThan(0);
    expect(weaponMaterials(scene, PREFIX).length).toBeGreaterThan(0);
    expect(prefixNodes(scene, PREFIX).length).toBeGreaterThan(0);

    wm.dispose();
    expect(wm.isDisposed).toBe(true);
    expect(() => wm!.dispose()).not.toThrow();
    expect(weaponMeshes(scene, PREFIX)).toHaveLength(0);
    expect(weaponMaterials(scene, PREFIX)).toHaveLength(0);
    // Root, both weapon groups, and both muzzle anchors are released.
    expect(prefixNodes(scene, PREFIX)).toHaveLength(0);
  });

  it("every method is a safe no-op after dispose", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);
    wm.dispose();

    expect(() => wm!.setEquippedWeapon("shotgun")).not.toThrow();
    expect(() => wm!.setEnabled(false)).not.toThrow();
    expect(() => wm!.setReload(true, 0.5)).not.toThrow();
    expect(() => wm!.update(1 / 60)).not.toThrow();
    const out = new Vector3(9, 9, 9);
    expect(() => wm!.getMuzzlePosition(out)).not.toThrow();
    expect(out).toEqual(new Vector3(0, 0, 0));
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

  it("each weapon group carries a geometry-free muzzle anchor at its barrel tip", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);

    const rifleAnchor = muzzleAnchorOf(scene, `${PREFIX}-rifle-muzzle-anchor`);
    const shotgunAnchor = muzzleAnchorOf(scene, `${PREFIX}-shotgun-muzzle-anchor`);
    // Anchors ride the weapon groups (so dips / aim tilt move the muzzle) ...
    expect(rifleAnchor.parent).toBe(rifleGroupOf(scene));
    expect(shotgunAnchor.parent).toBe(shotgunGroupOf(scene));
    // ... and sit at the forward-most (most negative Z) point of the weapon.
    expect(rifleAnchor.position.z).toBeCloseTo(-0.48, 3);
    expect(shotgunAnchor.position.z).toBeCloseTo(-0.33, 3);
    // They are not renderable meshes.
    expect(scene.meshes).not.toContain(rifleAnchor);
    expect(scene.meshes).not.toContain(shotgunAnchor);
  });

  it("getMuzzlePosition reports the equipped weapon's barrel tip in world space", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);
    // Place the root like the runtime does on the player's presentation root.
    wm.root.position.set(0, 0.02, -0.22);

    const out = new Vector3();
    // Rifle tip: anchor local -0.48 + root offset -0.22 = -0.70.
    wm.getMuzzlePosition(out);
    expect(out.x).toBeCloseTo(0, 5);
    expect(out.y).toBeCloseTo(0.02, 5);
    expect(out.z).toBeCloseTo(-0.7, 5);

    // Switching changes which barrel tip is reported.
    wm.setEquippedWeapon("shotgun");
    settleToRest(wm);
    wm.getMuzzlePosition(out);
    expect(out.z).toBeCloseTo(-0.55, 5);
  });

  it("the muzzle position follows the reload dip", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);
    wm.root.position.set(0, 0.02, -0.22);

    const out = new Vector3();
    wm.getMuzzlePosition(out);
    const restY = out.y;

    // Mid-reload the equipped group (and its muzzle anchor) is lowered.
    wm.setReload(true, 0.5);
    wm.getMuzzlePosition(out);
    expect(out.y).toBeLessThan(restY);

    // Back at rest the muzzle returns to the resting height.
    wm.setReload(true, 1);
    wm.getMuzzlePosition(out);
    expect(out.y).toBeCloseTo(restY, 5);
  });

  it("the held weapon tilts with the active camera aim pitch (clamped)", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);
    wm.root.position.set(0, 0.02, -0.22);

    const rifle = rifleGroupOf(scene);
    const cam = new FreeCamera("aim-cam", new Vector3(0, 0, 0), scene);
    scene.activeCamera = cam;

    // Looking up tilts the muzzle up (positive local rotation.x in this
    // engine). Babylon camera Euler: NEGATIVE rotation.x = looking up, and
    // the component reads the camera's real world direction.
    cam.rotation.x = -0.6;
    for (let i = 0; i < 120; i += 1) wm!.update(1 / 60);
    expect(rifle.rotation.x).toBeGreaterThan(0.5);
    expect(rifle.rotation.x).toBeLessThan(0.61);

    // The muzzle world position rises with the tilt.
    const out = new Vector3();
    wm!.getMuzzlePosition(out);
    expect(out.y).toBeGreaterThan(0.2);

    // Extreme aim is clamped — the weapon never over-tilts (an aim pitch
    // of ~1.47 rad exceeds the 1.15 rad follow clamp).
    cam.rotation.x = -1.5;
    for (let i = 0; i < 240; i += 1) wm!.update(1 / 60);
    expect(rifle.rotation.x).toBeCloseTo(1.15, 1);

    // A level aim eases the weapon back to rest.
    cam.rotation.x = 0;
    settleToRest(wm!, 300);
    expect(rifle.rotation.x).toBeCloseTo(0, 5);
  });

  it("does not follow the aim on a zero or negative delta (no camera either)", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);

    const cam = new FreeCamera("aim-cam", new Vector3(0, 0, 0), scene);
    scene.activeCamera = cam;
    cam.rotation.x = 0.6;

    // No valid frame delta: the tilt must not start moving.
    wm.update(0);
    wm.update(-1);
    const rifle = rifleGroupOf(scene);
    expect(rifle.rotation.x).toBeCloseTo(0, 6);
  });

  it("reloading dips the held weapon at mid-reload and returns it to rest", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);

    const rifle = rifleGroupOf(scene);
    expect(rifle.position.y).toBeCloseTo(0, 6);

    // Mid-reload the weapon is lowered (negative Y) ...
    wm.setReload(true, 0.5);
    expect(rifle.position.y).toBeLessThan(0);
    // ... with a muzzle-DOWN tilt (negative local rotation.x here).
    expect(rifle.rotation.x).toBeLessThan(0);

    // The dip peaks at the middle, not near the start.
    const midDip = -rifle.position.y;
    wm.setReload(true, 0.15);
    expect(-rifle.position.y).toBeLessThan(midDip);

    // Back to rest at the end of the reload and when idle.
    wm.setReload(true, 1);
    expect(rifle.position.y).toBeCloseTo(0, 6);
    expect(rifle.rotation.x).toBeCloseTo(0, 6);
    wm.setReload(false, 0.5);
    expect(rifle.position.y).toBeCloseTo(0, 6);
  });

  it("switching weapons dips the newly-equipped weapon, then eases it to rest", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);

    const shotgun = shotgunGroupOf(scene);
    // Switch to the shotgun: it starts dipped (low, muzzle down) ...
    wm.setEquippedWeapon("shotgun");
    expect(shotgun.position.y).toBeLessThan(0);
    expect(shotgun.rotation.x).toBeLessThan(0);

    // ... and eases back to rest over a short, deliberate settle.
    for (let i = 0; i < 120; i += 1) wm.update(1 / 60);
    expect(shotgun.position.y).toBeCloseTo(0, 6);
    expect(shotgun.rotation.x).toBeCloseTo(0, 6);
  });

  it("applies the held-weapon transform only to the equipped weapon group", () => {
    ({ engine, scene } = makeScene());
    wm = WeaponModelPresentation.create(scene, PREFIX);

    const rifle = rifleGroupOf(scene);
    const shotgun = shotgunGroupOf(scene);

    wm.setReload(true, 0.5);
    expect(rifle.position.y).toBeLessThan(0); // equipped rifle is dipped
    expect(shotgun.position.y).toBeCloseTo(0, 6); // hidden shotgun stays at rest
    expect(shotgun.rotation.x).toBeCloseTo(0, 6);
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
