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

/** Build tiles are centred on grid × cellSize: aiming straight down there hits tile i. */
const cellCenter = (i: number) => i * BUILD_GRID.cellSize;

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
  it("ramp is valid at rotations 0–3 and keeps the selected rotation", () => {
    for (const rotation of [0, 1, 2, 3] as const) {
      const p = previewAt("ramp", rotation, { x: 0, z: 0 });
      expect(p.valid, `ramp r${rotation}: ${p.reason}`).toBe(true);
      expect(p.rotation).toBe(rotation);
    }
  });

  it("walls snap to the aimed tile's nearest edge (the selected rotation does not apply)", () => {
    const cs = BUILD_GRID.cellSize;
    const at = (dx: number, dz: number) => computePlacementPreview({
      aimOrigin: { x: dx, y: 5, z: dz }, aimDirection: { x: 0, y: -1, z: 0 }, playerPosition: { x: 0, y: 0, z: 0 },
      buildType: "wall", rotation: 2, occupied: [],
    });
    expect([at(0.3, -cs / 2 + 0.4).rotation, at(cs / 2 - 0.4, 0.2).rotation, at(-0.1, cs / 2 - 0.3).rotation, at(-cs / 2 + 0.2, 0.5).rotation]).toEqual([0, 1, 2, 3]);
    for (const p of [at(0.3, -2), at(2, 0.3)]) expect(p.grid).toEqual({ x: 0, y: 0, z: 0 });
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

  it("checks overlap by canonical slot: a ramp's tile still takes walls, floors and a cone; only another ramp conflicts", () => {
    const ramp: OccupiedStructure = { buildType: "ramp", grid: { x: 0, y: 0, z: 0 }, rotation: 1 };
    expect(previewAt("ramp", 0, { x: 0, z: 0 }, [ramp]).reason).toBe("overlap");
    for (const type of ["wall", "floor", "cone"] as const) expect(previewAt(type, 0, { x: 0, z: 0 }, [ramp]).valid, type).toBe(true);
    expect(previewAt("ramp", 0, { x: 0, z: 1 }, [ramp]).valid).toBe(true); // one tile only
    // A wall already on the aimed edge — named from the neighbour tile — conflicts.
    const cs = BUILD_GRID.cellSize;
    const wallOnSharedEdge: OccupiedStructure = { buildType: "wall", grid: { x: 0, y: 0, z: -1 }, rotation: 2 };
    const p = computePlacementPreview({ aimOrigin: { x: 0, y: 5, z: -cs / 2 + 0.3 }, aimDirection: { x: 0, y: -1, z: 0 }, playerPosition: { x: 0, y: 0, z: 0 }, buildType: "wall", rotation: 0, occupied: [wallOnSharedEdge] });
    expect(p.rotation).toBe(0);
    expect(p.reason).toBe("overlap");
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

  it("a one-tile ramp at the edge of the volume is in bounds at every rotation", () => {
    const edge = { x: BUILD_BOUNDS.maxX, z: 0 };
    for (const rotation of [0, 1, 2, 3] as const) {
      const p = previewAt("ramp", rotation, edge);
      const inBounds = isWithinBuildBounds("ramp", { x: edge.x, y: 0, z: edge.z }, rotation);
      expect(inBounds).toBe(true);
      expect(p.valid).toBe(inBounds);
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

describe("rotation binds, turbo and piece switching", () => {
  it("rotate left/right wrap around 0–3", () => {
    const f = createFixture();
    expect(f.input.getRotation()).toBe(0);
    f.key("KeyX");
    expect(f.input.getRotation()).toBe(3);
    f.key("KeyR");
    expect(f.input.getRotation()).toBe(0);
    for (const expected of [1, 2, 3, 0]) { f.key("KeyR"); expect(f.input.getRotation()).toBe(expected); }
    for (const expected of [3, 2, 1, 0]) { f.key("KeyX"); expect(f.input.getRotation()).toBe(expected); }
    f.dispose();
  });

  it("turbo keeps placing while rotating, each ramp request carrying the current rotation", () => {
    const f = createFixture();
    f.key("KeyE"); // ramp (walls take their rotation from the aimed edge instead)
    const cells = [-2, -1, 0, 1, 2];
    for (const [i, x] of cells.entries()) {
      if (i > 0) f.key("KeyR");
      f.frame(x, 0, true);
    }
    expect(f.sent.map(r => r.rotation)).toEqual([0, 1, 2, 3, 0]);
    expect(f.sent.map(r => (r.grid as { x: number }).x)).toEqual(cells);
    f.dispose();
  });

  it("switching wall → floor → ramp → cone after rotating sends the canonical rotation for each piece", () => {
    const f = createFixture();
    f.key("KeyR"); // rotation 1 selected
    const plan: Array<[string, BuildType, number]> = [["KeyQ", "wall", -2], ["KeyF", "floor", -1], ["KeyE", "ramp", 0], ["KeyZ", "cone", 2]];
    for (const [code, , x] of plan) { f.key(code); f.frame(x, 0, true); }
    // The wall snaps to the aimed edge (aim at the tile centre → its −Z edge);
    // the ramp keeps the selected rotation; floor / cone normalize to 0.
    expect(f.sent.map(r => [r.buildType, r.rotation])).toEqual([["wall", 0], ["floor", 0], ["ramp", 1], ["cone", 0]]);
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
    // Part-way up a ramp (still the ground layer), 3.4 m straight above the anchor.
    expect(fromPlayer({ x: 10.24, y: 3.4, z: 0 }).valid).toBe(true);
  });

  it("is out_of_range for an anchor beyond the limit in 3D (in range horizontally)", () => {
    // Part-way up a ramp at y = 3.4 (ground layer), 11.74 m away horizontally → 12.22 m.
    const player = { x: -1.5, y: 3.4, z: 0 };
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
      { x: -1.5, y: 3.4, z: 0 } as unknown as Vector3,
      true, held, 10_000,
    );
    elevated(true);
    expect(f.sent).toHaveLength(0);
    f.dispose();
  });
});
