/**
 * Tracer presentation effect.
 *
 * A short unlit cylinder streak running from the muzzle origin along the
 * aim direction. Purely presentational — it is never used for hit detection.
 * The assault-rifle tracer is thin and fades fast; the shotgun tracer is
 * broader and lingers longer, reading as a heavier weapon.
 */
import type { WeaponType } from "@buildshift/protocol";
import type { Scene } from "@babylonjs/core";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { PooledEffectGroup, createEffectMaterial } from "./pooledEffect";

export interface TracerSpec {
  /** Streak length in world units. */
  length: number;
  /** Streak radius in world units. */
  radius: number;
  color: Color3;
  durationMs: number;
}

export const TRACER_SPECS: Record<WeaponType, TracerSpec> = {
  assault_rifle: {
    length: 10,
    radius: 0.012,
    color: new Color3(1.0, 0.95, 0.7),
    durationMs: 70,
  },
  shotgun: {
    length: 7,
    radius: 0.05,
    color: new Color3(1.0, 0.78, 0.42),
    durationMs: 130,
  },
};

/** Unit cylinder local axis (the cylinder's height axis). */
const LOCAL_Y = new Vector3(0, 1, 0);

/** Module-level scratch vectors (reused on every activation to avoid per-shot allocation). */
const _direction = new Vector3();
const _midpoint = new Vector3();

/** Creates the fixed-size tracer pool. */
export function createTracerGroup(scene: Scene, slotCount = 6): PooledEffectGroup {
  return new PooledEffectGroup((i) => {
    const mesh = CreateCylinder(
      `combat-feedback-tracer-${i}`,
      { diameter: 2, height: 1, tessellation: 8 },
      scene
    );
    mesh.setEnabled(false);
    const material = createEffectMaterial(scene, `combat-feedback-tracer-mat-${i}`);
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

/**
 * Activates the next tracer slot from `origin` along `aimDirection`.
 * If `aimDirection` is degenerate (zero length) no tracer is spawned.
 */
export function activateTracer(
  group: PooledEffectGroup,
  weaponType: WeaponType,
  origin: Vector3,
  aimDirection: Vector3,
  nowMs: number
): void {
  const spec = TRACER_SPECS[weaponType];

  _direction.copyFrom(aimDirection);
  if (_direction.lengthSquared() < 1e-8) return;
  _direction.normalize();

  // midpoint = origin + direction * (length / 2)  — no allocation
  const half = spec.length / 2;
  _midpoint.set(
    origin.x + _direction.x * half,
    origin.y + _direction.y * half,
    origin.z + _direction.z * half,
  );

  group.spawn(nowMs, spec.durationMs, (slot) => {
    slot.mesh.scaling.set(spec.radius, spec.length, spec.radius);
    slot.mesh.position.copyFrom(_midpoint);
    slot.mesh.rotationQuaternion = Quaternion.FromUnitVectorsToRef(LOCAL_Y, _direction, new Quaternion());
    slot.material.diffuseColor.copyFrom(spec.color);
    slot.material.emissiveColor.copyFrom(spec.color);
    slot.mesh.setEnabled(true);
    // Orientation only becomes observable through the world matrix; force an
    // update so the streak is correct even before the next render pass.
    slot.mesh.computeWorldMatrix(true);
  });
}
