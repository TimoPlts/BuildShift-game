/**
 * Fire gate — a small, pure cooldown / eligibility check shared by both the
 * predicting client (local fire) and the authoritative server (validation).
 *
 * The canonical hitscan contract keys fire off the input *sequence* rather than
 * wall-clock time so that prediction and authority use the exact same gate:
 * a player may fire again only once `fireIntervalTicks` simulation ticks have
 * elapsed since the sequence at which they last fired (`lastFireSequence`).
 *
 * This module contains no platform-specific code and no side effects, so the
 * client and the server can each call it with their own view of the player
 * state and be guaranteed to agree.
 */

/**
 * Optional per-call context for {@link canFire}.
 *
 * The only factor the pure cooldown check needs beyond the three numeric
 * arguments is whether the shooter is currently eliminated: an eliminated
 * player can never fire, regardless of cooldown or sequence. Keeping this a
 * tiny options object (rather than a full weapon config) keeps the helper
 * decoupled from `@buildshift/game-config` so it stays trivially testable.
 */
export interface CanFireConfig {
  /**
   * Whether the shooter is currently eliminated. When `true`, {@link canFire}
   * always returns `false`.
   */
  isEliminated?: boolean;
}

/**
 * Decide whether a player may fire on the given simulation tick.
 *
 * Pure and platform-independent — safe to call on the client for local fire
 * prediction and on the server for authoritative validation with identical
 * results for identical inputs.
 *
 * @param lastFireSequence
 *   The input sequence at which the player last fired. The sentinel `-1`
 *   (or any non-finite / negative value) means "the player has not fired
 *   yet", in which case the first shot is always allowed.
 * @param currentSequence
 *   The input sequence of the tick on which the player is trying to fire.
 * @param fireIntervalTicks
 *   The minimum number of simulation ticks that must elapse between
 *   consecutive shots (the weapon cooldown, in ticks). A non-positive value
 *   means there is no cooldown gate, so firing is always allowed (subject to
 *   the elimination check).
 * @param config
 *   Optional per-call context. When `config.isEliminated` is `true` the
 *   player cannot fire.
 * @returns
 *   `true` when the shot is allowed, `false` when it is blocked (either the
 *   shooter is eliminated or the weapon is still in cooldown).
 *
 * Boundary semantics:
 *  - **First shot** (`lastFireSequence` is the `-1` sentinel): always allowed
 *    (unless eliminated).
 *  - **Within cooldown** (`currentSequence - lastFireSequence <
 *    fireIntervalTicks`): not allowed.
 *  - **Exactly at the cooldown boundary** (`currentSequence -
 *    lastFireSequence === fireIntervalTicks`): allowed — the cooldown has
 *    fully elapsed.
 *  - **After elimination** (`config.isEliminated === true`): not allowed.
 */
export function canFire(
  lastFireSequence: number,
  currentSequence: number,
  fireIntervalTicks: number,
  config: CanFireConfig = {},
): boolean {
  // An eliminated shooter can never fire.
  if (config.isEliminated === true) {
    return false;
  }

  // A non-positive interval means there is no cooldown gate to enforce.
  if (!(fireIntervalTicks > 0)) {
    return true;
  }

  // No shot has been fired yet (sentinel -1, or any non-finite / negative
  // value): the first shot is always allowed.
  if (!Number.isFinite(lastFireSequence) || lastFireSequence < 0) {
    return true;
  }

  // Cooldown gate: allow the shot once at least `fireIntervalTicks` ticks have
  // elapsed since the last shot. The `>=` makes the exact boundary inclusive.
  return currentSequence - lastFireSequence >= fireIntervalTicks;
}

/**
 * The reason an authoritative fire request was rejected by {@link fireGate}.
 *
 * The literal set is intentionally small and stable so the authoritative
 * server can broadcast a rejection event (see `@buildshift/protocol`
 * `FIRE_REJECTED`) and the client can present it deterministically.
 */
export type FireGateRejectionReason =
  | "eliminated"
  | "no_ammo"
  | "cooldown";

/**
 * Discriminated result of {@link fireGate}.
 *
 * When the shot is allowed, the result is `{ approved: true }`. When it is
 * blocked, the result is `{ approved: false, reason }` where `reason` names
 * the *first* failing check in the fixed precedence below (elimination is the
 * strongest, then ammo availability, then cooldown).
 */
export type FireGateResult =
  | { approved: true }
  | { approved: false; reason: FireGateRejectionReason };

/**
 * Inputs to the authoritative fire gate.
 *
 * This is the *full* eligibility view the authoritative server has for a single
 * fire intent: the sequence-based cooldown state (delegated to {@link canFire}),
 * whether the shooter is still alive, and whether the weapon has ammo to spend.
 *
 * Keeping `fireGate` a pure function of these inputs (with no weapon-object or
 * platform dependency) lets the client predict local fire and the server
 * validate with identical results.
 */
export interface FireGateInput {
  /** Input sequence at which the shooter last fired (`-1` = never fired). */
  lastFireSequence: number;
  /** The input sequence of the current fire intent (the tick being fired). */
  currentSequence: number;
  /** Weapon cooldown in ticks (`fireIntervalTicks`). */
  fireIntervalTicks: number;
  /** Whether the shooter is currently eliminated. */
  isEliminated: boolean;
  /** Rounds currently in the shooter's magazine (weapon-available check). */
  ammo: number;
}

/**
 * Authoritatively validate a fire request.
 *
 * This is the fire-gate the authoritative room invokes on every fire intent.
 * It composes the pure {@link canFire} cooldown gate (the core combat math —
 * never reimplemented elsewhere) with the two additional eligibility checks the
 * full gate needs: the shooter must not be eliminated, and the weapon must have
 * at least one round in the magazine.
 *
 * Precedence (the *first* failing check wins, and only one reason is reported):
 *  1. `eliminated` — an eliminated player can never fire.
 *  2. `no_ammo` — the magazine is empty, so there is no weapon available.
 *  3. `cooldown` — `fireIntervalTicks` ticks have not elapsed since the last
 *     shot (per {@link canFire}).
 *
 * @param input — the full eligibility view for one fire intent.
 * @returns — a discriminated {@link FireGateResult}: `{ approved: true }` or
 *   `{ approved: false, reason }`.
 */
export function fireGate(input: FireGateInput): FireGateResult {
  // 1. An eliminated shooter can never fire, regardless of anything else.
  if (input.isEliminated) {
    return { approved: false, reason: "eliminated" };
  }

  // 2. The weapon must have a round available to spend.
  if (input.ammo <= 0) {
    return { approved: false, reason: "no_ammo" };
  }

  // 3. The sequence-based cooldown gate (the shared, pure combat math).
  const cooldownOk = canFire(
    input.lastFireSequence,
    input.currentSequence,
    input.fireIntervalTicks,
    { isEliminated: input.isEliminated },
  );
  if (!cooldownOk) {
    return { approved: false, reason: "cooldown" };
  }

  return { approved: true };
}
