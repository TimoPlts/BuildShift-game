/**
 * Player hit marker presentation effect.
 *
 * A small billboarded disc rendered a fixed distance in front of the active
 * camera, tinted and timed per weapon so an assault-rifle hit reads crisp
 * and quick while a shotgun hit reads heavier and lingers a touch longer.
 * Triggered only after an authoritative event has confirmed the local player
 * as the shooter of a hit — this module never decides whether a hit occurred.
 */
import type { WeaponType } from "@buildshift/protocol";
import type { Scene } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { PooledEffectGroup, createEffectMaterial } from "./pooledEffect";

export interface HitMarkerSpec {
  /** Disc radius in world units. */
  radius: number;
  color: Color3;
  durationMs: number;
}

export const HIT_MARKER_SPECS: Record<WeaponType, HitMarkerSpec> = {
  assault_rifle: {
    radius: 0.035,
    color: new Color3(1.0, 1.0, 1.0),
    durationMs: 200,
  },
  shotgun: {
    radius: 0.06,
    color: new Color3(1.0, 0.88, 0.62),
    durationMs: 260,
  },
};

/** Distance in front of the active camera where the marker appears. */
export const HIT_MARKER_CAMERA_OFFSET = 1.5;

/** Creates the single-slot hit marker pool. */
export function createHitMarkerGroup(scene: Scene): PooledEffectGroup {
  return new PooledEffectGroup(
    (i) => {
      const mesh = CreateDisc(
        `combat-feedback-hitmarker-${i}`,
        { tessellation: 16, radius: 1 },
        scene
      );
      mesh.billboardMode = AbstractMesh.BILLBOARDMODE_ALL;
      mesh.setEnabled(false);
      const material = createEffectMaterial(scene, `combat-feedback-hitmarker-mat-${i}`);
      mesh.material = material;
      return {
        mesh,
        material,
        active: false,
        activatedAtMs: 0,
        durationMs: 0,
      };
    },
    1
  );
}

/** Module-level scratch vectors (reused on every activation to avoid per-hit allocation). */
const _forward = new Vector3();
const _position = new Vector3();

/**
 * Activates the hit marker in front of the scene's active camera using the
 * per-weapon spec for `weaponType`. Does nothing if the scene has no active
 * camera.
 */
export function activateHitMarker(
  group: PooledEffectGroup,
  scene: Scene,
  weaponType: WeaponType,
  nowMs: number
): void {
  const camera = scene.activeCamera;
  if (!camera) return;
  const spec = HIT_MARKER_SPECS[weaponType];

  camera.getDirectionToRef(Vector3.Forward(), _forward);
  const offset = HIT_MARKER_CAMERA_OFFSET;
  _position.set(
    camera.position.x + _forward.x * offset,
    camera.position.y + _forward.y * offset,
    camera.position.z + _forward.z * offset,
  );

  group.spawn(nowMs, spec.durationMs, (slot) => {
    slot.mesh.position.copyFrom(_position);
    slot.mesh.scaling.setAll(spec.radius);
    slot.material.diffuseColor.copyFrom(spec.color);
    slot.material.emissiveColor.copyFrom(spec.color);
    slot.mesh.setEnabled(true);
  });
}
