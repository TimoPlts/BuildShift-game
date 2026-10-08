/**
 * buildEditHudView — pure mapping from the {@link BuildEditController}'s
 * presentation state into the flat, plain-data {@link BuildEditHudState} the
 * React build-edit HUD panel renders from.
 *
 * This module owns NO gameplay state and NO side effects. It only copies and
 * normalises the controller's presentation-only values (mode, targeted
 * structure, chosen edit, allowed edits, accepted/rejected feedback) and
 * quantises them into a stable change-key fragment so the runtime can skip
 * re-emitting when nothing player-visible changed.
 */
import type { BuildEditType } from "@buildshift/protocol";
import type { BuildEditSelection } from "./buildEditInputController";
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
  /** Whether build-edit mode is active (the selection preview is presented). */
  mode: boolean;
  /** The targeted structure, or `null` when nothing is selected. */
  target: BuildEditTargetHud | null;
  /** The currently chosen edit (door / window / half_top / half_bottom / clear). */
  selectedEdit: BuildEditSelection;
  /** The edit types the target allows (drives the selector row). */
  allowedEdits: BuildEditType[];
  /** The accepted/rejected feedback banner, or `null` when none is pending. */
  feedback: BuildEditFeedbackHud | null;
  /**
   * Whether the chosen edit can be applied right now: edit mode is on, a
   * structure is aimed, and the connection is live. Drives the HUD's
   * valid/invalid state and contextual hint.
   */
  applyReady: boolean;
}

/** The raw controller presentation values fed into {@link buildBuildEditHudView}. */
export interface BuildEditHudInput {
  mode: boolean;
  target: TargetedStructure | null;
  selectedEdit: BuildEditSelection;
  allowedEdits: readonly BuildEditType[];
  feedback: BuildEditFeedback | null;
  /** Whether the canonical network connection is live. */
  connected: boolean;
}

/**
 * Copies the controller's presentation state into the flat HUD view.
 * Arrays are cloned and the grid is copied so the runtime can hand the view
 * to React without the controller's live objects leaking across frames.
 */
export function buildBuildEditHudView(input: BuildEditHudInput): BuildEditHudState {
  return {
    mode: input.mode,
    target: input.target
      ? {
          structureId: input.target.structureId,
          buildType: input.target.buildType,
          grid: { x: input.target.grid.x, y: input.target.grid.y, z: input.target.grid.z },
        }
      : null,
    selectedEdit: input.selectedEdit,
    allowedEdits: [...input.allowedEdits],
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
  return [
    state.mode ? "e" : "-",
    target,
    state.selectedEdit,
    state.allowedEdits.join(","),
    feedback,
    state.applyReady ? "r" : "-",
  ].join("|");
}
