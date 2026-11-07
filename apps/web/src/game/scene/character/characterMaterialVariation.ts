/**
 * characterMaterialVariation — per-variant material variation for rigged
 * character instances (Batch 2B, Task D).
 *
 * Makes local and opponent {@link CharacterModel} instances (both built from
 * the single licensed `BuildShiftBaseCharacter.glb` asset, CC0) immediately
 * distinguishable WITHOUT skins or duplicated models:
 *  - every instance still uses its own `instantiateModelsToScene` material
 *    clone (independent per instance; geometry/skeleton stay shared where
 *    Babylon shares them);
 *  - the variation is a small, deterministic color write on those existing
 *    clones — local instances lean BuildShift blue/cyan, opponent instances
 *    lean a contrasting amber — nudging the asset's original diffuse
 *    slightly and setting a variant identity emissive.
 *
 * The helper ALLOCATES NO materials and never clones: it only re-writes
 * colors on materials the caller already owns and disposes (explicit clone
 * ownership stays with the caller, see `CharacterModel.dispose`). A "reset"
 * therefore restores the untouched asset look by writing back stored base
 * colors — it can never leak.
 *
 * Attribution: color-tinting a licensed asset's per-instance material clones
 * does not alter, re-skin, or redistribute the asset itself; the CC-BY 4.0
 * attribution in `public/assets/character/ATTRIBUTION.md` remains intact.
 */
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { CharacterVariant } from "./CharacterModel";

/** A deterministic color scheme applied to one instance's cloned materials. */
export interface CharacterMaterialScheme {
  /** Stable identifier (diagnostics / tests). */
  readonly id: string;
  /** The asset's original diffuse is nudged toward this color. */
  readonly tintDiffuse: Readonly<Color3>;
  /** 0..1 blend strength toward {@link tintDiffuse} (kept small: the asset's
   * original diffuse stays dominant — no skin, no model change). */
  readonly tintStrength: number;
  /** Variant identity emissive marker. */
  readonly accentEmissive: Readonly<Color3>;
}

/**
 * Local identity: BuildShift blue/cyan accent, chosen to read clearly against
 * the dark blue arena while staying a small tint on the asset's own diffuse.
 */
export const LOCAL_MATERIAL_SCHEME: CharacterMaterialScheme = {
  id: "buildshift-blue",
  tintDiffuse: new Color3(0.12, 0.34, 0.75),
  tintStrength: 0.28,
  accentEmissive: new Color3(0.05, 0.2, 0.45),
};

/**
 * Opponent identity: contrasting warm amber, maximally far from the local
 * blue in hue so the two instances are distinguishable at a glance.
 */
export const REMOTE_MATERIAL_SCHEME: CharacterMaterialScheme = {
  id: "contrast-amber",
  tintDiffuse: new Color3(0.78, 0.36, 0.05),
  tintStrength: 0.28,
  accentEmissive: new Color3(0.45, 0.19, 0.03),
};

/** Deterministic scheme lookup per side of the match. */
export function characterMaterialScheme(
  variant: CharacterVariant,
): CharacterMaterialScheme {
  return variant === "local" ? LOCAL_MATERIAL_SCHEME : REMOTE_MATERIAL_SCHEME;
}

/**
 * Deterministic variant-base diffuse for one material: the asset's original
 * diffuse blended toward the scheme tint. Pure function — allocates a single
 * result `Color3` the caller owns.
 */
export function tintedBaseDiffuse(
  base: Readonly<Color3>,
  scheme: CharacterMaterialScheme,
): Color3 {
  return Color3.Lerp(base, scheme.tintDiffuse, scheme.tintStrength);
}

/** Reads the diffuse color of a PBR or Standard material (black otherwise). */
export function readDiffuse(material: Material): Color3 {
  if (material instanceof PBRMaterial) return material.albedoColor;
  if (material instanceof StandardMaterial) return material.diffuseColor;
  return Color3.Black();
}

/** Writes a diffuse color onto a PBR or Standard material (no-op otherwise). */
export function writeDiffuse(material: Material, value: Readonly<Color3>): void {
  if (material instanceof PBRMaterial) {
    material.albedoColor.copyFrom(value);
  } else if (material instanceof StandardMaterial) {
    material.diffuseColor.copyFrom(value);
  }
}

/** Writes an emissive color onto a PBR or Standard material (no-op otherwise). */
export function writeEmissive(
  material: Material,
  value: Readonly<Color3>,
): void {
  if (material instanceof PBRMaterial) {
    material.emissiveColor.copyFrom(value);
  } else if (material instanceof StandardMaterial) {
    material.emissiveColor.copyFrom(value);
  }
}

/**
 * Applies the variant scheme to a set of instance-OWNED cloned materials:
 * diffuse ← `tintedBaseDiffuse(baseDiffuse[i], scheme)`, emissive ←
 * `scheme.accentEmissive`. `baseDiffuse` holds each material's untouched
 * asset diffuse (length must match `materials`). No allocation beyond the
 * per-material tinted-base `Color3`s.
 */
export function applyMaterialScheme(
  materials: readonly Material[],
  baseDiffuse: readonly Color3[],
  scheme: CharacterMaterialScheme,
): void {
  for (let i = 0; i < materials.length; i++) {
    writeDiffuse(materials[i], tintedBaseDiffuse(baseDiffuse[i], scheme));
    writeEmissive(materials[i], scheme.accentEmissive);
  }
}

/**
 * Resets a set of instance-owned cloned materials to the untouched asset
 * look: diffuse ← original asset diffuse, emissive ← black. Pure color
 * restore on already-owned clones — allocates nothing, so it can never leak
 * materials.
 */
export function resetMaterialScheme(
  materials: readonly Material[],
  baseDiffuse: readonly Color3[],
): void {
  const black = Color3.Black();
  for (let i = 0; i < materials.length; i++) {
    writeDiffuse(materials[i], baseDiffuse[i]);
    writeEmissive(materials[i], black);
  }
}
