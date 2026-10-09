/**
 * cameraRecoil — a small, modular, per-weapon camera-recoil model.
 *
 * Presentation-only: this module owns the *feel* of recoil (a vertical pitch
 * nudge that kicks up and then returns to neutral) and nothing else. It never
 * touches gameplay state, weapon cooldowns, ammo, spread, or network
 * authority — the `GameRuntime` decides *when* to call {@link CameraRecoil.kick}
 * (on an accepted local shot) and *how* to apply the resulting offset to the
 * camera (via the camera controller's transient pitch offset).
 *
 * The model is pure math (no Babylon, no DOM) so it can be unit-tested in
 * isolation. It is a two-phase kick/return:
 *
 *  - **Kick** — {@link kick} registers an accepted shot by raising an
 *    accumulated *target* offset (capped at {@link RecoilConfig.maxOffset}).
 *    The offset actually applied to the camera ({@link currentOffset}) then
 *    rises toward that target over a fast *attack* phase, so a shot reads as
 *    a quick snap rather than an instant jump.
 *  - **Return** — the target decays exponentially toward zero at a
 *    per-weapon *return rate*, and the camera offset eases back down to
 *    neutral behind it.
 *
 * The per-weapon tuning makes the two weapons clearly distinct: the assault
 * rifle uses a small, fast kick with a snappy return, while the shotgun uses
 * a larger kick with a slower, heavier return — so it reads as the heavier
 * weapon without distorting the camera.
 */
import type { WeaponType } from "@buildshift/protocol";

/** Tuning parameters for the modular recoil model. */
export interface RecoilConfig {
  /** Per-weapon kick magnitude, in radians (positive = camera looks up). */
  readonly kick: Readonly<Record<WeaponType, number>>;
  /**
   * How fast the applied offset rises toward the accumulated target after a
   * kick (per second). Larger = a snappier kick-up.
   */
  readonly attackRatePerSec: number;
  /**
   * Per-weapon return (decay) rate (per second). Larger = settles faster.
   * The shotgun's is smaller than the rifle's so it lingers longer and
   * feels heavier.
   */
  readonly returnRate: Readonly<Record<WeaponType, number>>;
  /** Upper bound on the accumulated offset so sustained fire stays bounded. */
  readonly maxOffset: number;
}

/**
 * Default (subtle) recoil tuning. The shotgun's kick is larger AND its return
 * is slower than the assault rifle's, giving it a clearly heavier feel
 * without distorting the camera.
 */
export const DEFAULT_RECOIL_CONFIG: RecoilConfig = {
  kick: {
    // ~1.1° — a light kick for the high-CADence rifle.
    assault_rifle: 0.02,
    // ~2.9° — a visibly heavier kick for the shotgun.
    shotgun: 0.05,
  },
  // Snappy kick-up: reaches ~98% of the target in well under a frame.
  attackRatePerSec: 40,
  returnRate: {
    // Snappy settle: ~1/e in ~70ms, effectively gone in ~200ms.
    assault_rifle: 14,
    // Heavier settle: ~1/e in ~170ms, lingers for ~400ms.
    shotgun: 6,
  },
  // ~8.6° — caps sustained-fire accumulation to stay subtle.
  maxOffset: 0.15,
};

/**
 * The modular camera-recoil state machine.
 *
 * The `GameRuntime` calls {@link kick} when a local shot is accepted and
 * reads {@link update} once per frame (feeding the returned offset to the
 * camera controller). A kick raises the accumulated target; the applied
 * offset ({@link currentOffset}) snaps up toward it over the attack phase and
 * eases back to neutral as the target decays.
 */
export class CameraRecoil {
  private readonly config: RecoilConfig;
  /** Accumulated target offset (capped at `maxOffset`), decays each frame. */
  private target = 0;
  /** Applied offset the camera uses this frame (chases `target`). */
  private current = 0;
  /** Return rate of the most recently kicked weapon (drives the decay). */
  private returnRate: number;

  public constructor(config: RecoilConfig = DEFAULT_RECOIL_CONFIG) {
    this.config = config;
    this.returnRate = config.returnRate.assault_rifle;
  }

  /**
   * The current applied vertical offset in radians. Read-only view for
   * inspection and tests.
   */
  public get currentOffset(): number {
    return this.current;
  }

  /**
   * Register an accepted shot for `weaponType`, adding that weapon's kick to
   * the accumulated target (clamped to {@link RecoilConfig.maxOffset}) and
   * switching the return rate to that weapon's.
   */
  public kick(weaponType: WeaponType): void {
    this.target += this.config.kick[weaponType];
    if (this.target > this.config.maxOffset) {
      this.target = this.config.maxOffset;
    }
    this.returnRate = this.config.returnRate[weaponType];
  }

  /**
   * Advance the kick/return by `dtSeconds` and return the offset the camera
   * should use this frame:
   *   1. the target decays exponentially toward zero (the return), and
   *   2. the applied offset eases toward the target (the kick-up).
   * A zero (or negative) delta leaves the offset unchanged.
   */
  public update(dtSeconds: number): number {
    if (dtSeconds <= 0 || (this.target === 0 && this.current === 0)) {
      return this.current;
    }
    // Return: the accumulated target decays toward neutral.
    this.target *= Math.exp(-this.returnRate * dtSeconds);
    if (this.target < 1e-5) {
      this.target = 0;
    }
    // Kick-up: the applied offset eases toward the (now decaying) target.
    const step = 1 - Math.exp(-this.config.attackRatePerSec * dtSeconds);
    this.current += (this.target - this.current) * step;
    if (Math.abs(this.current) < 1e-5) {
      this.current = 0;
    }
    return this.current;
  }

  /**
   * Immediately clear any accumulated recoil (round reset / reconnect).
   */
  public reset(): void {
    this.target = 0;
    this.current = 0;
  }
}
