/**
 * playerPoseModel — pure, Babylon-free procedural pose math for the player
 * presentation.
 *
 * The model derives a visual-only pose from the EXISTING canonical player
 * state that the presentation is already mirrored from:
 *
 *  1. {@link PlayerPoseModel.sample} feeds the same position values the
 *     presentation receives in `setTransform` (predicted / interpolated
 *     capsule-centre position, any cadence). The position stream is turned
 *     into a smoothed horizontal speed and the per-sample vertical velocity;
 *     grounded/airborne transitions, the fall speed, and the landing dip are
 *     derived from that stream alone — never from gameplay state, and nothing
 *     gameplay-owned is ever read beyond the position values.
 *
 *  2. {@link PlayerPoseModel.setAim} receives the display aim input the
 *     presentation derives from the existing canonical aim state (local:
 *     the active camera's aim direction; remote: neutral facing).
 *
 *  3. {@link PlayerPoseModel.advance} runs once per render frame: it blends
 *     the pose toward the idle / walk / run / jump / fall / landing targets,
 *     advances the walk cycle, breathes on idle, and decays the landing dip.
 *
 * The model is presentation-only: it cannot change positions, velocities,
 * colliders, movement, input, prediction/reconciliation, or authority. Every
 * number in {@link PlayerPoseConfig} is visual tuning.
 */

/** The discrete display state of the player body. */
export type PlayerPoseState = "idle" | "walk" | "run" | "jump" | "fall";

/**
 * The current (smoothed) display pose. The model updates its internal pose
 * in place (zero allocation per frame); consumers read it through the
 * `pose` getter, which returns a `Readonly<PlayerPose>` view.
 */
export interface PlayerPose {
  /** Discrete display state derived from the kinematic estimate. */
  state: PlayerPoseState;
  /** Smoothed horizontal speed (m/s). */
  speed: number;
  /** Walk-cycle phase in radians; advances only while moving on the ground. */
  walkPhase: number;
  /** Upper-body vertical bob (metres, signed). */
  bob: number;
  /** Upper-body forward lean (radians; positive = forward). */
  lean: number;
  /** Leg swing amplitude (radians); 0 while idle or airborne. */
  legSwing: number;
  /** Arm counter-swing amplitude (radians). */
  armSwing: number;
  /** Weapon-aim stance blend, 0..1 (arms raised into the ready pose). */
  armRaise: number;
  /** Aim pitch (radians, smoothed; positive = looking up). */
  aimPitch: number;
  /** Idle breathing oscillator, -1..1. */
  breath: number;
  /** Jump (tuck) pose blend, 0..1. */
  jumpBlend: number;
  /** Fall pose blend, 0..1. */
  fallBlend: number;
  /** Landing dip, 0..1; set on landing, decays over time. */
  landingDip: number;
  /** True while the body is airborne (jump/fall). */
  airborne: boolean;
}

/** Presentation-only tuning for the procedural pose. */
export interface PlayerPoseConfig {
  /** Horizontal speed (m/s) below which the body is idle. */
  readonly idleSpeed: number;
  /** Horizontal speed (m/s) at/above which the gait reads as a run. */
  readonly runSpeed: number;
  /** Upward vertical velocity (m/s) that launches the airborne state. */
  readonly jumpVy: number;
  /** Downward vertical velocity magnitude (m/s) that launches the airborne
   * state when there was no upward launch (running off a ledge). */
  readonly fallEntryVy: number;
  /** |Vertical velocity| (m/s) below which an airborne body is grounded. */
  readonly groundVy: number;
  /** Minimum airborne samples before a landing may register (rejects
   * single-sample glitches such as tiny step-downs). */
  readonly minAirborneSamples: number;
  /** Descent speed (m/s) at/above which a landing produces a dip. Kept
   * above single-sample step-down velocities (~3 m/s for a 10 cm step at
   * 30 Hz) so tiny steps never read as landings. */
  readonly minLandingFallSpeed: number;
  /** Descent speed (m/s) at which the landing dip is at its maximum. */
  readonly fullLandingFallSpeed: number;
  /** Maximum landing dip applied to the upper body (metres). */
  readonly maxLandingDipMeters: number;
  /** Sample gap (seconds) beyond which the position stream is treated as a
   * discontinuity (tab hidden / reconnect) and velocity history is dropped. */
  readonly maxSampleIntervalSeconds: number;
  /** Sample speed (m/s) beyond which a sample is treated as a teleport and
   * the velocity history is dropped instead of faking a speed spike. */
  readonly maxPlausibleSpeed: number;
  /** Exponential smoothing rate (per second) of the horizontal speed. */
  readonly horizontalSmoothingRate: number;
  /** Exponential blend rate (per second) of pose transitions. */
  readonly poseBlendRate: number;
  /** Exponential decay rate (per second) of the landing dip. */
  readonly landingDipDecayRate: number;
  /** Walk-cycle phase rate (radians per second per m/s of speed). */
  readonly walkPhaseRate: number;
  /** Peak leg swing amplitude at full run speed (radians). */
  readonly maxLegSwing: number;
  /** Peak arm counter-swing amplitude at full run speed (radians). */
  readonly maxArmSwing: number;
  /** Peak upper-body bob at full run speed (metres). */
  readonly maxBob: number;
  /** Idle breathing bob amplitude (metres). */
  readonly idleBreathBob: number;
  /** Idle breathing rate (radians per second). */
  readonly breathRate: number;
  /** Peak forward lean at full run speed (radians). */
  readonly maxLean: number;
  /** Upper-body lean while jumping (radians; positive = forward). */
  readonly jumpLean: number;
  /** Upper-body lean while falling (radians; negative = slight back lean). */
  readonly fallLean: number;
}

/**
 * Default (restrained) tuning, matched to the shared movement constants
 * (moveSpeed 6 m/s, jumpSpeed 9 m/s, gravity -25 m/s²): a full jump lands
 * near 9 m/s and reads as the full ~12 cm dip.
 */
export const DEFAULT_PLAYER_POSE_CONFIG: PlayerPoseConfig = {
  idleSpeed: 0.3,
  runSpeed: 3,
  jumpVy: 1.5,
  fallEntryVy: 1.0,
  groundVy: 0.5,
  minAirborneSamples: 3,
  minLandingFallSpeed: 4,
  fullLandingFallSpeed: 9,
  maxLandingDipMeters: 0.12,
  maxSampleIntervalSeconds: 0.25,
  maxPlausibleSpeed: 25,
  horizontalSmoothingRate: 8,
  poseBlendRate: 10,
  landingDipDecayRate: 9,
  walkPhaseRate: 1.8,
  maxLegSwing: 0.65,
  maxArmSwing: 0.45,
  maxBob: 0.035,
  idleBreathBob: 0.006,
  breathRate: 2.2,
  maxLean: 0.16,
  jumpLean: 0.08,
  fallLean: -0.12,
};

const TWO_PI = Math.PI * 2;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * The procedural pose state machine + clock.
 *
 * Usage (the presentation's contract):
 *  - `sample(x, y, z, timeMs)` — once per canonical position update (any
 *    cadence: simulation ticks for the local player, interpolation frames
 *    for remote players);
 *  - `setAim(pitchRadians, weaponReady)` — once per render frame;
 *  - `advance(deltaSeconds)` — once per render frame;
 *  - `pose` — read the current smoothed pose and drive presentation meshes.
 */
export class PlayerPoseModel {
  private readonly config: PlayerPoseConfig;
  private readonly _pose: PlayerPose;

  // --- kinematics derived from the canonical position stream -------------
  private _prev: { x: number; y: number; z: number; timeMs: number } | null =
    null;
  private _smoothedSpeed = 0;
  private _lastVy = 0;
  private _grounded = true;
  private _airborneSamples = 0;
  private _peakFallSpeed = 0;

  // --- aim input (set by the presentation each frame) --------------------
  private _aimPitchTarget = 0;
  private _weaponReady = false;

  // --- animation clock ----------------------------------------------------
  private _breathTime = 0;

  public constructor(config: PlayerPoseConfig = DEFAULT_PLAYER_POSE_CONFIG) {
    this.config = config;
    this._pose = {
      state: "idle",
      speed: 0,
      walkPhase: 0,
      bob: 0,
      lean: 0,
      legSwing: 0,
      armSwing: 0,
      armRaise: 0,
      aimPitch: 0,
      breath: 0,
      jumpBlend: 0,
      fallBlend: 0,
      landingDip: 0,
      airborne: false,
    };
  }

  /** The current smoothed display pose (safe to read at any time). */
  public get pose(): Readonly<PlayerPose> {
    return this._pose;
  }

  /**
   * Feed one canonical position sample — the same values the presentation
   * mirrors from predicted / interpolated state — timestamped in ms.
   *
   * Any cadence is fine (simulation ticks, interpolation frames). Duplicate
   * timestamps are ignored; gaps above `maxSampleIntervalSeconds` (tab
   * hidden / reconnect) and super-plausible samples (teleports,
   * reconciliation jumps) drop the velocity history instead of faking a
   * speed spike.
   */
  public sample(x: number, y: number, z: number, timeMs: number): void {
    const c = this.config;
    if (this._prev !== null) {
      const dt = (timeMs - this._prev.timeMs) / 1000;
      if (dt > 0 && dt <= c.maxSampleIntervalSeconds) {
        const vx = (x - this._prev.x) / dt;
        const vy = (y - this._prev.y) / dt;
        const vz = (z - this._prev.z) / dt;
        const speed = Math.hypot(vx, vz);
        if (
          speed <= c.maxPlausibleSpeed &&
          Math.abs(vy) <= c.maxPlausibleSpeed
        ) {
          const alpha = 1 - Math.exp(-c.horizontalSmoothingRate * dt);
          this._smoothedSpeed += (speed - this._smoothedSpeed) * alpha;
          this._lastVy = vy;
          this._stepGrounding(vy);
        } else {
          this._resetKinematics();
        }
      } else if (dt > c.maxSampleIntervalSeconds) {
        // Stale stream: no velocity may be inferred across the gap.
        this._resetKinematics();
      }
      // dt <= 0: duplicate timestamp — ignore.
    }
    this._prev = { x, y, z, timeMs };
  }

  /**
   * Set the display aim input for the next {@link advance}: the aim pitch in
   * radians (0 = horizontal, positive = looking up) and whether the body
   * holds the weapon-ready (aim) stance. The presentation derives these from
   * the existing canonical state — local: the active camera's aim direction;
   * remote: neutral facing (the aim pitch of a remote player is not
   * replicated, so the same logic runs with the facing-only fallback).
   */
  public setAim(pitchRadians: number, weaponReady: boolean): void {
    this._aimPitchTarget = clamp(pitchRadians, -1.3, 1.3);
    this._weaponReady = weaponReady;
  }

  /**
   * Advance the animation clock by one render frame: transition the pose
   * toward the current targets, advance the walk cycle, breathe on idle,
   * and decay the landing dip. No-op for non-positive deltas.
   */
  public advance(deltaSeconds: number): void {
    if (deltaSeconds <= 0) return;
    const c = this.config;
    const p = this._pose;
    const blend = 1 - Math.exp(-c.poseBlendRate * deltaSeconds);

    this._breathTime += deltaSeconds;
    p.breath = Math.sin(this._breathTime * c.breathRate);

    // --- discrete state --------------------------------------------------
    p.state = this._currentState();
    p.airborne = !this._grounded;
    p.speed = this._smoothedSpeed;

    // --- walk cycle (freezes while airborne) ------------------------------
    if (this._grounded && this._smoothedSpeed >= c.idleSpeed) {
      p.walkPhase =
        (p.walkPhase +
          this._smoothedSpeed * c.walkPhaseRate * deltaSeconds) %
        TWO_PI;
    }
    const moving = Math.min(1, this._smoothedSpeed / c.runSpeed);

    p.legSwing +=
      ((this._grounded ? moving * c.maxLegSwing : 0) - p.legSwing) * blend;
    p.armSwing +=
      ((this._grounded ? moving * c.maxArmSwing : 0) - p.armSwing) * blend;

    let targetBob: number;
    if (!this._grounded) targetBob = 0;
    else if (p.state === "idle") targetBob = c.idleBreathBob * p.breath;
    else targetBob = c.maxBob * moving * Math.sin(2 * p.walkPhase);
    p.bob += (targetBob - p.bob) * blend;

    const targetLean = !this._grounded
      ? p.state === "jump"
        ? c.jumpLean
        : c.fallLean
      : p.state === "idle"
        ? 0
        : c.maxLean * moving;
    p.lean += (targetLean - p.lean) * blend;

    // --- aim stance ---------------------------------------------------------
    p.armRaise += ((this._weaponReady ? 1 : 0) - p.armRaise) * blend;
    p.aimPitch += (this._aimPitchTarget - p.aimPitch) * blend;

    // --- airborne pose blends ----------------------------------------------
    p.jumpBlend += ((p.state === "jump" ? 1 : 0) - p.jumpBlend) * blend;
    p.fallBlend += ((p.state === "fall" ? 1 : 0) - p.fallBlend) * blend;

    // --- landing dip decay --------------------------------------------------
    if (p.landingDip > 0) {
      p.landingDip *= Math.exp(-c.landingDipDecayRate * deltaSeconds);
      if (p.landingDip < 0.001) p.landingDip = 0;
    }
  }

  /**
   * Back to the idle baseline: clears kinematics, aim, and every pose value
   * (round reset / reconnect).
   */
  public reset(): void {
    this._resetKinematics();
    this._aimPitchTarget = 0;
    this._weaponReady = false;
    this._breathTime = 0;
    const p = this._pose;
    p.state = "idle";
    p.speed = 0;
    p.walkPhase = 0;
    p.bob = 0;
    p.lean = 0;
    p.legSwing = 0;
    p.armSwing = 0;
    p.armRaise = 0;
    p.aimPitch = 0;
    p.breath = 0;
    p.jumpBlend = 0;
    p.fallBlend = 0;
    p.landingDip = 0;
    p.airborne = false;
  }

  // --- internals -----------------------------------------------------------

  private _currentState(): PlayerPoseState {
    if (!this._grounded) return this._lastVy >= 0 ? "jump" : "fall";
    if (this._smoothedSpeed < this.config.idleSpeed) return "idle";
    if (this._smoothedSpeed < this.config.runSpeed) return "walk";
    return "run";
  }

  /**
   * Grounded/airborne transition from the raw per-sample vertical velocity.
   * A landing only registers after `minAirborneSamples` airborne samples so
   * single-sample glitches (tiny step-downs, interpolation hiccups) never
   * produce a landing dip.
   */
  private _stepGrounding(vy: number): void {
    const c = this.config;
    if (this._grounded) {
      if (vy > c.jumpVy || vy < -c.fallEntryVy) {
        this._grounded = false;
        this._airborneSamples = 1;
        this._peakFallSpeed = 0;
      }
      return;
    }
    this._airborneSamples += 1;
    if (vy < 0) this._peakFallSpeed = Math.max(this._peakFallSpeed, -vy);
    if (
      Math.abs(vy) <= c.groundVy &&
      this._airborneSamples >= c.minAirborneSamples
    ) {
      this._grounded = true;
      this._airborneSamples = 0;
      if (this._peakFallSpeed >= c.minLandingFallSpeed) {
        this._pose.landingDip = Math.min(
          1,
          this._peakFallSpeed / c.fullLandingFallSpeed,
        );
      }
      this._peakFallSpeed = 0;
    }
  }

  private _resetKinematics(): void {
    this._prev = null;
    this._smoothedSpeed = 0;
    this._lastVy = 0;
    this._grounded = true;
    this._airborneSamples = 0;
    this._peakFallSpeed = 0;
  }
}
