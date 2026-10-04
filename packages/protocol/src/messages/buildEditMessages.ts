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
