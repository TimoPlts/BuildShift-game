/**
 * buildEdit — the presentation-only client half of the existing
 * server-authoritative piece-edit system (docs/TECHNICAL_ARCHITECTURE.md §24).
 *
 * Public surface:
 *
 *  - {@link selectTargetStructure} — pure aim-ray selection of an owned
 *    structure from the authoritative building-state mirror.
 *  - {@link aimEditTile} — pure crosshair → canonical tile (wall 3×3,
 *    floor/cone 2×2) / ramp half-cell mapping for the selected piece.
 *  - {@link BuildEditInputController} — the browser intent source (edit mode
 *    toggle, confirm, cancel, reset, and the routed primary-button
 *    tile-selection state — no mouse listeners of its own).
 *  - {@link BuildEditController} — the presentation-only orchestrator that
 *    tracks the pending tile state (optimistic apply + authoritative
 *    convergence from the replicated state and the
 *    `two-player:edit_grid_action` result broadcast), submits
 *    `edit_grid_action` intents, and turns results into feedback.
 *  - {@link buildBuildEditHudView} / {@link buildEditHudChangeKey} — pure
 *    mapping of the controller's presentation state into the flat HUD view.
 *  - {@link buildEditPreviewGeometry} — pure mapping of the canonical edit
 *    model into a lightweight preview descriptor (tiles / ramp variant /
 *    validity), engine-free and serializable.
 *  - {@link EditPreviewPresentation} — the presentation-only Babylon preview
 *    of the pending edit (full piece, projected grid, selection highlight,
 *    resulting shape, clear invalid indication).
 *  - {@link createBuildEditSystem} — wires the input + controller together
 *    and owns their lifecycle (dispose tears both down).
 *
 * Authority contract: this module is presentation-only. It reads the
 * replicated building state, sends edit *intents*, and consumes the server's
 * authoritative results. It never creates/edits/deletes structures, never
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
import type { InteractionModeCoordinator } from "../input/interactionMode";
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
  /**
   * "Confirm Edit on Release" — releasing the primary button after a tile
   * selection also confirms the edit (fast single-click commit).
   */
  confirmOnRelease?: boolean;
  /**
   * The shared interaction-mode coordinator (overhaul task 12). When
   * provided, edit-mode ownership moves to the coordinator so build and
   * edit can never be active at once; the runtime shares one instance with
   * the building system.
   */
  interactionMode?: InteractionModeCoordinator;
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
  const input = new BuildEditInputController(
    canvas,
    options?.env,
    options?.interactionMode,
  );
  const controller = new BuildEditController(
    input,
    network,
    options?.now,
    options?.confirmOnRelease !== undefined
      ? { confirmOnRelease: options.confirmOnRelease }
      : undefined,
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
  BUILD_EDIT_RANGE,
  EDIT_GRID_ACTION_MESSAGE,
  parseEditActionResult,
  type BuildEditFrameContext,
  type BuildEditNetworkLike,
  type BuildEditActionResultInfo,
  type BuildEditFeedback,
  type BuildEditControllerOptions,
} from "./buildEditController";
export {
  BuildEditInputController,
  defaultBuildEditInputEnvironment,
  EDIT_MODE_TOGGLE_KEY,
  CONFIRM_EDIT_KEY,
  CANCEL_EDIT_KEY,
  RESET_EDIT_KEY,
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
  aimEditTile,
  type EditTileAimResult,
  type EditTileAimInput,
} from "./editTileSelection";
export {
  buildBuildEditHudView,
  buildEditHudChangeKey,
  type BuildEditHudState,
  type BuildEditHudInput,
  type BuildEditTargetHud,
  type BuildEditFeedbackHud,
} from "./buildEditHudView";
export {
  buildEditPreviewGeometry,
  type EditPreviewTile,
  type EditPreviewRamp,
  type EditPreviewGeometry,
} from "./editPreviewGeometry";
export {
  CONE_CORNER_COUNT,
  CONE_CORNER_NAMES,
  CONE_SHAPE_IDS,
  CONE_SHAPE_TILES,
  isConeShapeId,
  coneTilesForShape,
  coneShapeForTiles,
  validateConeTiles,
  isConeEditState,
  classifyConeEditState,
  resetConeEditState,
  coneGeometryFromTiles,
  coneGeometryFromState,
  type ConeShapeId,
  type ConeTilePattern,
  type ConeTilesValidation,
  type ConeCornerGeometry,
  type ConeGeometry,
} from "./coneEdit";
export {
  EditPreviewPresentation,
  editTileLayout,
  editRampLayout,
  type EditPreviewInput,
  type EditTileLayout,
} from "./EditPreviewPresentation";
