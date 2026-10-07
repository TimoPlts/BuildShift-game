/**
 * Build impact presentation effect.
 *
 * A short-lived world-anchored spark shown at the supplied world position
 * after an authoritative event confirms a structure hit. Visually distinct
 * from the player hit marker (amber tint, world-anchored instead of
 * camera-anchored). This module never decides whether a hit occurred.
 */
import type { Scene } from "@babylonjs/core";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { PooledEffectGroup, createEffectMaterial } from "./pooledEffect";

export const BUILD_IMPACT = {
  /** Spark disc radius in world units. */
  radius: 0.08,
  color: new Color3(1.0, 0.72, 0.35),
  durationMs: 150,
} as const;

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

/** Activates the next build impact slot at the given world position. */
export function activateBuildImpact(
  group: PooledEffectGroup,
  worldPosition: Vector3,
  nowMs: number
): void {
  group.spawn(nowMs, BUILD_IMPACT.durationMs, (slot) => {
    slot.mesh.position.copyFrom(worldPosition);
    slot.mesh.scaling.setAll(BUILD_IMPACT.radius);
    slot.material.diffuseColor.copyFrom(BUILD_IMPACT.color);
    slot.material.emissiveColor.copyFrom(BUILD_IMPACT.color);
    slot.mesh.setEnabled(true);
  });
}
