/**
 * NullEngine tests for the Batch 2A rigged GLB character pipeline:
 *  - feet-root alignment of the loaded humanoid to the (predicted) player
 *    position, at the collider-envelope height
 *  - independent local/remote instances (transform, material, skeleton)
 *  - local vs remote creation with distinct variant material tints
 *  - deterministic scale (same buffer → same normalisation, repeatable)
 *  - idempotent disposal releasing every owned scene resource
 *  - explicit failures: corrupt buffer rejects with CharacterAssetLoadError;
 *    the factory falls back to the procedural PlayerPresentation with a
 *    reported reason when the asset cannot be loaded
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import {
  PLAYER_COLLIDER_TOTAL_HEIGHT,
} from "@buildshift/game-config";
import {
  CharacterAsset,
  CharacterAssetLoadError,
} from "./characterAsset";
import { CharacterModel } from "./CharacterModel";
import { createCharacterPresentation } from "./createCharacterPresentation";
import { PlayerPresentation } from "../PlayerPresentation";

const GLB_PATH = fileURLToPath(
  new URL("../../../../public/assets/character/RiggedFigure.glb", import.meta.url),
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

/** World Y extent [min, max] of every mesh owned by the given name prefix. */
function worldYRange(prefix: string): [number, number] {
  const meshes = scene.meshes.filter(
    (m) => m instanceof Mesh && m.name.startsWith(prefix),
  );
  expect(meshes.length, `owned meshes for ${prefix}`).toBeGreaterThan(0);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    minY = Math.min(minY, box.minimumWorld.y);
    maxY = Math.max(maxY, box.maximumWorld.y);
  }
  return [minY, maxY];
}

describe("CharacterAsset (GLB/glTF loading)", () => {
  it("loads the rigged asset with a finite positive asset-space height", async () => {
    makeScene();
    const asset = await loadAsset();
    expect(Number.isFinite(asset.heightMeters)).toBe(true);
    expect(asset.heightMeters).toBeGreaterThan(0);
    // Source hierarchy must stay hidden: only clones are ever rendered.
    for (const root of asset.container.rootNodes) {
      expect(root.isEnabled()).toBe(false);
    }
    // The asset is genuinely rigged: the source carries a skeleton.
    expect(asset.container.skeletons.length).toBeGreaterThan(0);
  });

  it("rejects a corrupt buffer with CharacterAssetLoadError (never resolves)", async () => {
    makeScene();
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(
      CharacterAsset.fromBuffer(garbage.buffer, scene),
    ).rejects.toBeInstanceOf(CharacterAssetLoadError);
  });

  it("computes a deterministic scale factor from the same buffer twice", async () => {
    makeScene();
    const bytes = readFileSync(GLB_PATH);
    const buffer = new Uint8Array(bytes).buffer;
    const a = await CharacterAsset.fromBuffer(buffer, scene);
    const b = await CharacterAsset.fromBuffer(buffer, scene);
    expect(a.scaleForHeight(PLAYER_COLLIDER_TOTAL_HEIGHT)).toBe(
      b.scaleForHeight(PLAYER_COLLIDER_TOTAL_HEIGHT),
    );
    expect(b.scaleForHeight(PLAYER_COLLIDER_TOTAL_HEIGHT)).toBeCloseTo(
      PLAYER_COLLIDER_TOTAL_HEIGHT / a.heightMeters,
      12,
    );
  });
});

describe("CharacterModel (per-player GLB instances)", () => {
  it("aligns the feet to the predicted player position at the root", async () => {
    makeScene();
    const asset = await loadAsset();
    const model = await CharacterModel.create(scene, asset, "local", "local-character");
    const predicted = { x: 2.5, y: 0.5, z: -3.25 };
    model.setTransform(predicted, 0);
    const [minY, maxY] = worldYRange("local-character-");
    // Feet exactly on the predicted position; body fills the collider
    // envelope above it (deterministic normalised height).
    expect(minY).toBeCloseTo(predicted.y, 5);
    expect(maxY - minY).toBeCloseTo(PLAYER_COLLIDER_TOTAL_HEIGHT, 5);
    model.dispose();
  });

  it("applies the shared yaw convention (root.rotation.y = -yaw) and keeps the feet planted", async () => {
    makeScene();
    const asset = await loadAsset();
    const model = await CharacterModel.create(scene, asset, "local", "local-character");
    const predicted = { x: 0, y: 0, z: 0 };
    model.setTransform(predicted, Math.PI / 2);
    expect(model.root.rotation.y).toBeCloseTo(-Math.PI / 2, 12);
    const [minY] = worldYRange("local-character-");
    expect(minY).toBeCloseTo(predicted.y, 5);
    model.dispose();
  });

  it("scales deterministically: two models from two loads match exactly", async () => {
    makeScene();
    const a = await loadAsset();
    const b = await loadAsset();
    const ma = await CharacterModel.create(scene, a, "local", "char-a");
    const mb = await CharacterModel.create(scene, b, "local", "char-b");
    ma.setTransform({ x: -1, y: 0, z: 1 }, 0);
    mb.setTransform({ x: 3, y: 4, z: -2 }, 0);
    expect(ma.scale).toBe(mb.scale);
    const [, maxA] = worldYRange("char-a-");
    const [minB] = worldYRange("char-b-");
    expect(maxA - 0).toBeCloseTo(minB - 4 + PLAYER_COLLIDER_TOTAL_HEIGHT, 5);
    ma.dispose();
    mb.dispose();
  });

  it("creates independent local and remote instances", async () => {
    makeScene();
    const asset = await loadAsset();
    const local = await CharacterModel.create(scene, asset, "local", "local-character");
    const remote = await CharacterModel.create(scene, asset, "remote", "remote-character");

    // Independent skeletons.
    const localSkeletons = local.root.getDescendants()
      .flatMap((n) => (n instanceof Mesh ? [n.skeleton] : []))
      .filter((s) => s !== null);
    const remoteSkeletons = remote.root.getDescendants()
      .flatMap((n) => (n instanceof Mesh ? [n.skeleton] : []))
      .filter((s) => s !== null);
    expect(localSkeletons.length).toBeGreaterThan(0);
    expect(remoteSkeletons.length).toBeGreaterThan(0);
    for (const s of remoteSkeletons) {
      expect(localSkeletons).not.toContain(s);
    }

    // Independent transforms: moving one leaves the other exactly in place.
    local.setTransform({ x: 0, y: 0, z: 0 }, 0);
    remote.setTransform({ x: 5, y: 0, z: -5 }, 0);
    const [localMinY0] = worldYRange("local-character-");
    remote.setTransform({ x: 9, y: 1, z: -1 }, Math.PI / 4);
    const [localMinY1] = worldYRange("local-character-");
    const [remoteMinY1] = worldYRange("remote-character-");
    expect(localMinY1).toBe(localMinY0);
    expect(remoteMinY1).toBeCloseTo(1, 5);

    // Independent materials: the same asset material is cloned per instance.
    const localMats = local.root
      .getDescendants()
      .filter((n): n is Mesh => n instanceof Mesh)
      .map((m) => m.material)
      .filter((m) => m !== null);
    const remoteMats = remote.root
      .getDescendants()
      .filter((n): n is Mesh => n instanceof Mesh)
      .map((m) => m.material)
      .filter((m) => m !== null);
    expect(localMats.length).toBeGreaterThan(0);
    for (const m of remoteMats) {
      expect(localMats).not.toContain(m);
    }

    local.dispose();
    remote.dispose();
    // Both instances gone → no owned meshes remain.
    expect(scene.meshes.filter((m) => m.name.startsWith("local-character-")).length).toBe(0);
    expect(scene.meshes.filter((m) => m.name.startsWith("remote-character-")).length).toBe(0);
  });

  it("assigns distinct variant material tints (local vs remote)", async () => {
    makeScene();
    const asset = await loadAsset();
    const local = await CharacterModel.create(scene, asset, "local", "local-character");
    const remote = await CharacterModel.create(scene, asset, "remote", "remote-character");
    const emissive = (model: CharacterModel): readonly number[] => {
      const mats = model.root
        .getDescendants()
        .filter((n): n is Mesh => n instanceof Mesh)
        .map((m) => m.material)
        .filter((m) => m !== null);
      expect(mats.length).toBeGreaterThan(0);
      return (mats[0] as unknown as { emissiveColor: Color3 }).emissiveColor.asArray();
    };
    const localTint = emissive(local);
    const remoteTint = emissive(remote);
    expect(localTint).not.toEqual(remoteTint);
    // The variant identity is applied to every owned material.
    expect(local.applyState(false, 0)).toBe(0);
    const localTintAgain = emissive(local);
    expect(localTintAgain).toEqual(localTint);
    local.dispose();
    remote.dispose();
  });

  it("keeps the feet planted while crouching (squash anchored at the feet)", async () => {
    makeScene();
    const asset = await loadAsset();
    const model = await CharacterModel.create(scene, asset, "local", "local-character");
    const predicted = { x: 0, y: 2, z: 0 };
    model.setTransform(predicted, 0);
    const [, standTop] = worldYRange("local-character-");
    model.setCrouchBlend(1);
    const [crouchFeet, crouchTop] = worldYRange("local-character-");
    expect(crouchFeet).toBeCloseTo(predicted.y, 5);
    expect(crouchTop - crouchFeet).toBeLessThan(standTop - predicted.y);
    model.dispose();
  });

  it("hides and shows the rendered model without touching the gameplay root", async () => {
    makeScene();
    const asset = await loadAsset();
    const model = await CharacterModel.create(scene, asset, "local", "local-character");
    model.setTransform({ x: 0, y: 0, z: 0 }, 0);
    model.setEnabled(false);
    const ownedMeshes = scene.meshes.filter(
      (m) => m instanceof Mesh && m.name.startsWith("local-character-"),
    );
    expect(ownedMeshes.length).toBeGreaterThan(0);
    for (const mesh of ownedMeshes) {
      expect(mesh.isEnabled()).toBe(false);
    }
    expect(model.root.position.y).toBe(0);
    model.setEnabled(true);
    for (const mesh of ownedMeshes) {
      expect(mesh.isEnabled()).toBe(true);
    }
    model.dispose();
  });

  it("decays the hit-flash contract and restores the variant palette", async () => {
    makeScene();
    const asset = await loadAsset();
    const model = await CharacterModel.create(scene, asset, "local", "local-character");
    expect(model.applyState(false, 3)).toBe(2);
    expect(model.applyState(false, 2)).toBe(1);
    expect(model.applyState(false, 1)).toBe(0);
    // Eliminated suppresses the flash count and switches to the neutral look.
    expect(model.applyState(true, 5)).toBe(5);
    const eliminatedMats = model.root
      .getDescendants()
      .filter((n): n is Mesh => n instanceof Mesh)
      .map((m) => m.material)
      .filter((m) => m !== null);
    for (const m of eliminatedMats) {
      const emissive = (m as unknown as { emissiveColor: Color3 }).emissiveColor;
      expect(emissive.r).toBeCloseTo(0, 6);
      expect(emissive.g).toBeCloseTo(0, 6);
      expect(emissive.b).toBeCloseTo(0, 6);
    }
    // Back to alive → variant tint restored.
    expect(model.applyState(false, 0)).toBe(0);
    const restored = (
      eliminatedMats[0] as unknown as { emissiveColor: Color3 }
    ).emissiveColor;
    expect(restored.g).toBeGreaterThan(restored.r);
    model.dispose();
  });

  it("dispose is idempotent, releases owned resources, and methods are no-ops", async () => {
    makeScene();
    const asset = await loadAsset();
    const model = await CharacterModel.create(scene, asset, "local", "local-character");
    model.setTransform({ x: 1, y: 1, z: 1 }, 0);
    const ownedBefore = scene.meshes.filter((m) => m.name.startsWith("local-character-"));
    expect(ownedBefore.length).toBeGreaterThan(0);
    const ownedMaterialsBefore = scene.materials.filter((m) => m.name.startsWith("local-character-"));
    expect(ownedMaterialsBefore.length).toBeGreaterThan(0);

    model.dispose();
    expect(model.isDisposed).toBe(true);
    model.dispose(); // idempotent
    // Safe no-ops after dispose.
    model.setTransform({ x: 9, y: 9, z: 9 }, 1);
    model.setCrouchBlend(1);
    model.setEnabled(false);
    expect(model.applyState(false, 2)).toBe(2);

    // Every owned mesh and cloned material is gone from the scene.
    expect(scene.meshes.filter((m) => m.name.startsWith("local-character-")).length).toBe(0);
    expect(scene.materials.filter((m) => m.name.startsWith("local-character-")).length).toBe(0);
    const root = scene.transformNodes.find((t) => t.name === "local-character-root");
    expect(root).toBeUndefined();
  });
});

describe("createCharacterPresentation (graceful fallback)", () => {
  it("falls back to the procedural PlayerPresentation when the asset URL is unreachable", async () => {
    makeScene();
    const result = await createCharacterPresentation(scene, "local", "player", {
      assetUrl: "http://127.0.0.1:9/missing.glb",
    });
    expect(result.kind).toBe("fallback");
    if (result.kind === "fallback") {
      expect(result.reason.length).toBeGreaterThan(0);
      expect(result.presentation).toBeInstanceOf(PlayerPresentation);
      expect(result.presentation.isDisposed).toBe(false);
      // The fallback drives the same transform contract.
      result.presentation.setTransform({ x: 0, y: 0, z: 0 }, 0);
      expect(result.presentation.root.position.x).toBe(0);
      result.presentation.dispose();
    }
  });

  it("yields the character presentation when the asset loads (served bytes)", async () => {
    makeScene();
    // Node's fetch cannot read file: URLs; serve the real GLB bytes through a
    // stub fetch for the marker URL (the same fetch path the browser uses).
    const assetUrl = "http://unit.local/assets/character/RiggedFigure.glb";
    const realFetch = globalThis.fetch;
    const bytes = new Uint8Array(readFileSync(GLB_PATH));
    globalThis.fetch = (async (input: unknown) => {
      if (String(input).includes("RiggedFigure.glb")) {
        return new Response(bytes, { status: 200, statusText: "OK" });
      }
      return realFetch(input as RequestInfo | URL);
    }) as typeof fetch;
    try {
      const result = await createCharacterPresentation(scene, "remote", "remote-player", {
        assetUrl,
      });
      expect(result.kind).toBe("character");
      if (result.kind === "character") {
        result.model.setTransform({ x: 0, y: 0, z: 0 }, 0);
        const [minY] = worldYRange("remote-player-");
        expect(minY).toBeCloseTo(0, 5);
        result.model.dispose();
        result.asset.dispose();
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
