/**
 * Build impact presentation effect.
 *
 * A short-lived world-anchored spark shown at the supplied world position
 * after an authoritative event confirms a structure hit. Visually distinct
 * from the player hit marker (amber tint, world-anchored instead of
 * camera-anchored), with a per-weapon spec so a shotgun hit on a build reads
 * heavier (bigger, longer) than a rifle hit. This module never decides
 * whether a hit occurred.
 */
import type { WeaponType } from "@buildshift/protocol";
import type { Scene } from "@babylonjs/core";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { PooledEffectGroup, createEffectMaterial } from "./pooledEffect";

export interface BuildImpactSpec {
  /** Spark disc radius in world units. */
  radius: number;
  color: Color3;
  durationMs: number;
}

export const BUILD_IMPACT_SPECS: Record<WeaponType, BuildImpactSpec> = {
  assault_rifle: {
    radius: 0.08,
    color: new Color3(1.0, 0.72, 0.35),
    durationMs: 150,
  },
  shotgun: {
    radius: 0.12,
    color: new Color3(1.0, 0.6, 0.28),
    durationMs: 200,
  },
};

/** Creates the fixed-size build impact pool. */
export function createBuildImpactGroup(scene: Scene, slotCount = 3): PooledEffectGroup {
  return new PooledEffectGroup((i) => {
    const mesh = CreateDisc(
      `combat-feedback-buildimpact-${i}`,
      { tessellation: 12, radius: 1 },
      scene
    );
    mesh.billboardMode = AbstractMesh.BILLBOARDMODE_ALL;
    mesh.setEnabled(false);
    const material = createEffectMaterial(scene, `combat-feedback-buildimpact-mat-${i}`);
    mesh.material = material;
    return {
      mesh,
      material,
      active: false,
      activatedAtMs: 0,
      durationMs: 0,
    };
  }, slotCount);
}

/** Activates the next build impact slot at `worldPosition` with the weapon's spec. */
export function activateBuildImpact(
  group: PooledEffectGroup,
  weaponType: WeaponType,
  worldPosition: Vector3,
  nowMs: number
): void {
  const spec = BUILD_IMPACT_SPECS[weaponType];
  group.spawn(nowMs, spec.durationMs, (slot) => {
    slot.mesh.position.copyFrom(worldPosition);
    slot.mesh.scaling.setAll(spec.radius);
    slot.material.diffuseColor.copyFrom(spec.color);
    slot.material.emissiveColor.copyFrom(spec.color);
    slot.mesh.setEnabled(true);
  });
}
