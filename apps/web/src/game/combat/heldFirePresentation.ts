/**
 * HeldFirePresentationGate — the client-side accepted-shot gate that drives
 * local shot PRESENTATION (muzzle flash + tracer + recoil + fire audio).
 *
 * Background: before this module existed, the GameRuntime only presented a
 * shot on the click *edge* (`weaponFirePressed`). Automatic fire while the
 * primary button is HELD flows through the fixed simulation tick instead
 * (`frameRoute.weaponFireHeld` -> the replicated `primaryFire` intent), and
 * that path never reached the presentation layer — so held-fire rounds were
 * accepted (server damage, ammo, cadence all fine) yet showed no tracer.
 *
 * This gate re-derives, purely for presentation, the SAME acceptance rule
 * the authoritative server applies to each input frame:
 *   - the shot requires a held fire intent on this tick (no click-edge
 *     dependency: the first tick of a fresh click is just a held tick, so a
 *     single click and sustained automatic fire run through one path);
 *   - the shared sequence-based cooldown gate (`canFire` from
 *     @buildshift/simulation) with the EQUIPPED weapon's
 *     `fireIntervalTicks` — deliberately not a wall-clock timer, so the
 *     feedback cadence matches the server's tick cadence and is frame-rate
 *     independent;
 *   - rejection on empty magazine, active reload, or elimination: rejected
 *     shots never spawn feedback.
 *
 * The gate is presentation-only: it never sends intents, never touches
 * ammo/cooldown authority, and cannot cause gameplay. If it drifts a tick
 * from the server (e.g. a boundary rejection), at worst one tracer is
 * delayed or omitted; server-side hitscan remains authoritative.
 */
import { canFire } from "@buildshift/simulation";

/** Inputs for one {@link HeldFirePresentationGate.allows} evaluation. */
export interface HeldFirePresentationRequest {
  /** Whether the routed primary fire is held on this simulation tick. */
  fireHeld: boolean;
  /** The input sequence consumed by this simulation tick. */
  sequence: number;
  /** The equipped weapon's authoritative `fireIntervalTicks` cooldown gate. */
  fireIntervalTicks: number;
  /** Locally-predicted magazine ammo BEFORE this tick's prediction. */
  ammo: number;
  /** Whether a reload is currently in progress for the equipped weapon. */
  reloading: boolean;
  /** Whether the local player is eliminated. */
  eliminated: boolean;
}

/**
 * Sequence-based, per-weapon presentation gate. `allows()` returns `true`
 * exactly once per presentation-accepted round, mirroring the server's
 * per-frame fire gate.
 */
export class HeldFirePresentationGate {
  /** Same sentinel convention as the server / prediction: -1 = never fired. */
  private _lastFireSequence = -1;

  /** The last sequence this gate presented a round for (or -1). */
  public get lastFireSequence(): number {
    return this._lastFireSequence;
  }

  /**
   * Evaluate one simulation tick. Returns `true` (and records the sequence)
   * when a round is accepted for presentation; `false` (recording nothing)
   * when the tick must produce no feedback.
   */
  public allows(request: HeldFirePresentationRequest): boolean {
    // No intent on this tick (released, mode switch, countdown, ...).
    if (!request.fireHeld) return false;
    // Rejected shots show nothing: empty, reloading, eliminated.
    if (request.reloading || request.eliminated) return false;
    if (!(request.ammo > 0)) return false;
    // The same tick-based cooldown gate the server applies.
    if (
      !canFire(
        this._lastFireSequence,
        request.sequence,
        request.fireIntervalTicks,
        { isEliminated: request.eliminated },
      )
    ) {
      return false;
    }
    this._lastFireSequence = request.sequence;
    return true;
  }

  /**
   * Forget the cooldown history (match/round reset — mirrors the server
   * re-arming the fire gate for the next round). Keeps nothing allocated.
   */
  public reset(): void {
    this._lastFireSequence = -1;
  }
}
