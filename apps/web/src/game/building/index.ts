/**
 * Public entry point for the client building layer.
 *
 * The building layer implements the client's half of the
 * server-authoritative building contract (docs/TECHNICAL_ARCHITECTURE.md
 * §9/§21–§24):
 *
 *  - build-mode input (toggle / type select / rotate / place intent),
 *  - the grid-snapped non-authoritative placement preview
 *    (valid/invalid state, candidate grid + rotation + anchor world),
 *  - submission of `build:placement_request` intents to the server,
 *  - consumption of the replicated authoritative structure state (room
 *    state sync + `build:structure_placed` / `build:structure_rejected`
 *    events) — the client never creates structures on its own authority.
 *
 * Rendering (the translucent ghost preview and structure meshes) is
 * deliberately NOT part of this module yet; consumers read the plain
 * state this layer exposes.
 */
import { BuildingInputController } from "./buildingInputController";
import { BuildingStateStore } from "./buildingStateStore";
import type { BuildingNetworkLike } from "./buildingController";
import { BuildingController } from "./buildingController";

export {
  BuildingInputController,
  BUILD_MODE_TOGGLE_KEY,
  BUILD_TYPE_KEYS,
  ROTATE_LEFT_KEY,
  ROTATE_RIGHT_KEY,
  defaultBuildingInputEnvironment,
  type BuildingInputEnvironment,
  type InputEventTarget,
} from "./buildingInputController";

export {
  BuildingStateStore,
  parseStructureEntry,
  parseStructureRejectedEvent,
} from "./buildingStateStore";

export {
  BuildingController,
  type BuildingNetworkLike,
  type BuildingFrameContext,
} from "./buildingController";

export {
  computePlacementPreview,
  ABSENT_PREVIEW,
  MIN_AIM_DOWNGRADE,
  type PlacementPreview,
  type PlacementPreviewInput,
  type PlacementInvalidReason,
  type OccupiedStructure,
  type Vec3Like,
} from "./placementPreview";

export {
  worldToGridPosition,
  gridToWorldAnchor,
  getFootprint,
  gridKey,
  footprintCells,
  footprintsOverlap,
} from "./gridSnap";

export { updateBuildingFrame } from "./buildingFrameUpdate";

/**
 * The fully-wired client building system, as produced by
 * {@link createBuildingSystem}.
 */
export interface BuildingSystem {
  /** The build-mode input controller (keyboard / mouse intent signals). */
  readonly input: BuildingInputController;
  /** The authoritative structure mirror + pending intents. */
  readonly store: BuildingStateStore;
  /** The orchestrator: preview updates, intent submission, event handling. */
  readonly controller: BuildingController;
  /**
   * Submits a placement intent for the current valid preview. Returns the
   * submitted intent, or `null` when there is nothing valid to place.
   */
  requestPlace: () => ReturnType<BuildingController["requestPlace"]>;
  /** Consumes the replicated building state from a room-state sync. */
  applyReplicatedBuilding: (
    building: Parameters<BuildingController["applyReplicatedBuilding"]>[0],
  ) => void;
  /** Full reset for a new session / round. */
  reset: () => void;
  /** Clears pending intents only (connection drop). */
  clearPending: () => void;
  /** Tears down subscriptions and input listeners. */
  dispose: () => void;
}

/**
 * Wires the client building system for the production GameRuntime.
 *
 * @param canvas the gameplay canvas (pointer-lock surface for build input).
 * @param network the canonical network client (satisfies
 *        {@link BuildingNetworkLike}: `send` + `onEvent`).
 */
export function createBuildingSystem(
  canvas: HTMLCanvasElement,
  network: BuildingNetworkLike,
): BuildingSystem {
  const input = new BuildingInputController(canvas);
  const store = new BuildingStateStore();
  const controller = new BuildingController(input, store, network);
  return {
    input,
    store,
    controller,
    requestPlace: () => controller.requestPlace(),
    applyReplicatedBuilding: (building) =>
      controller.applyReplicatedBuilding(building),
    reset: () => controller.reset(),
    clearPending: () => controller.clearPending(),
    dispose: () => {
      controller.dispose();
      input.dispose();
    },
  };
}
