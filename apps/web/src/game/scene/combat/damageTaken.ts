/**
 * Damage-taken presentation effect.
 *
 * A subdued, camera-anchored red marker shown after an authoritative event
 * confirms that the local player took damage (shield or health). It is
 * deliberately dimmer and smaller than a player hit marker so incoming
 * damage reads clearly without competing with the outgoing-hit feedback.
 * This module never decides whether damage occurred.
 */
import type { Scene } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { PooledEffectGroup, createEffectMaterial } from "./pooledEffect";
import { HIT_MARKER_CAMERA_OFFSET } from "./hitMarker";

export const DAMAGE_TAKEN = {
  /** Disc radius in world units. */
  radius: 0.045,
  color: new Color3(0.95, 0.32, 0.26),
  durationMs: 240,
} as const;

/** Creates the single-slot damage-taken pool. */
export function createDamageTakenGroup(scene: Scene): PooledEffectGroup {
  return new PooledEffectGroup(
    (i) => {
      const mesh = CreateDisc(
        `combat-feedback-damagetaken-${i}`,
        { tessellation: 16, radius: 1 },
        scene
      );
      mesh.billboardMode = AbstractMesh.BILLBOARDMODE_ALL;
      mesh.setEnabled(false);
      const material = createEffectMaterial(
        scene,
        `combat-feedback-damagetaken-mat-${i}`
      );
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
 * Activates the damage-taken marker in front of the scene's active camera.
 * Does nothing if the scene has no active camera.
 */
export function activateDamageTaken(
  group: PooledEffectGroup,
  scene: Scene,
  nowMs: number
): void {
  const camera = scene.activeCamera;
  if (!camera) return;

  camera.getDirectionToRef(Vector3.Forward(), _forward);
  const offset = HIT_MARKER_CAMERA_OFFSET;
  _position.set(
    camera.position.x + _forward.x * offset,
    camera.position.y + _forward.y * offset,
    camera.position.z + _forward.z * offset,
  );

  group.spawn(nowMs, DAMAGE_TAKEN.durationMs, (slot) => {
    slot.mesh.position.copyFrom(_position);
    slot.mesh.scaling.setAll(DAMAGE_TAKEN.radius);
    slot.material.diffuseColor.copyFrom(DAMAGE_TAKEN.color);
    slot.material.emissiveColor.copyFrom(DAMAGE_TAKEN.color);
    slot.mesh.setEnabled(true);
  });
}
