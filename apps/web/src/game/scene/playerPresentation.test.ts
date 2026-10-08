/**
 * Behavioral NullEngine tests for PlayerPresentation — the modular low-poly
 * player body:
 *  - built from a bounded set of Babylon primitives/materials, no external
 *    assets, inside the player collider envelope (feet at -0.9 m)
 *  - local vs remote variants are visually distinct
 *  - setTransform moves the body and orients the forward visor (yaw 0 = -Z,
 *    positive yaw toward +X — the shared movement convention)
 *  - applyState: eliminated palette, hit-flash decay contract, base restore
 *  - setEnabled hides/shows every owned mesh
 *  - dispose releases every owned mesh and material and is idempotent;
 *    all methods are safe no-ops after dispose
 */
import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PLAYER_COLLIDER_TOTAL_HEIGHT } from "@buildshift/game-config";
import { PlayerPresentation } from "./PlayerPresentation";

function makeScene(): { engine: NullEngine; scene: Scene } {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  return { engine, scene };
}

function ownedMeshes(scene: Scene, prefix: string) {
  return scene.meshes.filter((m) => m.name.startsWith(prefix));
}

function ownedMaterials(scene: Scene, prefix: string) {
  return scene.materials.filter((m) => m.name.startsWith(prefix));
}

/**
 * World-space Y extent [min, max] of every owned mesh. Transforms each mesh's
 * local bounding-box corners through its world matrix (Babylon 9 no longer
 * exposes getWorldBoundingBox).
 */
function worldYExtent(scene: Scene, prefix: string): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const mesh of ownedMeshes(scene, prefix)) {
    mesh.computeWorldMatrix(true);
    const worldMatrix = mesh.getWorldMatrix();
    const localBox = mesh.getBoundingInfo().boundingBox;
    // Enumerate the 8 corners of the axis-aligned local box.
    const xs = [localBox.minimum.x, localBox.maximum.x];
    const ys = [localBox.minimum.y, localBox.maximum.y];
    const zs = [localBox.minimum.z, localBox.maximum.z];
    for (const x of xs) {
      for (const y of ys) {
        for (const z of zs) {
          const world = Vector3.TransformCoordinates(new Vector3(x, y, z), worldMatrix);
          min = Math.min(min, world.y);
          max = Math.max(max, world.y);
        }
      }
    }
  }
  return [min, max];
}

describe("PlayerPresentation", () => {
  let engine: NullEngine | undefined;
  let scene: Scene | undefined;
  let local: PlayerPresentation | undefined;
  let remote: PlayerPresentation | undefined;

  afterEach(() => {
    local?.dispose();
    remote?.dispose();
    engine?.dispose();
    local = undefined;
    remote = undefined;
    scene = undefined;
  });

  it("builds a bounded body from primitives inside the collider envelope", () => {
    ({ engine, scene } = makeScene());
    local = PlayerPresentation.create(scene, "local", "local-player");

    const meshes = ownedMeshes(scene, "local-player");
    const materials = ownedMaterials(scene, "local-player");
    // 11 primitive meshes, 3 shared materials — a bounded, lightweight body.
    expect(meshes).toHaveLength(11);
    expect(materials).toHaveLength(3);
    // Low-poly: every material is plain (no textures) and every mesh is safe
    // (not pickable, no collisions).
    for (const material of materials) {
      expect((material as StandardMaterial).diffuseTexture).toBeNull();
    }
    for (const mesh of meshes) {
      expect(mesh.isPickable).toBe(false);
      expect(mesh.checkCollisions).toBe(false);
      expect(mesh.parent).toBe(local.visualRoot);
    }

    // The body stands on the same feet line the capsule collider implies
    // (centre at 0, feet at -0.9) and never exceeds the collider envelope.
    const [minY, maxY] = worldYExtent(scene, "local-player");
    expect(minY).toBeCloseTo(-PLAYER_COLLIDER_TOTAL_HEIGHT / 2, 4);
    expect(maxY).toBeLessThanOrEqual(PLAYER_COLLIDER_TOTAL_HEIGHT / 2);
  });

  it("local and remote variants are visually distinct", () => {
    ({ engine, scene } = makeScene());
    local = PlayerPresentation.create(scene, "local", "local-player");
    remote = PlayerPresentation.create(scene, "remote", "remote-player");

    const localBody = local.bodyMaterial.diffuseColor;
    const remoteBody = remote.bodyMaterial.diffuseColor;
    // Green side vs red side — distinct at a glance and from a distance.
    expect(localBody.g).toBeGreaterThan(localBody.r + 0.2);
    expect(remoteBody.r).toBeGreaterThan(remoteBody.g + 0.2);
    // No shared material instances between the two players.
    expect(local.bodyMaterial).not.toBe(remote.bodyMaterial);
    expect(local.bodyMaterial.name).not.toBe(remote.bodyMaterial.name);
  });

  it("setTransform moves the body and orients the visor along the facing yaw", () => {
    ({ engine, scene } = makeScene());
    local = PlayerPresentation.create(scene, "local", "local-player");

    // Yaw 0 faces -Z: the visor sits in front of the head toward -Z.
    local.setTransform({ x: 0, y: 0, z: 0 }, 0);
    local.root.computeWorldMatrix(true);
    local.visorMesh.computeWorldMatrix(true);
    expect(local.visorMesh.getAbsolutePosition().z).toBeLessThan(-0.1);

    // Yaw PI/2 rotates forward toward +X (shared movement convention).
    local.setTransform({ x: 2, y: 0.5, z: -1 }, Math.PI / 2);
    expect(local.root.position.asArray()).toEqual([2, 0.5, -1]);
    local.root.computeWorldMatrix(true);
    local.visorMesh.computeWorldMatrix(true);
    const visorPos = local.visorMesh.getAbsolutePosition();
    expect(visorPos.x).toBeGreaterThan(local.root.position.x + 0.1);
    expect(Math.abs(visorPos.z - local.root.position.z)).toBeLessThan(0.1);
  });

  it("keeps the gameplay root unchanged while lifting replicated feet-based visuals", () => {
    engine = new NullEngine();
    scene = new Scene(engine);
    local = PlayerPresentation.create(scene, "local", "local-player");
    remote = PlayerPresentation.create(scene, "remote", "remote-player");

    local.setTransform({ x: 1, y: 0, z: 2 }, 0);
    remote.setTransform({ x: -1, y: 0, z: -2 }, 0);

    expect(local.root.position.y).toBe(0);
    expect(remote.root.position.y).toBe(0);
    expect(local.visualRoot.position.y).toBeCloseTo(0.9, 6);
    expect(remote.visualRoot.position.y).toBeCloseTo(0.9, 6);
  });

  it("applyState: eliminated darkens, hit flash decays, base colors restore", () => {
    ({ engine, scene } = makeScene());
    local = PlayerPresentation.create(scene, "local", "local-player");

    const body = local.bodyMaterial;
    const baseEmissive = body.emissiveColor.clone();

    // Eliminated: shared dark palette, flash counter untouched.
    let frames = local.applyState(true, 4);
    expect(frames).toBe(4);
    expect(body.diffuseColor.r).toBeLessThan(0.2);
    {
      const e = body.emissiveColor;
      expect(e.r * e.r + e.g * e.g + e.b * e.b).toBeCloseTo(0, 5);
    }

    // Hit flash: warm emissive and the frame counter decays by one per call.
    frames = local.applyState(false, 3);
    expect(frames).toBe(2);
    expect(body.emissiveColor.r).toBeGreaterThan(0.5);
    frames = local.applyState(false, 2);
    expect(frames).toBe(1);

    // When the counter runs out the variant's base palette is restored.
    frames = local.applyState(false, 1);
    expect(frames).toBe(0);
    local.applyState(false, 0);
    expect(body.emissiveColor.asArray()).toEqual(baseEmissive.asArray());
    expect(body.emissiveColor.asArray()).not.toEqual([0.75, 0.22, 0.05]);
  });

  it("setEnabled hides and shows every owned mesh", () => {
    ({ engine, scene } = makeScene());
    local = PlayerPresentation.create(scene, "local", "local-player");

    local.setEnabled(false);
    const meshes = ownedMeshes(scene, "local-player");
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      expect(mesh.isEnabled()).toBe(false);
    }

    local.setEnabled(true);
    for (const mesh of meshes) {
      expect(mesh.isEnabled()).toBe(true);
    }
  });

  it("dispose releases every owned mesh and material and is idempotent", () => {
    ({ engine, scene } = makeScene());
    local = PlayerPresentation.create(scene, "local", "local-player");
    remote = PlayerPresentation.create(scene, "remote", "remote-player");
    expect(ownedMeshes(scene, "local-player").length).toBeGreaterThan(0);
    expect(ownedMeshes(scene, "remote-player").length).toBeGreaterThan(0);

    local.dispose();
    expect(local.isDisposed).toBe(true);
    expect(() => local!.dispose()).not.toThrow();
    expect(ownedMeshes(scene, "local-player")).toHaveLength(0);
    expect(ownedMaterials(scene, "local-player")).toHaveLength(0);
    // The other player's presentation is untouched.
    expect(ownedMeshes(scene, "remote-player").length).toBeGreaterThan(0);
  });

  it("every method is a safe no-op after dispose", () => {
    ({ engine, scene } = makeScene());
    local = PlayerPresentation.create(scene, "local", "local-player");
    local.dispose();

    expect(() => local!.setTransform({ x: 1, y: 2, z: 3 }, 1)).not.toThrow();
    expect(() => local!.setEnabled(false)).not.toThrow();
    expect(local.applyState(true, 2)).toBe(2);
    expect(ownedMeshes(scene, "local-player")).toHaveLength(0);
    expect(ownedMaterials(scene, "local-player")).toHaveLength(0);
  });
});
