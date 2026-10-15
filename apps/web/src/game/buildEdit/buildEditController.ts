/**
 * buildEditController — the presentation-only client orchestrator for the
 * piece-edit system (docs/TECHNICAL_ARCHITECTURE.md §24).
 *
 * Wires the client's half of the canonical edit-grid contract for *editing*
 * an already-placed, owned structure — as opposed to the
 * {@link BuildingController}, which handles *placing* new ones. The
 * competitive interaction (bindings are gameplay actions, see
 * `DEFAULT_ACTION_BINDINGS`):
 *
 *  - aim at an owned piece and press `edit`: the piece is locked into a local
 *    draft (its canonical edit grid becomes targetable),
 *  - hold `editSelect` (the primary button) and drag across the canonical
 *    tiles (wall 3×3, floor/cone 2×2): every tile the crosshair path crosses
 *    is selected — or restored, when the drag started on a removed tile —
 *    live in the preview; ramps pick a width half by press,
 *  - `editReset` previews the default form immediately,
 *  - `editConfirm` (or `edit` again, or a build-piece / weapon bind) applies
 *    the draft; `editCancel` (unbound by default) drops it.
 *
 * State model (all presentation-only):
 *
 *  - the authoritative per-structure edit state is tracked from two
 *    converging sources: the replicated room state (each structure's
 *    `editGrid`) and the fast `two-player:edit_grid_action` result broadcast;
 *  - the drag selection is local input state: nothing is sent per tile or
 *    per hover. Confirming sends only the canonical difference between the
 *    draft and the applied state ({@link editDiffActions}) over the existing
 *    edit route, shows it optimistically at once, and rolls back to the
 *    authoritative state (with a reason banner) if the server rejects it.

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
import type { BuildLatencyMetrics } from "../building/buildLatencyMetrics";
import type { BuildEditInputController } from "./buildEditInputController";
import type { EditTileAimResult } from "./editTileSelection";
import { TileDragSelection, editGridSize, sampleEditSurface, sampleTile } from "./editDragSelection";
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

/** The local, unconfirmed edit of the locked piece (presentation/input only). */
interface EditDraft {
  structureId: string;
  buildType: StructureState["buildType"];
  /** The authoritative (or in-flight optimistic) state the draft started from. */
  base: StructureEditState;
  /** The player's working state (shown in the preview; sent on confirm). */
  state: StructureEditState;
}

/** The edit view for the preview / HUD while a piece is being edited. */
export interface BuildEditView {
  structureId: string;
  /** The applied state (authoritative or in-flight optimistic). */
  baseState: StructureEditState;
  /** The player's unconfirmed working state. */
  draftState: StructureEditState;
  /** The tile under the crosshair (wall 0–8, floor/cone 0–3), or `null`. */
  hoverTile: number | null;
  /** The ramp width half under the crosshair, or `null`. */
  hoverVariant: RampVariant | null;
  /** Whether a drag (held select) is in progress. */
  dragging: boolean;
  /** Whether the draft differs from the applied state. */
  changed: boolean;
  /** Human-readable reason when the draft cannot be confirmed, else `null`. */
  invalidReason: string | null;
}

/**
 * The client build-edit orchestrator (presentation-only).
 *
 * Edit flow (competitive): the edit bind locks the owned piece under the
 * crosshair into a local **draft**. Holding the primary button and dragging
 * across the piece's canonical tiles selects them locally — every tile the
 * crosshair path crosses, even between slow frames ({@link TileDragSelection}).
 * Reset previews the default form immediately. Nothing is sent while
 * dragging: confirming (the confirm bind, the edit bind again, or leaving
 * edit through a build-piece / weapon bind) sends only the canonical
 * difference between the draft and the applied state over the existing
 * `edit_grid_action` route (restores before removals, or one `reset`), then a
 * `confirm`. The result is shown optimistically and rolled back if the
 * server rejects it; the server remains the only authority.
 */
export class BuildEditController {
  private readonly input: BuildEditInputController;
  private readonly network: BuildEditNetworkLike;
  private readonly now: () => number;
  private readonly confirmOnRelease: boolean;
  private readonly latency: BuildLatencyMetrics | null;
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
   * The last optimistically-applied state per structure (the confirmed edit
   * shown while the server's results are in flight).
   */
  private readonly optimistic = new Map<string, StructureEditState>();
  /** Actions sent but not yet answered, per structure. */
  private readonly unacked = new Map<string, number>();
  /** The last sent action per structure (for result feedback). */
  private readonly lastAction = new Map<string, string>();
  /**
   * Structures with a successful edit result that have been consumed
   * (unacked reached 0) but whose `acceptToReplicatedMeshMs` has not yet
   * been resolved. Resolved on the next frame in {@link updateFrame}.
   */
  private readonly pendingEditMesh = new Set<string>();

  /** The locked piece's unconfirmed edit, or `null`. */
  private draft: EditDraft | null = null;
  private readonly drag = new TileDragSelection();
  private hover: EditTileAimResult | null = null;

  public constructor(
    input: BuildEditInputController,
    network: BuildEditNetworkLike,
    now?: () => number,
    options?: BuildEditControllerOptions & { latency?: BuildLatencyMetrics },
  ) {
    this.input = input;
    this.network = network;
    this.now = now ?? (() => performance.now());
    this.confirmOnRelease = options?.confirmOnRelease ?? false;
    this.latency = options?.latency ?? null;
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

  /** The structure being edited (locked) or aimed at, or `null`. */
  public getTarget(): TargetedStructure | null {
    return this.target;
  }

  /** The accepted/rejected feedback, or `null` when none is pending. */
  public getFeedback(): BuildEditFeedback | null {
    return this.feedback;
  }

  /**
   * The state the preview shows for the target: the player's draft while
   * editing, otherwise the in-flight optimistic or authoritative state (the
   * default when never edited). `null` when nothing is targeted.
   */
  public getPendingState(): StructureEditState | null {
    if (this.target === null) {
      return null;
    }
    if (this.draft !== null && this.draft.structureId === this.target.structureId) {
      return this.draft.state;
    }
    return this.pendingStateFor(this.target.structureId, this.target.buildType);
  }

  /** The full edit view of the locked piece (preview + HUD), or `null`. */
  public getEditView(): BuildEditView | null {
    const draft = this.draft;
    if (draft === null || this.target === null || draft.structureId !== this.target.structureId) {
      return null;
    }
    const base = this.pendingStateFor(draft.structureId, draft.buildType);
    const hover = this.hover;
    return {
      structureId: draft.structureId,
      baseState: base,
      draftState: draft.state,
      hoverTile: hover !== null && hover.kind === "tile" ? hover.tileIndex : null,
      hoverVariant: hover !== null && hover.kind === "ramp_half" ? (hover.side === "left" ? "half_left" : "half_right") : null,
      dragging: this.drag.isDragging(),
      changed: !sameEditState(base, draft.state),
      invalidReason: draftInvalidReason(draft),
    };
  }

  // ── per-frame update ──────────────────────────────────────────────────────

  /**
   * Drives the build-edit system for one render frame:
   *
   *  1. expires stale feedback,
   *  2. latches the routed primary-button state into the input controller,
   *  3. applies or drops the draft when the edit layer was left (commit /
   *     discard), and mirrors the edit mode for the HUD,
   *  4. locks the owned piece under the crosshair into a draft,
   *  5. converges the authoritative per-structure states from the mirror,
   *  6. drives the local drag selection and the confirm / reset / cancel
   *     intents (confirm sends the canonical difference).
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

    // 3. apply / drop the draft when the edit layer was left this frame.
    this.handleExit(this.input.consumeEditExit(), ctx);
    const nextMode = this.input.isEditModeActive();
    if (nextMode !== this.mode) {
      this.mode = nextMode;
      if (!nextMode) this.dropDraft();
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

    // 5. converge the authoritative states from the replicated mirror (and
    //    prune caches for structures that no longer exist).
    if (this.mode) {
      this.syncAuthFromMirror(ctx.building);
    }

    // 4. the locked piece, or lock the owned piece under the crosshair.
    this.target = null;
    this.hover = null;
    if (this.mode && ctx.sessionId !== null) {
      if (this.draft !== null) {
        const locked = ctx.building.structures[this.draft.structureId];
        if (locked === undefined || locked.ownerId !== ctx.sessionId) {
          this.dropDraft();
          this.showFeedback({ kind: "info", message: "Edit target lost" });
        } else {
          this.target = { structureId: locked.structureId, buildType: locked.buildType, grid: locked.grid, rotation: locked.rotation, ownerId: locked.ownerId, distance: 0 };
        }
      }
      if (this.draft === null) {
        this.target = selectTargetStructure({
          aimOrigin: ctx.aimOrigin,
          aimDirection: ctx.aimDirection,
          maxRange: BUILD_EDIT_RANGE,
          building: ctx.building,
          ownerId: ctx.sessionId,
        });
        if (this.target !== null) {
          const base = this.pendingStateFor(this.target.structureId, this.target.buildType);
          this.draft = { structureId: this.target.structureId, buildType: this.target.buildType, base, state: cloneEditState(base) };
        }
      } else {
        // An untouched draft follows the applied state (e.g. a confirmed
        // edit's result arriving): the player always edits the current form.
        const applied = this.pendingStateFor(this.draft.structureId, this.draft.buildType);
        if (!sameEditState(applied, this.draft.base) && sameEditState(this.draft.state, this.draft.base)) {
          this.draft.base = applied;
          this.draft.state = cloneEditState(applied);
        }
      }
    }

    // 5b. resolve any pending edit mesh latency measurements (the preview
    //     now shows the authoritative state for these structures).
    if (this.latency !== null && this.pendingEditMesh.size > 0) {
      for (const id of this.pendingEditMesh) {
        if (this.unacked.has(id)) {
          // Still in flight — defer to a later frame.
          continue;
        }
        this.latency.resolveEditMesh(id);
        this.pendingEditMesh.delete(id);
      }
    }

    // 6. drive the drag selection and the terminal intents.
    const draft = this.draft;
    const structure = draft !== null ? ctx.building.structures[draft.structureId] : undefined;
    if (this.mode && draft !== null && structure !== undefined && ctx.connected && ctx.inRound) {
      const sample = sampleEditSurface(structure, ctx.aimOrigin, ctx.aimDirection, BUILD_EDIT_RANGE);
      const size = editGridSize(structure.buildType);
      if (sample !== null && sample.kind === "ramp") {
        this.hover = { kind: "ramp_half", side: sample.side };
      } else if (sample !== null && size !== null) {
        const tile = sampleTile(sample, size);
        this.hover = tile === null ? null : { kind: "tile", tileIndex: tile };
      }

      const pressEdge = this.input.consumeEditSelectPressed();
      const tileSample = sample !== null && sample.kind === "tiles" ? sample : null;
      if (draft.state.kind === "ramp") {
        if (pressEdge && sample !== null && sample.kind === "ramp") {
          const half: RampVariant = sample.side === "left" ? "half_left" : "half_right";
          draft.state = { kind: "ramp", variant: draft.state.variant === half ? "full" : half };
        }
      } else if (size !== null) {
        if (pressEdge) {
          this.drag.press(tileSample, size, draft.state.tiles);
        } else if (this.input.isEditSelectHeld() && this.drag.isDragging()) {
          this.drag.move(tileSample, size, draft.state.tiles);
        }
      }
      if (!this.input.isEditSelectHeld() && this.drag.isDragging()) {
        this.drag.release();
      }

      if (this.input.consumeResetPressed()) {
        // Immediate predicted reset: the preview shows the default form now;
        // confirming applies it.
        draft.state = createDefaultEditState(draft.buildType);
        this.drag.release();
      }
      const released = this.input.consumeEditSelectReleased();
      const confirm = this.input.consumeConfirmPressed() ||
        (this.confirmOnRelease && released && !sameEditState(this.pendingStateFor(draft.structureId, draft.buildType), draft.state));
      if (this.input.consumeCancelPressed()) {
        this.input.cancelEditExit();
        this.handleExit(this.input.consumeEditExit(), ctx);
      } else if (confirm) {
        const invalid = draftInvalidReason(draft);
        if (invalid !== null) {
          this.showFeedback({ kind: "rejected", message: invalid, structureId: draft.structureId });
        } else {
          this.input.commitEditExit();
          this.handleExit(this.input.consumeEditExit(), ctx);
        }
      }
    } else {
      // Out of the interaction window (no mode / no target / not connected /
      // not in round): drain the latches so stale edges never fire later.
      this.input.consumeEditSelectPressed();
      this.input.consumeConfirmPressed();
      this.input.consumeCancelPressed();
      this.input.consumeResetPressed();
      this.input.consumeEditSelectReleased();
      if (this.drag.isDragging()) this.drag.release();
    }

    if (!this.input.isEditModeActive() && this.mode) {
      // Left during this frame (confirm / cancel above).
      this.mode = false;
      this.target = null;
      this.hover = null;
    }
    return this.target;
  }

  // ── intent submission ─────────────────────────────────────────────────────

  /** Applies (commit) or drops (discard) the draft when the edit layer was left. */
  private handleExit(
    exit: "commit" | "discard" | null,
    ctx: Pick<BuildEditFrameContext, "connected" | "inRound" | "building">,
  ): void {
    if (exit === null) return;
    const draft = this.draft;
    this.dropDraft();
    if (exit !== "commit" || draft === null) return;
    if (!ctx.connected || !ctx.inRound || ctx.building.structures[draft.structureId] === undefined) return;
    const invalid = draftInvalidReason(draft);
    if (invalid !== null) {
      this.showFeedback({ kind: "rejected", message: invalid, structureId: draft.structureId });
      return;
    }
    this.sendDraft(draft);
  }

  /**
   * Sends the canonical difference between the applied state and the draft:
   * a single `reset` when the draft is the default form, the ramp variant
   * change, or the tile changes (restores before removals, so no
   * intermediate state is less solid than the target), then `confirm`. The
   * draft is shown optimistically until every result arrives.
   */
  private sendDraft(draft: EditDraft): void {
    const id = draft.structureId;
    const applied = this.pendingStateFor(id, draft.buildType);
    const actions = editDiffActions(draft.buildType, applied, draft.state);
    if (actions.length === 0) {
      return;
    }
    actions.push({ action: "confirm" });
    for (const action of actions) {
      this.network.send(EDIT_GRID_ACTION_MESSAGE, { structureId: id, ...action });
    }
    this.optimistic.set(id, cloneEditState(draft.state));
    this.unacked.set(id, (this.unacked.get(id) ?? 0) + actions.length);
    this.lastAction.set(id, "confirm");
    this.latency?.recordEditSent(id);
  }

  private dropDraft(): void {
    this.draft = null;
    this.hover = null;
    if (this.drag.isDragging()) this.drag.release();
  }

  // ── state convergence ─────────────────────────────────────────────────────

  /**
   * The applied edit state for one structure: optimistic while actions are
   * in flight, otherwise the last authoritative state (or the default form
   * when the piece has never been edited).
   */
  private pendingStateFor(structureId: string, buildType: StructureState["buildType"] = "wall"): StructureEditState {
    if ((this.unacked.get(structureId) ?? 0) > 0) {
      const optimistic = this.optimistic.get(structureId);
      if (optimistic !== undefined) return optimistic;
    }
    return this.authStates.get(structureId) ?? createDefaultEditState(buildType);
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
    this.lastAction.delete(structureId);
    this.pendingEditMesh.delete(structureId);
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
    if (!parsed.success) {
      // Rejection: drop the optimistic result at once — the preview rolls
      // back to the authoritative state.
      this.optimistic.delete(id);
    }
    if (remaining <= 0) {
      this.unacked.delete(id);
      this.optimistic.delete(id); // applied state falls back to authoritative
      if (parsed.success) {
        // The applied state now shows the authoritative result on the
        // next frame — resolve the mesh latency measurement then.
        this.pendingEditMesh.add(id);
      }
    } else {
      this.unacked.set(id, remaining);
    }

    if (parsed.success) {
      if (remaining > 0) return; // one banner per confirmed edit
      this.latency?.recordEditResult(id, true);
      const action = this.lastAction.get(id);
      if (action === "confirm") {
        this.showFeedback({
          kind: "accepted",
          message: "Edit confirmed",
          structureId: id,
        });
      }
      return;
    }

    this.latency?.recordEditResult(id, false);
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
   * Drops the preview + feedback + local draft. Called when the player
   * exits edit mode outside the key path (e.g. a forced transition).
   */
  public cancel(): void {
    if (this.disposed) {
      return;
    }
    this.target = null;
    this.feedback = null;
    this.feedbackUntil = 0;
    this.dropDraft();
  }

  /**
   * Full reset for a round reset / rematch: exits edit mode without applying
   * the draft, drops the preview, feedback, and every pending cache. The
   * authoritative structure mirror (owned by the building system) is reset
   * separately by the runtime.
   */
  public reset(): void {
    if (this.disposed) {
      return;
    }
    this.input.exitEditMode();
    this.input.consumeEditExit();
    this.mode = false;
    this.target = null;
    this.feedback = null;
    this.feedbackUntil = 0;
    this.dropDraft();
    this.authStates.clear();
    this.optimistic.clear();
    this.unacked.clear();
    this.lastAction.clear();
    this.pendingEditMesh.clear();
    this.latency?.reset();
  }

  /**
   * Clears preview + feedback + pending caches and exits edit mode (without
   * applying the draft) when the connection drops, so a stale selection,
   * optimistic state, or feedback can never persist.
   */
  public clearOnDisconnect(): void {
    if (this.disposed) {
      return;
    }
    this.input.exitEditMode();
    this.input.consumeEditExit();
    this.mode = false;
    this.target = null;
    this.feedback = null;
    this.feedbackUntil = 0;
    this.dropDraft();
    this.authStates.clear();
    this.optimistic.clear();
    this.unacked.clear();
    this.lastAction.clear();
    this.pendingEditMesh.clear();
    this.latency?.clearInFlight();
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
    this.dropDraft();
    this.authStates.clear();
    this.optimistic.clear();
    this.unacked.clear();
    this.lastAction.clear();
    this.pendingEditMesh.clear();
  }
}

/** One `edit_grid_action` intent body (without the structure id). */
export type EditActionBody =
  | { action: "select" | "deselect"; tileIndex: number }
  | { action: "select"; rampVariant: RampVariant }
  | { action: "deselect" | "reset" | "confirm" };

/**
 * The canonical intents that turn `applied` into `target` (excluding the
 * final `confirm`): `[]` when they are equal; a single `reset` when `target`
 * is the default form; for ramps the variant change; for tiles every restore
 * (`deselect`) before every removal (`select`), so each intermediate state is
 * at least as solid as `target` (a valid target never passes through an
 * invalid floor form).
 */
export function editDiffActions(
  buildType: StructureState["buildType"],
  applied: StructureEditState,
  target: StructureEditState,
): EditActionBody[] {
  if (sameEditState(applied, target)) return [];
  if (sameEditState(createDefaultEditState(buildType), target)) return [{ action: "reset" }];
  if (target.kind === "ramp") {
    return target.variant === "full" ? [{ action: "deselect" }] : [{ action: "select", rampVariant: target.variant }];
  }
  if (applied.kind === "ramp" || applied.kind !== target.kind || applied.tiles.length !== target.tiles.length) {
    return [{ action: "reset" }, ...editDiffActions(buildType, createDefaultEditState(buildType), target)];
  }
  const restores: EditActionBody[] = [];
  const removals: EditActionBody[] = [];
  for (let i = 0; i < target.tiles.length; i++) {
    if (target.tiles[i] && !applied.tiles[i]) restores.push({ action: "deselect", tileIndex: i });
    if (!target.tiles[i] && applied.tiles[i]) removals.push({ action: "select", tileIndex: i });
  }
  return [...restores, ...removals];
}

/** Why a draft cannot be confirmed (mirrors the server's floor rule), else `null`. */
function draftInvalidReason(draft: EditDraft): string | null {
  if (draft.buildType === "floor" && draft.state.kind === "floor_cone" && !draft.state.tiles.some(Boolean)) {
    return REJECTION_LABELS.invalid_form!;
  }
  return null;
}

function cloneEditState(state: StructureEditState): StructureEditState {
  return state.kind === "ramp" ? { kind: "ramp", variant: state.variant } : { kind: state.kind, tiles: [...state.tiles] };
}

// ── pure helpers ────────────────────────────────────────────────────────────

/**
 * Structural equality of two edit states (the replicated mirror reparses
 * its objects on every state sync, so identity comparison is not enough).
 */
export function sameEditState(
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
