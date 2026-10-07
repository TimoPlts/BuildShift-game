/**
 * Server-authoritative build-editing messages for the 1v1 Energy Box Fight
 * mode.
 *
 * The first slice of build editing lets a player apply (or clear) an *opening*
 * pattern to a placed structure. The client sends a {@link BuildEdit} intent;
 * the authoritative server validates it and either applies the edit (updating
 * the structure's `openings` array in its state) or rejects it, and always
 * replies with a {@link BuildEditResult} so the sender (and every other
 * client) can reconcile.
 *
 * `BuildEdit` is a client → server *message* (plain TypeScript, sent via
 * Colyseus `client.send()` — not a `Schema`, since it is not stored in room
 * state). `BuildEditResult` is the server → client reply payload. The
 * *resulting* structure state (including its `openings`) is carried authori-
 * tatively by Colyseus state synchronisation; `updatedStructure` on the result
 * is a convenience snapshot so a client need not wait on the state patch.
 *
 * The additive first *server-authoritative build-editing* slice adds
 * {@link BuildEditRequest}: a player-addressed request (carrying `playerId`)
 * to *remove* a single cell (`cellIndex`, 0–8) from a placed structure. This
 * is distinct from the pattern-based {@link BuildEdit} above, which stays
 * untouched for backward compatibility.
 */
import type {
  StructureOpeningPattern,
  StructureState,
} from "../building.js";

/** Build-edit network event identifiers. */
export const BUILD_EDIT_EVENTS = {
  /** Client → server: an opening edit intent for a placed structure. */
  EDIT_REQUEST: "build:edit_request",
  /** Server → all: the result of a build edit (applied or rejected). */
  EDIT_RESULT: "build:edit_result",
} as const;

/** A valid build-edit event identifier. */
export type BuildEditEventName = (typeof BUILD_EDIT_EVENTS)[keyof typeof BUILD_EDIT_EVENTS];

// ─────── Cell-based build editing (first server-authoritative slice) ───────

/** The lowest valid structure cell index (first cell). */
export const BUILD_CELL_INDEX_MIN = 0;

/** The highest valid structure cell index (last cell; inclusive). */
export const BUILD_CELL_INDEX_MAX = 8;

/** Inclusive bounds for a {@link BuildEditRequest.cellIndex}. */
export const BUILD_CELL_INDEX_LIMITS = {
  min: BUILD_CELL_INDEX_MIN,
  max: BUILD_CELL_INDEX_MAX,
} as const;

/**
 * The structural cells a placed structure exposes for editing, as a literal
 * integer union (`0`–`8`). A structure grid is a 3×3 set of cells, so a valid
 * cell index is any integer in `[0, 8]`.
 */
export type BuildCellIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Type guard: `value` is a valid {@link BuildCellIndex} (integer 0–8). */
export function isBuildCellIndex(value: unknown): value is BuildCellIndex {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= BUILD_CELL_INDEX_MIN &&
    value <= BUILD_CELL_INDEX_MAX
  );
}

/**
 * The build-edit action the first server-authoritative slice supports.
 *
 * Currently only `remove` (clearing a single cell from a structure) is
 * supported; the literal is widened as more actions are added.
 */
export type BuildEditAction = "remove";

/**
 * Client → server (server-authoritative slice): the player wants to edit a
 * single cell of a placed structure.
 *
 * Carries the `playerId` issuing the request, the `structureId` to edit, the
 * `cellIndex` (`0`–`8`) of the cell targeted, and the `action` (currently
 * `"remove"`). The authoritative server validates the request (structure
 * exists, player owns it, in range, cell in bounds, rate rule) and, on
 * success, updates the structure's state and broadcasts a
 * {@link BuildEditResult}.
 */
export interface BuildEditRequest {
  /** The player issuing the build-edit request. */
  playerId: string;
  /** The stable id of the structure to edit (assigned by the server). */
  structureId: string;
  /** The structure cell to edit, as an integer index in `[0, 8]`. */
  cellIndex: BuildCellIndex;
  /** The edit action to apply (first slice: `"remove"`). */
  action: BuildEditAction;
}

/**
 * Client → server: apply (or clear) an opening pattern on a placed structure.
 *
 * The authoritative server looks up the structure by `structureId`, validates
 * the request (structure exists, owner / range / rate rules), applies the
 * {@link StructureOpeningPattern} to the structure's `openings` array, and
 * broadcasts a {@link BuildEditResult}.
 */
export interface BuildEdit {
  /** The stable id of the structure to edit (assigned by the server). */
  structureId: string;
  /**
   * The opening pattern to apply. `none` clears the structure's openings.
   * See {@link StructureOpeningPattern} for the full set
   * (`door_top` / `window_center` / `half_bottom` / `none`).
   */
  editPattern: StructureOpeningPattern;
}

/**
 * Server → client: the result of a {@link BuildEdit} intent.
 *
 * Broadcast to all clients (not just the sender) so every client converges on
 * the same authoritative structure state. When the edit succeeded,
 * `updatedStructure` carries the full, up-to-date structure (including its
 * new `openings`) as a convenience snapshot; it is omitted on rejection.
 */
export interface BuildEditResult {
  /** The structure that was the target of the edit. */
  structureId: string;
  /** Whether the authoritative server applied the edit. */
  success: boolean;
  /**
   * The authoritative structure state *after* the (successful) edit. Present
   * only when {@link success} is `true`.
   */
  updatedStructure?: StructureState;
}
