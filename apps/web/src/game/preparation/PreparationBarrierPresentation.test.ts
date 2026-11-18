/**
 * Behavioral NullEngine tests for PreparationBarrierPresentation:
 *  - opening a side presents exactly two panels (inner + outer faces of the
 *    one-row shared zone span, one cell wide) plus one material, positioned
 *    from the SHARED zone only (never literals, never the arena edge);
 *  - panel height spans ground → actual room ceiling underside
 *    (ceilingHeight, includes build/jump/camera clearance);
 *  - panels are presentation-only: non-pickable, no collider contribution;
 *  - open is idempotent per side, replaces on side change;
 *  - close/dispose fully reclaim meshes and materials — repeated prep rounds
 *    never grow the scene (no mesh/material growth);
 *  - dispose is idempotent and makes the component inert.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
// Direct submodule import (NOT the `@babylonjs/core` barrel): the barrel
// masks EdgeRenderer side-effect registration, which previously hid a
// production PAGEERROR. With the narrow import, enableEdgesRendering only
// works because the component itself imports the renderer side-effect.
import { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { BUILD_BOUNDS, BUILD_GRID, VERTICAL_MOVEMENT } from "@buildshift/game-config";
import { ceilingHeight } from "../scene/arenaDecorations";
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
    // Both planes are the zone's own faces: inner = arena-facing row edge,
    // outer = far row edge where the preparation clamp actually stops movement.
    expect(inner.position.x).toBeCloseTo(zone.maxX, 9);
    expect(outer.position.x).toBeCloseTo(zone.minX, 9);
    // The two planes span exactly one build cell in X.
    expect(Math.abs(inner.position.x - outer.position.x)).toBeCloseTo(
      BUILD_GRID.cellSize,
      9,
    );
    // Both span the strip's full allowed Z at the zone centre, and stand
    // from the ground up to the actual room ceiling underside.
    const height = preparationBarrierTopY() - VERTICAL_MOVEMENT.groundY;
    for (const panel of [inner, outer]) {
      expect(panel.position.z).toBeCloseTo((zone.minZ + zone.maxZ) / 2, 9);
      expect(panel.position.y).toBeCloseTo(VERTICAL_MOVEMENT.groundY + height / 2, 9);
      const box = panel.getBoundingInfo().boundingBox;
      expect(box.extendSize.y * 2).toBeCloseTo(height, 9);
    }
  });

  it("height reaches the actual room ceiling underside, not just the build top", () => {
    expect(preparationBarrierTopY()).toBeCloseTo(ceilingHeight(), 9);
    expect(preparationBarrierTopY()).toBeGreaterThan(
      (BUILD_BOUNDS.maxLayer + 1) * BUILD_GRID.layerHeight,
    );
  });

  it("positive side mirrors: inner at zone.minX, outer at zone.maxX", () => {
    barriers.open("positive");
    const zone = getPreparationZone("positive");
    const inner = ownedMeshes(scene).find((p) => p.name.endsWith("inner"))!;
    const outer = ownedMeshes(scene).find((p) => p.name.endsWith("outer"))!;
    expect(inner.position.x).toBeCloseTo(zone.minX, 9);
    expect(outer.position.x).toBeCloseTo(zone.maxX, 9);
    expect(Math.abs(inner.position.x - outer.position.x)).toBeCloseTo(
      BUILD_GRID.cellSize,
      9,
    );
  });

  it("panels are presentation-only: non-pickable translucent blue, edges registered without throwing", () => {
    barriers.open("negative");
    const panels = ownedMeshes(scene);
    expect(panels).toHaveLength(2);
    for (const panel of panels) {
      expect(panel.isPickable).toBe(false);
      // The side-effect import must have registered the EdgeRenderer, so
      // enableEdgesRendering actually created one (no throw in open()).
      expect((panel as unknown as { _edgesRenderer?: unknown })._edgesRenderer).toBeDefined();
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
