/**
 * buildEdit — the presentation-only client half of the existing
 * server-authoritative build-edit system (docs/TECHNICAL_ARCHITECTURE.md §24).
 *
 * Public surface:
 *
 *  - {@link selectTargetStructure} — pure aim-ray selection of an owned,
 *    editable structure from the authoritative building-state mirror.
 *  - {@link BuildEditInputController} — the browser keyboard intent source
 *    (edit mode toggle, edit choice, apply).
 *  - {@link BuildEditController} — the presentation-only orchestrator that
 *    tracks the chosen edit, submits `build:edit_request` intents, and turns
 *    `build:edit_result` into accepted/rejected feedback.
 *  - {@link buildBuildEditHudView} / {@link buildEditHudChangeKey} — pure
 *    mapping of the controller's presentation state into the flat HUD view.
 *  - {@link createBuildEditSystem} — wires the input + controller together and
 *    owns their lifecycle (dispose tears both down).
 *
 * Authority contract: this module is presentation-only. It reads the
 * replicated building state, sends edit *intents*, and consumes the server's
 * authoritative result. It never creates/edits/deletes structures, never
 * touches structure health, ownership, placement rules, Energy, grid logic,
 * the networking protocol, or server authority — those are unchanged.
 */
import {
  BuildEditController,
  type BuildEditFrameContext,
  type BuildEditNetworkLike,
} from "./buildEditController";
import {
  BuildEditInputController,
  type BuildEditInputEnvironment,
} from "./buildEditInputController";
import type { TargetedStructure } from "./structureSelection";

/**
 * The wired build-edit system: the input controller + orchestrator plus a
 * single `dispose` that tears both down in the correct order.
 */
export interface BuildEditSystem {
  /** The orchestrator (exposed for HUD accessors + result handling). */
  readonly controller: BuildEditController;
  /** Drives the build-edit system for one render frame. */
  updateFrame: (ctx: BuildEditFrameContext) => TargetedStructure | null;
  /** Cancels the current preview/feedback (player exited edit mode). */
  cancel: () => void;
  /** Full reset for a round reset / rematch (clears preview + feedback). */
  reset: () => void;
  /** Clears preview + feedback on a connection drop. */
  clearOnDisconnect: () => void;
  /** Tears down the input controller and the orchestrator. */
  dispose: () => void;
}

/** Optional knobs for {@link createBuildEditSystem} (injectable clock + env). */
export interface CreateBuildEditSystemOptions {
  now?: () => number;
  env?: BuildEditInputEnvironment;
}

/**
 * Creates the build-edit input controller + orchestrator as one unit with a
 * shared dispose. The runtime constructs it (lazily) in its constructor and
 * disposes it during teardown. Positional `canvas`/`network` mirror the
 * building-system factory so the two read the same way in the runtime.
 */
export function createBuildEditSystem(
  canvas: HTMLCanvasElement,
  network: BuildEditNetworkLike,
  options?: CreateBuildEditSystemOptions,
): BuildEditSystem {
  const input = new BuildEditInputController(canvas, options?.env);
  const controller = new BuildEditController(
    input,
    network,
    options?.now,
  );

  return {
    controller,
    updateFrame: (ctx) => controller.updateFrame(ctx),
    cancel: () => controller.cancel(),
    reset: () => controller.reset(),
    clearOnDisconnect: () => controller.clearOnDisconnect(),
    dispose: () => {
      controller.dispose();
      input.dispose();
    },
  };
}

// Re-exports so the runtime and tests import a single, stable surface.
export {
  BuildEditController,
  supportedEditsFor,
  parseBuildEditResult,
  type BuildEditFrameContext,
  type BuildEditNetworkLike,
  type BuildEditResultInfo,
  type BuildEditFeedback,
  BUILD_EDIT_RANGE,
} from "./buildEditController";
export {
  BuildEditInputController,
  defaultBuildEditInputEnvironment,
  EDIT_MODE_TOGGLE_KEY,
  APPLY_EDIT_KEY,
  EDIT_TYPE_KEYS,
  type BuildEditSelection,
  type BuildEditInputEnvironment,
  type InputEventTarget,
} from "./buildEditInputController";
export {
  selectTargetStructure,
  type TargetedStructure,
  type StructureSelectionInput,
  type Vec3Like,
} from "./structureSelection";
export {
  buildBuildEditHudView,
  buildEditHudChangeKey,
  type BuildEditHudState,
  type BuildEditHudInput,
  type BuildEditTargetHud,
  type BuildEditFeedbackHud,
} from "./buildEditHudView";
