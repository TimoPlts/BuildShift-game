/**
 * movementFeedbackModel — pure presentation math for movement feedback.
 *
 * Two small, Babylon-free state machines that turn the EXISTING client
 * movement state (predicted grounded flag + vertical velocity, one sample per
 * simulation tick) into presentation events:
 *
 *  1. {@link MovementEventTracker} — detects jump-launch and landing
 *     transitions (grounded true→false / false→true) and reports the fall
 *     speed at landing. It is stateless with respect to gameplay: it only
 *     remembers the previous grounded flag and the last airborne velocity.
 *
 *  2. {@link MovementCameraMotion} — a transient vertical camera offset
 *     (metres, world Y) that eases back to zero. A landing adds a small
 *     downward dip scaled by fall speed (capped); a jump adds a small upward
 *     nudge. The offset is a pure *translation* applied to both the camera
 *     position and its look target, so the aim direction is never
 *     disturbed — unlike the combat {@link CameraRecoil} pitch nudge.
 *
 * Neither machine touches movement speed, gravity, jump velocity, collision,
 * prediction, or input. They are presentation-only tuning.
 */

/** One sample of the existing client movement state (per simulation tick). */
export interface MovementSample {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly grounded: boolean;
  readonly velocityY: number;
}

/** Presentation events derived from one movement sample. */
export interface MovementEvents {
  /** The sample launched a jump (grounded true → false). */
  readonly jumped: boolean;
  /** The sample landed (grounded false → true). */
  readonly landed: boolean;
  /** Downward speed at landing (m/s, positive). 0 when not landing. */
  readonly landingFallSpeed: number;
}

/**
 * Detects jump/land transitions from a stream of movement samples.
 *
 * The landing fall speed comes from the LAST AIRBORNE velocity, not the
 * landing sample's own velocity — the shared vertical step zeroes
 * `velocityY` on the landing tick, so the descent speed must be captured
 * from the tick before.
 */
export class MovementEventTracker {
  private grounded = true;
  private airborneVelocityY = 0;
  private groundY = 0;

  /** Sample the latest movement state; reports any transition this tick. */
  public sample(sample: MovementSample): MovementEvents {
    let jumped = false;
    let landed = false;
    let landingFallSpeed = 0;

    if (this.grounded && !sample.grounded) {
      jumped = true;
    } else if (!this.grounded && sample.grounded) {
      landed = true;
      landingFallSpeed = Math.max(0, -this.airborneVelocityY);
    }

    if (sample.grounded) {
      this.groundY = sample.y;
    } else {
      this.airborneVelocityY = sample.velocityY;
    }
    this.grounded = sample.grounded;

    return { jumped, landed, landingFallSpeed };
  }

  /**
   * The last known grounded reference Y. Used to pose takeoff dust on the
   * ground (the launch sample's own Y is already slightly above it).
   */
  public get lastGroundY(): number {
    return this.groundY;
  }

  /** Back to the resting baseline (round reset / reconnect). */
  public reset(): void {
    this.grounded = true;
    this.airborneVelocityY = 0;
    this.groundY = 0;
  }
}

/** Tuning for the transient movement camera offset (presentation only). */
export interface MovementCameraMotionConfig {
  /** Upward camera nudge (m) registered on a jump launch. */
  readonly jumpOffsetMeters: number;
  /** Downward camera dip (m) per m/s of fall speed at landing. */
  readonly landingOffsetMetersPerMeterPerSec: number;
  /** Upper bound on the landing dip so long falls stay subtle. */
  readonly maxLandingOffsetMeters: number;
  /** Exponential decay rate (per second). Larger = settles faster. */
  readonly decayRatePerSec: number;
}

/**
 * Default (restrained) tuning, scaled to the third-person camera's tracking
 * distance (~7 m, see `cameraConfig.ts`): a normal jump landing at ~8 m/s
 * (jump velocity 8, gravity -20) reads as a ~12 cm dip; terminal falls
 * (40 m/s) are capped at ~18 cm. The offset settles to ~1/e in ~80 ms and is
 * effectively gone in ~250 ms.
 */
export const DEFAULT_MOVEMENT_CAMERA_MOTION: MovementCameraMotionConfig = {
  jumpOffsetMeters: 0.08,
  landingOffsetMetersPerMeterPerSec: 0.015,
  maxLandingOffsetMeters: 0.18,
  decayRatePerSec: 12,
};

/**
 * The transient vertical camera offset driven by movement events.
 *
 * Pure math (no Babylon, no DOM): the runtime calls {@link onJump} /
 * {@link onLanding} from the event tracker's output and {@link update} once
 * per render frame, feeding the returned offset to the camera's transient
 * vertical offset (a translation shared by camera position and look target,
 * so the aim direction is untouched).
 */
export class MovementCameraMotion {
  private readonly config: MovementCameraMotionConfig;
  private offsetMeters = 0;

  public constructor(config: MovementCameraMotionConfig = DEFAULT_MOVEMENT_CAMERA_MOTION) {
    this.config = config;
  }

  /** The current offset (m). Positive = camera nudged up. */
  public get currentOffsetMeters(): number {
    return this.offsetMeters;
  }

  /** A jump launched: small upward nudge. */
  public onJump(): void {
    this.offsetMeters += this.config.jumpOffsetMeters;
  }

  /** A landing: small downward dip scaled by fall speed, capped. */
  public onLanding(fallSpeedMetersPerSec: number): void {
    const dip = Math.min(
      Math.max(0, fallSpeedMetersPerSec) * this.config.landingOffsetMetersPerMeterPerSec,
      this.config.maxLandingOffsetMeters,
    );
    this.offsetMeters -= dip;
  }

  /**
   * Decay the offset exponentially toward zero (no-op for non-positive
   * frame deltas). Returns the current offset.
   */
  public update(deltaSeconds: number): number {
    if (deltaSeconds > 0) {
      this.offsetMeters *= Math.exp(-this.config.decayRatePerSec * deltaSeconds);
      if (Math.abs(this.offsetMeters) < 1e-5) {
        this.offsetMeters = 0;
      }
    }
    return this.offsetMeters;
  }

  /** Clear the offset immediately (round reset / reconnect). */
  public reset(): void {
    this.offsetMeters = 0;
  }
}
