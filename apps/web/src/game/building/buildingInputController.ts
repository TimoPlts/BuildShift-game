/**
 * buildingInputController — browser input for the build-mode controls.
 *
 * Owns the *player intent* signals for building (docs/TECHNICAL_ARCHITECTURE.md
 * §9 "Client Owns ... Keyboard state, Mouse state, Build ghost preview"):
 *
 *  - `B`            toggle build mode on/off
 *  - `1` / `2` / `3` / `4`   select wall / floor / ramp / cone
 *  - `Q` / `E`      rotate the selected placement (counter-clockwise / clockwise)
 *  - left mouse button (while in build mode)   place-structure intent edge
 *
 * All signals are only latched while the canvas holds browser pointer lock —
 * the same rule the movement/fire {@link InputManager} uses, so a stale key
 * or click can never produce a building intent after the pointer is
 * released. Releasing pointer lock (or hiding the tab) exits build mode and
 * drops any pending place press, mirroring the fire-input safety behaviour.
 *
 * The controller is a *pure intent source*: it reports state and edges but
 * never talks to the network and never decides placement validity. The
 * {@link BuildingController} consumes these signals.
 *
 * Testability: the event targets (window / document) are injectable via
 * {@link BuildingInputEnvironment} so unit tests can drive the controller
 * without a real DOM.
 */
import type { BuildType, GridRotation } from "@buildshift/protocol";

/** The key that toggles build mode. */
export const BUILD_MODE_TOGGLE_KEY = "KeyB";

/** Maps number-row keys to build types (1=wall, 2=floor, 3=ramp, 4=cone). */
export const BUILD_TYPE_KEYS: Readonly<Record<string, BuildType>> = {
  Digit1: "wall",
  Digit2: "floor",
  Digit3: "ramp",
  Digit4: "cone",
};

/** The key that rotates the placement counter-clockwise. */
export const ROTATE_LEFT_KEY = "KeyQ";

/** The key that rotates the placement clockwise. */
export const ROTATE_RIGHT_KEY = "KeyE";

/** The minimum building-input event shape the controller reads. */
interface KeyboardLikeEvent {
  code: string;
  repeat: boolean;
}

interface MouseLikeEvent {
  button: number;
}

/** A minimal DOM event target (window or document). */
export interface InputEventTarget {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

/**
 * The DOM surface the controller binds to. In production this is the real
 * `window` + `document`; tests substitute fakes.
 */
export interface BuildingInputEnvironment {
  /** Receives `keydown` / `keyup` (normally `window`). */
  readonly keyTarget: InputEventTarget;
  /** Receives `mousedown` (normally `window`). */
  readonly mouseTarget: InputEventTarget;
  /** Receives `pointerlockchange` (normally `document`). */
  readonly pointerLockTarget: InputEventTarget;
  /** Receives `visibilitychange` (normally `document`). */
  readonly visibilityTarget: InputEventTarget;
  /** Reports the current pointer-lock element (normally `document.pointerLockElement`). */
  getPointerLockElement(): Element | null;
  /** Reports whether the page is hidden (normally `document.hidden`). */
  isHidden(): boolean;
}

/** The real-browser environment. The canvas parameter is accepted for API symmetry. */
export function defaultBuildingInputEnvironment(
  _canvas: HTMLCanvasElement,
): BuildingInputEnvironment {
  return {
    keyTarget: window,
    mouseTarget: window,
    pointerLockTarget: document,
    visibilityTarget: document,
    getPointerLockElement: () => document.pointerLockElement,
    isHidden: () => document.hidden,
  };
}

/**
 * Owns the build-mode keyboard/mouse intent signals.
 */
export class BuildingInputController {
  private readonly canvas: HTMLCanvasElement;
  private readonly env: BuildingInputEnvironment;
  private buildModeActive = false;
  private selectedBuildType: BuildType = "wall";
  private rotation: GridRotation = 0;
  /** Latched place-press edge, pending the next frame's poll. */
  private placePressed = false;
  private disposed = false;

  public constructor(
    canvas: HTMLCanvasElement,
    env?: BuildingInputEnvironment,
  ) {
    this.canvas = canvas;
    this.env = env ?? defaultBuildingInputEnvironment(canvas);
    this.env.keyTarget.addEventListener("keydown", this.handleKeyDown);
    this.env.mouseTarget.addEventListener("mousedown", this.handleMouseDown);
    this.env.pointerLockTarget.addEventListener(
      "pointerlockchange",
      this.handlePointerLockChange,
    );
    this.env.visibilityTarget.addEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );
  }

  /** True while build mode is active (the placement preview is presented). */
  public isBuildModeActive(): boolean {
    return this.buildModeActive;
  }

  /** The currently selected build type (wall / floor / ramp / cone). */
  public getSelectedBuildType(): BuildType {
    return this.selectedBuildType;
  }

  /** The currently selected cardinal rotation (0–3). */
  public getRotation(): GridRotation {
    return this.rotation;
  }

  /**
   * Returns whether a place press (left-click while in build mode) is
   * pending, and clears the latch. Polled once per render frame by the
   * runtime — never inside the key/mouse handlers, so a press can never be
   * consumed before a frame actually runs.
   */
  public consumePlacePressed(): boolean {
    const pressed = this.placePressed;
    this.placePressed = false;
    return pressed;
  }

  /** Removes all listeners and drops every latched intent. */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.env.keyTarget.removeEventListener("keydown", this.handleKeyDown);
    this.env.mouseTarget.removeEventListener("mousedown", this.handleMouseDown);
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
    // Gameplay building intent only while the canvas holds pointer lock —
    // the same rule as movement and fire, so browser UI interaction never
    // produces intents.
    if (!this.isPointerLocked()) {
      return;
    }

    if (e.code === BUILD_MODE_TOGGLE_KEY) {
      this.buildModeActive = !this.buildModeActive;
      return;
    }
    const type = BUILD_TYPE_KEYS[e.code];
    if (type !== undefined) {
      this.selectedBuildType = type;
      return;
    }
    if (e.code === ROTATE_LEFT_KEY) {
      this.rotation = ((this.rotation + 3) % 4) as GridRotation;
      return;
    }
    if (e.code === ROTATE_RIGHT_KEY) {
      this.rotation = ((this.rotation + 1) % 4) as GridRotation;
    }
  };

  private readonly handleMouseDown = (event: unknown): void => {
    if (this.disposed) {
      return;
    }
    const e = event as MouseLikeEvent;
    if (e?.button !== 0) {
      return;
    }
    // The place edge only latches while pointer-locked AND in build mode —
    // outside build mode the left button belongs to the fire input.
    if (!this.isPointerLocked() || !this.buildModeActive) {
      return;
    }
    this.placePressed = true;
  };

  private readonly handlePointerLockChange = (): void => {
    // Any pointer-lock change that is not "locked to our canvas" means the
    // player is out of the gameplay view: drop every latched intent and
    // exit build mode (mirrors InputManager.clearInput safety).
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
   * Drops every latched intent and exits build mode. Triggered by pointer
   * lock release and hidden-tab transitions — so a stale click or key can
   * never fire a build after the player is no longer "in" the game view.
   */
  private clearIntents(): void {
    this.buildModeActive = false;
    this.placePressed = false;
  }
}
