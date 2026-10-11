/**
 * buildEditHudView — pure mapping from the {@link BuildEditController}'s
 * presentation state into the flat, plain-data {@link BuildEditHudState} the
 * React build-edit HUD panel renders from.
 *
 * This module owns NO gameplay state and NO side effects. It only copies and
 * normalises the controller's presentation-only values (mode, targeted
 * structure, pending tile state, accepted/rejected feedback) and quantises
 * them into a stable change-key fragment so the runtime can skip re-emitting
 * when nothing player-visible changed.
 */
import type { StructureEditState } from "@buildshift/protocol";
import type { TargetedStructure } from "./structureSelection";
import type { BuildEditFeedback } from "./buildEditController";

/** The structure the aim ray currently selects (presentation data). */
export interface BuildEditTargetHud {
  structureId: string;
  buildType: string;
  grid: { x: number; y: number; z: number };
}

/** An accepted/rejected/informational build-edit feedback banner. */
export interface BuildEditFeedbackHud {
  kind: "accepted" | "rejected" | "info";
  message: string;
}

/**
 * The flat build-edit HUD view. This object is a display snapshot only —
 * it never feeds back into gameplay or networking.
 */
export interface BuildEditHudState {
  /** Whether edit mode is active (the tile grid is presented). */
  mode: boolean;
  /** The targeted structure, or `null` when nothing is selected. */
  target: BuildEditTargetHud | null;
  /**
   * The number of open (removed) tiles in the piece's pending edit state
   * (`0` for ramps, which use a directional variant instead of tiles).
   */
  removedTiles: number;
  /**
   * The total tile count of the piece's edit grid (`9` wall, `4` floor/cone,
   * `0` ramp).
   */
  totalTiles: number;
  /**
   * The ramp variant in the pending state (ramp pieces only), or `null`
   * for tile-based pieces.
   */
  rampVariant: string | null;
  /** The accepted/rejected feedback banner, or `null` when none is pending. */
  feedback: BuildEditFeedbackHud | null;
  /**
   * Whether the edit can change right now: edit mode is on, a structure is
   * aimed, and the connection is live. Drives the HUD's valid/invalid state
   * and contextual hint.
   */
  applyReady: boolean;
}

/** The raw controller presentation values fed into {@link buildBuildEditHudView}. */
export interface BuildEditHudInput {
  mode: boolean;
  target: TargetedStructure | null;
  /** The targeted piece's pending edit state, or `null` when untargeted. */
  pending: StructureEditState | null;
  feedback: BuildEditFeedback | null;
  /** Whether the canonical network connection is live. */
  connected: boolean;
}

/**
 * Copies the controller's presentation state into the flat HUD view.
 * The grid is copied so the runtime can hand the view to React without the
 * controller's live objects leaking across frames.
 */
export function buildBuildEditHudView(input: BuildEditHudInput): BuildEditHudState {
  let removedTiles = 0;
  let totalTiles = 0;
  let rampVariant: string | null = null;
  const pending = input.pending;
  if (pending !== null) {
    if (pending.kind === "ramp") {
      rampVariant = pending.variant;
    } else {
      totalTiles = pending.tiles.length;
      for (const tile of pending.tiles) {
        if (!tile) {
          removedTiles++;
        }
      }
    }
  }
  return {
    mode: input.mode,
    target: input.target
      ? {
          structureId: input.target.structureId,
          buildType: input.target.buildType,
          grid: { x: input.target.grid.x, y: input.target.grid.y, z: input.target.grid.z },
        }
      : null,
    removedTiles,
    totalTiles,
    rampVariant,
    feedback: input.feedback
      ? { kind: input.feedback.kind, message: input.feedback.message }
      : null,
    applyReady: input.mode && input.target !== null && input.connected,
  };
}

/**
 * A stable change-key fragment for a {@link BuildEditHudState}.
 *
 * Folded into the overall `localHudChangeKey` so the runtime re-emits the
 * local HUD whenever any player-visible build-edit value changes.
 */
export function buildEditHudChangeKey(state: BuildEditHudState): string {
  const target = state.target
    ? `${state.target.structureId}:${state.target.grid.x},${state.target.grid.y},${state.target.grid.z}`
    : "-";
  const feedback = state.feedback ? `${state.feedback.kind}:${state.feedback.message}` : "-";
  const tiles =
    state.rampVariant !== null
      ? `v:${state.rampVariant}`
      : state.totalTiles > 0
        ? `${state.removedTiles}/${state.totalTiles}`
        : "-";
  return [
    state.mode ? "e" : "-",
    target,
    tiles,
    feedback,
    state.applyReady ? "r" : "-",
  ].join("|");
}
