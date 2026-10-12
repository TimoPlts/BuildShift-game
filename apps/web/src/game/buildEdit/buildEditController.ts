/**
 * buildEditController — the presentation-only client orchestrator for the
 * piece-edit system (docs/TECHNICAL_ARCHITECTURE.md §24).
 *
 * Wires the client's half of the canonical edit-grid contract for *editing*
 * an already-placed, owned structure — as opposed to the
 * {@link BuildingController}, which handles *placing* new ones. The fast
 * third-person interaction is:
 *
 *  - aim at an owned piece (the crosshair selects via the shared aim-ray
 *    selection volume),
 *  - click (or hold-drag) the primary button on the projected tile grid —
 *    the crosshair maps to the canonical tile (wall 3×3, floor/cone 2×2) or
 *    ramp half-cell, and each change is sent as an `edit_grid_action`
 *    intent (`select` / `deselect`),
 *  - confirm (`Enter`), cancel (`C`), or reset (`Backspace`) the edit.
 *
 * State model (all presentation-only):
 *
 *  - the authoritative per-structure edit state is tracked from two
 *    converging sources: the replicated room state (each structure's
 *    `editGrid`, parsed from the server's `editKind` / `editTiles` /
 *    `editRampVariant` fields) and the fast
 *    `two-player:edit_grid_action` result broadcast (which carries the
 *    authoritative state on success);
 *  - the player's in-progress edit is applied *optimistically* the moment
 *    the action is sent (the pending state shown in the preview), and
 *    reconciled on the authoritative result: a success re-syncs the
 *    pending state to the broadcast, a rejection rolls it back to the last
 *    authoritative state and surfaces a reason banner;
 *  - terminal actions (confirm / cancel / reset) are only sent when the
 *    player actually changed the piece — the server treats a confirm as an
 *    acknowledgement of an already-committed state, so there is nothing to
 *    send for an untouched piece. A `reset` (or `cancel`) is applied to the
 *    pending state *optimistically and immediately*, so the preview snaps to
 *    the full/default canonical form before the server round-trip (the fast,
 *    combat-ready reset); repeated edit → reset → edit cycles therefore
 *    replicate identically from the same canonical baseline.
 *
 * Authority contract: this controller NEVER edits structures on its own
 * authority. It sends *intents* and consumes the server's results. It does
 * not write to the building mirror, structure health, ownership, or any
 * other gameplay rule. Its preview + feedback are presentation state only,
 * cleaned up on cancel, round reset, rematch, disconnect, and dispose.
 */
import {
  createDefaultEditState,
  isRampVariant,
  FLOOR_CONE_EDIT_TILE_COUNT,
  WALL_EDIT_TILE_COUNT,
  type BuildingState,
  type RampVariant,
  type StructureEditState,
  type StructureState,
} from "@buildshift/protocol";
import { BUILD_RANGE } from "@buildshift/game-config";
import type { BuildEditInputController } from "./buildEditInputController";
import { aimEditTile, type EditTileAimResult } from "./editTileSelection";
import {
  selectTargetStructure,
  type TargetedStructure,
  type Vec3Like,
} from "./structureSelection";

/**
 * The canonical edit-grid action message (client → server intents, server →
 * all clients results). Matches the server's `EDIT_GRID_ACTION_INPUT`; the
 * client keeps its message-name literals local (the established convention
 * for client network names, e.g. `NetworkClient`).
 */
export const EDIT_GRID_ACTION_MESSAGE = "two-player:edit_grid_action";

/**
 * The narrow network surface the controller needs. {@link NetworkClient}
 * satisfies it structurally; unit tests substitute a plain fake.
 */
export interface BuildEditNetworkLike {
  /** Send an outbound message (no-op/false when not connected). */
  send: (type: string, payload?: unknown) => boolean;
  /** Subscribe to a named server event; returns an unsubscribe function. */
  onEvent: (
    name: string,
    callback: (payload: unknown) => void,
  ) => () => void;
}

/** Per-frame context the runtime hands to the controller. */
export interface BuildEditFrameContext {
  /** The camera's world position (aim ray origin). */
  aimOrigin: Vec3Like;
  /** The normalized world-space aim direction. */
  aimDirection: Vec3Like;
  /** The local player's feet position (kept for parity). */
  playerPosition: Vec3Like;
  /** The authoritative structure mirror (server truth only). */
  building: BuildingState;
  /** The local session id (for ownership filtering), or `null` when unknown. */
  sessionId: string | null;
  /** Whether the canonical network connection is live. */
  connected: boolean;
  /**
   * Whether the round is in progress (the server rejects edit actions
   * outside `IN_PROGRESS`; the client does not send them either).
   */
  inRound: boolean;
  /**
   * The routed primary-button press edge (from the runtime's single
   * {@link routePrimaryAction} decision — `true` only in edit mode).
   */
  editSelectPressed: boolean;
  /**
   * The routed primary-button hold (from the same decision — `true` only
   * in edit mode).
   */
  editSelectHeld: boolean;
}

/** The authoritative edit action result, parsed defensively off the wire. */
export interface BuildEditActionResultInfo {
  structureId: string;
  success: boolean;
  reason?: string;
  editState?: StructureEditState;
}

/** Accepted/rejected/informational feedback shown (briefly) in the HUD. */
export interface BuildEditFeedback {
  kind: "accepted" | "rejected" | "info";
  message: string;
  /** Set for feedback tied to a structure. */
  structureId?: string;
}

/** Optional knobs for the controller. */
export interface BuildEditControllerOptions {
  /**
   * "Confirm Edit on Release": when enabled, releasing the primary button
   * after a tile selection also confirms the edit (fast single-click
   * commit). Default `false` — confirmation is explicit (`Enter`).
   */
  confirmOnRelease?: boolean;
}

/**
 * The maximum distance (metres) from the camera at which an owned structure
 * is selectable for editing. Reuses the shared placement range so edit
 * selection and placement share one interaction-radius constant.
 */
export const BUILD_EDIT_RANGE = BUILD_RANGE.maxPlacementDistance;

/** How long (ms) an accepted/rejected feedback banner stays on screen. */
const FEEDBACK_TTL_MS = 3000;

/** How long (ms) an edit-mode enter/exit (info) banner stays on screen. */
const MODE_FEEDBACK_TTL_MS = 2000;

/** A short, human-readable label per authoritative rejection reason. */
const REJECTION_LABELS: Readonly<Record<string, string>> = {
  not_owned: "Not your structure",
  structure_not_found: "Structure not found",
  invalid_player_state: "Editing unavailable now",
  tile_out_of_range: "Tile out of range",
  invalid_action: "Edit not allowed here",
  invalid_form: "Floor cannot be fully opened",
};

/**
 * The client build-edit orchestrator (presentation-only).
 */
export class BuildEditController {
  private readonly input: BuildEditInputController;
  private readonly network: BuildEditNetworkLike;
  private readonly now: () => number;
  private readonly confirmOnRelease: boolean;
  private readonly unsubscribeResult: () => void;

  private disposed = false;
  private mode = false;
  private target: TargetedStructure | null = null;
  private feedback: BuildEditFeedback | null = null;
  private feedbackUntil = 0;

  /**
   * Last authoritative edit state per structure — converged from the
   * replicated room state (`editGrid`) and from successful result
   * broadcasts (which arrive before the next state sync).
   */
  private readonly authStates = new Map<string, StructureEditState>();
  /**
   * The last optimistically-applied state per structure (the pending state
   * shown in the preview while the server's result is in flight).
   */
  private readonly optimistic = new Map<string, StructureEditState>();
  /** Actions sent but not yet answered, per structure. */
  private readonly unacked = new Map<string, number>();
  /**
   * Structures the local player has changed since the last terminal action
   * (gates the confirm/cancel/reset sends — an untouched piece has nothing
   * to confirm).
   */
  private readonly touched = new Set<string>();
  /** The last sent action per structure (for result feedback). */
  private readonly lastAction = new Map<string, string>();
  /**
   * The last painted target while holding the primary button (`null`
   * between presses) — prevents drag-painting from re-applying the same
   * tile every frame.
   */
  private lastPainted: { structureId: string; key: string } | null = null;

  public constructor(
    input: BuildEditInputController,
    network: BuildEditNetworkLike,
    now?: () => number,
    options?: BuildEditControllerOptions,
  ) {
    this.input = input;
    this.network = network;
    this.now = now ?? (() => performance.now());
    this.confirmOnRelease = options?.confirmOnRelease ?? false;
    this.unsubscribeResult = network.onEvent(
      EDIT_GRID_ACTION_MESSAGE,
      (payload) => this.handleActionResult(payload),
    );
  }

  // ── state accessors (for the HUD / presentation layer) ───────────────────

  /** True while the player is in edit mode (mirrors the input controller). */
  public getMode(): boolean {
    return this.input.isEditModeActive();
  }

  /** The structure the aim ray currently selects, or `null`. */
  public getTarget(): TargetedStructure | null {
    return this.target;
  }

  /** The accepted/rejected feedback, or `null` when none is pending. */
  public getFeedback(): BuildEditFeedback | null {
    return this.feedback;
  }

  /**
   * The pending edit state for the targeted structure (the preview's
   * canonical input): the optimistic state while actions are in flight,
   * otherwise the last authoritative state (or the default when the piece
   * has never been edited). `null` when nothing is targeted.
   */
  public getPendingState(): StructureEditState | null {
    if (this.target === null) {
      return null;
    }
    return this.pendingStateFor(this.target.structureId);
  }

  // ── per-frame update ──────────────────────────────────────────────────────

  /**
   * Drives the build-edit system for one render frame:
   *
   *  1. expires stale feedback,
   *  2. latches the routed primary-button state into the input controller,
   *  3. mirrors the input controller's edit-mode state, reporting a genuine
   *     enter/exit transition to the HUD,
   *  4. resolves the aim target (owned piece under the crosshair),
   *  5. converges the authoritative per-structure states from the mirror,
   *  6. consumes the edit intents (tile toggle, confirm, cancel, reset,
   *     optional confirm-on-release) and submits the matching
   *     `edit_grid_action` intents.
   *
   * Returns the targeted structure for this frame (or `null`).
   */
  public updateFrame(ctx: BuildEditFrameContext): TargetedStructure | null {
    if (this.disposed) {
      this.target = null;
      return null;
    }

    // 1. expire stale feedback.
    if (this.feedback !== null && this.now() >= this.feedbackUntil) {
      this.feedback = null;
    }

    // 2. route the shared primary button into the edit intents (the runtime
    //    decided ownership via routePrimaryAction; the input controller
    //    derives the press/hold/release edges — no mouse listeners here).
    this.input.latchEditSelect(ctx.editSelectPressed, ctx.editSelectHeld);

    // 3. mirror edit mode; report user enter/exit transitions to the HUD.
    //    A forced exit (round reset / disconnect) sets this.mode directly in
    //    reset()/clearOnDisconnect(), so it is never observed as a
    //    transition here and never produces a banner.
    const nextMode = this.input.isEditModeActive();
    if (nextMode !== this.mode) {
      this.mode = nextMode;
      this.lastPainted = null;
      // Never clobber a live accepted/rejected banner: the server's verdict
      // is more important than the mode-transition notice.
      const keepResult =
        this.feedback !== null &&
        this.feedback.kind !== "info" &&
        this.now() < this.feedbackUntil;
      if (!keepResult) {
        this.feedback = {
          kind: "info",
          message: nextMode ? "Edit mode on" : "Edit mode off",
        };
        this.feedbackUntil = this.now() + MODE_FEEDBACK_TTL_MS;
      }
    }

    // 4. resolve the aim target (only while in edit mode with a known id).
    if (this.mode && ctx.sessionId !== null) {
      this.target = selectTargetStructure({
        aimOrigin: ctx.aimOrigin,
        aimDirection: ctx.aimDirection,
        maxRange: BUILD_EDIT_RANGE,
        building: ctx.building,
        ownerId: ctx.sessionId,
      });
    } else {
      this.target = null;
    }

    // 5. converge the authoritative states from the replicated mirror (and
    //    prune caches for structures that no longer exist).
    if (this.mode) {
      this.syncAuthFromMirror(ctx.building);
    }

    // 6. consume the edit intents.
    if (this.mode && this.target !== null && ctx.connected && ctx.inRound) {
      const id = this.target.structureId;
      const structure = ctx.building.structures[id];
      if (structure !== undefined) {
        const aim = aimEditTile({
          structure,
          aimOrigin: ctx.aimOrigin,
          aimDirection: ctx.aimDirection,
          maxRange: BUILD_EDIT_RANGE,
        });
        const pressEdge = this.input.consumeEditSelectPressed();
        if (pressEdge) {
          this.lastPainted = null;
          if (aim !== null) {
            this.applyTileToggle(structure, aim);
          }
        } else if (this.input.isEditSelectHeld()) {
          // Hold-drag painting: apply when the aim reaches a fresh tile.
          if (aim !== null) {
            const key = paintKey(aim);
            if (
              this.lastPainted === null ||
              this.lastPainted.structureId !== id ||
              this.lastPainted.key !== key
            ) {
              this.applyTileToggle(structure, aim);
            }
          }
        }
        if (this.input.consumeConfirmPressed()) {
          this.sendTerminal(ctx, structure, "confirm");
        }
        if (this.input.consumeCancelPressed()) {
          this.sendTerminal(ctx, structure, "cancel");
        }
        if (this.input.consumeResetPressed()) {
          this.sendTerminal(ctx, structure, "reset");
        }
        if (this.confirmOnRelease && this.input.consumeEditSelectReleased()) {
          this.sendTerminal(ctx, structure, "confirm");
        } else {
          // Keep the release latch drained when the option is off.
          this.input.consumeEditSelectReleased();
        }
      } else {
        // Target vanished mid-frame: drain the latches so they do not leak
        // into the next frame.
        this.input.consumeEditSelectPressed();
        this.input.consumeConfirmPressed();
        this.input.consumeCancelPressed();
        this.input.consumeResetPressed();
        this.input.consumeEditSelectReleased();
      }
    } else {
      // Out of the interaction window (no mode / no target / not connected /
      // not in round): drain the latches so stale edges never fire later.
      this.input.consumeEditSelectPressed();
      this.input.consumeConfirmPressed();
      this.input.consumeCancelPressed();
      this.input.consumeResetPressed();
      this.input.consumeEditSelectReleased();
    }

    return this.target;
  }

  // ── intent submission ─────────────────────────────────────────────────────

  /**
   * Applies one crosshair tile toggle optimistically and submits the
   * matching `edit_grid_action` intent (`select` marks a tile for removal /
   * sets the ramp half; `deselect` restores it / returns the ramp to full).
   *
   * The server remains authoritative: the change is only real once the
   * server broadcasts the result (and the replicated state carries the
   * updated structure).
   */
  private applyTileToggle(
    structure: StructureState,
    aim: EditTileAimResult,
  ): void {
    const id = structure.structureId;
    const pending = this.pendingStateFor(id);
    let action: "select" | "deselect";
    let next: StructureEditState;
    let rampVariant: RampVariant | null = null;
    let tileIndex: number | null = null;

    if (aim.kind === "ramp_half") {
      const variant: RampVariant =
        aim.side === "left" ? "half_left" : "half_right";
      rampVariant = variant;
      if (pending.kind === "ramp" && pending.variant === variant) {
        // Same half again: back to the full ramp.
        action = "deselect";
        next = { kind: "ramp", variant: "full" };
      } else {
        action = "select";
        next = { kind: "ramp", variant };
      }
    } else {
      const tile = aim.tileIndex;
      tileIndex = tile;
      if (pending.kind !== "wall" && pending.kind !== "floor_cone") {
        return; // shape mismatch (cannot happen for a targeted piece)
      }
      const tiles = [...pending.tiles];
      if (tile < 0 || tile >= tiles.length) {
        return;
      }
      if (tiles[tile]) {
        action = "select";
        tiles[tile] = false;
      } else {
        action = "deselect";
        tiles[tile] = true;
      }
      next = { ...pending, tiles };
    }

    // Optimistic application: the preview shows the pending state at once.
    this.optimistic.set(id, next);
    const inFlight = (this.unacked.get(id) ?? 0) + 1;
    this.unacked.set(id, inFlight);
    this.touched.add(id);
    this.lastAction.set(id, action);
    this.lastPainted = { structureId: id, key: paintKey(aim) };

    const payload: Record<string, unknown> = { structureId: id, action };
    if (rampVariant !== null) {
      payload.rampVariant = rampVariant;
    } else if (tileIndex !== null) {
      payload.tileIndex = tileIndex;
    }
    this.network.send(EDIT_GRID_ACTION_MESSAGE, payload);
  }

  /**
   * Submits a terminal edit action (`confirm` / `cancel` / `reset`) when the
   * piece was actually changed, then exits edit mode for confirm/cancel
   * (reset keeps the mode on so further edits continue). An untouched piece
   * simply exits (confirm/cancel) — there is nothing to send.
   *
   * Fast reset: `reset` and `cancel` both resolve to the canonical default
   * state on the server, so the matching default is applied to the pending
   * (optimistic) cache *immediately* — the preview reflects the reset to the
   * full/default form before the server round-trip, so repeated
   * edit → reset → edit cycles start from an identical canonical baseline.
   * The server remains authoritative: the intent is still sent, and a
   * rejection drops the optimistic default (the pending state rolls back to
   * the last authoritative state) in {@link handleActionResult}.
   */
  private sendTerminal(
    ctx: Pick<BuildEditFrameContext, "connected" | "inRound">,
    structure: StructureState,
    action: "confirm" | "cancel" | "reset",
  ): void {
    if (!ctx.connected || !ctx.inRound) {
      return;
    }
    const id = structure.structureId;
    const send = this.touched.has(id);
    if (send) {
      this.lastAction.set(id, action);
      const inFlight = (this.unacked.get(id) ?? 0) + 1;
      this.unacked.set(id, inFlight);
      this.network.send(EDIT_GRID_ACTION_MESSAGE, { structureId: id, action });
      // A terminal action ends the change set for this piece.
      this.touched.delete(id);
      // Apply the reset-to-default result optimistically now, so the preview
      // is immediately combat-ready (full/default canonical form) instead of
      // waiting for the broadcast. `confirm` is a no-op acknowledgement and
      // keeps the current state, so it is deliberately not applied here.
      if (action === "reset" || action === "cancel") {
        this.optimistic.set(id, createDefaultEditState(structure.buildType));
      }
    }
    if (action === "confirm" || action === "cancel") {
      // Commit-exit drops the edit layer AND the build layer beneath it, so
      // the primary button and the number keys are combat actions
      // immediately ("confirm then shotgun") — overhaul task 12.
      this.input.commitEditExit();
    }
  }

  // ── state convergence ─────────────────────────────────────────────────────

  /**
   * The pending edit state for one structure: optimistic while actions are
   * in flight, otherwise the last authoritative state (or the default when
   * the piece has never been edited).
   */
  private pendingStateFor(structureId: string): StructureEditState {
    if ((this.unacked.get(structureId) ?? 0) > 0) {
      return (
        this.optimistic.get(structureId) ??
        this.authStates.get(structureId) ??
        createDefaultEditState("wall")
      );
    }
    return (
      this.authStates.get(structureId) ?? createDefaultEditState("wall")
    );
  }

  /**
   * Convergence pass over the replicated mirror: adopts any structure's
   * replicated `editGrid` when it differs from the cached authoritative
   * state, and drops caches for structures that no longer exist.
   */
  private syncAuthFromMirror(building: BuildingState): void {
    const present = new Set<string>();
    for (const key in building.structures) {
      const structure = building.structures[key];
      present.add(key);
      const grid = structure.editGrid;
      if (grid === undefined) {
        continue;
      }
      const cached = this.authStates.get(key);
      if (!sameEditState(cached, grid)) {
        this.authStates.set(key, grid);
      }
    }
    for (const key of this.authStates.keys()) {
      if (!present.has(key)) {
        this.dropCaches(key);
      }
    }
  }

  private dropCaches(structureId: string): void {
    this.authStates.delete(structureId);
    this.optimistic.delete(structureId);
    this.unacked.delete(structureId);
    this.touched.delete(structureId);
    this.lastAction.delete(structureId);
    if (this.lastPainted?.structureId === structureId) {
      this.lastPainted = null;
    }
  }

  // ── authoritative result consumption ──────────────────────────────────────

  private handleActionResult(payload: unknown): void {
    if (this.disposed) {
      return;
    }
    const parsed = parseEditActionResult(payload);
    if (parsed === null) {
      return;
    }
    const id = parsed.structureId;

    if (parsed.success && parsed.editState !== undefined) {
      // Convergence for *all* clients (including the remote player's own
      // edits): the broadcast carries the authoritative post-action state
      // and arrives before the next replicated state sync.
      this.authStates.set(id, parsed.editState);
    }

    // Feedback / rollback only for the local player's own in-flight
    // actions — a result for a structure we never edited (e.g. the remote
    // player's) updates convergence but never shows a banner.
    const inFlight = this.unacked.get(id) ?? 0;
    if (inFlight === 0) {
      return;
    }
    const remaining = inFlight - 1;
    if (remaining <= 0) {
      this.unacked.delete(id);
      this.optimistic.delete(id); // pending falls back to authoritative
    } else {
      this.unacked.set(id, remaining);
    }

    if (parsed.success) {
      const action = this.lastAction.get(id);
      if (action === "confirm") {
        this.showFeedback({
          kind: "accepted",
          message: "Edit confirmed",
          structureId: id,
        });
      } else if (action === "cancel") {
        this.showFeedback({
          kind: "info",
          message: "Edit cancelled",
          structureId: id,
        });
      } else if (action === "reset") {
        this.showFeedback({
          kind: "info",
          message: "Edit reset",
          structureId: id,
        });
      }
      // select / deselect are silent: the piece's shape is the feedback.
      return;
    }

    this.showFeedback({
      kind: "rejected",
      message:
        parsed.reason !== undefined && parsed.reason in REJECTION_LABELS
          ? REJECTION_LABELS[parsed.reason]!
          : "Edit rejected",
      structureId: id,
    });
  }

  private showFeedback(feedback: BuildEditFeedback): void {
    this.feedback = feedback;
    this.feedbackUntil = this.now() + FEEDBACK_TTL_MS;
  }

  // ── cleanup triggers (presentation-only) ──────────────────────────────────

  /**
   * Drops the preview + feedback + pending caches. Called when the player
   * exits edit mode outside the key path (e.g. a forced transition).
   */
  public cancel(): void {
    if (this.disposed) {
      return;
    }
    this.target = null;
    this.feedback = null;
    this.feedbackUntil = 0;
    this.lastPainted = null;
  }

  /**
   * Full reset for a round reset / rematch: exits edit mode, drops the
   * preview, feedback, and every pending cache. The authoritative structure
   * mirror (owned by the building system) is reset separately by the
   * runtime.
   */
  public reset(): void {
    if (this.disposed) {
      return;
    }
    this.input.exitEditMode();
    this.mode = false;
    this.target = null;
    this.feedback = null;
    this.feedbackUntil = 0;
    this.lastPainted = null;
    this.authStates.clear();
    this.optimistic.clear();
    this.unacked.clear();
    this.touched.clear();
    this.lastAction.clear();
  }

  /**
   * Clears preview + feedback + pending caches and exits edit mode without
   * dropping the connection. Called when the connection drops so a stale
   * selection, optimistic state, or feedback can never persist.
   */
  public clearOnDisconnect(): void {
    if (this.disposed) {
      return;
    }
    this.input.exitEditMode();
    this.mode = false;
    this.target = null;
    this.feedback = null;
    this.feedbackUntil = 0;
    this.lastPainted = null;
    this.authStates.clear();
    this.optimistic.clear();
    this.unacked.clear();
    this.touched.clear();
    this.lastAction.clear();
  }

  /** Unsubscribes from server events and drops every cache. */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.unsubscribeResult();
    this.mode = false;
    this.target = null;
    this.feedback = null;
    this.authStates.clear();
    this.optimistic.clear();
    this.unacked.clear();
    this.touched.clear();
    this.lastAction.clear();
  }
}

// ── pure helpers ────────────────────────────────────────────────────────────

/** A stable key for the painted target (prevents drag re-applying). */
function paintKey(aim: EditTileAimResult): string {
  return aim.kind === "tile"
    ? `t:${aim.tileIndex}`
    : `v:${aim.side}`;
}

/**
 * Structural equality of two edit states (the replicated mirror reparses
 * its objects on every state sync, so identity comparison is not enough).
 */
function sameEditState(
  a: StructureEditState | undefined,
  b: StructureEditState,
): boolean {
  if (a === undefined) {
    return false;
  }
  if (a.kind === "ramp") {
    return b.kind === "ramp" && a.variant === b.variant;
  }
  if (b.kind === "ramp") {
    return false;
  }
  // Both are tile-based (wall / floor_cone).
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.tiles.length !== b.tiles.length) {
    return false;
  }
  for (let i = 0; i < a.tiles.length; i++) {
    if (a.tiles[i] !== b.tiles[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Defensively parses an `edit_grid_action` result payload off the wire.
 * Returns `null` for malformed payloads so a corrupt event can never set
 * feedback or corrupt the convergence cache.
 */
export function parseEditActionResult(
  payload: unknown,
): BuildEditActionResultInfo | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const r = payload as Record<string, unknown>;
  if (typeof r.structureId !== "string" || r.structureId.length === 0) {
    return null;
  }
  if (typeof r.success !== "boolean") {
    return null;
  }
  const info: BuildEditActionResultInfo = {
    structureId: r.structureId,
    success: r.success,
  };
  if (typeof r.reason === "string") {
    info.reason = r.reason;
  }
  if (r.editState !== undefined) {
    const state = parseEditStatePayload(r.editState);
    if (state !== null) {
      info.editState = state;
    }
  }
  return info;
}

/**
 * Parses the authoritative edit state carried on a successful result
 * (shape-validated, length-checked per kind).
 */
function parseEditStatePayload(raw: unknown): StructureEditState | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (r.kind === "ramp") {
    return isRampVariant(r.variant)
      ? { kind: "ramp", variant: r.variant }
      : null;
  }
  if (
    (r.kind === "wall" || r.kind === "floor_cone") &&
    Array.isArray(r.tiles)
  ) {
    const expected =
      r.kind === "wall" ? WALL_EDIT_TILE_COUNT : FLOOR_CONE_EDIT_TILE_COUNT;
    if (r.tiles.length !== expected) {
      return null;
    }
    for (const tile of r.tiles) {
      if (typeof tile !== "boolean") {
        return null;
      }
    }
    return {
      kind: r.kind,
      tiles: (r.tiles as boolean[]).slice(),
    };
  }
  return null;
}
