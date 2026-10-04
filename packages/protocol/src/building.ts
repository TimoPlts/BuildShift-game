/**
 * Server-authoritative multiplayer building protocol contract (transport-neutral).
 *
 * Shared building vocabulary for client and server: the {@link BuildType} ids
 * (wall / floor / ramp / cone), the grid-snapped {@link StructurePlacementIntent},
 * the authoritative {@link StructureState} / {@link BuildingState}, the
 * {@link BUILD_EVENTS} identifiers + payloads, and the structural
 * {@link validateStructurePlacementIntent} guard. Plain TypeScript only (no
 * `@colyseus/schema`), mirroring `PlayerNetworkState` / `GameStateSchema`.
 */

import type { ProtocolValidation } from "./inputs/validatePlayerInputFrame.js";

// ──── Build type vocabulary ────

/** A valid structure kind a player can build (single source of truth). */
export type BuildType = "wall" | "floor" | "ramp" | "cone";

/** All valid build types as a frozen tuple. */
export const BUILD_TYPES = Object.freeze(["wall", "floor", "ramp", "cone"] as const);

/** Type guard: `value` is a valid {@link BuildType}. */
export function isBuildType(value: unknown): value is BuildType {
  return typeof value === "string" && (BUILD_TYPES as readonly string[]).includes(value);
}

// ──── Grid coordinate contract ────

/** A build-grid cell coordinate (integer cell indices, not metres). */
export interface GridPosition {
  /** Column index along world X. */
  x: number;
  /** Layer index along world Y (`0` = ground layer). */
  y: number;
  /** Column index along world Z. */
  z: number;
}

/**
 * A cardinal orientation, as the number of 90° clockwise steps from the
 * default facing (0 = default, 1 = 90°, 2 = 180°, 3 = 270°).
 */
export type GridRotation = 0 | 1 | 2 | 3;

/** All valid cardinal rotations as a frozen tuple. */
export const GRID_ROTATIONS = Object.freeze([0, 1, 2, 3] as const);

/** Type guard: `value` is a valid {@link GridRotation}. */
export function isGridRotation(value: unknown): value is GridRotation {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    (GRID_ROTATIONS as readonly number[]).includes(value)
  );
}

// ──── Structure opening vocabulary (server-authoritative build editing) ────

/**
 * The set of editable opening patterns a player can apply to (or remove from)
 * a structure.
 *
 *  - `door_top`        — a top-aligned door opening.
 *  - `window_center`   — a centre window opening.
 *  - `half_bottom`     — a lower-half opening.
 *  - `none`            — no opening (removes / clears any active opening).
 *
 * These are the *edit patterns* a {@link BuildEdit} intent references; the
 * *resulting* active openings on a structure are described by
 * {@link StructureOpening} on {@link StructureState}.
 */
export type StructureOpeningPattern = "door_top" | "window_center" | "half_bottom" | "none";

/** All valid structure opening patterns as a frozen tuple. */
export const OPENING_PATTERNS = Object.freeze([
  "door_top",
  "window_center",
  "half_bottom",
  "none",
] as const);

/** Type guard: `value` is a valid {@link StructureOpeningPattern}. */
export function isStructureOpeningPattern(value: unknown): value is StructureOpeningPattern {
  return (
    typeof value === "string" &&
    (OPENING_PATTERNS as readonly string[]).includes(value)
  );
}

/**
 * A descriptor of a single *active* opening on a placed structure.
 *
 * Carried on a structure's `openings` array (see {@link StructureState}) so
 * clients can render the structure's modified geometry (cut-outs for doors /
 * windows) to match the authoritative server. A structure with no openings
 * simply has an empty (or absent) `openings` array.
 */
export interface StructureOpening {
  /** The opening pattern that is currently active on the structure. */
  pattern: StructureOpeningPattern;
}

// ──── Placement intent (client → server) ────

/** A client's grid-snapped structure placement intent (player intent only). */
export interface StructurePlacementIntent {
  /** Monotonically increasing intent identity (non-negative safe integer). */
  sequence: number;
  /** The structure kind to place. */
  buildType: BuildType;
  /** The grid cell the structure anchors to. */
  grid: GridPosition;
  /** Cardinal rotation applied to the structure (0–3). */
  rotation: GridRotation;
}

/** Inclusive protocol bounds for {@link StructurePlacementIntent}. */
export const STRUCTURE_PLACEMENT_INTENT_LIMITS = {
  /** Lowest valid `sequence` value. */
  sequenceMin: 0,
  /** Lowest valid grid layer index (`y`): the ground layer. */
  layerMin: 0,
} as const;

// ──── Authoritative structure state ────

/** The authoritative state of a single placed structure. */
export interface StructureState {
  /** Stable identity for this placed structure, assigned by the server. */
  structureId: string;
  /** The structure kind. */
  buildType: BuildType;
  /** The grid cell the structure anchors to. */
  grid: GridPosition;
  /** Cardinal rotation applied to the structure (0–3). */
  rotation: GridRotation;
  /** `sessionId` of the player who placed the structure. */
  ownerId: string;
  /** The placement-intent `sequence` that produced this structure. */
  createdSequence: number;
  /**
   * The set of *active* openings on this structure, in the order they were
   * applied. Empty (or omitted) when the structure has no openings. Clients
   * use this to render the structure's modified geometry.
   *
   * Optional so pre-existing construction sites that do not yet model build
   * editing keep compiling unchanged (the field defaults to "no openings").
   */
  openings?: StructureOpening[];
}

/** Plain-data view of a room's authoritative building state. */
export interface BuildingState {
  /** All currently placed structures, keyed by `structureId`. */
  structures: Record<string, StructureState>;
}

// ──── Building events ────

/** Building network event identifiers. */
export const BUILD_EVENTS = {
  /** Client → server: a structure placement intent. */
  PLACEMENT_REQUEST: "build:placement_request",
  /** Server → all: a structure was authoritatively created. */
  STRUCTURE_PLACED: "build:structure_placed",
  /** Server → all: a placement intent was rejected. */
  STRUCTURE_REJECTED: "build:structure_rejected",
} as const;

/** A valid building event identifier. */
export type BuildEventName = (typeof BUILD_EVENTS)[keyof typeof BUILD_EVENTS];

/** Why the authoritative server rejected a structure placement intent. */
export type BuildRejectionReason =
  | "unknown_build_type"
  | "invalid_grid"
  | "out_of_range"
  | "overlap"
  | "rate_limited"
  | "unaffordable";

/** Payload for {@link BUILD_EVENTS.STRUCTURE_PLACED}. */
export interface StructurePlacedEvent {
  /** The authoritative structure that was created. */
  structure: StructureState;
}

/** Payload for {@link BUILD_EVENTS.STRUCTURE_REJECTED}. */
export interface StructureRejectedEvent {
  /** The placement-intent `sequence` that was rejected. */
  sequence: number;
  /** Why the placement was rejected. */
  reason: BuildRejectionReason;
}

// ──── Structural validation ────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field];
  return typeof value === "number" ? value : undefined;
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Validates the shape of an incoming {@link StructurePlacementIntent}. */
export function validateStructurePlacementIntent(
  input: unknown,
): ProtocolValidation<StructurePlacementIntent> {
  if (!isRecord(input)) {
    return { ok: false, errors: [`input must be a plain object, got ${typeOf(input)}`] };
  }
  const errors: string[] = [];

  const sequence = readNumber(input, "sequence");
  if (sequence === undefined) {
    errors.push(`sequence: expected a number, got ${typeOf(input.sequence)}`);
  } else if (!Number.isSafeInteger(sequence) || sequence < STRUCTURE_PLACEMENT_INTENT_LIMITS.sequenceMin) {
    errors.push(`sequence: must be a safe integer >= ${STRUCTURE_PLACEMENT_INTENT_LIMITS.sequenceMin}, got ${sequence}`);
  }

  if (!isBuildType(input.buildType)) {
    errors.push(`buildType: must be one of [${(BUILD_TYPES as readonly string[]).join(", ")}], got ${typeOf(input.buildType)} ${JSON.stringify(input.buildType)}`);
  }

  const grid = input.grid;
  if (!isRecord(grid)) {
    errors.push(`grid: expected a plain object, got ${typeOf(grid)}`);
  } else {
    const layerMin = STRUCTURE_PLACEMENT_INTENT_LIMITS.layerMin;
    for (const field of ["x", "y", "z"] as const) {
      const value = readNumber(grid, field);
      if (value === undefined) {
        errors.push(`grid.${field}: expected a number, got ${typeOf(grid[field])}`);
      } else if (!Number.isSafeInteger(value)) {
        errors.push(`grid.${field}: must be a safe integer, got ${value}`);
      } else if (field === "y" && value < layerMin) {
        errors.push(`grid.${field}: must be >= ${layerMin} (ground layer), got ${value}`);
      }
    }
  }

  if (!isGridRotation(input.rotation)) {
    errors.push(`rotation: must be one of [${GRID_ROTATIONS.join(", ")}], got ${typeOf(input.rotation)} ${JSON.stringify(input.rotation)}`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      sequence: input.sequence as number,
      buildType: input.buildType as BuildType,
      grid: {
        x: (input.grid as GridPosition).x,
        y: (input.grid as GridPosition).y,
        z: (input.grid as GridPosition).z,
      },
      rotation: input.rotation as GridRotation,
    },
  };
}
