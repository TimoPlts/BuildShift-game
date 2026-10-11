/**
 * Unit tests for the {@link buildBuildEditHudView} /
 * {@link buildEditHudChangeKey} pure mapping.
 *
 * Pinned contracts:
 *  - the flat HUD state mirrors the controller's presentation values
 *    (mode, target, pending tile summary, feedback, readiness),
 *  - the pending tile summary derives open/total from the canonical edit
 *    state (ramps report their variant instead of tiles),
 *  - the change key is stable across identical views and distinguishes any
 *    player-visible change (mode, target, tile count, ramp variant,
 *    feedback, readiness).
 */
import { describe, expect, it } from "vitest";
import {
  buildBuildEditHudView,
  buildEditHudChangeKey,
  type BuildEditHudInput,
} from "./buildEditHudView";
import type { TargetedStructure } from "./structureSelection";

const wallTarget: TargetedStructure = {
  structureId: "wall-1",
  buildType: "wall",
  grid: { x: 1, y: 0, z: 2 },
  rotation: 0,
  ownerId: "p1",
  distance: 3.2,
};

function input(overrides: Partial<BuildEditHudInput> = {}): BuildEditHudInput {
  return {
    mode: true,
    target: wallTarget,
    pending: {
      kind: "wall",
      tiles: [true, true, true, true, false, true, true, true, true],
    },
    feedback: null,
    connected: true,
    ...overrides,
  };
}

describe("buildBuildEditHudView", () => {
  it("copies the presentation values into the flat view", () => {
    const view = buildBuildEditHudView(input());
    expect(view.mode).toBe(true);
    expect(view.target).toEqual({
      structureId: "wall-1",
      buildType: "wall",
      grid: { x: 1, y: 0, z: 2 },
    });
    expect(view.removedTiles).toBe(1);
    expect(view.totalTiles).toBe(9);
    expect(view.rampVariant).toBeNull();
    expect(view.feedback).toBeNull();
    expect(view.applyReady).toBe(true);
  });

  it("reports an untargeted edit mode with null target and zero summary", () => {
    const view = buildBuildEditHudView(input({ target: null, pending: null }));
    expect(view.mode).toBe(true);
    expect(view.target).toBeNull();
    expect(view.removedTiles).toBe(0);
    expect(view.totalTiles).toBe(0);
    expect(view.rampVariant).toBeNull();
    expect(view.applyReady).toBe(false);
  });

  it("counts every open tile on a floor grid", () => {
    const view = buildBuildEditHudView(
      input({
        target: { ...wallTarget, structureId: "floor-1", buildType: "floor" },
        pending: {
          kind: "floor_cone",
          tiles: [false, true, false, false],
        },
      }),
    );
    expect(view.totalTiles).toBe(4);
    expect(view.removedTiles).toBe(3);
    expect(view.rampVariant).toBeNull();
  });

  it("reports the ramp variant instead of tiles", () => {
    const view = buildBuildEditHudView(
      input({
        target: { ...wallTarget, structureId: "ramp-1", buildType: "ramp" },
        pending: { kind: "ramp", variant: "half_right" },
      }),
    );
    expect(view.totalTiles).toBe(0);
    expect(view.removedTiles).toBe(0);
    expect(view.rampVariant).toBe("half_right");
  });

  it("passes the feedback through with kind + message only", () => {
    const view = buildBuildEditHudView(
      input({
        feedback: {
          kind: "rejected",
          message: "Not your structure",
          structureId: "wall-1",
        },
      }),
    );
    expect(view.feedback).toEqual({
      kind: "rejected",
      message: "Not your structure",
    });
  });

  it("marks the edit unavailable while disconnected or untargeted", () => {
    expect(buildBuildEditHudView(input({ connected: false })).applyReady).toBe(false);
    expect(buildBuildEditHudView(input({ mode: false })).applyReady).toBe(false);
    expect(buildBuildEditHudView(input()).applyReady).toBe(true);
  });
});

describe("buildEditHudChangeKey", () => {
  it("is stable for identical views", () => {
    const a = buildBuildEditHudView(input());
    const b = buildBuildEditHudView(input());
    expect(buildEditHudChangeKey(a)).toBe(buildEditHudChangeKey(b));
  });

  it("changes with mode, target, tile summary, ramp variant, feedback, and readiness", () => {
    const base = buildBuildEditHudView(input());
    const baseKey = buildEditHudChangeKey(base);

    const variants = [
      buildBuildEditHudView(input({ mode: false })),
      buildBuildEditHudView(
        input({
          target: { ...wallTarget, structureId: "wall-2", grid: { x: 9, y: 1, z: 4 } },
        }),
      ),
      buildBuildEditHudView(
        input({
          pending: {
            kind: "wall",
            tiles: [true, true, true, true, false, false, true, true, true],
          },
        }),
      ),
      buildBuildEditHudView(
        input({
          target: { ...wallTarget, buildType: "ramp" },
          pending: { kind: "ramp", variant: "full" },
        }),
      ),
      buildBuildEditHudView(
        input({
          target: { ...wallTarget, buildType: "ramp" },
          pending: { kind: "ramp", variant: "half_left" },
        }),
      ),
      buildBuildEditHudView(
        input({ feedback: { kind: "accepted", message: "Edit confirmed" } }),
      ),
      buildBuildEditHudView(input({ connected: false })),
    ];
    for (const variant of variants) {
      expect(buildEditHudChangeKey(variant)).not.toBe(baseKey);
    }
  });
});
