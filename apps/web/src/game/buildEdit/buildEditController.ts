/**
 * buildEditController — the presentation-only client orchestrator for the
 * existing server-authoritative build-edit system.
 *
 * This wires the client's half of the canonical build-edit contract
 * (docs/TECHNICAL_ARCHITECTURE.md §24) for *editing* an already-placed
 * structure — as opposed to the {@link BuildingController}, which handles
 * *placing* new ones. It:
 *
 *  - selects the owned, editable structure the aim ray points at
 *    (presentation-only, via {@link selectTargetStructure});
 *  - tracks the player's chosen edit (door / window / half_top / half_bottom
 *    / clear) and keeps it clamped to what the targeted structure allows;
 *  - submits the edit intent over the canonical `build:edit_request`
 *    (`BUILD_EDIT_EVENTS.EDIT_REQUEST`) message; and
 *  - turns the authoritative `build:edit_result`
 *    (`BUILD_EDIT_EVENTS.EDIT_RESULT`) broadcast into accepted/rejected
 *    feedback for the HUD, and reports edit-mode enter/exit transitions as
 *    brief informational banners;
 *
 * Authority contract: this controller NEVER edits structures on its own
 * authority. It sends *intents* and consumes the server's result. The
 * resulting structure state (including its `editType`) is carried by the
 * replicated room state — this controller does not write to the building
 * mirror, structure health, ownership, or any other gameplay rule. Its
 * preview + feedback are presentation state only, and are cleaned up on
 * cancellation, round reset, rematch, disconnect, and dispose.
 */
import {
  BUILD_EDIT_EVENTS,
  BUILD_EDIT_TYPES,
  isBuildEditType,
  type BuildEditType,
  type BuildingState,
} from "@buildshift/protocol";
import {
  BUILD_RANGE,
  isBuildEditAllowedForStructure,
} from "@buildshift/game-config";
import type { BuildEditInputController, BuildEditSelection } from "./buildEditInputController";
import {
  selectTargetStructure,
  type TargetedStructure,
  type Vec3Like,
} from "./structureSelection";

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
  /** The local player's feet position (unused by selection, kept for parity). */
  playerPosition: Vec3Like;
  /** The authoritative structure mirror (server truth only). */
  building: BuildingState;
  /** The local session id (for ownership filtering), or `null` when unknown. */
  sessionId: string | null;
  /** Whether the canonical network connection is live. */
  connected: boolean;
}

/** The authoritative build-edit result, parsed defensively off the wire. */
export interface BuildEditResultInfo {
  structureId: string;
  success: boolean;
  reason?: string;
  /** The edit the server confirmed ("" when the opening was cleared). */
  editType?: string;
}

/** Accepted/rejected/informational feedback shown (briefly) in the HUD. */
export interface BuildEditFeedback {
  kind: "accepted" | "rejected" | "info";
  message: string;
  /** Set for accepted/rejected feedback tied to a structure. */
  structureId?: string;
}

/**
 * The maximum distance (metres) from the camera at which an owned structure
 * is selectable. Reuses the shared placement range so edit selection and
 * placement share one interaction-radius constant.
 */
export const BUILD_EDIT_RANGE = BUILD_RANGE.maxPlacementDistance;

/** How long (ms) an accepted/rejected feedback banner stays on screen. */
const FEEDBACK_TTL_MS = 3000;

/** How long (ms) an edit-mode enter/exit (info) banner stays on screen. */
const MODE_FEEDBACK_TTL_MS = 2000;

/** Short, human-readable labels for edits confirmed by an accepted result. */
const EDIT_TYPE_LABELS: Readonly<Record<string, string>> = {
  door: "Door",
  window: "Window",
  half_top: "Top half",
  half_bottom: "Bottom half",
};

/** A short, human-readable label per authoritative rejection reason. */
const REJECTION_LABELS: Readonly<Record<string, string>> = {
  not_owned: "Not your structure",
  structure_not_found: "Structure not found",
  invalid_structure_state: "Structure not intact",
  edit_type_not_allowed: "Edit not allowed here",
  invalid_player_state: "Editing unavailable now",
  invalid_pattern: "Edit not allowed here",
  invalid_cell: "Edit not allowed here",
};

/**
 * The client build-edit orchestrator (presentation-only).
 */
export class BuildEditController {
  private readonly input: BuildEditInputController;
  private readonly network: BuildEditNetworkLike;
  private readonly now: () => number;
  private readonly unsubscribeResult: () => void;

  private disposed = false;
  private mode = false;
  private selectedEdit: BuildEditSelection = "door";
  private target: TargetedStructure | null = null;
  private feedback: BuildEditFeedback | null = null;
  private feedbackUntil = 0;

  public constructor(
    input: BuildEditInputController,
    network: BuildEditNetworkLike,
    now?: () => number,
  ) {
    this.input = input;
    this.network = network;
    this.now = now ?? (() => performance.now());
    this.unsubscribeResult = network.onEvent(
      BUILD_EDIT_EVENTS.EDIT_RESULT,
      (payload) => this.handleResult(payload),
    );
  }

  // ── state accessors (for the HUD layer) ──────────────────────────────────

  /** True while the player is in build-edit mode. */
  public getMode(): boolean {
    return this.mode;
  }

  /** The currently chosen edit (door / window / half_top / half_bottom / clear). */
  public getSelectedEdit(): BuildEditSelection {
    return this.selectedEdit;
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
   * The build-edit types the shared config allows on the targeted structure's
   * build type (e.g. all four on a wall). Empty when no structure is
   * targeted or it supports no edits.
   */
  public allowedEdits(): BuildEditType[] {
    if (!this.target) {
      return [];
    }
    return supportedEditsFor(this.target.buildType);
  }

  // ── per-frame update ──────────────────────────────────────────────────────

  /**
   * Drives the build-edit system for one render frame:
   *
   *  1. expires stale feedback,
   *  2. mirrors the input controller's edit-mode state, reporting a
   *     genuine enter/exit transition to the HUD (and clearing the
   *     preview when the mode turns off),
   *  3. resolves the aim target,
   *  4. applies any latched edit choice (clamped to the target's allowed set),
   *  5. submits the edit intent when an apply press is latched and connected.
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

    // 2. mirror edit mode; report user enter/exit transitions to the HUD.
    //    A forced exit (round reset / disconnect) sets this.mode directly in
    //    reset()/clearOnDisconnect(), so it is never observed as a transition
    //    here and never produces a banner.
    const nextMode = this.input.isEditModeActive();
    if (nextMode !== this.mode) {
      this.mode = nextMode;
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

    // 3. resolve the aim target (only while in edit mode with a known id).
    if (this.mode && ctx.sessionId !== null) {
      this.target = selectTargetStructure({
        aimOrigin: ctx.aimOrigin,
        aimDirection: ctx.aimDirection,
        maxRange: BUILD_EDIT_RANGE,
        building: ctx.building,
        ownerId: ctx.sessionId,
        isEligible: (s) => supportedEditsFor(s.buildType).length > 0,
      });
    } else {
      this.target = null;
    }

    // 4. apply any latched edit choice, then clamp to the target's allowed set.
    const chosen = this.input.consumeEditSelection();
    if (chosen !== null) {
      this.selectedEdit = chosen;
    }
    if (this.target !== null) {
      this.selectedEdit = clampSelection(this.target, this.selectedEdit);
    }

    // 5. submit the edit intent on a latched apply press (only when connected).
    if (
      this.input.consumeApplyPressed() &&
      this.mode &&
      this.target !== null &&
      ctx.connected
    ) {
      this.requestEdit(ctx);
    }

    return this.target;
  }

  // ── intent submission ─────────────────────────────────────────────────────

  /**
   * Submits the edit intent for the current (clamped) selection over the
   * canonical `build:edit_request` message. Returns the submitted intent, or
   * `null` when there is nothing to edit or the send could not be made.
   *
   * The server remains authoritative: the edit is only real once the server
   * broadcasts `build:edit_result` (and the replicated state carries the
   * updated structure).
   */
  public requestEdit(
    ctx: Pick<BuildEditFrameContext, "connected">,
  ): { structureId: string; editType: string } | null {
    if (this.disposed || !this.mode || this.target === null || !ctx.connected) {
      return null;
    }
    const editType = this.selectedEdit === "clear" ? "" : this.selectedEdit;
    const structureId = this.target.structureId;
    const sent = this.network.send(BUILD_EDIT_EVENTS.EDIT_REQUEST, {
      structureId,
      editType,
    });
    return sent ? { structureId, editType } : null;
  }

  // ── authoritative result consumption ──────────────────────────────────────

  private handleResult(payload: unknown): void {
    if (this.disposed) {
      return;
    }
    const parsed = parseBuildEditResult(payload);
    if (parsed === null) {
      return;
    }
    this.feedback = {
      kind: parsed.success ? "accepted" : "rejected",
      message: buildFeedbackMessage(parsed),
      structureId: parsed.structureId,
    };
    this.feedbackUntil = this.now() + FEEDBACK_TTL_MS;
  }

  // ── cleanup triggers (presentation-only) ──────────────────────────────────

  /**
   * Drops the preview + feedback. Called when the player cancels out of edit
   * mode (in addition to the per-frame mode clearing).
   */
  public cancel(): void {
    if (this.disposed) {
      return;
    }
    this.target = null;
    this.feedback = null;
    this.feedbackUntil = 0;
  }

  /**
   * Full reset for a round reset / rematch: exits edit mode, drops the
   * preview and feedback, and returns the selection to its default. The
   * authoritative structure mirror (owned by the building system) is reset
   * separately by the runtime.
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
    this.selectedEdit = "door";
  }

  /**
   * Clears preview + feedback and exits edit mode without dropping the
   * connection. Called when the connection drops so a stale selection or
   * feedback can never persist.
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
  }

  /** Unsubscribes from server events. Safe to call multiple times. */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.unsubscribeResult();
    this.mode = false;
    this.target = null;
    this.feedback = null;
  }
}

/**
 * The build-edit types the shared config allows on a structure build type, in
 * the canonical `BUILD_EDIT_TYPES` order (empty when none are allowed).
 */
export function supportedEditsFor(buildType: string): BuildEditType[] {
  return (BUILD_EDIT_TYPES as readonly string[]).filter(
    (t) => isBuildEditAllowedForStructure(t as BuildEditType, buildType),
  ) as BuildEditType[];
}

/**
 * Clamps a chosen edit to one the targeted structure allows. `clear` is always
 * allowed; a specific edit that the structure does not support falls back to
 * the first allowed edit so the preview always reflects an applicable edit.
 */
function clampSelection(
  target: TargetedStructure,
  selection: BuildEditSelection,
): BuildEditSelection {
  if (selection === "clear") {
    return "clear";
  }
  const allowed = supportedEditsFor(target.buildType);
  if (allowed.length === 0) {
    return "clear";
  }
  if (allowed.includes(selection)) {
    return selection;
  }
  return allowed[0];
}

/**
 * Defensively parses a `build:edit_result` payload off the wire. Returns
 * `null` for malformed payloads so a corrupt event can never set feedback.
 */
export function parseBuildEditResult(
  payload: unknown,
): BuildEditResultInfo | null {
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
  const rawEditType = r.editType;
  const editType =
    typeof rawEditType === "string" &&
    (rawEditType === "" || isBuildEditType(rawEditType))
      ? rawEditType
      : undefined;
  return {
    structureId: r.structureId,
    success: r.success,
    ...(typeof r.reason === "string" ? { reason: r.reason } : {}),
    ...(editType !== undefined ? { editType } : {}),
  };
}

/** Builds the short feedback banner text for a parsed build-edit result. */
function buildFeedbackMessage(result: BuildEditResultInfo): string {
  if (result.success) {
    // The canonical room echoes the applied edit on success; name it so the
    // banner confirms exactly what changed.
    if (result.editType === "") {
      return "Opening cleared";
    }
    if (result.editType !== undefined) {
      return `Edit applied: ${EDIT_TYPE_LABELS[result.editType] ?? result.editType}`;
    }
    return "Edit applied";
  }
  if (result.reason !== undefined && result.reason in REJECTION_LABELS) {
    return REJECTION_LABELS[result.reason]!;
  }
  return "Edit rejected";
}
