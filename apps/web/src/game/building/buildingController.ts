/**
 * buildingController — the client-side orchestrator for server-authoritative
 * building (the "fast preview + quick authoritative confirmation" model from
 * docs/TECHNICAL_ARCHITECTURE.md §24).
 *
 * Wires together the four building concerns:
 *
 *  - {@link BuildingInputController} — build-mode / type / rotation / place
 *    intent signals from the keyboard + mouse.
 *  - {@link computePlacementPreview} — the per-frame grid-snapped
 *    non-authoritative placement preview (valid/invalid state).
 *  - {@link BuildingStateStore} — the authoritative structure mirror (fed by
 *    replicated room state + placed events) and the local pending-intent set.
 *  - the network client — the outbound `build:placement_request` intent
 *    and the inbound `build:structure_placed` / `build:structure_rejected`
 *    confirmation events.
 *
 * Authority contract: the controller NEVER creates authoritative
 * structures. It submits *intents* (grid + type + rotation + sequence) and
 * the server decides what exists; the client only ever consumes replicated
 * data. Rendering (ghost preview, structure meshes) is a later concern and
 * deliberately absent here — this class is state and intent only.
 */
import {
  BUILD_EVENTS,
  type BuildingState,
  type StructurePlacementIntent,
  type StructurePlacedEvent,
} from "@buildshift/protocol";
import type { BuildingInputController } from "./buildingInputController";
import type { BuildingStateStore } from "./buildingStateStore";
import {
  ABSENT_PREVIEW,
  computePlacementPreview,
  type PlacementPreview,
  type Vec3Like,
} from "./placementPreview";
import { parseStructureRejectedEvent } from "./buildingStateStore";

/**
 * The narrow network surface the controller needs. {@link NetworkClient}
 * satisfies it structurally; unit tests substitute a plain fake.
 */
export interface BuildingNetworkLike {
  /** Send an outbound message (no-op/false when not connected). */
  send: (type: string, payload?: unknown) => boolean;
  /** Subscribe to a named server event; returns an unsubscribe function. */
  onEvent: (
    name: string,
    callback: (payload: unknown) => void,
  ) => () => void;
}

/** Per-frame context the runtime hands to the preview calculation. */
export interface BuildingFrameContext {
  /** The camera's world position (aim ray origin). */
  aimOrigin: Vec3Like;
  /** The normalized world-space aim direction. */
  aimDirection: Vec3Like;
  /** The local player's feet position (for the placement range check). */
  playerPosition: Vec3Like;
}

/**
 * The client building orchestrator.
 */
export class BuildingController {
  private readonly input: BuildingInputController;
  private readonly store: BuildingStateStore;
  private readonly network: BuildingNetworkLike;
  private readonly unsubscribePlaced: () => void;
  private readonly unsubscribeRejected: () => void;
  /**
   * Monotonic identity for placement intents. Independent of the movement
   * input sequence — building intents form their own sequence stream.
   */
  private nextSequence = 0;
  private preview: PlacementPreview = ABSENT_PREVIEW;
  private disposed = false;

  public constructor(
    input: BuildingInputController,
    store: BuildingStateStore,
    network: BuildingNetworkLike,
  ) {
    this.input = input;
    this.store = store;
    this.network = network;
    this.unsubscribePlaced = network.onEvent(
      BUILD_EVENTS.STRUCTURE_PLACED,
      (payload) => this.handleStructurePlaced(payload),
    );
    this.unsubscribeRejected = network.onEvent(
      BUILD_EVENTS.STRUCTURE_REJECTED,
      (payload) => this.handleStructureRejected(payload),
    );
  }

  // ── state accessors (for HUD / later rendering layers) ─────────────────

  /** True while the player is in build mode. */
  public isBuildModeActive(): boolean {
    return this.input.isBuildModeActive();
  }

  /** The selected build type. */
  public getSelectedBuildType() {
    return this.input.getSelectedBuildType();
  }

  /** The selected cardinal rotation. */
  public getRotation() {
    return this.input.getRotation();
  }

  /** The latest computed placement preview (or the absent preview). */
  public getPreview(): PlacementPreview {
    return this.preview;
  }

  /** The authoritative structure mirror as a plain `BuildingState`. */
  public getBuildingState(): BuildingState {
    return this.store.getBuildingState();
  }

  /**
   * The number of authoritative structures currently mirrored — useful for
   * debugging and later HUD work.
   */
  public get structureCount(): number {
    return this.store.structureCount;
  }

  /** The number of in-flight placement intents. */
  public get pendingCount(): number {
    return this.store.pendingCount;
  }

  /**
   * Polls the pending place-press edge from the input controller. The
   * runtime polls this once per render frame so a press is never consumed
   * between frames.
   */
  public consumePlacePressed(): boolean {
    return this.input.consumePlacePressed();
  }

  // ── per-frame update ────────────────────────────────────────────────────

  /**
   * Recomputes the placement preview for the current frame. Called once per
   * render frame by the runtime, after the aim direction is known. When the
   * player is not in build mode the preview becomes {@link ABSENT_PREVIEW}.
   *
   * @returns the preview computed for this frame.
   */
  public updateFrame(context: BuildingFrameContext): PlacementPreview {
    if (this.disposed) {
      return this.preview;
    }
    if (!this.input.isBuildModeActive()) {
      this.preview = ABSENT_PREVIEW;
      return this.preview;
    }
    this.preview = computePlacementPreview({
      aimOrigin: context.aimOrigin,
      aimDirection: context.aimDirection,
      playerPosition: context.playerPosition,
      buildType: this.input.getSelectedBuildType(),
      rotation: this.input.getRotation(),
      occupied: this.store.getOccupiedStructures(),
    });
    return this.preview;
  }

  // ── intent submission ───────────────────────────────────────────────────

  /**
   * Submits a placement intent for the current (valid) preview.
   *
   * Assigns the next intent `sequence`, registers the intent as pending in
   * the store (so the preview immediately reflects the occupied cell), and
   * sends `build:placement_request` to the server. Returns `null` when
   * there is no valid preview to place (not in build mode, aiming off the
   * grid, out of range, overlapping, or invalid rotation).
   *
   * The server remains authoritative: a pending intent only becomes a real
   * structure when the server broadcasts `build:structure_placed`.
   */
  public requestPlace(): StructurePlacementIntent | null {
    if (this.disposed) {
      return null;
    }
    const preview = this.preview;
    if (!preview.present || !preview.valid || preview.grid === null) {
      return null;
    }
    const intent: StructurePlacementIntent = {
      sequence: this.nextSequence,
      buildType: this.input.getSelectedBuildType(),
      grid: preview.grid,
      rotation: preview.rotation,
    };
    this.nextSequence += 1;
    this.store.addPending(intent);
    this.network.send(BUILD_EVENTS.PLACEMENT_REQUEST, intent);
    return intent;
  }

  // ── replicated-state consumption ────────────────────────────────────────

  /**
   * Consumes the replicated building state from a room-state sync. This is
   * the *only* path through which authoritative structures enter the
   * client: the server's synchronized `structures` collection, verbatim.
   */
  public applyReplicatedBuilding(building: BuildingState): void {
    if (this.disposed) {
      return;
    }
    this.store.applyReplicatedState(building.structures);
  }

  private handleStructurePlaced(payload: unknown): void {
    if (this.disposed) {
      return;
    }
    const event = payload as StructurePlacedEvent | null;
    if (event?.structure?.structureId !== undefined) {
      this.store.confirmPlacement(event);
    }
  }

  private handleStructureRejected(payload: unknown): void {
    if (this.disposed) {
      return;
    }
    const parsed = parseStructureRejectedEvent(payload);
    if (parsed !== null) {
      this.store.rejectPlacement(parsed);
    }
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  /**
   * Clears pending intents only (keeps the authoritative mirror and the
   * sequence counter). Called when the connection drops so a stale intent
   * can never be misattributed after a reconnect.
   */
  public clearPending(): void {
    this.store.clearPending();
  }

  /**
   * Full reset for a new session / round: drops the structure mirror, all
   * pending intents, and restarts the intent sequence at 0. The next
   * replicated state sync re-populates the mirror from the server truth.
   */
  public reset(): void {
    this.nextSequence = 0;
    this.store.reset();
    this.preview = ABSENT_PREVIEW;
  }

  /** Unsubscribes from server events. Safe to call multiple times. */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.unsubscribePlaced();
    this.unsubscribeRejected();
    this.preview = ABSENT_PREVIEW;
  }
}
