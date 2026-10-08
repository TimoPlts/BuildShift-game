/**
 * buildEditInputController — browser input for the build-edit controls.
 *
 * Owns the *player intent* signals for editing a placed structure (the
 * presentation half of build editing). It is a pure intent source: it reports
 * state and edges but never talks to the network, never validates edit
 * legality, and never creates/edits structures. The {@link BuildEditController}
 * consumes these signals.
 *
 * Controls (all latched only while the canvas holds pointer lock, mirroring
 * the building / movement / fire input safety rules):
 *
 *  - `F`                toggle build-edit mode on/off
 *  - `5` / `6` / `7` / `8` / `9`   choose door / window / half_top /
 *                                  half_bottom / clear (the number row is
 *                                  free here; 1–4 are build-type + weapon keys)
 *  - `Enter`            apply the chosen edit to the aimed, owned structure
 *
 * Releasing pointer lock (or hiding the tab) exits edit mode and drops every
 * latched intent, so a stale key can never produce an edit intent after the
 * player is no longer in the gameplay view.
 *
 * Testability: the event targets are injectable via
 * {@link BuildEditInputEnvironment} so unit tests can drive the controller
 * without a real DOM.
 */
import type { BuildEditType } from "@buildshift/protocol";

/** The key that toggles build-edit mode. */
export const EDIT_MODE_TOGGLE_KEY = "KeyF";

/** The key that applies the chosen edit to the targeted structure. */
export const APPLY_EDIT_KEY = "Enter";

/** A build-edit choice: an opening edit, or `clear` to remove the opening. */
export type BuildEditSelection = BuildEditType | "clear";

/**
 * Maps number-row keys to the build-edit choices the client can select.
 *
 * `5`–`8` select the four opening edits (`door` / `window` / `half_top` /
 * `half_bottom`); `9` clears the structure's opening. The number row is
 * reused (not `1`–`4`, which are the build-type and weapon-switch keys) so
 * edit intent never collides with placement or weapon intent.
 */
export const EDIT_TYPE_KEYS: Readonly<Record<string, BuildEditSelection>> = {
  Digit5: "door",
  Digit6: "window",
  Digit7: "half_top",
  Digit8: "half_bottom",
  Digit9: "clear",
};

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
 * Owns the build-edit keyboard intent signals.
 */
export class BuildEditInputController {
  private readonly canvas: HTMLCanvasElement;
  private readonly env: BuildEditInputEnvironment;
  private editModeActive = false;
  /** Latched edit choice, pending the next frame's poll (or `null`). */
  private editSelection: BuildEditSelection | null = null;
  /** Latched apply-press edge, pending the next frame's poll. */
  private applyPressed = false;
  private disposed = false;

  public constructor(
    canvas: HTMLCanvasElement,
    env?: BuildEditInputEnvironment,
  ) {
    this.canvas = canvas;
    this.env = env ?? defaultBuildEditInputEnvironment(canvas);
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

  /** True while build-edit mode is active (the selection preview is presented). */
  public isEditModeActive(): boolean {
    return this.editModeActive;
  }

  /**
   * Returns the latched edit choice and clears it, or `null` when none is
   * pending. Polled once per render frame — never inside the key handler, so
   * a press is never consumed before a frame actually runs.
   */
  public consumeEditSelection(): BuildEditSelection | null {
    const selection = this.editSelection;
    this.editSelection = null;
    return selection;
  }

  /**
   * Returns whether an apply press is pending, and clears the latch. Polled
   * once per render frame by the controller.
   */
  public consumeApplyPressed(): boolean {
    const pressed = this.applyPressed;
    this.applyPressed = false;
    return pressed;
  }

  /**
   * Forces edit mode off and drops every latched intent. Called by the
   * controller on round reset / rematch / disconnect so a stale edit can
   * never survive a state transition (the pointer-lock path also clears
   * intents independently).
   */
  public exitEditMode(): void {
    if (this.disposed) {
      return;
    }
    this.clearIntents();
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

    if (e.code === EDIT_MODE_TOGGLE_KEY) {
      this.editModeActive = !this.editModeActive;
      return;
    }
    if (e.code === APPLY_EDIT_KEY) {
      // The apply edge only latches in edit mode (out of edit mode Enter has
      // no build meaning and is deliberately ignored).
      if (this.editModeActive) {
        this.applyPressed = true;
      }
      return;
    }
    const selection = EDIT_TYPE_KEYS[e.code];
    if (selection !== undefined && this.editModeActive) {
      this.editSelection = selection;
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
   * lock release and hidden-tab transitions — so a stale key can never fire
   * an edit after the player is no longer "in" the game view.
   */
  private clearIntents(): void {
    this.editModeActive = false;
    this.editSelection = null;
    this.applyPressed = false;
  }
}
