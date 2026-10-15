/**
 * Gameplay action map — the single place where physical inputs (keyboard
 * codes, mouse buttons) are bound to gameplay actions.
 *
 * Gameplay systems consume **actions** (`buildWall`, `edit`, `primaryAction`,
 * …), never literal `KeyW` / `KeyF` / mouse-button codes. The defaults below
 * are development defaults chosen for competitive building muscle memory
 * (dedicated build binds, a dedicated edit bind, contextual rotate/reload on
 * one key); an {@link ActionMap} can be rebound at runtime, which is the hook
 * a settings menu will use later.
 *
 * Binding codes: keyboard bindings use `KeyboardEvent.code` (`"KeyQ"`,
 * `"Digit1"`, `"Space"`, …); mouse bindings use `"Mouse<button>"`
 * (`"Mouse0"` = primary, `"Mouse2"` = secondary).
 *
 * One code may drive several actions (e.g. `KeyR` is `reload` in weapon mode
 * and `buildRotateRight` in build mode): consumers interpret an action only
 * in the mode where it is meaningful, so contextual binds never conflict.
 */

/** Every gameplay action a binding can drive. */
export const GAME_ACTIONS = [
  "moveForward",
  "moveBackward",
  "moveLeft",
  "moveRight",
  "jump",
  "crouch",
  "weaponSlot1",
  "weaponSlot2",
  "reload",
  "buildWall",
  "buildFloor",
  "buildRamp",
  "buildCone",
  "buildRotateLeft",
  "buildRotateRight",
  "buildToggle",
  "edit",
  "editSelect",
  "editConfirm",
  "editReset",
  "editCancel",
  "primaryAction",
] as const;

export type GameAction = (typeof GAME_ACTIONS)[number];

/** A physical input code: a `KeyboardEvent.code` or `"Mouse<button>"`. */
export type InputBindingCode = string;

/** The full binding table: each action → the codes that trigger it. */
export type ActionBindings = Readonly<Record<GameAction, readonly InputBindingCode[]>>;

/** The four dedicated build-piece actions, in HUD order, with their piece. */
export const BUILD_PIECE_ACTIONS = [
  ["buildWall", "wall"],
  ["buildFloor", "floor"],
  ["buildRamp", "ramp"],
  ["buildCone", "cone"],
] as const;

/**
 * Development default bindings. Kept here (config), not in the systems that
 * consume the actions.
 */
export const DEFAULT_ACTION_BINDINGS: ActionBindings = Object.freeze({
  moveForward: ["KeyW"],
  moveBackward: ["KeyS"],
  moveLeft: ["KeyA"],
  moveRight: ["KeyD"],
  jump: ["Space"],
  crouch: ["KeyC"],
  weaponSlot1: ["Digit1"],
  weaponSlot2: ["Digit2"],
  reload: ["KeyR"],
  buildWall: ["KeyQ"],
  buildFloor: ["KeyF"],
  buildRamp: ["KeyE"],
  buildCone: ["KeyZ"],
  buildRotateLeft: ["KeyX"],
  buildRotateRight: ["KeyR"],
  // Optional legacy toggle: never required (the piece binds enter building).
  buildToggle: ["KeyB"],
  // Pressing `edit` again while editing confirms (the edit layer's toggle).
  edit: ["KeyG"],
  editSelect: ["Mouse0"],
  editConfirm: ["Enter"],
  editReset: ["KeyT", "Backspace"],
  // Unbound by default: leaving edit through any action commits it.
  editCancel: [],
  primaryAction: ["Mouse0"],
});

/** The binding code for a mouse button (`0` → `"Mouse0"`). */
export function mouseBindingCode(button: number): InputBindingCode {
  return `Mouse${button}`;
}

/**
 * A resolvable, rebindable action map. Resolution is a precomputed
 * code → actions index, so per-event lookup is a single map read.
 */
export class ActionMap {
  private bindings: Record<GameAction, readonly InputBindingCode[]>;
  private index = new Map<InputBindingCode, GameAction[]>();
  private static readonly NONE: readonly GameAction[] = Object.freeze([]);

  public constructor(bindings: Partial<ActionBindings> = {}) {
    this.bindings = { ...DEFAULT_ACTION_BINDINGS, ...bindings } as Record<GameAction, readonly InputBindingCode[]>;
    this.rebuildIndex();
  }

  /** Every action bound to `code` (empty when unbound). */
  public actionsFor(code: InputBindingCode): readonly GameAction[] {
    return this.index.get(code) ?? ActionMap.NONE;
  }

  /** Whether `code` is bound to `action`. */
  public matches(action: GameAction, code: InputBindingCode): boolean {
    return this.bindings[action].includes(code);
  }

  /** The codes bound to `action`. */
  public bindingsFor(action: GameAction): readonly InputBindingCode[] {
    return this.bindings[action];
  }

  /** Replaces the bindings of one action (a settings-menu rebind). */
  public rebind(action: GameAction, codes: readonly InputBindingCode[]): void {
    this.bindings = { ...this.bindings, [action]: [...codes] };
    this.rebuildIndex();
  }

  /** A snapshot of the full binding table. */
  public snapshot(): ActionBindings {
    return { ...this.bindings };
  }

  private rebuildIndex(): void {
    const index = new Map<InputBindingCode, GameAction[]>();
    for (const action of GAME_ACTIONS) {
      for (const code of this.bindings[action] ?? []) {
        const list = index.get(code) ?? [];
        if (!list.includes(action)) list.push(action);
        index.set(code, list);
      }
    }
    this.index = index;
  }
}

/**
 * A short human-readable label for a binding code, for HUD hints
 * (`"KeyQ"` → `"Q"`, `"Digit1"` → `"1"`, `"Mouse0"` → `"LMB"`).
 */
export function bindingLabel(code: InputBindingCode | undefined): string {
  if (code === undefined) return "—";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "Mouse0") return "LMB";
  if (code === "Mouse1") return "MMB";
  if (code === "Mouse2") return "RMB";
  return code;
}

/** The HUD label of an action's first binding. */
export function actionLabel(action: GameAction, bindings: ActionBindings = DEFAULT_ACTION_BINDINGS): string {
  return bindingLabel(bindings[action][0]);
}
