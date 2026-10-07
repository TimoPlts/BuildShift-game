/**
 * cameraRecoil — a small, modular, per-weapon camera-recoil model.
 *
 * Presentation-only: this module owns the *feel* of recoil (a temporary
 * vertical pitch nudge that decays back to zero) and nothing else. It never
 * touches gameplay state, weapon cooldowns, ammo, spread, or network
 * authority — the `GameRuntime` decides *when* to call {@link CameraRecoil.kick}
 * (on an accepted local shot) and *how* to apply the resulting offset to the
 * camera (via the camera controller's transient pitch offset).
 *
 * The model is pure math (no Babylon, no DOM) so it can be unit-tested in
 * isolation: a kick adds a fixed, per-weapon vertical offset, and
 * {@link CameraRecoil.update} decays it exponentially toward zero each frame.
 * The shotgun kicks harder than the assault rifle so it reads as heavier.
 */
import type { WeaponType } from "@buildshift/protocol";

/** Tuning parameters for the modular recoil model. */
export interface RecoilConfig {
  /** Per-weapon vertical kick, in radians (positive = camera looks up). */
  readonly kick: Readonly<Record<WeaponType, number>>;
  /** Exponential decay rate (per second). Larger = settles faster. */
  readonly decayRatePerSec: number;
  /** Upper bound on the accumulated offset so sustained fire stays bounded. */
  readonly maxOffset: number;
}

/**
 * Default (subtle) recoil tuning. The shotgun's kick is larger than the
 * assault rifle's, giving it a heavier feel without distorting the camera.
 */
export const DEFAULT_RECOIL_CONFIG: RecoilConfig = {
  kick: {
    // ~1.1° nudge — a light, snappy kick for the high-CADence rifle.
    assault_rifle: 0.02,
    // ~2.9° nudge — a visibly heavier kick for the shotgun.
    shotgun: 0.05,
  },
  // Settles to ~1/e in 100ms and is effectively gone in ~300ms.
  decayRatePerSec: 10,
  // ~8.6° — caps sustained-fire accumulation to stay subtle.
  maxOffset: 0.15,
};

/**
 * The modular camera-recoil state machine.
 *
 * The `GameRuntime` calls {@link kick} when a local shot is accepted and
 * reads {@link update} once per frame (feeding the returned offset to the
 * camera controller). The offset accumulates across kicks and decays
 * exponentially each frame, so a burst of fire builds up a bounded nudge
 * that then eases back to a neutral view.
 */
export class CameraRecoil {
  private readonly config: RecoilConfig;
  private offset = 0;

  public constructor(config: RecoilConfig = DEFAULT_RECOIL_CONFIG) {
    this.config = config;
  }

  /**
   * The current (pre-decay) vertical offset in radians. Read-only view for
   * inspection and tests.
   */
  public get currentOffset(): number {
    return this.offset;
  }

  /**
   * Register an accepted shot for `weaponType`, adding that weapon's kick to
   * the accumulated offset (clamped to {@link RecoilConfig.maxOffset}).
   */
  public kick(weaponType: WeaponType): void {
    this.offset += this.config.kick[weaponType];
    if (this.offset > this.config.maxOffset) {
      this.offset = this.config.maxOffset;
    }
  }

  /**
   * Advance the decay by `dtSeconds` and return the offset the camera should
   * use this frame. A zero (or negative) delta leaves the offset unchanged.
   */
  public update(dtSeconds: number): number {
    if (this.offset === 0 || dtSeconds <= 0) {
      return this.offset;
    }
    this.offset *= Math.exp(-this.config.decayRatePerSec * dtSeconds);
    if (Math.abs(this.offset) < 1e-5) {
      this.offset = 0;
    }
    return this.offset;
  }

  /**
   * Immediately clear any accumulated recoil (round reset / reconnect).
   */
  public reset(): void {
    this.offset = 0;
  }
}
