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
 * A build cell is a `cellSize` × `cellSize` (metres) square in the X/Z plane,
 * stacked in layers of `layerHeight` metres. `groundLayer` is the index of the
 * lowest buildable layer (the layer whose base sits on the ground). The client
 * snaps its placement preview to this lattice and the server validates a
 * placement against it; both derive a cell's world-space position from the
 * shared cell size / layer height so they cannot drift.
 */
export const BUILD_GRID = {
  /** Size of a single build cell in the X/Z plane, in metres. */
  cellSize: 2,
  /** Height of a single build layer, in metres (distance between layer bases). */
  layerHeight: 1.5,
  /** The index of the ground layer (the lowest buildable layer). */
  groundLayer: 0,
} as const;

// ─────────────────────────── Build volume bounds ─────────────────────────────

/**
 * The fixed build volume in grid-cell coordinates.
 *
 * A placement is valid only when every cell its footprint occupies lies
 * within `[minX..maxX] × [minLayer..maxLayer] × [minZ..maxZ]` (inclusive).
 * The bounds are symmetric on X/Z and match the 30 m × 30 m arena ground:
 * 15 cells × 2 m/cell = 30 m.
 *
 * Both the client preview snapper and the authoritative server validator
 * reference these same bounds so they cannot drift.
 */
export const BUILD_BOUNDS = {
  /** Minimum cell index along world X. */
  minX: -7,
  /** Maximum cell index along world X. */
  maxX: 7,
  /** Minimum cell index along world Z. */
  minZ: -7,
  /** Maximum cell index along world Z. */
  maxZ: 7,
  /** Minimum (lowest) buildable layer index. */
  minLayer: 0,
  /** Maximum (highest) buildable layer index. */
  maxLayer: 6,
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
   * measured in the units of {@link BUILD_GRID} (cellSize per x/z cell,
   * layerHeight per y layer). The footprint is how many grid cells the
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
 *  - **wall** — a vertical barrier: 1 cell wide (2 m), 2 layers tall (3 m),
 *   1 deep (2 m), and rotatable in 4 cardinal directions.
 * - **floor** — a single-cell platform (2 m × 1.5 m × 2 m); rotation-invariant.
 * - **ramp** — a two-cell-long (4 m) incline spanning one layer (1.5 m);
 *   rotatable in 4 cardinal directions.
 * - **cone** — a single-cell point/fixture (2 m × 1.5 m × 2 m); rotation-invariant.
 *
 * Consumers look a structure up by build type via {@link getStructureConfig};
 * additional structure kinds can be appended to {@link BUILD_STRUCTURE_KEYS}
 * and {@link STRUCTURES} in later stages without changing the consumer
 * contract.
 */
export const STRUCTURES: Record<BuildStructureKey, StructureConfig> = {
  wall: {
    buildType: "wall",
    footprint: [1, 2, 1],
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
