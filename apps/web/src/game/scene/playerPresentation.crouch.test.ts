/**
 * Behavioral NullEngine tests for the PlayerPresentation crouch blend
 * ({@link PlayerPresentation.setCrouchBlend}).
 *
 * The crouch presentation is a *feet-anchored* vertical squash of `visualRoot`:
 *  - `visualRoot.scaling.y` blends 1 → CROUCH_SCALE;
 *  - `visualRoot.position.y` blends halfHeight → halfHeight * CROUCH_SCALE, so
 *    the squash is anchored at the feet (visualRoot-local y = -halfHeight) and
 *    the ground contact point stays planted;
 *  - at blend 0 the transform is the identity (the standing layout, so existing
 *    world positions are unchanged);
 *  - the body's world height shrinks by exactly CROUCH_SCALE while the bottom
 *    (feet) is held.
 *
 * CROUCH_SCALE mirrors the authoritative collider ratio
 * (crouch half-total-height / standing half-total-height) so the presented
 * height matches the server's reduced crouch hitbox.
 */
import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import {
  PLAYER_COLLIDER_HALF_TOTAL_HEIGHT,
  PLAYER_CROUCH_COLLIDER_HALF_TOTAL_HEIGHT,
} from "@buildshift/game-config";
import { PlayerPresentation } from "./PlayerPresentation";

/** Presented crouch squash, derived from the authoritative collider ratio. */
const CROUCH_SCALE =
  PLAYER_CROUCH_COLLIDER_HALF_TOTAL_HEIGHT / PLAYER_COLLIDER_HALF_TOTAL_HEIGHT;

function worldYExtent(scene: Scene, prefix: string): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const mesh of scene.meshes.filter((m) => m.name.startsWith(prefix))) {
    mesh.computeWorldMatrix(true);
    const worldMatrix = mesh.getWorldMatrix();
    const box = mesh.getBoundingInfo().boundingBox;
    for (const x of [box.minimum.x, box.maximum.x]) {
      for (const y of [box.minimum.y, box.maximum.y]) {
        for (const z of [box.minimum.z, box.maximum.z]) {
          const world = Vector3.TransformCoordinates(new Vector3(x, y, z), worldMatrix);
          min = Math.min(min, world.y);
          max = Math.max(max, world.y);
        }
      }
    }
  }
  return [min, max];
}

function makeRig(registry: Array<{ dispose(): void }>): {
  engine: NullEngine;
  scene: Scene;
  pres: PlayerPresentation;
  dispose: () => void;
} {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const pres = PlayerPresentation.create(scene, "local", "crouch-player");
  const rig = { engine, scene, pres, dispose: () => { pres.dispose(); engine.dispose(); } };
  registry.push(rig);
  return rig;
}

describe("PlayerPresentation crouch blend", () => {
  const rigs: Array<{ dispose(): void }> = [];

  afterEach(() => {
    for (const rig of rigs.splice(0)) rig.dispose();
  });

  it("defaults to the identity standing layout (blend 0)", () => {
    const rig = makeRig(rigs);
    rig.pres.setTransform({ x: 0, y: 0, z: 0 }, 0);
    expect(rig.pres.visualRoot.scaling.y).toBeCloseTo(1, 6);
    expect(rig.pres.visualRoot.position.y).toBeCloseTo(
      PLAYER_COLLIDER_HALF_TOTAL_HEIGHT,
      6,
    );
  });

  it("squashes the visual root about the feet when fully crouched", () => {
    const rig = makeRig(rigs);
    rig.pres.setTransform({ x: 0, y: 0, z: 0 }, 0);

    rig.pres.setCrouchBlend(1);

    // The vertical squash reaches the presented crouch scale and the visual
    // root is lowered so the squash is anchored at the feet.
    expect(rig.pres.visualRoot.scaling.y).toBeCloseTo(CROUCH_SCALE, 4);
    expect(rig.pres.visualRoot.position.y).toBeCloseTo(
      PLAYER_COLLIDER_HALF_TOTAL_HEIGHT * CROUCH_SCALE,
      4,
    );
  });

  it("keeps the feet planted while the body height shrinks by the crouch scale", () => {
    const rig = makeRig(rigs);
    rig.pres.setTransform({ x: 0, y: 0, z: 0 }, 0);
    const [restMin, restMax] = worldYExtent(rig.scene, "crouch-player");

    rig.pres.setCrouchBlend(1);
    const [crouchMin, crouchMax] = worldYExtent(rig.scene, "crouch-player");

    // The body is strictly shorter when crouched ...
    expect(crouchMax).toBeLessThan(restMax);
    // ... by exactly the presented crouch scale (the squash is uniform).
    expect(crouchMax - crouchMin).toBeCloseTo((restMax - restMin) * CROUCH_SCALE, 3);
    // ... and the feet (bottom of the body) stay planted.
    expect(crouchMin).toBeCloseTo(restMin, 3);
  });

  it("partially crouches for a blend between 0 and 1", () => {
    const rig = makeRig(rigs);
    rig.pres.setTransform({ x: 0, y: 0, z: 0 }, 0);

    rig.pres.setCrouchBlend(0.5);
    const expectedScale = 1 - (1 - CROUCH_SCALE) * 0.5;
    expect(rig.pres.visualRoot.scaling.y).toBeCloseTo(expectedScale, 4);
    expect(rig.pres.visualRoot.position.y).toBeCloseTo(
      PLAYER_COLLIDER_HALF_TOTAL_HEIGHT * expectedScale,
      4,
    );
  });

  it("clamps the blend to [0, 1]", () => {
    const rig = makeRig(rigs);
    rig.pres.setTransform({ x: 0, y: 0, z: 0 }, 0);

    rig.pres.setCrouchBlend(-1);
    expect(rig.pres.visualRoot.scaling.y).toBeCloseTo(1, 6);

    rig.pres.setCrouchBlend(2);
    expect(rig.pres.visualRoot.scaling.y).toBeCloseTo(CROUCH_SCALE, 4);
  });

  it("setCrouchBlend is a no-op after dispose", () => {
    const rig = makeRig(rigs);
    rig.pres.dispose();
    expect(() => rig.pres.setCrouchBlend(1)).not.toThrow();
    expect(rig.pres.visualRoot.scaling.y).toBeCloseTo(1, 6);
    rig.dispose();
  });
});
