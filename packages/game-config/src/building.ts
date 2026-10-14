/**
 * Shared building configuration (grid, range, rate, structure tuning).
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §7.5, building balance values live in this
 * package so the authoritative server (`apps/game-server`) and the client
 * (`apps/web`) — the placement-preview snapper and the authoritative
 * validator — reference the exact same numbers. This is *data only*: no engine
 * imports, no presentation.
 *
 * The protocol package owns the *shapes* of the building contract (the
 * `BuildType` ids, the grid-placement intent, and the structure state — see
 * `@buildshift/protocol` `building.ts`); this package owns the *values* those
 * shapes are validated and tuned against:
 *
 *  - {@link BUILD_GRID} — the grid-snapping lattice (cell size + layer height),
 *  - {@link BUILD_RANGE} — how far from a player a structure may be placed,
 *  - {@link BUILD_RATE} — how often a player may place structures, and
 *  - {@link STRUCTURES} / {@link StructureConfig} — the per-kind footprint,
 *    cost, and rotation tuning for wall / floor / ramp / cone.
 */

// ─────────────────────────── Grid configuration ──────────────────────────────

/**
 * The grid-snapping lattice for structure placement.
 *
 * This is the **canonical modular build geometry**: one shared, authoritative
 * definition of the build lattice that the client (preview snapper, renderer,
 * selection, placement offsets) and the authoritative server (validator,
 * collision collider placement) both consume so they can never drift.
 *
 * The modular unit is a `cellSize` × `cellSize` (metres) square in the X/Z
 * plane — approximately **5.12 m** per cell — stacked in layers of
 * `layerHeight` metres — approximately **3.84 m** per layer. The cell and the
 * layer keep a clean 4:3 ratio (5.12 : 3.84), so the grid reads as a coherent
 * modular set. `groundLayer` is the index of the lowest buildable layer (the
 * layer whose base sits on the ground). The client snaps its placement preview
 * to this lattice and the server validates a placement against it; both derive
 * a cell's world-space position from the shared cell size / layer height, so
 * the wall/ramp **rise is exactly one layer (≈ 3.84 m)** on both sides.
 */
export const BUILD_GRID = {
  /**
   * Size of a single build cell in the X/Z plane, in metres. The canonical
   * modular cell is ≈ 5.12 m wide.
   */
  cellSize: 5.12,
  /**
   * Height of a single build layer, in metres (distance between layer bases).
   * The canonical modular layer is ≈ 3.84 m; a wall or ramp that rises one
   * layer therefore rises ≈ 3.84 m.
   */
  layerHeight: 3.84,
  /** The index of the ground layer (the lowest buildable layer). */
  groundLayer: 0,
} as const;

// ─────────────────────────── Build volume bounds ─────────────────────────────

/**
 * The fixed build volume in grid-cell coordinates.
 *
 * A placement is valid only when every cell its footprint occupies lies
 * within `[minX..maxX] × [minLayer..maxLayer] × [minZ..maxZ]` (inclusive).
 * The bounds are symmetric on X/Z and are sized so the build volume fits
 * within the 30 m × 30 m arena ground: with ≈ 5.12 m cells, 5 cells span
 * 25.6 m (leaving a margin inside the arena). Vertically the volume allows
 * three ≈ 3.84 m layers (11.52 m).
 *
 * Both the client preview snapper and the authoritative server validator
 * reference these same bounds so they cannot drift.
 */
export const BUILD_BOUNDS = {
  /** Minimum cell index along world X. */
  minX: -2,
  /** Maximum cell index along world X. */
  maxX: 2,
  /** Minimum cell index along world Z. */
  minZ: -2,
  /** Maximum cell index along world Z. */
  maxZ: 2,
  /** Minimum (lowest) buildable layer index. */
  minLayer: 0,
  /** Maximum (highest) buildable layer index. */
  maxLayer: 2,
} as const;

// ─────────────────────────── Range configuration ─────────────────────────────

/**
 * Placement-range tuning: how far from the placing player a structure may be.
 */
export const BUILD_RANGE = {
  /**
   * Maximum distance, in metres, from the player's position to a placeable
   * grid cell. A placement whose anchor cell is farther than this is rejected
   * with the `out_of_range` reason.
   */
  maxPlacementDistance: 12,
} as const;

// ─────────────────────────── Rate configuration ──────────────────────────────

/**
 * Placement-rate tuning: how often a player may successfully place structures.
 *
 * Expressed in simulation ticks (matching the tick-based cadence convention
 * used elsewhere, e.g. weapon `fireIntervalTicks`) so the gate is
 * deterministic on both the predicting client and the authoritative server.
 */
export const BUILD_RATE = {
  /**
   * Minimum simulation ticks between two accepted placements for a single
   * player. A placement submitted sooner than this after the player's last
   * accepted placement is rejected with the `rate_limited` reason.
   */
  minTicksBetweenPlacements: 10,
} as const;

// ─────────────────────────── Structure configuration ─────────────────────────

/**
 * The build-type keys the shared building configuration is keyed by.
 *
 * These are the *same* stable ids the protocol's `BuildType` uses (`wall` /
 * `floor` / `ramp` / `cone`); they are declared locally so this package stays
 * self-contained (no cross-package import) while remaining structurally
 * aligned with the protocol vocabulary.
 */
export const BUILD_STRUCTURE_KEYS = ["wall", "floor", "ramp", "cone"] as const;

/** A build-type key used by the shared building configuration. */
export type BuildStructureKey = (typeof BUILD_STRUCTURE_KEYS)[number];

/** A single structure-kind definition shared by client and server. */
export interface StructureConfig {
  /** The build type this configuration describes. */
  buildType: BuildStructureKey;
  /**
   * Grid footprint in build cells: `[width (x), height (y), depth (z)]`,
   * measured in the units of {@link BUILD_GRID} (≈ 5.12 m per x/z cell,
   * ≈ 3.84 m per y layer). The footprint is how many grid cells the
   * structure occupies when placed at its anchor cell.
   */
  footprint: [number, number, number];
  /** Resource cost to place one instance of this structure. */
  cost: number;
  /**
   * Number of valid cardinal orientations. `1` means the structure is
   * rotation-invariant (only the default facing is meaningful); `4` means it
   * may face any of the 0/90/180/270° cardinal rotations.
   */
  rotationCount: number;
}

/**
 * The per-kind building tuning.
 *
 * All four kinds are built from the same ≈ 5.12 m × ≈ 3.84 m modular cell,
 * with thin surfaces (the renderer presents walls as thin panels, floors as
 * thin slabs, ramps as low inclines — see `BuildStructureRenderer`): the
 * authoritative footprint/collider stays the full cell so gameplay and
 * authority are unchanged, while the visual reads as a thin surface.
 *
 *  - **wall** — a vertical barrier one cell wide (≈ 5.12 m) and one layer
 *   tall (≈ 3.84 m rise), rotatable in 4 cardinal directions.
 * - **floor** — a single-cell platform (≈ 5.12 m × ≈ 3.84 m × ≈ 5.12 m);
 *   rotation-invariant.
 * - **ramp** — a two-cell-long (≈ 10.24 m) incline rising one layer
 *   (≈ 3.84 m), rotatable in 4 cardinal directions.
 * - **cone** — a single-cell point/fixture (≈ 5.12 m × ≈ 3.84 m × ≈ 5.12 m);
 *   rotation-invariant.
 *
 * Consumers look a structure up by build type via {@link getStructureConfig};
 * additional structure kinds can be appended to {@link BUILD_STRUCTURE_KEYS}
 * and {@link STRUCTURES} in later stages without changing the consumer
 * contract.
 */
export const STRUCTURES: Record<BuildStructureKey, StructureConfig> = {
  wall: {
    buildType: "wall",
    footprint: [1, 1, 1],
    cost: 10,
    rotationCount: 4,
  },
  floor: {
    buildType: "floor",
    footprint: [1, 1, 1],
    cost: 5,
    rotationCount: 1,
  },
  ramp: {
    buildType: "ramp",
    footprint: [2, 1, 1],
    cost: 8,
    rotationCount: 4,
  },
  cone: {
    buildType: "cone",
    footprint: [1, 1, 1],
    cost: 6,
    rotationCount: 1,
  },
};

/**
 * Look up a structure-kind configuration by its build type.
 *
 * Returns `undefined` for unknown ids so callers can validate player intent
 * (e.g. the authoritative server rejecting a placement with an unknown build
 * type), mirroring the `getWeaponById` contract.
 */
export function getStructureConfig(buildType: string): StructureConfig | undefined {
  return (STRUCTURES as Record<string, StructureConfig>)[buildType];
}

// ───────────────────────── Canonical placement rules ─────────────────────────
//
// Shared by the client placement preview and the authoritative server
// placement validator, so the two cannot disagree about which rotation a
// placement carries, which cells it occupies, or whether it fits the build
// volume.

/** A grid cell / anchor in build-cell coordinates. */
export interface BuildCell {
  x: number;
  y: number;
  z: number;
}

/**
 * The canonical rotation a placement of `buildType` carries when the player
 * has the quarter turn `selectedRotation` (0–3) selected: the selection taken
 * modulo the kind's {@link StructureConfig.rotationCount}. Rotatable kinds
 * (`rotationCount` 4: wall, ramp) keep the selected quarter turn;
 * rotation-invariant kinds (`rotationCount` 1: floor, cone) always place with
 * rotation 0, whatever was selected for a previous piece.
 */
export function normalizePlacementRotation(buildType: string, selectedRotation: number): number {
  const count = getStructureConfig(buildType)?.rotationCount ?? 1;
  return ((selectedRotation % count) + count) % count;
}

/**
 * Whether `rotation` is a canonical placement rotation for `buildType`: an
 * integer in `[0, rotationCount)`. The server rejects any other rotation.
 */
export function isValidPlacementRotation(buildType: string, rotation: number): boolean {
  const cfg = getStructureConfig(buildType);
  return cfg !== undefined && Number.isInteger(rotation) && rotation >= 0 && rotation < cfg.rotationCount;
}

/**
 * Footprint extents in cells after rotation: rotations 1 and 3 swap the X/Z
 * extents (a ramp then runs along Z), 0 and 2 keep them.
 */
export function rotatedFootprintExtents(cfg: StructureConfig, rotation: number): { xs: number; ys: number; zs: number } {
  const [w, h, d] = cfg.footprint;
  return rotation === 1 || rotation === 3 ? { xs: d, ys: h, zs: w } : { xs: w, ys: h, zs: d };
}

/**
 * Every grid cell occupied by a `buildType` placed at anchor `grid` with
 * `rotation`: the anchor plus the next cells along the positive axes.
 * Unknown kinds occupy just the anchor cell.
 */
export function structureFootprintCells(buildType: string, grid: BuildCell, rotation: number): BuildCell[] {
  const cfg = getStructureConfig(buildType);
  const { xs, ys, zs } = cfg ? rotatedFootprintExtents(cfg, rotation) : { xs: 1, ys: 1, zs: 1 };
  const cells: BuildCell[] = [];
  for (let a = 0; a < xs; a++) for (let b = 0; b < ys; b++) for (let c = 0; c < zs; c++) cells.push({ x: grid.x + a, y: grid.y + b, z: grid.z + c });
  return cells;
}

/** Whether every cell of the placement lies inside {@link BUILD_BOUNDS}. */
export function isWithinBuildBounds(buildType: string, grid: BuildCell, rotation: number): boolean {
  return structureFootprintCells(buildType, grid, rotation).every((c) =>
    c.x >= BUILD_BOUNDS.minX && c.x <= BUILD_BOUNDS.maxX &&
    c.z >= BUILD_BOUNDS.minZ && c.z <= BUILD_BOUNDS.maxZ &&
    c.y >= BUILD_BOUNDS.minLayer && c.y <= BUILD_BOUNDS.maxLayer);
}

/**
 * The world-space point a placement's range is measured to: the anchor
 * cell's base corner `(x·cellSize, y·layerHeight, z·cellSize)`.
 */
export function placementAnchorWorld(grid: BuildCell): BuildCell {
  return { x: grid.x * BUILD_GRID.cellSize, y: grid.y * BUILD_GRID.layerHeight, z: grid.z * BUILD_GRID.cellSize };
}

/**
 * Whether a player at `player` (feet position) may place at anchor `grid`:
 * the full 3D distance to {@link placementAnchorWorld} is at most
 * {@link BUILD_RANGE.maxPlacementDistance}. The server rejects anything
 * farther with `out_of_range`.
 */
export function isWithinPlacementRange(player: BuildCell, grid: BuildCell): boolean {
  const a = placementAnchorWorld(grid);
  return Math.hypot(player.x - a.x, player.y - a.y, player.z - a.z) <= BUILD_RANGE.maxPlacementDistance;
}
