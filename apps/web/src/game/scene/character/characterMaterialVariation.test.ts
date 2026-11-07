/**
 * NullEngine tests for Batch 2B Task D (character material variation):
 *  - deterministic per-variant schemes (BuildShift blue local vs contrasting
 *    remote) and deterministic tinting
 *  - separate local/remote instances carry independent, distinguishable
 *    material variation on their own material clones
 *  - shared geometry stays shared between instances (Babylon clone behavior)
 *  - resetMaterialVariation restores the untouched asset look with zero
 *    material allocation (no leaks)
 *  - dispose releases every owned cloned material; double-dispose is safe
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Geometry } from "@babylonjs/core/Meshes/geometry";
import type { Material } from "@babylonjs/core/Materials/material";
import {
  CharacterAsset,
} from "./characterAsset";
import { CharacterModel } from "./CharacterModel";
import {
  LOCAL_MATERIAL_SCHEME,
  REMOTE_MATERIAL_SCHEME,
  applyMaterialScheme,
  characterMaterialScheme,
  readDiffuse,
  resetMaterialScheme,
  tintedBaseDiffuse,
  writeDiffuse,
  writeEmissive,
} from "./characterMaterialVariation";
import { PlayerPresentation } from "../PlayerPresentation";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

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
  const buffer = new Uint8Array(bytes).buffer;
  return CharacterAsset.fromBuffer(buffer, scene);
}

/** The owned (cloned) materials of a character instance, in mesh order. */
function ownedMaterials(model: CharacterModel): Material[] {
  return model.root
    .getDescendants()
    .filter((n): n is Mesh => n instanceof Mesh)
    .map((m) => m.material)
    .filter((m): m is Material => m !== null);
}


/** Emissive accessor for the base `Material` type (PBR/Standard carry it). */
function emissiveOf(material: Material): Color3 {
  return (material as unknown as { emissiveColor: Color3 }).emissiveColor;
}

/**
 * Looks up the asset's SOURCE material that a cloned instance material was
 * derived from (clone name = `${namePrefix}-${sourceName}`), so tests can
 * verify the variation is an exact tint of the shared asset's own diffuse.
 */
function sourceMaterialFor(
  asset: CharacterAsset,
  namePrefix: string,
  cloneMaterialName: string,
): Material {
  const sourceName = cloneMaterialName.slice(namePrefix.length + 1);
  for (const root of asset.container.rootNodes) {
    for (const node of [root, ...root.getDescendants()]) {
      if (node instanceof Mesh && node.material?.name === sourceName) {
        return node.material;
      }
    }
  }
  throw new Error(`source material not found for ${cloneMaterialName}`);
}

describe("characterMaterialVariation (scheme + helpers)", () => {
  it("returns deterministic, distinct schemes per variant", () => {
    const localA = characterMaterialScheme("local");
    const localB = characterMaterialScheme("local");
    const remoteA = characterMaterialScheme("remote");
    const remoteB = characterMaterialScheme("remote");
    // Deterministic per side.
    expect(localA).toBe(LOCAL_MATERIAL_SCHEME);
    expect(localB).toBe(localA);
    expect(remoteA).toBe(REMOTE_MATERIAL_SCHEME);
    expect(remoteB).toBe(remoteA);
    // Local leans BuildShift blue; remote leans contrasting warm.
    expect(localA.tintDiffuse.b).toBeGreaterThan(localA.tintDiffuse.r);
    expect(remoteA.tintDiffuse.r).toBeGreaterThan(remoteA.tintDiffuse.b);
    // The two schemes are clearly distinct (no shared identity).
    expect(localA.id).not.toBe(remoteA.id);
    expect(localA.accentEmissive.asArray()).not.toEqual(
      remoteA.accentEmissive.asArray(),
    );
    // The scheme tints sit far apart in RGB space (clear visual contrast).
    const dr = localA.tintDiffuse.r - remoteA.tintDiffuse.r;
    const dg = localA.tintDiffuse.g - remoteA.tintDiffuse.g;
    const db = localA.tintDiffuse.b - remoteA.tintDiffuse.b;
    expect(Math.hypot(dr, dg, db)).toBeGreaterThan(0.5);
    // Tint strength is a small nudge, never a full repaint.
    expect(localA.tintStrength).toBeGreaterThan(0);
    expect(localA.tintStrength).toBeLessThan(1);
  });

  it("tints deterministically: base → tint is the exact lerp, twice loaded", () => {
    const base = new Color3(0.4, 0.35, 0.3);
    const a = tintedBaseDiffuse(base, LOCAL_MATERIAL_SCHEME);
    const b = tintedBaseDiffuse(base, LOCAL_MATERIAL_SCHEME);
    expect(a.r).toBe(b.r);
    expect(a.g).toBe(b.g);
    expect(a.b).toBe(b.b);
    // Exact lerp math against the scheme tint/strength.
    const expected = Color3.Lerp(
      base,
      LOCAL_MATERIAL_SCHEME.tintDiffuse,
      LOCAL_MATERIAL_SCHEME.tintStrength,
    );
    expect(a.r).toBe(expected.r);
    expect(a.g).toBe(expected.g);
    expect(a.b).toBe(expected.b);
  });

  it("applyMaterialScheme / resetMaterialScheme are exact inverses on owned clones", () => {
    makeScene();
    // Pure-material path (no GLB): one instance-owned StandardMaterial clone.
    const material = new StandardMaterial("owned-clone", scene);
    material.diffuseColor = new Color3(0.5, 0.4, 0.25);
    const base = readDiffuse(material).clone();

    applyMaterialScheme([material], [base], LOCAL_MATERIAL_SCHEME);
    expect(readDiffuse(material)).toEqual(
      tintedBaseDiffuse(base, LOCAL_MATERIAL_SCHEME),
    );
    expect(material.emissiveColor).toEqual(
      LOCAL_MATERIAL_SCHEME.accentEmissive as unknown as Color3,
    );

    // Reset restores the untouched look and allocates nothing new.
    const materialsBefore = scene.materials.length;
    resetMaterialScheme([material], [base]);
    expect(readDiffuse(material)).toEqual(base);
    expect(material.emissiveColor.r).toBe(0);
    expect(material.emissiveColor.g).toBe(0);
    expect(material.emissiveColor.b).toBe(0);
    expect(scene.materials.length).toBe(materialsBefore);

    // Writers are no-ops on non-PBR/Standard materials (never throw).
    const odd = {} as unknown as Material;
    expect(() => {
      writeDiffuse(odd, base);
      writeEmissive(odd, base);
      readDiffuse(odd);
    }).not.toThrow();
    material.dispose();
  });
});

describe("CharacterModel material variation (per-instance independence)", () => {
  it("gives separate instances independent, distinguishable variation while sharing geometry", async () => {
    makeScene();
    const asset = await loadAsset();
    const local = await CharacterModel.create(scene, asset, "local", "local-character");
    const remote = await CharacterModel.create(scene, asset, "remote", "remote-character");
    local.setTransform({ x: 0, y: 0, z: 0 }, 0);
    remote.setTransform({ x: 4, y: 0, z: -4 }, 0);

    const localMats = ownedMaterials(local);
    const remoteMats = ownedMaterials(remote);
    expect(localMats.length).toBeGreaterThan(0);
    expect(remoteMats.length).toBe(localMats.length);

    // Independent clones: no material object is shared between instances.
    for (const m of remoteMats) {
      expect(localMats).not.toContain(m);
    }

    // Deterministic per-side variation: each clone's diffuse is EXACTLY the
    // shared asset's original diffuse tinted toward its side's scheme, and
    // each clone carries its side's identity emissive.
    for (let i = 0; i < localMats.length; i++) {
      const localSrc = sourceMaterialFor(asset, "local-character", localMats[i].name);
      const remoteSrc = sourceMaterialFor(asset, "remote-character", remoteMats[i].name);
      // The two clones were derived from the same shared source material.
      expect(localSrc).toBe(remoteSrc);
      expect(readDiffuse(localMats[i])).toEqual(
        tintedBaseDiffuse(readDiffuse(localSrc), LOCAL_MATERIAL_SCHEME),
      );
      expect(readDiffuse(remoteMats[i])).toEqual(
        tintedBaseDiffuse(readDiffuse(remoteSrc), REMOTE_MATERIAL_SCHEME),
      );
      expect(emissiveOf(localMats[i])).toEqual(
        LOCAL_MATERIAL_SCHEME.accentEmissive as unknown as Color3,
      );
      expect(emissiveOf(remoteMats[i])).toEqual(
        REMOTE_MATERIAL_SCHEME.accentEmissive as unknown as Color3,
      );
    }
    // Distinguishable at a glance: corresponding instance materials differ.
    expect(readDiffuse(localMats[0])).not.toEqual(readDiffuse(remoteMats[0]));
    expect(emissiveOf(localMats[0])).not.toEqual(emissiveOf(remoteMats[0]));

    // Shared resources where Babylon permits: instance clones share the
    // asset's geometry objects (no duplicated geometry per player).
    const localGeoms = local.root
      .getDescendants()
      .filter((n): n is Mesh => n instanceof Mesh)
      .map((m) => m.geometry)
      .filter((g): g is Geometry => g !== null);
    const remoteGeoms = remote.root
      .getDescendants()
      .filter((n): n is Mesh => n instanceof Mesh)
      .map((m) => m.geometry)
      .filter((g): g is Geometry => g !== null);
    expect(localGeoms.length).toBeGreaterThan(0);
    for (const g of remoteGeoms) {
      expect(localGeoms, "remote instance must share the asset's geometry").toContain(g);
    }

    local.dispose();
    remote.dispose();
  });

  it("resetMaterialVariation restores the untouched asset look without leaking materials", async () => {
    makeScene();
    const asset = await loadAsset();
    const model = await CharacterModel.create(scene, asset, "local", "local-character");
    const mats = ownedMaterials(model);
    expect(mats.length).toBeGreaterThan(0);

    // Variant look is applied on creation (tinted diffuse + accent emissive).
    const source = sourceMaterialFor(asset, "local-character", mats[0].name);
    const assetDiffuse = readDiffuse(source).clone();
    const variantDiffuse = readDiffuse(mats[0]);
    expect(variantDiffuse).toEqual(
      tintedBaseDiffuse(assetDiffuse, LOCAL_MATERIAL_SCHEME),
    );
    const variantEmissive = emissiveOf(mats[0]).clone();
    expect(variantEmissive).not.toEqual(Color3.Black());

    const materialsBefore = scene.materials.length;
    model.resetMaterialVariation();
    const materialsAfterReset = scene.materials.length;

    // Untouched look: emissive zeroed and diffuse exactly the shared asset's
    // original (untinted) value, for every owned material.
    for (const m of mats) {
      const em = emissiveOf(m);
      expect(em.r).toBe(0);
      expect(em.g).toBe(0);
      expect(em.b).toBe(0);
      expect(readDiffuse(m)).toEqual(
        readDiffuse(sourceMaterialFor(asset, "local-character", m.name)),
      );
    }
    // No material allocation on reset: same count, same material objects.
    expect(materialsAfterReset).toBe(materialsBefore);
    const matsAfterReset = ownedMaterials(model);
    for (const m of matsAfterReset) {
      expect(mats).toContain(m);
    }

    // applyState re-applies the variant look on the same clones (no new
    // materials, same objects).
    model.applyState(false, 0);
    expect(readDiffuse(mats[0])).toEqual(variantDiffuse);
    expect(emissiveOf(mats[0])).toEqual(variantEmissive);
    expect(scene.materials.length).toBe(materialsBefore);

    // Reset is a no-op after dispose (safe, no throw, no leak).
    model.dispose();
    model.resetMaterialVariation();
    model.dispose(); // idempotent
    expect(scene.materials.filter((m) => m.name.startsWith("local-character-")).length).toBe(0);
  });

  it("dispose releases every owned cloned material (no leak) and double-dispose is safe", async () => {
    makeScene();
    const asset = await loadAsset();
    const local = await CharacterModel.create(scene, asset, "local", "local-character");
    const remote = await CharacterModel.create(scene, asset, "remote", "remote-character");

    const localOwned = scene.materials.filter((m) => m.name.startsWith("local-character-"));
    const remoteOwned = scene.materials.filter((m) => m.name.startsWith("remote-character-"));
    expect(localOwned.length).toBeGreaterThan(0);
    expect(remoteOwned.length).toBeGreaterThan(0);
    for (const m of remoteOwned) {
      expect(localOwned).not.toContain(m);
    }

    local.dispose();
    remote.dispose();
    local.dispose();
    remote.dispose();

    expect(scene.materials.filter((m) => m.name.startsWith("local-character-")).length).toBe(0);
    expect(scene.materials.filter((m) => m.name.startsWith("remote-character-")).length).toBe(0);
    expect(local.isDisposed).toBe(true);
    expect(remote.isDisposed).toBe(true);
  });
});

describe("fallback path is unaffected (sanity)", () => {
  it("procedural fallback still presents independently of the GLB variation", async () => {
    makeScene();
    const asset = await loadAsset();
    const model = await CharacterModel.create(scene, asset, "local", "local-character");
    const fallback = PlayerPresentation.create(scene, "remote", "fallback-player");
    expect(model.isDisposed).toBe(false);
    expect(fallback.isDisposed).toBe(false);
    model.dispose();
    fallback.dispose();
  });
});
