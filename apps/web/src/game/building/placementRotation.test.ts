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

  it("walls keep the selected (locked) orientation: the aim only picks the nearer parallel edge of the aimed tile", () => {
    const cs = BUILD_GRID.cellSize;
    const at = (dx: number, dz: number, rotation: GridRotation) => computePlacementPreview({
      aimOrigin: { x: dx, y: 5, z: dz }, aimDirection: { x: 0, y: -1, z: 0 }, playerPosition: { x: 0, y: 0, z: 0 },
      buildType: "wall", rotation, occupied: [],
    });
    const aims: Array<[number, number]> = [[0.3, -cs / 2 + 0.4], [cs / 2 - 0.4, 0.2], [-0.1, cs / 2 - 0.3], [-cs / 2 + 0.2, 0.5]];
    // Z-edge orientation (selected 2): never an X edge, wherever the aim lands.
    expect(aims.map(([x, z]) => at(x, z, 2).rotation)).toEqual([0, 2, 2, 2]);
    // X-edge orientation (selected 1).
    expect(aims.map(([x, z]) => at(x, z, 1).rotation)).toEqual([1, 1, 3, 3]);
    for (const p of [at(0.3, -2, 2), at(2, 0.3, 1)]) expect(p.grid).toEqual({ x: 0, y: 0, z: 0 });
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
    // Aiming at the ramp builds from its surface: a ramp continues past the
    // high end one layer up (rising the same way) — unless that slot is taken.
    const continued = previewAt("ramp", 0, { x: 0, z: 0 }, [ramp]);
    expect([continued.valid, continued.grid, continued.rotation]).toEqual([true, { x: 0, y: 1, z: 1 }, 1]);
    expect(previewAt("ramp", 0, { x: 0, z: 0 }, [ramp, { buildType: "ramp", grid: { x: 0, y: 1, z: 1 }, rotation: 3 }]).reason).toBe("overlap");
    for (const type of ["wall", "floor", "cone"] as const) expect(previewAt(type, 0, { x: 0, z: 0 }, [ramp]).valid, type).toBe(true);
    expect(previewAt("ramp", 0, { x: 0, z: 1 }, [ramp]).valid).toBe(true); // one tile only
    // A wall already on the aimed edge — named from the neighbour tile — conflicts.
    const cs = BUILD_GRID.cellSize;
    const wallOnSharedEdge: OccupiedStructure = { buildType: "wall", grid: { x: 0, y: 0, z: -1 }, rotation: 2 };
    const p = computePlacementPreview({ aimOrigin: { x: 0, y: 5, z: -cs / 2 + 0.5 }, aimDirection: { x: 0, y: -1, z: 0 }, playerPosition: { x: 0, y: 0, z: 0 }, buildType: "wall", rotation: 0, occupied: [wallOnSharedEdge] }); // just clear of the panel (its top would stack a wall above)
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
    f.key("Mouse4"); // ramp (walls take their rotation from the aimed edge instead)
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
    const plan: Array<[string, BuildType, number]> = [["Mouse3", "wall", -2], ["KeyQ", "floor", -1], ["Mouse4", "ramp", 0], ["KeyF", "cone", 2]];
    for (const [code, , x] of plan) { f.key(code); f.frame(x, 0, true); }
    // The wall keeps the selected X-edge orientation (aim at the tile centre →
    // its −X edge); the ramp keeps the selected rotation; floor / cone normalize to 0.
    expect(f.sent.map(r => [r.buildType, r.rotation])).toEqual([["wall", 3], ["floor", 0], ["ramp", 1], ["cone", 0]]);
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

describe("equip-facing orientation (the piece starts where the player looks, then stays locked)", () => {
  const H = Math.PI / 2;
  /** Fixture with a camera yaw source; every piece bind is an equip. */
  const facingFixture = () => {
    const f = createFixture();
    let yaw = 0;
    f.input.setFacingSource(() => yaw);
    return { ...f, look: (y: number) => { yaw = y; } };
  };

  it.each([
    ["north (−Z)", 0, 3, 0],
    ["east (+X)", H, 0, 1],
    ["south (+Z)", Math.PI, 1, 2],
    ["west (−X)", -H, 2, 3],
  ] as const)("facing %s: an equipped ramp rises that way and a wall stands on that edge", (_name, yaw, ramp, wall) => {
    const f = facingFixture();
    f.look(yaw);
    f.key("Mouse4"); // ramp
    expect(f.input.getRotation()).toBe(ramp);
    f.key("Mouse3"); // wall
    expect(f.input.getRotation()).toBe(wall);
    f.dispose();
  });

  it("camera turns after the equip never change the rotation; only R / X do, one quarter turn each", () => {
    const f = facingFixture();
    f.look(0);
    f.key("Mouse4"); // ramp facing north → 3
    for (const yaw of [H, Math.PI, -H, 0.3, -2.9]) {
      f.look(yaw);
      f.frame(0, 0, false);
      expect(f.input.getRotation()).toBe(3);
      expect(f.controller.getPreview().rotation).toBe(3);
    }
    f.key("KeyR");
    expect(f.input.getRotation()).toBe(0);
    f.key("KeyX");
    f.key("KeyX");
    expect(f.input.getRotation()).toBe(2);
    f.dispose();
  });

  it("switching piece while building re-initializes from the current facing (and only then)", () => {
    const f = facingFixture();
    f.look(H);
    f.key("Mouse3"); // wall facing east → 1
    expect(f.input.getRotation()).toBe(1);
    f.look(0);
    f.key("Mouse4"); // ramp facing north → 3
    expect(f.input.getRotation()).toBe(3);
    f.look(-H); // turn west without re-equipping: the ramp stays north
    expect(f.input.getRotation()).toBe(3);
    f.key("KeyR"); // exactly one quarter turn
    expect(f.input.getRotation()).toBe(0);
    f.key("Mouse4"); // re-equip: facing west → 2
    expect(f.input.getRotation()).toBe(2);
    f.dispose();
  });

  it("the placement request carries the equipped orientation, whatever the camera does meanwhile", () => {
    const f = facingFixture();
    f.look(H);
    f.key("Mouse4"); // ramp facing east → 0
    f.look(-H);
    f.frame(0, 0, true);
    expect(f.sent.map((r) => [r.buildType, r.rotation])).toEqual([["ramp", 0]]);
    f.dispose();
  });
});

describe("aiming up with no structure in the way targets the next layer (the ceiling)", () => {
  const up = (buildType: BuildType, playerY: number, occupied: OccupiedStructure[] = []) => computePlacementPreview({
    aimOrigin: { x: 0.3, y: playerY + 2, z: 1.5 }, aimDirection: { x: 0, y: Math.sin(0.9), z: -Math.cos(0.9) },
    playerPosition: { x: 0, y: playerY, z: 0 }, buildType, rotation: 0, occupied,
  });
  it("from the ground: a floor above the player's tile on layer 1 (a box roof)", () => {
    const p = up("floor", 0);
    expect([p.valid, p.grid]).toEqual([true, { x: 0, y: 1, z: 0 }]);
  });
  it("from a layer-1 floor: the next roof on layer 2; a wall there keeps the locked orientation", () => {
    expect(up("floor", BUILD_GRID.layerHeight + 0.15).grid).toEqual({ x: 0, y: 2, z: 0 });
    expect(up("wall", BUILD_GRID.layerHeight + 0.15).rotation % 2).toBe(0);
  });
  it("a structure nearer than the ceiling still wins (build from its surface)", () => {
    const p = up("floor", 0, [{ buildType: "floor", grid: { x: 0, y: 1, z: 0 } }]); // the roof already there: hit its underside
    expect(p.grid?.y).toBe(1);
    expect(p.grid).not.toEqual({ x: 0, y: 1, z: 0 });
  });
  it("the top layer's ceiling is out of the build bounds (invalid, not wrapped)", () => {
    const p = up("floor", 2 * BUILD_GRID.layerHeight + 0.15);
    expect([p.valid, p.reason, p.grid?.y]).toEqual([false, "out_of_bounds", 3]);
  });
});

describe("aiming up: a structure beyond the ceiling plane but within reach still wins", () => {
  it("the upper face of a layer-1 wall (behind the ceiling crossing) stacks the layer-2 wall", () => {
    const cs = BUILD_GRID.cellSize, lh = BUILD_GRID.layerHeight;
    const walls: OccupiedStructure[] = [{ buildType: "wall", grid: { x: 0, y: 0, z: 0 }, rotation: 0 }, { buildType: "wall", grid: { x: 0, y: 1, z: 0 }, rotation: 0 }];
    const origin = { x: 0.2, y: 3, z: 4 };
    const target = { x: 0.2, y: lh + 0.8 * lh, z: -cs / 2 + 0.384 };
    const d = { x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z };
    const n = Math.hypot(d.x, d.y, d.z);
    const p = computePlacementPreview({ aimOrigin: origin, aimDirection: { x: d.x / n, y: d.y / n, z: d.z / n }, playerPosition: { x: 0, y: 0, z: 1 }, buildType: "wall", rotation: 0, occupied: walls });
    expect([p.valid, p.grid, p.rotation]).toEqual([true, { x: 0, y: 2, z: 0 }, 0]);
  });
});
