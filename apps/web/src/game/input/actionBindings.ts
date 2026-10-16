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
 * `"Digit1"`, `"Space"`, …); mouse bindings use `"Mouse<button>"` with the
 * DOM `MouseEvent.button` number (`"Mouse0"` = primary, `"Mouse2"` =
 * secondary). The side buttons gamers call "Mouse Button 4" / "Mouse Button
 * 5" are DOM buttons 3 / 4 — use {@link MOUSE_BUTTON_4} / {@link MOUSE_BUTTON_5}
 * rather than literal codes.
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

/** "Mouse Button 4" (the back side button): DOM `MouseEvent.button` 3. */
export const MOUSE_BUTTON_4 = "Mouse3";
/** "Mouse Button 5" (the forward side button): DOM `MouseEvent.button` 4. */
export const MOUSE_BUTTON_5 = "Mouse4";

/**
 * Default Floor bind, isolated so it can be changed in one place. Temporary:
 * the requested `KeyA` is `moveLeft` (strafing would switch to floor) and the
 * previous `KeyF` is now Cone, so Floor sits on the freed `KeyQ` until a
 * permanent key is chosen.
 */
export const DEFAULT_FLOOR_BINDING: InputBindingCode = "KeyQ";

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
  buildWall: [MOUSE_BUTTON_4],
  buildFloor: [DEFAULT_FLOOR_BINDING],
  buildRamp: [MOUSE_BUTTON_5],
  buildCone: ["KeyF"],
  buildRotateLeft: ["KeyX"],
  buildRotateRight: ["KeyR"],
  // Optional legacy toggle: never required (the piece binds enter building).
  buildToggle: ["KeyB"],
  // Pressing `edit` again while editing confirms (the edit layer's toggle).
  edit: ["KeyE"],
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
 * The binding code of a `keydown` (its `code`; auto-repeats excluded) or a
 * `mousedown` (`"Mouse<button>"`) event, so key and mouse binds drive actions
 * through one path. `null` for anything else.
 */
export function pressedBindingCode(event: unknown): InputBindingCode | null {
  const e = event as { code?: unknown; repeat?: unknown; button?: unknown; type?: unknown } | null;
  if (!e) return null;
  if (typeof e.code === "string") return e.repeat ? null : e.code;
  if (typeof e.button === "number" && (e.type === undefined || e.type === "mousedown")) return mouseBindingCode(e.button);
  return null;
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
 * (`"KeyQ"` → `"Q"`, `"Digit1"` → `"1"`, `"Mouse0"` → `"LMB"`, `"Mouse3"` → `"M4"`).
 */
export function bindingLabel(code: InputBindingCode | undefined): string {
  if (code === undefined) return "—";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "Mouse0") return "LMB";
  if (code === "Mouse1") return "MMB";
  if (code === "Mouse2") return "RMB";
  if (code === MOUSE_BUTTON_4) return "M4";
  if (code === MOUSE_BUTTON_5) return "M5";
  return code;
}

/** The HUD label of an action's first binding. */
export function actionLabel(action: GameAction, bindings: ActionBindings = DEFAULT_ACTION_BINDINGS): string {
  return bindingLabel(bindings[action][0]);
}

/** DOM `MouseEvent.buttons` bit of each `MouseEvent.button`. */
const BUTTON_BITS = [1, 4, 2, 8, 16] as const;

/** A minimal event target for {@link attachMouseBindPresses}. */
export interface MouseBindTarget {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

const MOUSE_BIND_EVENTS = ["pointerdown", "pointermove", "pointerup", "mousedown", "mouseup"] as const;

/**
 * Reports each physical mouse-button press exactly once, as its binding code.
 *
 * A browser may deliver a press as `pointerdown`, as a chorded `pointermove`
 * (another button already held — e.g. a side-button bind while the primary
 * is held for turbo building), and/or as the compatibility `mousedown`
 * (which it drops after a cancelled `pointerdown`). Tracking the held button
 * bits makes the three paths one: a press counts only on a 0 → 1 transition.
 * Returns the detach function.
 */
export function attachMouseBindPresses(
  target: MouseBindTarget,
  onPress: (code: InputBindingCode) => void,
  onRelease?: (code: InputBindingCode) => void,
): () => void {
  let held = 0;
  const listener = (event: unknown): void => {
    const e = event as { type?: string; button?: number; buttons?: number; pointerType?: string };
    if (e.pointerType !== undefined && e.pointerType !== "mouse") return;
    const button = e.button;
    const bit = typeof button === "number" && button >= 0 ? BUTTON_BITS[button as 0] ?? 0 : 0;
    // Resync with the authoritative held-button mask when the event has one.
    if (typeof e.buttons === "number") {
      for (const [index, b] of BUTTON_BITS.entries()) {
        if (held & b && !(e.buttons & b)) {
          held &= ~b;
          onRelease?.(mouseBindingCode(index));
        }
      }
    }
    if (!bit) return;
    const pressed = e.type === "pointerdown" || e.type === "mousedown" || (e.type === "pointermove" && typeof e.buttons === "number" && (e.buttons & bit) !== 0);
    const released = e.type === "pointerup" || e.type === "mouseup";
    if (pressed && !(held & bit)) {
      held |= bit;
      onPress(mouseBindingCode(button!));
    } else if (released && held & bit) {
      held &= ~bit;
      onRelease?.(mouseBindingCode(button!));
    }
  };
  for (const type of MOUSE_BIND_EVENTS) target.addEventListener(type, listener);
  return () => {
    for (const type of MOUSE_BIND_EVENTS) target.removeEventListener(type, listener);
    held = 0;
  };
}
