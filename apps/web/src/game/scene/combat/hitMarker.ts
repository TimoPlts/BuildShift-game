/**
 * Player hit marker presentation effect.
 *
 * A small white billboarded disc rendered a fixed distance in front of the
 * active camera. Triggered only after an authoritative event has confirmed
 * the local player as the shooter of a hit — this module never decides
 * whether a hit occurred.
 */
import type { Scene } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { PooledEffectGroup, createEffectMaterial } from "./pooledEffect";

export const HIT_MARKER = {
  /** Disc radius in world units. */
  radius: 0.03,
  color: new Color3(1.0, 1.0, 1.0),
  durationMs: 200,
  /** Distance in front of the active camera where the marker appears. */
  cameraOffset: 1.5,
} as const;

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
 * Activates the hit marker in front of the scene's active camera.
 * Does nothing if the scene has no active camera.
 */
export function activateHitMarker(group: PooledEffectGroup, scene: Scene, nowMs: number): void {
  const camera = scene.activeCamera;
  if (!camera) return;

  camera.getDirectionToRef(Vector3.Forward(), _forward);
  const offset = HIT_MARKER.cameraOffset;
  _position.set(
    camera.position.x + _forward.x * offset,
    camera.position.y + _forward.y * offset,
    camera.position.z + _forward.z * offset,
  );

  group.spawn(nowMs, HIT_MARKER.durationMs, (slot) => {
    slot.mesh.position.copyFrom(_position);
    slot.mesh.scaling.setAll(HIT_MARKER.radius);
    slot.material.diffuseColor.copyFrom(HIT_MARKER.color);
    slot.material.emissiveColor.copyFrom(HIT_MARKER.color);
    slot.mesh.setEnabled(true);
  });
}
