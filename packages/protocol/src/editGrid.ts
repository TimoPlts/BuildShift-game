/**
 * Canonical edit-grid model — the shared, serializable, authoritative
 * description of a placed structure's tile-level edit state.
 *
 * This replaces the single-string `editType` with a full tile grid that
 * supports the complete editing workflow. The model is pure data (no
 * visual mesh information) and serves as the single source of truth for
 * both the client renderer and the server collision system.
 *
 * Supported edit models per build type:
 *  - **wall** — a 3×3 tile grid (9 tiles, row-major)
 *  - **floor** / **cone** — a 2×2 tile grid (4 tiles, row-major)
 *  - **ramp** — a directional variant (full / flipped / half_left / half_right)
 *
 * Edit workflow actions:
 *  - `begin`      — initialize the edit state to default (all-solid / full)
 *  - `select`     — mark a tile for removal (or set a ramp variant)
 *  - `deselect`   — restore a tile to solid (or reset ramp to full)
 *  - `confirm`    — acknowledge the current state (no-op; already committed)
 *  - `reset`      — reset to default (all-solid / full)
 *  - `cancel`     — same as reset
 *  - `full_reset` — reset to default (same as reset for a single structure)
 */

// ─── Tile dimensions per build type ──────────────────────────────────────────

/** Number of columns in the wall edit grid. */
export const WALL_EDIT_COLS = 3;
/** Number of rows in the wall edit grid. */
export const WALL_EDIT_ROWS = 3;
/** Total tile count for the wall edit grid (3×3 = 9). */
export const WALL_EDIT_TILE_COUNT = WALL_EDIT_COLS * WALL_EDIT_ROWS;

/** Number of columns in the floor/cone edit grid. */
export const FLOOR_CONE_EDIT_COLS = 2;
/** Number of rows in the floor/cone edit grid. */
export const FLOOR_CONE_EDIT_ROWS = 2;
/** Total tile count for the floor/cone edit grid (2×2 = 4). */
export const FLOOR_CONE_EDIT_TILE_COUNT = FLOOR_CONE_EDIT_COLS * FLOOR_CONE_EDIT_ROWS;

/**
 * The expected tile count for a given build type's edit grid.
 * Returns `null` for build types that use a directional (non-tile) edit model.
 */
export function getEditTileCount(buildType: string): number | null {
  switch (buildType) {
    case "wall":
      return WALL_EDIT_TILE_COUNT;
    case "floor":
    case "cone":
      return FLOOR_CONE_EDIT_TILE_COUNT;
    case "ramp":
      return null; // directional, not tile-based
    default:
      return null;
  }
}

// ─── Ramp variants ──────────────────────────────────────────────────────────

/**
 * A directional ramp variant.
 *
 * - `full`       — the full ramp in its default orientation.
 * - `flipped`    — the full ramp with reversed slope direction.
 * - `half_left`  — only the left half of the ramp is present.
 * - `half_right` — only the right half of the ramp is present.
 */
export type RampVariant = "full" | "flipped" | "half_left" | "half_right";

/** All valid ramp variants as a frozen tuple. */
export const RAMP_VARIANTS = Object.freeze([
  "full",
  "flipped",
  "half_left",
  "half_right",
] as const);

/** Type guard: `value` is a valid {@link RampVariant}. */
export function isRampVariant(value: unknown): value is RampVariant {
  return (
    typeof value === "string" &&
    (RAMP_VARIANTS as readonly string[]).includes(value)
  );
}

// ─── Edit state (serializable, no mesh information) ────────────────────────

/**
 * Wall edit state: a 3×3 grid of tile solidity booleans (row-major).
 * `true` = solid (tile present), `false` = removed (tile open).
 */
export interface WallEditState {
  /** Discriminator. */
  kind: "wall";
  /** 9 tile states, row-major. `true` = solid, `false` = removed. */
  tiles: boolean[];
}

/**
 * Floor/cone edit state: a 2×2 grid of tile solidity booleans (row-major).
 */
export interface FloorConeEditState {
  /** Discriminator. */
  kind: "floor_cone";
  /** 4 tile states, row-major. `true` = solid, `false` = removed. */
  tiles: boolean[];
}

/**
 * Ramp edit state: a single directional variant.
 */
export interface RampEditState {
  /** Discriminator. */
  kind: "ramp";
  /** The active directional variant. */
  variant: RampVariant;
}

/**
 * The authoritative edit state for a placed structure.
 * A discriminated union by build type.
 */
export type StructureEditState = WallEditState | FloorConeEditState | RampEditState;

// ─── Default (all-solid / full) states ─────────────────────────────────────

/**
 * Creates the default (unmodified) edit state for a build type.
 * All tiles solid for tile-based grids; `full` for ramps.
 */
export function createDefaultEditState(buildType: string): StructureEditState {
  switch (buildType) {
    case "wall":
      return { kind: "wall", tiles: new Array<boolean>(WALL_EDIT_TILE_COUNT).fill(true) };
    case "floor":
    case "cone":
      return { kind: "floor_cone", tiles: new Array<boolean>(FLOOR_CONE_EDIT_TILE_COUNT).fill(true) };
    case "ramp":
      return { kind: "ramp", variant: "full" };
    default:
      return { kind: "wall", tiles: new Array<boolean>(WALL_EDIT_TILE_COUNT).fill(true) };
  }
}

// ─── Edit workflow actions ─────────────────────────────────────────────────

/**
 * The edit workflow actions a client can send to the server.
 *
 * - `begin`      — enter edit mode; initialize to default state.
 * - `select`     — mark a tile for removal (or set ramp variant).
 * - `deselect`   — restore a tile to solid (or reset ramp to full).
 * - `confirm`    — acknowledge (no state change; the state is already committed).
 * - `reset`      — reset to default (all-solid / full).
 * - `cancel`     — discard pending changes, same as reset.
 * - `full_reset` — full reset (same as reset for a single structure).
 */
export type EditActionType =
  | "begin"
  | "select"
  | "deselect"
  | "confirm"
  | "reset"
  | "cancel"
  | "full_reset";

/** All valid edit action types as a frozen tuple. */
export const EDIT_ACTION_TYPES = Object.freeze([
  "begin",
  "select",
  "deselect",
  "confirm",
  "reset",
  "cancel",
  "full_reset",
] as const);

/** Type guard: `value` is a valid {@link EditActionType}. */
export function isEditActionType(value: unknown): value is EditActionType {
  return (
    typeof value === "string" &&
    (EDIT_ACTION_TYPES as readonly string[]).includes(value)
  );
}

// ─── Edit action request (client → server) ─────────────────────────────────

/**
 * Client → server: an edit workflow action targeting a specific structure.
 *
 * The authoritative server validates the action (structure exists, player
 * owns it, tile in bounds, etc.) and either applies it or rejects it.
 */
export interface EditActionRequest {
  /** The stable id of the structure to edit. */
  structureId: string;
  /** The edit action to perform. */
  action: EditActionType;
  /**
   * Tile index for `select`/`deselect` on tile-based grids.
   * Wall: 0–8 (3×3). Floor/Cone: 0–3 (2×2).
   * Omitted for ramp actions and non-tile actions.
   */
  tileIndex?: number;
  /**
   * Ramp variant for `select` action on ramps.
   * Omitted for non-ramp structures and non-select actions.
   */
  rampVariant?: RampVariant;
}

// ─── Edit action result (server → client) ──────────────────────────────────

/**
 * Server → client: the result of an edit action.
 *
 * Broadcast to all clients so every client converges on the same
 * authoritative edit state.
 */
export interface EditActionResult {
  /** The structure that was the target of the edit. */
  structureId: string;
  /** Whether the server applied the action successfully. */
  success: boolean;
  /** A human-readable reason when the action was rejected. */
  reason?: string;
  /**
   * The authoritative edit state after the (successful) action.
   * Present only when {@link success} is `true`.
   */
  editState?: StructureEditState;
}

// ─── Validation ────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Validates an `EditActionRequest` from the wire.
 * Returns `{ ok: true, value }` on success or `{ ok: false, errors }` on failure.
 */
export function validateEditActionRequest(
  input: unknown,
): { ok: true; value: EditActionRequest } | { ok: false; errors: string[] } {
  if (!isRecord(input)) {
    return { ok: false, errors: [`input must be a plain object, got ${typeOf(input)}`] };
  }
  const r = input;
  const errors: string[] = [];

  if (typeof r.structureId !== "string" || r.structureId.length === 0) {
    errors.push(`structureId: must be a non-empty string, got ${typeOf(r.structureId)}`);
  }

  if (!isEditActionType(r.action)) {
    errors.push(
      `action: must be one of [${EDIT_ACTION_TYPES.join(", ")}], got ${typeOf(r.action)} ${JSON.stringify(r.action)}`,
    );
  }

  // Validate tileIndex when present.
  if (r.tileIndex !== undefined) {
    if (typeof r.tileIndex !== "number" || !Number.isInteger(r.tileIndex)) {
      errors.push(`tileIndex: must be an integer, got ${typeOf(r.tileIndex)}`);
    } else if (r.tileIndex < 0) {
      errors.push(`tileIndex: must be >= 0, got ${r.tileIndex}`);
    }
  }

  // Validate rampVariant when present.
  if (r.rampVariant !== undefined && !isRampVariant(r.rampVariant)) {
    errors.push(
      `rampVariant: must be one of [${RAMP_VARIANTS.join(", ")}], got ${JSON.stringify(r.rampVariant)}`,
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const value: EditActionRequest = {
    structureId: r.structureId as string,
    action: r.action as EditActionType,
  };
  if (r.tileIndex !== undefined) {
    value.tileIndex = r.tileIndex as number;
  }
  if (r.rampVariant !== undefined) {
    value.rampVariant = r.rampVariant as RampVariant;
  }
  return { ok: true, value };
}

/**
 * Validates a `StructureEditState` for a given build type.
 * Returns `{ ok: true, value }` on success or `{ ok: false, errors }` on failure.
 */
export function validateEditState(
  state: unknown,
  buildType: string,
): { ok: true; value: StructureEditState } | { ok: false; errors: string[] } {
  if (!isRecord(state)) {
    return { ok: false, errors: [`state must be a plain object, got ${typeOf(state)}`] };
  }
  const s = state;

  switch (buildType) {
    case "wall": {
      if (s.kind !== "wall") {
        return { ok: false, errors: [`kind: must be "wall", got ${JSON.stringify(s.kind)}`] };
      }
      if (!Array.isArray(s.tiles) || s.tiles.length !== WALL_EDIT_TILE_COUNT) {
        return {
          ok: false,
          errors: [`tiles: must have exactly ${WALL_EDIT_TILE_COUNT} elements, got ${Array.isArray(s.tiles) ? s.tiles.length : typeOf(s.tiles)}`],
        };
      }
      for (let i = 0; i < WALL_EDIT_TILE_COUNT; i++) {
        if (typeof s.tiles[i] !== "boolean") {
          return { ok: false, errors: [`tiles[${i}]: must be a boolean, got ${typeOf(s.tiles[i])}`] };
        }
      }
      return { ok: true, value: { kind: "wall", tiles: s.tiles as boolean[] } };
    }
    case "floor":
    case "cone": {
      if (s.kind !== "floor_cone") {
        return { ok: false, errors: [`kind: must be "floor_cone", got ${JSON.stringify(s.kind)}`] };
      }
      if (!Array.isArray(s.tiles) || s.tiles.length !== FLOOR_CONE_EDIT_TILE_COUNT) {
        return {
          ok: false,
          errors: [`tiles: must have exactly ${FLOOR_CONE_EDIT_TILE_COUNT} elements, got ${Array.isArray(s.tiles) ? s.tiles.length : typeOf(s.tiles)}`],
        };
      }
      for (let i = 0; i < FLOOR_CONE_EDIT_TILE_COUNT; i++) {
        if (typeof s.tiles[i] !== "boolean") {
          return { ok: false, errors: [`tiles[${i}]: must be a boolean, got ${typeOf(s.tiles[i])}`] };
        }
      }
      return { ok: true, value: { kind: "floor_cone", tiles: s.tiles as boolean[] } };
    }
    case "ramp": {
      if (s.kind !== "ramp") {
        return { ok: false, errors: [`kind: must be "ramp", got ${JSON.stringify(s.kind)}`] };
      }
      if (!isRampVariant(s.variant)) {
        return {
          ok: false,
          errors: [`variant: must be one of [${RAMP_VARIANTS.join(", ")}], got ${JSON.stringify(s.variant)}`],
        };
      }
      return { ok: true, value: { kind: "ramp", variant: s.variant as RampVariant } };
    }
    default:
      return { ok: false, errors: [`unknown build type: ${buildType}`] };
  }
}

// ─── Pure state transition (for server use) ────────────────────────────────

/**
 * Applies an edit action to an edit state, returning the new state.
 *
 * Returns `null` when the action cannot be applied (out-of-range tile,
 * missing required field, etc.). The caller is responsible for checking
 * ownership, structure existence, and match-phase before calling this.
 */
export function applyEditAction(
  currentState: StructureEditState,
  action: EditActionRequest,
  buildType: string,
): StructureEditState | null {
  const tileCount = getEditTileCount(buildType);

  switch (action.action) {
    case "begin":
      return createDefaultEditState(buildType);

    case "select": {
      if (buildType === "ramp") {
        if (!action.rampVariant) return null;
        return { kind: "ramp", variant: action.rampVariant };
      }
      if (tileCount === null || action.tileIndex === undefined) return null;
      if (action.tileIndex < 0 || action.tileIndex >= tileCount) return null;
      if (currentState.kind === "wall" || currentState.kind === "floor_cone") {
        const tiles = [...currentState.tiles];
        tiles[action.tileIndex] = false; // select = mark for removal
        return { ...currentState, tiles };
      }
      return null;
    }

    case "deselect": {
      if (buildType === "ramp") {
        return { kind: "ramp", variant: "full" };
      }
      if (tileCount === null || action.tileIndex === undefined) return null;
      if (action.tileIndex < 0 || action.tileIndex >= tileCount) return null;
      if (currentState.kind === "wall" || currentState.kind === "floor_cone") {
        const tiles = [...currentState.tiles];
        tiles[action.tileIndex] = true; // deselect = restore
        return { ...currentState, tiles };
      }
      return null;
    }

    case "confirm":
      // The state is already committed; confirm is a no-op acknowledgement.
      return currentState;

    case "reset":
    case "cancel":
    case "full_reset":
      return createDefaultEditState(buildType);

    default:
      return null;
  }
}

// ─── Serialization helpers ─────────────────────────────────────────────────

/**
 * Serializes a `StructureEditState` to a JSON-safe plain object.
 * The result is round-trippable through `JSON.parse(JSON.stringify(...))`.
 */
export function serializeEditState(state: StructureEditState): Record<string, unknown> {
  switch (state.kind) {
    case "wall":
      return { kind: "wall", tiles: [...state.tiles] };
    case "floor_cone":
      return { kind: "floor_cone", tiles: [...state.tiles] };
    case "ramp":
      return { kind: "ramp", variant: state.variant };
  }
}

/**
 * Deserializes a plain object into a `StructureEditState`, validating
 * against the expected shape for the given build type.
 */
export function deserializeEditState(
  data: unknown,
  buildType: string,
): { ok: true; value: StructureEditState } | { ok: false; errors: string[] } {
  return validateEditState(data, buildType);
}
