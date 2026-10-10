/**
 * Elimination (kill-confirmation) presentation effect.
 *
 * A larger, longer-lived, red-tinted camera-anchored marker shown after an
 * authoritative event confirms the local player eliminated an opponent. It
 * is visually distinct from the white player hit marker (bigger, redder,
 * longer) so a kill reads as a bigger beat than a normal hit. This module
 * never decides who was eliminated.
 */
import type { Scene } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { PooledEffectGroup, createEffectMaterial } from "./pooledEffect";
import { HIT_MARKER_CAMERA_OFFSET } from "./hitMarker";

export const ELIMINATION_MARKER = {
  /** Disc radius in world units. */
  radius: 0.07,
  color: new Color3(1.0, 0.4, 0.3),
  durationMs: 350,
} as const;

/** Creates the single-slot elimination marker pool. */
export function createEliminationMarkerGroup(scene: Scene): PooledEffectGroup {
  return new PooledEffectGroup(
    (i) => {
      const mesh = CreateDisc(
        `combat-feedback-elimmarker-${i}`,
        { tessellation: 16, radius: 1 },
        scene
      );
      mesh.billboardMode = AbstractMesh.BILLBOARDMODE_ALL;
      mesh.setEnabled(false);
      const material = createEffectMaterial(
        scene,
        `combat-feedback-elimmarker-mat-${i}`
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

/** Module-level scratch vectors (reused on every activation to avoid per-kill allocation). */
const _forward = new Vector3();
const _position = new Vector3();

/**
 * Activates the elimination marker in front of the scene's active camera.
 * Does nothing if the scene has no active camera.
 */
export function activateEliminationMarker(
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

  group.spawn(nowMs, ELIMINATION_MARKER.durationMs, (slot) => {
    slot.mesh.position.copyFrom(_position);
    slot.mesh.scaling.setAll(ELIMINATION_MARKER.radius);
    slot.material.diffuseColor.copyFrom(ELIMINATION_MARKER.color);
    slot.material.emissiveColor.copyFrom(ELIMINATION_MARKER.color);
    slot.mesh.setEnabled(true);
  });
}
