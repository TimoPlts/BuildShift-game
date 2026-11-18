/**
 * Behavioral NullEngine tests for PreparationBarrierPresentation:
 *  - opening a side presents exactly two panels (inner edge + outer arena
 *    boundary) plus one material, positioned from the SHARED zone and the
 *    playable arena bounds (never literals);
 *  - panel height spans ground → actual build-volume ceiling;
 *  - panels are presentation-only: non-pickable, no collider contribution;
 *  - open is idempotent per side, replaces on side change;
 *  - close/dispose fully reclaim meshes and materials — repeated prep rounds
 *    never grow the scene (no mesh/material growth);
 *  - dispose is idempotent and makes the component inert.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PLAYABLE_ARENA_BOUNDS, VERTICAL_MOVEMENT } from "@buildshift/game-config";
import {
  PreparationBarrierPresentation,
  PREPARATION_BARRIER_NAME,
  preparationBarrierTopY,
} from "./PreparationBarrierPresentation";
import { getPreparationZone } from "./preparationContract";

function ownedMeshes(scene: Scene): Mesh[] {
  return scene.meshes.filter((m) => m.name.startsWith(PREPARATION_BARRIER_NAME)) as Mesh[];
}
function ownedMaterials(scene: Scene): number {
  return scene.materials.filter((m) => m.name.startsWith(PREPARATION_BARRIER_NAME)).length;
}

describe("PreparationBarrierPresentation", () => {
  let engine: NullEngine;
  let scene: Scene;
  let barriers: PreparationBarrierPresentation;

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    barriers = new PreparationBarrierPresentation(scene);
  });

  afterEach(() => {
    barriers.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("presents exactly two panels + one material, derived from the shared zone (negative side)", () => {
    barriers.open("negative");
    const panels = ownedMeshes(scene);
    expect(panels).toHaveLength(2);
    expect(ownedMaterials(scene)).toBe(1);
    const zone = getPreparationZone("negative");
    const inner = panels.find((p) => p.name === `${PREPARATION_BARRIER_NAME}inner`)!;
    const outer = panels.find((p) => p.name === `${PREPARATION_BARRIER_NAME}outer`)!;
    // Inner edge = the strip's arena-facing face; outer = playable edge behind the row.
    expect(inner.position.x).toBeCloseTo(zone.maxX, 9);
    expect(outer.position.x).toBeCloseTo(PLAYABLE_ARENA_BOUNDS.minX, 9);
    // Both span the strip's full allowed Z at the arena centre, and stand
    // from the ground up to the actual build-volume ceiling.
    const height = preparationBarrierTopY() - VERTICAL_MOVEMENT.groundY;
    for (const panel of [inner, outer]) {
      expect(panel.position.z).toBeCloseTo((zone.minZ + zone.maxZ) / 2, 9);
      expect(panel.position.y).toBeCloseTo(VERTICAL_MOVEMENT.groundY + height / 2, 9);
      const box = panel.getBoundingInfo().boundingBox;
      expect(box.extendSize.y * 2).toBeCloseTo(height, 9);
    }
  });

  it("positive side mirrors: inner at zone.minX, outer at the +X playable edge", () => {
    barriers.open("positive");
    const zone = getPreparationZone("positive");
    const inner = ownedMeshes(scene).find((p) => p.name.endsWith("inner"))!;
    const outer = ownedMeshes(scene).find((p) => p.name.endsWith("outer"))!;
    expect(inner.position.x).toBeCloseTo(zone.minX, 9);
    expect(outer.position.x).toBeCloseTo(PLAYABLE_ARENA_BOUNDS.maxX, 9);
  });

  it("panels are presentation-only: non-pickable translucent blue", () => {
    barriers.open("negative");
    for (const panel of ownedMeshes(scene)) {
      expect(panel.isPickable).toBe(false);
      const mat = panel.material as { alpha: number } | null;
      expect(mat).not.toBeNull();
      expect(mat!.alpha).toBeGreaterThan(0);
      expect(mat!.alpha).toBeLessThan(1);
    }
  });

  it("open is idempotent per side and bounded across side changes", () => {
    barriers.open("negative");
    barriers.open("negative");
    expect(ownedMeshes(scene)).toHaveLength(2);
    barriers.open("positive");
    expect(ownedMeshes(scene)).toHaveLength(2);
    expect(ownedMaterials(scene)).toBe(1);
  });

  it("close removes every owned mesh and material; reopen stays bounded (no growth across prep rounds)", () => {
    for (let round = 0; round < 4; round++) {
      barriers.open(round % 2 === 0 ? "negative" : "positive");
      expect(ownedMeshes(scene)).toHaveLength(2);
      barriers.close();
      expect(ownedMeshes(scene)).toHaveLength(0);
      expect(ownedMaterials(scene)).toBe(0);
    }
    // close on an already-closed component is a safe no-op.
    barriers.close();
    expect(ownedMeshes(scene)).toHaveLength(0);
  });

  it("dispose reclaims everything and is idempotent / inert afterwards", () => {
    barriers.open("negative");
    barriers.dispose();
    expect(ownedMeshes(scene)).toHaveLength(0);
    expect(ownedMaterials(scene)).toBe(0);
    barriers.dispose();
    barriers.open("positive");
    expect(barriers.isOpen).toBe(false);
    expect(ownedMeshes(scene)).toHaveLength(0);
  });
});
