/**
 * Muzzle flash presentation effect.
 *
 * A billboarded unit disc per pool slot, scaled and tinted per weapon on
 * activation. The shotgun flash is larger, warmer, and lasts longer than
 * the assault-rifle flash so the two weapons read with different weight.
 */
import type { WeaponType } from "@buildshift/protocol";
import type { Scene } from "@babylonjs/core";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { PooledEffectGroup, createEffectMaterial } from "./pooledEffect";

export interface MuzzleFlashSpec {
  /** Flash disc radius in world units. */
  radius: number;
  color: Color3;
  durationMs: number;
}

export const MUZZLE_FLASH_SPECS: Record<WeaponType, MuzzleFlashSpec> = {
  assault_rifle: {
    radius: 0.05,
    color: new Color3(1.0, 0.95, 0.6), // bright white-yellow
    durationMs: 60,
  },
  shotgun: {
    radius: 0.13,
    color: new Color3(1.0, 0.6, 0.18), // larger, warmer orange
    durationMs: 120,
  },
};

/** Creates the fixed-size muzzle flash pool. */
export function createMuzzleFlashGroup(scene: Scene, slotCount = 4): PooledEffectGroup {
  return new PooledEffectGroup((i) => {
    const mesh = CreateDisc(`combat-feedback-muzzle-${i}`, { tessellation: 12, radius: 1 }, scene);
    mesh.billboardMode = AbstractMesh.BILLBOARDMODE_ALL;
    mesh.setEnabled(false);
    const material = createEffectMaterial(scene, `combat-feedback-muzzle-mat-${i}`);
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

/** Activates the next muzzle flash slot at `origin` with the weapon's spec. */
export function activateMuzzleFlash(
  group: PooledEffectGroup,
  weaponType: WeaponType,
  origin: Vector3,
  nowMs: number
): void {
  const spec = MUZZLE_FLASH_SPECS[weaponType];
  group.spawn(nowMs, spec.durationMs, (slot) => {
    slot.mesh.position.copyFrom(origin);
    slot.mesh.scaling.setAll(spec.radius);
    slot.material.diffuseColor.copyFrom(spec.color);
    slot.material.emissiveColor.copyFrom(spec.color);
    slot.mesh.setEnabled(true);
  });
}
