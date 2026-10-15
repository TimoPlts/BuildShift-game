/**
 * buildEditInputController — browser input for the piece-edit controls.
 *
 * Owns the *player intent* signals for editing a placed structure (the
 * presentation half of piece editing). It is a pure intent source: it
 * reports state and edges but never talks to the network, never validates
 * edit legality, and never creates/edits structures. The
 * {@link BuildEditController} consumes these signals.
 *
 * Controls (gameplay actions, resolved through the shared {@link ActionMap};
 * see `DEFAULT_ACTION_BINDINGS` for the default keys):
 *
 *  - `edit`         enter edit mode; pressed again while editing it confirms
 *                   (commit-exit back to the layer beneath)
 *  - `editConfirm`  confirm the edit (latched only in edit mode)
 *  - `editReset`    reset the pending edit to the default form (latched only
 *                   in edit mode; the controller previews it immediately)
 *  - `editCancel`   discard the pending edit (unbound by default)
 *  - leaving edit through a build-piece or weapon bind also commits the edit
 *
 * The crosshair tile selection itself comes from the shared left mouse
 * button. Its browser state is owned by the centralized {@link InputManager};
 * this controller adds **no** mouse listeners. The runtime routes the
 * primary-button press/hold into edit mode via the single
 * {@link routePrimaryAction} policy and feeds the routed values in through
 * {@link BuildEditInputController.latchEditSelect}, which derives the press
 * edge, the held state, and the release edge. Exactly one interaction owns
 * the button at a time (edit > build > weapon).
 *
 *  - Releasing pointer lock (or hiding the tab) exits edit mode and drops
 *    every latched intent, so a stale key or click can never produce an edit
 *    intent after the player is no longer in the gameplay view.
 *
 * Mode ownership: when constructed with a shared `InteractionModeCoordinator`,
 * the edit bind toggles the edit layer on the coordinator (not a private
 * flag) and `isEditModeActive()` reports the coordinator's effective mode — so
 * build and edit can never be "active" at once. Every exit is latched as a
 * commit or a discard ({@link consumeEditExit}):
 *   - {@link exitEditMode} / {@link cancelEditExit} discard (round reset,
 *     disconnect, cancel — the build layer beneath survives), and
 *   - {@link commitEditExit} commits and clears the build layer beneath it
 *     (confirm: the primary button is a combat action immediately).
 * Without a coordinator both fall back to the local flag (legacy behavior).
 * This controller's browser listeners are unchanged — the coordinator is a
 * pure state machine with none of its own.
 *
 * Testability: the event targets are injectable via
 * {@link BuildEditInputEnvironment} so unit tests can drive the controller
 * without a real DOM.
 */

import type { EditExitKind, InteractionModeCoordinator } from "../input/interactionMode";
import { ActionMap, DEFAULT_ACTION_BINDINGS } from "../input/actionBindings";

/** The key that toggles edit mode. */
export const EDIT_MODE_TOGGLE_KEY = DEFAULT_ACTION_BINDINGS.edit[0]!;

/** The key that confirms the edit. */
export const CONFIRM_EDIT_KEY = DEFAULT_ACTION_BINDINGS.editConfirm[0]!;

/** The key that cancels the edit (unbound by default: `null`). */
export const CANCEL_EDIT_KEY: string | null = DEFAULT_ACTION_BINDINGS.editCancel[0] ?? null;

/** The key that resets the pending edit to the piece's default form. */
export const RESET_EDIT_KEY = DEFAULT_ACTION_BINDINGS.editReset[0]!;

/** The minimum keyboard event shape the controller reads. */
interface KeyboardLikeEvent {
  code: string;
  repeat: boolean;
}

/** A minimal DOM event target (window or document). */
export interface InputEventTarget {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

/** The DOM surface the controller binds to (tests substitute fakes). */
export interface BuildEditInputEnvironment {
  /** Receives `keydown` (normally `window`). */
  readonly keyTarget: InputEventTarget;
  /** Receives `pointerlockchange` (normally `document`). */
  readonly pointerLockTarget: InputEventTarget;
  /** Receives `visibilitychange` (normally `document`). */
  readonly visibilityTarget: InputEventTarget;
  /** Reports the current pointer-lock element (identity-compared to the canvas). */
  getPointerLockElement(): unknown;
  /** Reports whether the page is hidden (normally `document.hidden`). */
  isHidden(): boolean;
}

/** The real-browser environment. The canvas parameter is accepted for API symmetry. */
export function defaultBuildEditInputEnvironment(
  _canvas: HTMLCanvasElement,
): BuildEditInputEnvironment {
  return {
    keyTarget: window,
    pointerLockTarget: document,
    visibilityTarget: document,
    getPointerLockElement: () => document.pointerLockElement,
    isHidden: () => document.hidden,
  };
}

/**
 * Owns the piece-edit intent signals (keyboard keys + the routed primary
 * button).
 */
export class BuildEditInputController {
  private readonly canvas: HTMLCanvasElement;
  private readonly env: BuildEditInputEnvironment;
  private editModeActive = false;
  /** Latched confirm press, pending the next frame's poll. */
  private confirmPressed = false;
  /** Latched cancel press, pending the next frame's poll. */
  private cancelPressed = false;
  /** Latched reset press, pending the next frame's poll. */
  private resetPressed = false;
  /** Latched primary-button select press edge (routed), pending a poll. */
  private selectPressed = false;
  /** Routed primary-button hold while in edit mode (tile painting). */
  private selectHeld = false;
  /** Latched primary-button release edge (routed), pending a poll. */
  private selectReleased = false;
  /**
   * The routed hold on the previous frame — used to derive the release
   * edge. Only tracked while edit mode is active, so a mode toggle never
   * produces a phantom release.
   */
  private prevSelectHeld = false;
  private disposed = false;
  private readonly mode: InteractionModeCoordinator | null;
  private readonly actions: ActionMap;
  /** How the edit layer was last left (standalone mode, no coordinator). */
  private localExit: EditExitKind | null = null;

  public constructor(
    canvas: HTMLCanvasElement,
    env?: BuildEditInputEnvironment,
    mode?: InteractionModeCoordinator,
    actions?: ActionMap,
  ) {
    this.canvas = canvas;
    this.env = env ?? defaultBuildEditInputEnvironment(canvas);
    this.mode = mode ?? null;
    this.actions = actions ?? new ActionMap();
    this.env.keyTarget.addEventListener("keydown", this.handleKeyDown);
    this.env.pointerLockTarget.addEventListener(
      "pointerlockchange",
      this.handlePointerLockChange,
    );
    this.env.visibilityTarget.addEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );
  }

  /**
   * Effective edit-mode state. With a shared coordinator this is the
   * coordinator's topmost mode (edit is the active layer only when it is on
   * top). Without a coordinator it is the local flag (legacy behavior).
   */
  public isEditModeActive(): boolean {
    return this.mode ? this.mode.isEditActive() : this.editModeActive;
  }

  /**
   * Feeds the routed primary-button state (from the runtime's single
   * {@link routePrimaryAction} decision) into the edit intents. Called once
   * per render frame; derives the press edge, the hold, and the release
   * edge. While pointer lock is released the controller clears every intent
   * instead, so a stale click can never produce a selection.
   */
  public latchEditSelect(pressed: boolean, held: boolean): void {
    if (this.disposed) {
      return;
    }
    if (!this.isPointerLocked()) {
      this.clearIntents();
      return;
    }
    if (!this.isEditModeActive()) {
      // Out of edit mode the primary button belongs to another layer; keep
      // the edge bookkeeping flat so re-entering never emits a phantom
      // press/release.
      this.selectPressed = false;
      this.selectHeld = false;
      this.selectReleased = false;
      this.prevSelectHeld = false;
      return;
    }
    this.selectPressed = this.selectPressed || pressed;
    this.selectHeld = held;
    this.selectReleased = this.prevSelectHeld && !held;
    this.prevSelectHeld = held;
  }

  /**
   * Returns the latched confirm press and clears it. Polled once per render
   * frame by the controller.
   */
  public consumeConfirmPressed(): boolean {
    const pressed = this.confirmPressed;
    this.confirmPressed = false;
    return pressed;
  }

  /** Returns the latched cancel press and clears it. */
  public consumeCancelPressed(): boolean {
    const pressed = this.cancelPressed;
    this.cancelPressed = false;
    return pressed;
  }

  /** Returns the latched reset press and clears it. */
  public consumeResetPressed(): boolean {
    const pressed = this.resetPressed;
    this.resetPressed = false;
    return pressed;
  }

  /**
   * Returns the latched primary select press edge and clears it. The hold
   * is read separately via {@link isEditSelectHeld} (it persists across
   * frames while the button stays down — the drag-paint behaviour).
   */
  public consumeEditSelectPressed(): boolean {
    const pressed = this.selectPressed;
    this.selectPressed = false;
    return pressed;
  }

  /** True while the routed primary button is held in edit mode. */
  public isEditSelectHeld(): boolean {
    return this.selectHeld;
  }

  /**
   * Returns the latched primary select release edge and clears it (used for
   * the optional confirm-on-release behaviour).
   */
  public consumeEditSelectReleased(): boolean {
    const released = this.selectReleased;
    this.selectReleased = false;
    return released;
  }

  /**
   * Clears only the edit layer (the build layer beneath it, if any, is kept)
   * and drops every latched intent. Called by the controller on round reset /
   * rematch / disconnect so the player's build context survives while a stale
   * edit intent can never survive a state transition (the pointer-lock path
   * also clears intents independently).
   */
  public exitEditMode(): void {
    if (this.disposed) {
      return;
    }
    if (this.mode) {
      this.mode.clearEdit();
    } else {
      this.leaveLocal("discard");
    }
    this.clearLatches();
  }

  /**
   * How the edit layer was left since the last call: `"commit"` (the player
   * left through an action — the edit bind again, confirm, a build-piece or
   * weapon bind — so the edit is applied), `"discard"` (forced teardown or
   * cancel — the edit is dropped), or `null`.
   */
  public consumeEditExit(): EditExitKind | null {
    if (this.mode) return this.mode.consumeEditExit();
    const exit = this.localExit;
    this.localExit = null;
    return exit;
  }

  /**
   * Commit-exit from editing (confirm / cancel): clears the edit layer **and
   * the build layer beneath it**, returning to weapon mode so the primary
   * button and the number keys are combat actions immediately. Drops every
   * latched intent.
   */
  public commitEditExit(): void {
    if (this.disposed) {
      return;
    }
    if (this.mode) {
      this.mode.exitToWeapon();
    } else {
      this.leaveLocal("commit");
    }
    this.clearLatches();
  }

  /**
   * Cancel-exit from editing: drops the edit layer **without applying** the
   * pending edit (the build layer beneath survives) and every latched intent.
   */
  public cancelEditExit(): void {
    this.exitEditMode();
  }

  /** Removes all listeners and drops every latched intent. */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.env.keyTarget.removeEventListener("keydown", this.handleKeyDown);
    this.env.pointerLockTarget.removeEventListener(
      "pointerlockchange",
      this.handlePointerLockChange,
    );
    this.env.visibilityTarget.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );
    this.clearIntents();
  }

  // ── internal signal handling ─────────────────────────────────────────────

  private isPointerLocked(): boolean {
    return this.env.getPointerLockElement() === this.canvas;
  }

  private readonly handleKeyDown = (event: unknown): void => {
    if (this.disposed || this.env.isHidden()) {
      return;
    }
    const e = event as KeyboardLikeEvent;
    if (typeof e?.code !== "string" || e.repeat) {
      return;
    }
    // Edit intent only while the canvas holds pointer lock — the same rule as
    // movement, fire, and building, so browser UI interaction never produces
    // an edit intent.
    if (!this.isPointerLocked()) {
      return;
    }

    for (const action of this.actions.actionsFor(e.code)) {
      switch (action) {
        case "edit":
          if (this.mode) {
            this.mode.toggleEdit();
          } else if (this.editModeActive) {
            this.leaveLocal("commit");
          } else {
            this.editModeActive = true;
            this.localExit = null;
          }
          // Entering fresh: reset the hold bookkeeping so a button that was
          // already held from another layer never reads as a release edge.
          this.prevSelectHeld = false;
          this.selectReleased = false;
          break;
        // Standalone mode only (with a coordinator the building input routes
        // these binds): leaving edit through another bind commits the edit.
        case "buildWall":
        case "buildFloor":
        case "buildRamp":
        case "buildCone":
        case "weaponSlot1":
        case "weaponSlot2":
          if (!this.mode && this.editModeActive) this.leaveLocal("commit");
          break;
        // The terminal actions only latch in edit mode (out of edit mode they
        // have no build meaning and are deliberately ignored).
        case "editConfirm":
          if (this.isEditModeActive()) this.confirmPressed = true;
          break;
        case "editCancel":
          if (this.isEditModeActive()) this.cancelPressed = true;
          break;
        case "editReset":
          if (this.isEditModeActive()) this.resetPressed = true;
          break;
        default:
          break;
      }
    }
  };

  private readonly handlePointerLockChange = (): void => {
    // Any pointer-lock change that is not "locked to our canvas" means the
    // player is out of the gameplay view: drop every latched intent and exit
    // edit mode (mirrors BuildingInputController.clearIntents).
    if (!this.isPointerLocked()) {
      this.clearIntents();
    }
  };

  private readonly handleVisibilityChange = (): void => {
    if (this.env.isHidden()) {
      this.clearIntents();
    }
  };

  /**
   * Drops every latched intent and exits edit mode. Triggered by pointer
   * lock release, hidden-tab transitions, and forced exits — so a stale key
   * or click can never fire an edit after the player is no longer "in" the
   * game view.
   */
  private clearIntents(): void {
    if (this.mode) {
      this.mode.clearAll();
    } else {
      this.leaveLocal("discard");
    }
    this.clearLatches();
  }

  private leaveLocal(kind: EditExitKind): void {
    if (!this.editModeActive) return;
    this.editModeActive = false;
    if (this.localExit !== "discard") this.localExit = kind;
  }

  /** Drops the latched key/select intents (independent of the layer flags). */
  private clearLatches(): void {
    this.confirmPressed = false;
    this.cancelPressed = false;
    this.resetPressed = false;
    this.selectPressed = false;
    this.selectHeld = false;
    this.selectReleased = false;
    this.prevSelectHeld = false;
  }
}
