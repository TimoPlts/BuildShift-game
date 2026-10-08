/**
 * localHudView — pure mapping from the GameRuntime's existing
 * authoritative / predicted local values into the flat, plain-data
 * {@link LocalHudView} the React game HUD renders from.
 *
 * This module owns NO gameplay state. It only clamps/normalises values that
 * the runtime already holds through its canonical sources:
 *
 *  - health / shield / ammo / elimination — the prediction orchestrator's
 *    combat state (authoritative, reconciled from server state),
 *  - energy — the energy runtime consumer's mirrored authoritative value,
 *  - weapon type / magazine size / reload state — the weapon controller
 *    (reconciled from the authoritative `weapon:state_update` event),
 *  - build mode / selected piece / placement preview — the client building
 *    system (player intent + non-authoritative preview),
 *  - round timer / countdown — the authoritative server lifecycle
 *    broadcasts (`match:round_timer`, `match:countdown_tick`).
 *
 * No side effects, no framework dependencies — directly unit-testable.
 */
import {
  ENERGY,
  MAX_HEALTH,
  MAX_SHIELD,
} from "@buildshift/game-config";
import type {
  BuildType,
  GridPosition,
  WeaponType,
} from "@buildshift/protocol";

/**
 * One snapshot of the authoritative round timer (the server's
 * `match:round_timer` broadcast), in milliseconds.
 */
export interface LocalRoundTimer {
  /** Remaining round time in milliseconds (>= 0). */
  remainingMs: number;
  /** Total round duration in milliseconds (> 0). */
  totalMs: number;
}

/**
 * The flat, local-perspective view of everything the in-game HUD displays.
 *
 * Every value is derived from an existing runtime source (see the module
 * doc); this object is a display snapshot, never a second source of truth.
 */
export interface LocalHudView {
  /** Local player health (authoritative, reconciled). */
  health: number;
  /** Maximum health (shared game-config constant). */
  maxHealth: number;
  /** Local player shield (authoritative, reconciled). */
  shield: number;
  /** Maximum shield (shared game-config constant). */
  maxShield: number;
  /** Local player energy (mirrored authoritative value). */
  energy: number;
  /** Maximum energy (shared game-config constant). */
  maxEnergy: number;
  /** The currently equipped weapon type. */
  weaponType: WeaponType;
  /** Rounds currently in the active weapon's magazine (authoritative). */
  magazineAmmo: number;
  /** The active weapon's magazine capacity (reconciled). */
  magazineSize: number;
  /** Whether the active weapon is reloading. */
  isReloading: boolean;
  /** Reload progress in [0, 1] while reloading (0 otherwise). */
  reloadProgress: number;
  /** Whether the local player is eliminated (authoritative). */
  eliminated: boolean;
  /** Whether the local player is in build mode (player intent). */
  buildMode: boolean;
  /** The currently selected build piece type. */
  selectedBuildType: BuildType;
  /**
   * Locally-computed placement validity for the selected piece:
   * `true`/`false` while a preview is presented, `null` when no preview is
   * active (not in build mode, or no candidate on screen).
   */
  placementValid: boolean | null;
  /** The grid cell the selected piece would anchor to (null without a candidate). */
  gridPosition: GridPosition | null;
  /** The authoritative round timer, or `null` outside an active round. */
  roundTimer: LocalRoundTimer | null;
  /** The authoritative pre-round countdown in whole seconds (0 otherwise). */
  countdownSeconds: number;
}

/**
 * The raw, un-clamped runtime values fed into {@link buildLocalHudView}.
 *
 * The runtime composes these from its existing sources; the builder normalises
 * them into the display-safe {@link LocalHudView}.
 */
export interface LocalHudViewInput {
  health: number;
  shield: number;
  energy: number;
  weaponType: WeaponType;
  magazineAmmo: number;
  magazineSize: number;
  isReloading: boolean;
  reloadProgress: number;
  eliminated: boolean;
  buildMode: boolean;
  selectedBuildType: BuildType;
  placementValid: boolean | null;
  gridPosition: GridPosition | null;
  roundTimer: LocalRoundTimer | null;
  countdownSeconds: number;
}

/** Clamp a finite number into `[min, max]`; map non-finite input to `fallback`. */
function clampFinite(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(value, max));
}

/** Clamp a value into `[min, +∞)` and floor it to an integer; non-finite → `fallback`. */
function floorNonNegative(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

/**
 * Normalise the raw runtime values into a display-safe {@link LocalHudView}.
 *
 * All clamping uses the shared game-config ceilings (`MAX_HEALTH`,
 * `MAX_SHIELD`, `ENERGY.maxEnergy`) so the HUD can never present a value the
 * gameplay rules would reject.
 */
export function buildLocalHudView(input: LocalHudViewInput): LocalHudView {
  // ── Round timer (authoritative `match:round_timer` payload) ──
  let roundTimer: LocalRoundTimer | null = null;
  if (input.roundTimer !== null) {
    const { remainingMs, totalMs } = input.roundTimer;
    if (
      Number.isFinite(remainingMs) &&
      Number.isFinite(totalMs) &&
      totalMs > 0
    ) {
      roundTimer = {
        remainingMs: clampFinite(remainingMs, 0, totalMs, totalMs),
        totalMs,
      };
    }
  }

  return {
    health: clampFinite(input.health, 0, MAX_HEALTH, MAX_HEALTH),
    maxHealth: MAX_HEALTH,
    shield: clampFinite(input.shield, 0, MAX_SHIELD, 0),
    maxShield: MAX_SHIELD,
    energy: clampFinite(input.energy, 0, ENERGY.maxEnergy, 0),
    maxEnergy: ENERGY.maxEnergy,
    weaponType: input.weaponType,
    magazineAmmo: floorNonNegative(input.magazineAmmo, 0),
    magazineSize: floorNonNegative(input.magazineSize, 0),
    isReloading: input.isReloading === true,
    reloadProgress: clampFinite(input.reloadProgress, 0, 1, 0),
    eliminated: input.eliminated === true,
    buildMode: input.buildMode === true,
    selectedBuildType: input.selectedBuildType,
    placementValid: input.placementValid,
    gridPosition: input.gridPosition,
    roundTimer,
    countdownSeconds: floorNonNegative(input.countdownSeconds, 0),
  };
}

/**
 * A stable change-key for a {@link LocalHudView}.
 *
 * The key quantises each field to the precision the player can actually see
 * (whole timer seconds, ~2% reload progress steps, integer counts), so the
 * runtime can skip re-emitting — and React can skip re-rendering — whenever
 * no player-visible value changed. Two views with different keys always
 * differ in at least one player-visible field.
 */
export function localHudChangeKey(view: LocalHudView): string {
  const timerRemainingSec = view.roundTimer
    ? Math.round(view.roundTimer.remainingMs / 1000)
    : -1;
  const timerTotalMs = view.roundTimer ? view.roundTimer.totalMs : 0;
  const reloadStep = view.isReloading ? Math.round(view.reloadProgress * 50) : 0;
  const grid = view.gridPosition
    ? `${view.gridPosition.x},${view.gridPosition.y},${view.gridPosition.z}`
    : "-";
  const validity =
    view.placementValid === null ? "n" : view.placementValid ? "v" : "i";

  return [
    Math.round(view.health),
    Math.round(view.shield),
    Math.round(view.energy),
    view.weaponType,
    view.magazineAmmo,
    view.isReloading ? "r" : "-",
    reloadStep,
    view.eliminated ? "x" : "-",
    view.buildMode ? "b" : "-",
    view.selectedBuildType,
    validity,
    grid,
    timerRemainingSec,
    timerTotalMs,
    Math.round(view.countdownSeconds),
  ].join("|");
}
