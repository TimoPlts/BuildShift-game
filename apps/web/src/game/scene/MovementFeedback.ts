/**
 * MovementFeedback — reusable, self-cleaning presentation component for
 * movement feedback (Babylon scene + pure math).
 *
 * Driven EXCLUSIVELY from the existing client movement state (one predicted
 * sample per simulation tick: position, grounded flag, vertical velocity).
 * It never changes movement speed, gravity, jump velocity, collision,
 * prediction/reconciliation, input, or aim.
 *
 * Public API — the calls the runtime makes:
 *
 *   1. `step(sample)`
 *      One simulation tick of the client's predicted movement state.
 *      Detects jump launch and landing, then:
 *        - landing:  a bounded/reused dust burst at the ground point,
 *          scaled by fall speed, plus a small downward camera dip
 *          (capped, eases back to zero);
 *        - jump:     a small dust burst posed on the last ground level,
 *          plus a small upward camera nudge.
 *
 *   2. `updateCameraMotion(deltaSeconds)`
 *      Once per render frame: decays the transient vertical camera offset
 *      and returns it (metres, world Y). The runtime feeds it to the
 *      camera's transient vertical offset — a translation shared by camera
 *      position and look target, so the aim direction is never disturbed.
 *
 *   3. `reset()`
 *      Round reset / reconnect: clears the event tracker, the camera
 *      offset, and deactivates any live dust without disposing anything.
 *
 *   4. `dispose()`
 *      Idempotent teardown: removes the single scene render observer and
 *      releases every owned mesh and material.
 *
 * Design notes:
 *   - Dust is served from a fixed pool of pre-created slots, so repeated
 *     jumping/landing cannot grow meshes, materials, or observers.
 *   - All effects expire on their own; `reset` is for clean round
 *     boundaries (rematch) rather than for expiry.
 */
import type { Observer, Scene } from "@babylonjs/core";
import {
  MovementCameraMotion,
  MovementEventTracker,
  type MovementSample,
} from "./movement/movementFeedbackModel";
import { MovementDust } from "./movement/movementDust";

/** Dust intensity for a jump takeoff (restrained, fixed). */
const JUMP_DUST_INTENSITY = 0.3;

/** Fall speed (m/s) that maps to full landing-dust intensity. */
const LANDING_FULL_INTENSITY_FALL_SPEED = 12;

/** Minimum landing-dust intensity so even a small step-down reads. */
const LANDING_MIN_INTENSITY = 0.3;

/** Maps a landing fall speed (m/s) to a dust intensity in [0.3, 1]. */
function landingDustIntensity(fallSpeedMetersPerSec: number): number {
  const t = Math.max(0, fallSpeedMetersPerSec) / LANDING_FULL_INTENSITY_FALL_SPEED;
  return Math.min(1, Math.max(LANDING_MIN_INTENSITY, t));
}

export class MovementFeedback {
  private readonly scene: Scene;
  private readonly dust: MovementDust;
  private readonly cameraMotion: MovementCameraMotion;
  private readonly tracker = new MovementEventTracker();
  private readonly observer: Observer<Scene>;
  private _disposed = false;

  public constructor(scene: Scene, cameraMotion: MovementCameraMotion = new MovementCameraMotion()) {
    this.scene = scene;
    this.dust = new MovementDust(scene);
    this.cameraMotion = cameraMotion;
    // One scene observer, driven by the render loop's clock — no DOM, no
    // extra listeners. (The camera offset decay is driven per render frame
    // by the runtime via updateCameraMotion, mirroring the recoil model.)
    this.observer = scene.onBeforeRenderObservable.add(() => {
      this.dust.tick(Date.now());
    });
  }

  /**
   * One simulation tick of the existing client movement state (the predicted
   * sample the runtime already computes). Pure presentation: no gameplay
   * state is read beyond the sample or mutated at all.
   */
  public step(sample: MovementSample): void {
    if (this._disposed) return;

    const events = this.tracker.sample(sample);
    const nowMs = Date.now();

    if (events.landed) {
      this.cameraMotion.onLanding(events.landingFallSpeed);
      this.dust.spawn(
        sample.x,
        sample.y,
        sample.z,
        landingDustIntensity(events.landingFallSpeed),
        nowMs,
      );
    }

    if (events.jumped) {
      this.cameraMotion.onJump();
      // Pose the takeoff burst on the last ground level (the launch sample's
      // own Y is already slightly above the ground).
      this.dust.spawn(sample.x, this.tracker.lastGroundY, sample.z, JUMP_DUST_INTENSITY, nowMs);
    }
  }

  /**
   * Once per render frame: decay the transient vertical camera offset and
   * return the current value (metres, world Y; positive = nudged up).
   */
  public updateCameraMotion(deltaSeconds: number): number {
    if (this._disposed) return 0;
    return this.cameraMotion.update(deltaSeconds);
  }

  /** Round reset / reconnect: clear events, camera offset, and live dust. */
  public reset(): void {
    if (this._disposed) return;
    this.tracker.reset();
    this.cameraMotion.reset();
    this.dust.deactivateAll();
  }

  /** Idempotent teardown: releases every owned mesh/material and observer. */
  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.scene.onBeforeRenderObservable.remove(this.observer);
    this.dust.dispose();
  }
}
