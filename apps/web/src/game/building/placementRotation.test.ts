/**
 * Rotated building placement — client tests.
 *
 * Q/E rotation must work for every piece: the preview normalizes the
 * selected quarter turn with the shared `normalizePlacementRotation` rule
 * (walls/ramps keep it, floors/cones use 0), validates rotation and build
 * bounds with the same shared rules the server enforces, and uses
 * rotation-aware footprints for overlap. Driven through the real per-frame
 * contract (`updateBuildingFrame`) with fake DOM targets and a recording
 * network, like `buildingController.turbo.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BUILD_EVENTS, type BuildType, type GridRotation } from "@buildshift/protocol";
import {
  BUILD_BOUNDS,
  BUILD_GRID,
  isWithinPlacementRange,
  isValidPlacementRotation,
  isWithinBuildBounds,
  normalizePlacementRotation,
} from "@buildshift/game-config";
import {
  BuildingController,
  BuildingInputController,
  BuildingStateStore,
  PLACEMENT_REQUEST_INTERVAL_MS,
  computePlacementPreview,
  updateBuildingFrame,
  type BuildingInputEnvironment,
  type BuildingNetworkLike,
  type InputEventTarget,
  type OccupiedStructure,
} from "./index";

class FakeTarget implements InputEventTarget {
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

/** Camera straight above the centre of cell (x, z): the aim hits that cell. */
const cellCenter = (i: number) => i * BUILD_GRID.cellSize + BUILD_GRID.cellSize / 2;

function createFixture() {
  const canvas = {} as HTMLCanvasElement;
  const keyTarget = new FakeTarget();
  const inert = new FakeTarget();
  const env: BuildingInputEnvironment = { keyTarget, pointerLockTarget: inert, visibilityTarget: inert, getPointerLockElement: () => canvas, isHidden: () => false };
  const input = new BuildingInputController(canvas, env);
  const store = new BuildingStateStore();
  const sent: Array<Record<string, unknown>> = [];
  const network: BuildingNetworkLike = {
    send: (type, payload) => { if (type === BUILD_EVENTS.PLACEMENT_REQUEST) sent.push(payload as Record<string, unknown>); return true; },
    onEvent: () => () => {},
  };
  const controller = new BuildingController(input, store, network);
  const key = (code: string) => keyTarget.dispatch("keydown", { code, repeat: false });
  key("KeyB"); // build mode on
  let now = 0;
  /** One render frame aiming at cell (x, z), primary held or not. */
  const frame = (x: number, z: number, held: boolean, playerX = 0) => {
    now += PLACEMENT_REQUEST_INTERVAL_MS + 1;
    const camera = { position: { x: cellCenter(x), y: 5, z: cellCenter(z) } } as unknown as Camera;
    const aim = { x: 0, y: -1, z: 0 } as unknown as Vector3;
    const feet = { x: playerX, y: 0, z: 0 } as unknown as Vector3;
    updateBuildingFrame({ controller }, camera, aim, feet, true, held, now);
  };
  return { input, controller, sent, key, frame, dispose: () => controller.dispose() };
}

const previewAt = (buildType: BuildType, rotation: GridRotation, grid: { x: number; z: number }, occupied: OccupiedStructure[] = []) =>
  computePlacementPreview({
    aimOrigin: { x: cellCenter(grid.x), y: 5, z: cellCenter(grid.z) },
    aimDirection: { x: 0, y: -1, z: 0 },
    playerPosition: { x: 0, y: 0, z: 0 },
    buildType,
    rotation,
    occupied,
  });

describe("placement preview rotation (shared canonical rule)", () => {
  it.each(["wall", "ramp"] as const)("%s is valid at rotations 0–3 and keeps the selected rotation", (type) => {
    for (const rotation of [0, 1, 2, 3] as const) {
      const p = previewAt(type, rotation, { x: 0, z: 0 });
      expect(p.valid, `${type} r${rotation}: ${p.reason}`).toBe(true);
      expect(p.rotation).toBe(rotation);
    }
  });

  it.each(["floor", "cone"] as const)("%s stays valid after any selected rotation and normalizes it to 0", (type) => {
    for (const rotation of [0, 1, 2, 3] as const) {
      const p = previewAt(type, rotation, { x: 0, z: 0 });
      expect(p.valid, `${type} r${rotation}: ${p.reason}`).toBe(true);
      expect(p.rotation).toBe(0);
      expect(p.rotation).toBe(normalizePlacementRotation(type, rotation));
      expect(isValidPlacementRotation(type, p.rotation)).toBe(true); // what the server accepts
    }
  });

  it("uses rotated footprints for overlap (a rotation-1 ramp runs along Z)", () => {
    const ramp: OccupiedStructure = { buildType: "ramp", grid: { x: 0, y: 0, z: 0 }, rotation: 1 };
    expect(previewAt("wall", 0, { x: 0, z: 1 }, [ramp]).reason).toBe("overlap");
    expect(previewAt("wall", 0, { x: 1, z: 0 }, [ramp]).valid).toBe(true);
    const ramp0: OccupiedStructure = { ...ramp, rotation: 0 };
    expect(previewAt("wall", 0, { x: 1, z: 0 }, [ramp0]).reason).toBe("overlap");
    expect(previewAt("wall", 0, { x: 0, z: 1 }, [ramp0]).valid).toBe(true);
    // The candidate's own rotation counts too.
    expect(previewAt("ramp", 1, { x: 0, z: -1 }, [{ buildType: "wall", grid: { x: 0, y: 0, z: 0 } }]).reason).toBe("overlap");
    expect(previewAt("ramp", 0, { x: 0, z: -1 }, [{ buildType: "wall", grid: { x: 0, y: 0, z: 0 } }]).valid).toBe(true);
  });
});

describe("placement preview build bounds (shared BUILD_BOUNDS rule)", () => {
  it("cells outside the build volume are visibly invalid (out_of_bounds)", () => {
    for (const grid of [{ x: BUILD_BOUNDS.maxX + 1, z: 0 }, { x: BUILD_BOUNDS.minX - 1, z: 0 }, { x: 0, z: BUILD_BOUNDS.maxZ + 1 }, { x: 0, z: BUILD_BOUNDS.minZ - 1 }]) {
      const p = previewAt("wall", 0, grid);
      expect(p.present).toBe(true);
      expect(p.valid).toBe(false);
      expect(p.reason).toBe("out_of_bounds");
    }
  });

  it("a ramp is out of bounds exactly when its rotated footprint leaves the volume", () => {
    const edge = { x: BUILD_BOUNDS.maxX, z: 0 };
    for (const rotation of [0, 1, 2, 3] as const) {
      const p = previewAt("ramp", rotation, edge);
      const inBounds = isWithinBuildBounds("ramp", { x: edge.x, y: 0, z: edge.z }, rotation);
      expect(p.valid).toBe(inBounds);
      if (!inBounds) expect(p.reason).toBe("out_of_bounds");
    }
  });

  it("sends no placement request for a locally out-of-bounds target", () => {
    const f = createFixture();
    // Player at the build-volume edge: the next cell out is within placement
    // range, so only the bounds rule can stop the request.
    const edgeX = cellCenter(BUILD_BOUNDS.maxX);
    f.frame(BUILD_BOUNDS.maxX + 1, 0, true, edgeX);
    f.frame(BUILD_BOUNDS.maxX + 1, 0, true, edgeX);
    expect(f.sent).toHaveLength(0);
    f.frame(BUILD_BOUNDS.maxX, 0, true, edgeX); // back inside: turbo resumes
    expect(f.sent).toHaveLength(1);
    f.dispose();
  });
});

describe("Q/E rotation, turbo and piece switching", () => {
  it("Q/E wrap around 0–3", () => {
    const f = createFixture();
    expect(f.input.getRotation()).toBe(0);
    f.key("KeyQ");
    expect(f.input.getRotation()).toBe(3);
    f.key("KeyE");
    expect(f.input.getRotation()).toBe(0);
    for (const expected of [1, 2, 3, 0]) { f.key("KeyE"); expect(f.input.getRotation()).toBe(expected); }
    for (const expected of [3, 2, 1, 0]) { f.key("KeyQ"); expect(f.input.getRotation()).toBe(expected); }
    f.dispose();
  });

  it("turbo keeps placing while rotating, each request carrying the current rotation", () => {
    const f = createFixture();
    f.key("Digit1"); // wall
    const cells = [-2, -1, 0, 1, 2];
    for (const [i, x] of cells.entries()) {
      if (i > 0) f.key("KeyE");
      f.frame(x, 0, true);
    }
    expect(f.sent.map(r => r.rotation)).toEqual([0, 1, 2, 3, 0]);
    expect(f.sent.map(r => (r.grid as { x: number }).x)).toEqual(cells);
    f.dispose();
  });

  it("switching wall → floor → ramp → cone after rotating sends the canonical rotation for each piece", () => {
    const f = createFixture();
    f.key("KeyE"); // rotation 1 selected
    const plan: Array<[string, BuildType, number]> = [["Digit1", "wall", -2], ["Digit2", "floor", -1], ["Digit3", "ramp", 0], ["Digit4", "cone", 2]];
    for (const [code, , x] of plan) { f.key(code); f.frame(x, 0, true); }
    expect(f.sent.map(r => [r.buildType, r.rotation])).toEqual([["wall", 1], ["floor", 0], ["ramp", 1], ["cone", 0]]);
    for (const r of f.sent) expect(isValidPlacementRotation(r.buildType as string, r.rotation as number)).toBe(true);
    // The selection itself is preserved for the next rotatable piece.
    expect(f.input.getRotation()).toBe(1);
    f.dispose();
  });
});

describe("placement preview range (shared full-3D rule)", () => {
  /** Preview aiming at ground cell (2, 0) — anchor (10.24, 0, 0) — from `player`. */
  const fromPlayer = (player: { x: number; y: number; z: number }) => computePlacementPreview({
    aimOrigin: { x: cellCenter(2), y: player.y + 5, z: cellCenter(0) },
    aimDirection: { x: 0, y: -1, z: 0 },
    playerPosition: player,
    buildType: "wall",
    rotation: 0,
    occupied: [],
  });

  it("is valid in range horizontally", () => {
    expect(fromPlayer({ x: 0, y: 0, z: 0 }).valid).toBe(true); // 10.24 m
  });

  it("is valid in range vertically (player standing above the anchor)", () => {
    expect(fromPlayer({ x: 10.24, y: 7.83, z: 0 }).valid).toBe(true); // 7.83 m straight up
  });

  it("is out_of_range for an anchor beyond the limit in 3D (in range horizontally)", () => {
    // On a high build at y = 7.83, 10.24 m away horizontally → 12.89 m.
    const player = { x: 0, y: 7.83, z: 0 };
    const p = fromPlayer(player);
    expect(p.valid).toBe(false);
    expect(p.reason).toBe("out_of_range");
    expect(isWithinPlacementRange(player, p.grid!)).toBe(false); // the server's verdict
  });

  it("sends no placement request for a target out of 3D range", () => {
    const f = createFixture();
    const elevated = (held: boolean) => updateBuildingFrame(
      { controller: f.controller },
      { position: { x: cellCenter(2), y: 12, z: cellCenter(0) } } as unknown as Camera,
      { x: 0, y: -1, z: 0 } as unknown as Vector3,
      { x: 0, y: 7.83, z: 0 } as unknown as Vector3,
      true, held, 10_000,
    );
    elevated(true);
    expect(f.sent).toHaveLength(0);
    f.dispose();
  });
});
