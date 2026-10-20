/**
 * buildingInputController — browser input for the build-mode keyboard
 * controls.
 *
 * Owns the *player intent* signals for building that live on the keyboard
 * (docs/TECHNICAL_ARCHITECTURE.md §9 "Client Owns ... Keyboard state, Mouse
 * state, Build ghost preview"), resolved through the shared gameplay
 * {@link ActionMap} (no literal key codes):
 *
 *  - `buildWall` / `buildFloor` / `buildRamp` / `buildCone` — dedicated
 *    build binds: select that piece **and** enter building in one press, from
 *    weapon, build, or edit mode (no mode key required first); each equip
 *    starts the piece facing the player's current direction (camera yaw via
 *    {@link BuildingInputController.setFacingSource}) and the rotation then
 *    stays locked — camera turns never change it,
 *  - `weaponSlot1` / `weaponSlot2` — leave building for weapon mode (the
 *    weapon switch itself is handled by the weapon input),
 *  - `buildRotateLeft` / `buildRotateRight` — rotate while building (the only
 *    post-equip rotation changes),
 *  - `buildToggle` — optional legacy build-mode toggle (never required).
 *
 * The shared left mouse button is NOT listened to here: its browser state is
 * owned by the centralized {@link InputManager} (movement/fire module), and
 * its build-mode meaning (placement press edge + held rapid placement) is
 * decided by the single {@link routePrimaryAction} policy. This keeps every
 * browser input signal in exactly one owner.
 *
 * All signals are only latched while the canvas holds browser pointer lock —
 * the same rule the movement/fire {@link InputManager} uses, so a stale key
 * can never produce a building intent after the pointer is released.
 * Releasing pointer lock (or hiding the tab) exits build mode, mirroring the
 * fire-input safety behaviour.
 *
 * The controller is a *pure intent source*: it reports state but never talks
 * to the network and never decides placement validity. The
 * {@link BuildingController} consumes these signals.
 *
 * Testability: the event targets (window / document) are injectable via
 * {@link BuildingInputEnvironment} so unit tests can drive the controller
 * without a real DOM.
 */
import { facingPlacementRotation } from "@buildshift/game-config";
import type { BuildType, GridRotation } from "@buildshift/protocol";
import type { InteractionModeCoordinator } from "../input/interactionMode";
import { ActionMap, BUILD_PIECE_ACTIONS, DEFAULT_ACTION_BINDINGS, attachMouseBindPresses, pressedBindingCode } from "../input/actionBindings";

/** The default key of the optional legacy build-mode toggle. */
export const BUILD_MODE_TOGGLE_KEY = DEFAULT_ACTION_BINDINGS.buildToggle[0]!;

/** Default dedicated build binds → build types (derived from the action map). */
export const BUILD_TYPE_KEYS: Readonly<Record<string, BuildType>> = Object.freeze(
  Object.fromEntries(BUILD_PIECE_ACTIONS.flatMap(([action, type]) => DEFAULT_ACTION_BINDINGS[action].map((code) => [code, type]))),
);

/** The default key that rotates the placement counter-clockwise. */
export const ROTATE_LEFT_KEY = DEFAULT_ACTION_BINDINGS.buildRotateLeft[0]!;

/** Build-piece action → build type. */
const BUILD_PIECE_TYPE: Readonly<Record<(typeof BUILD_PIECE_ACTIONS)[number][0], BuildType>> =
  Object.fromEntries(BUILD_PIECE_ACTIONS) as Record<(typeof BUILD_PIECE_ACTIONS)[number][0], BuildType>;

/** The default key that rotates the placement clockwise (build mode only). */
export const ROTATE_RIGHT_KEY = DEFAULT_ACTION_BINDINGS.buildRotateRight[0]!;

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
    pointerLockTarget: document,
    visibilityTarget: document,
    getPointerLockElement: () => document.pointerLockElement,
    isHidden: () => document.hidden,
  };
}

/**
 * Owns the build-mode keyboard/mouse intent signals.
 *
 * Mode ownership: when constructed with a shared `InteractionModeCoordinator`,
 * the build binds drive the coordinator (not a private flag) and
 * `isBuildModeActive()` reports the coordinator's effective mode — so build
 * and edit can never be "active" at once. Without a coordinator the controller
 * keeps its own flag (used by standalone unit tests). The coordinator is a
 * pure state machine with no listeners of its own.
 */
export class BuildingInputController {
  private readonly canvas: HTMLCanvasElement;
  private readonly env: BuildingInputEnvironment;
  private buildModeActive = false;
  private selectedBuildType: BuildType = "wall";
  private rotation: GridRotation = 0;
  /** The player's current facing yaw (camera), read once per piece EQUIP. */
  private facingYaw: (() => number) | null = null;
  private readonly detachMouseBinds: () => void;
  private disposed = false;
  private readonly mode: InteractionModeCoordinator | null;
  private readonly actions: ActionMap;

  public constructor(
    canvas: HTMLCanvasElement,
    env?: BuildingInputEnvironment,
    mode?: InteractionModeCoordinator,
    actions?: ActionMap,
  ) {
    this.canvas = canvas;
    this.env = env ?? defaultBuildingInputEnvironment(canvas);
    this.mode = mode ?? null;
    this.actions = actions ?? new ActionMap();
    this.env.keyTarget.addEventListener("keydown", this.handleKeyDown);
    // Mouse binds (e.g. the side buttons) drive the same actions as keys.
    this.detachMouseBinds = attachMouseBindPresses(this.env.keyTarget, (code) => this.handleKeyDown({ code, repeat: false }));
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
   * Effective build-mode state. With a shared coordinator this is the
   * coordinator's topmost mode (build is inactive while the edit layer is on
   * top), so the controller never places while editing. Without a
   * coordinator it is the local flag (legacy behavior).
   */
  public isBuildModeActive(): boolean {
    return this.mode ? this.mode.isBuildActive() : this.buildModeActive;
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
   * The source of the player's facing yaw (the camera yaw). Each piece equip
   * initializes the selected rotation from it (shared
   * `facingPlacementRotation`); camera turns afterwards never change it.
   */
  public setFacingSource(yaw: () => number): void {
    this.facingYaw = yaw;
  }

  private initRotationFromFacing(): void {
    if (!this.facingYaw) return;
    const yaw = this.facingYaw();
    if (Number.isFinite(yaw)) this.rotation = facingPlacementRotation(this.selectedBuildType, yaw) as GridRotation;
  }

  /** Removes all listeners and drops every latched intent. */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.env.keyTarget.removeEventListener("keydown", this.handleKeyDown);
    this.detachMouseBinds();
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
    const code = pressedBindingCode(event);
    if (code === null) {
      return;
    }
    // Gameplay building intent only while the canvas holds pointer lock —
    // the same rule as movement and fire, so browser UI interaction never
    // produces intents.
    if (!this.isPointerLocked()) {
      return;
    }

    for (const action of this.actions.actionsFor(code)) {
      switch (action) {
        case "buildToggle":
          if (this.mode) this.mode.toggleBuild();
          else this.buildModeActive = !this.buildModeActive;
          if (this.isBuildModeActive()) this.initRotationFromFacing();
          break;
        case "buildWall":
        case "buildFloor":
        case "buildRamp":
        case "buildCone":
          // One press: piece + build layer. The routed primary hold keeps
          // placing with the new piece if the button is already down.
          this.selectedBuildType = BUILD_PIECE_TYPE[action];
          // Equip: the piece starts facing where the player looks, then stays
          // locked — only the rotate binds change it until the next equip.
          this.initRotationFromFacing();
          if (this.mode) this.mode.selectBuild();
          else this.buildModeActive = true;
          break;
        case "weaponSlot1":
        case "weaponSlot2":
          if (this.mode) this.mode.selectWeapon();
          else this.buildModeActive = false;
          break;
        case "buildRotateLeft":
          if (this.isBuildModeActive()) this.rotation = ((this.rotation + 3) % 4) as GridRotation;
          break;
        case "buildRotateRight":
          if (this.isBuildModeActive()) this.rotation = ((this.rotation + 1) % 4) as GridRotation;
          break;
        default:
          break;
      }
    }
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
   * lock release and hidden-tab transitions — so a stale key can never
   * fire a build after the player is no longer "in" the game view.
   */
  private clearIntents(): void {
    if (this.mode) {
      this.mode.clearAll();
      return;
    }
    this.buildModeActive = false;
  }
}
