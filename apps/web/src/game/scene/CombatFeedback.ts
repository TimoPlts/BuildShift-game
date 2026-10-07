/**
 * Reusable presentation component for combat feedback (Babylon only).
 *
 * Public API — the calls the client runtime worker is expected to use:
 *
 *   1. `playShot(weaponType, origin, aimDirection)`
 *      Local accepted shot: per-weapon muzzle flash plus a short tracer.
 *
 *   2. `triggerHitMarker()`
 *      Confirmed player hit: brief center-screen hit marker. Call only
 *      after an authoritative event confirms the local player as shooter.
 *
 *   3. `playBuildImpact(worldPosition)`
 *      Confirmed structure hit: brief spark at the given world position.
 *      Call only after an authoritative event confirms the structure hit.
 *
 *   4. `dispose()`
 *      Idempotent teardown: removes the single scene render observer and
 *      releases every owned mesh and material.
 *
 * Also available:
 *   - `reset()` — immediately deactivates all live effects (e.g. on round
 *     reset) without disposing anything.
 *   - `triggerMuzzleFlash(weaponType, position)` — compatibility shim kept
 *     for existing wiring; flash only, no tracer. Prefer `playShot`.
 *
 * Design notes:
 *   - Uses only Babylon primitives and materials — no external assets.
 *   - Every effect is served from a bounded pool of pre-created
 *     mesh/material slots, so repeated firing cannot grow meshes,
 *     materials, or observers.
 *   - This component never decides whether a hit occurred, never touches
 *     gameplay state, and does not add camera recoil (that belongs to the
 *     client/runtime layer).
 */
import type { WeaponType } from "@buildshift/protocol";
import type { Scene, Observer } from "@babylonjs/core";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PooledEffectGroup } from "./combat/pooledEffect";
import { activateMuzzleFlash, createMuzzleFlashGroup } from "./combat/muzzleFlash";
import { activateTracer, createTracerGroup } from "./combat/tracer";
import { activateHitMarker, createHitMarkerGroup } from "./combat/hitMarker";
import { activateBuildImpact, createBuildImpactGroup } from "./combat/buildImpact";

export class CombatFeedback {
  private readonly _scene: Scene;
  private readonly _muzzleFlashes: PooledEffectGroup;
  private readonly _tracers: PooledEffectGroup;
  private readonly _hitMarkers: PooledEffectGroup;
  private readonly _buildImpacts: PooledEffectGroup;
  private readonly _observer: Observer<Scene>;
  private _disposed = false;

  constructor(scene: Scene) {
    this._scene = scene;
    this._muzzleFlashes = createMuzzleFlashGroup(scene);
    this._tracers = createTracerGroup(scene);
    this._hitMarkers = createHitMarkerGroup(scene);
    this._buildImpacts = createBuildImpactGroup(scene);
    this._observer = scene.onBeforeRenderObservable.add(() => this._tick());
  }

  /**
   * Local accepted shot: per-weapon muzzle flash at `origin` plus a short
   * tracer from `origin` along `aimDirection`.
   */
  playShot(weaponType: WeaponType, origin: Vector3, aimDirection: Vector3): void {
    if (this._disposed) return;
    const nowMs = Date.now();
    activateMuzzleFlash(this._muzzleFlashes, weaponType, origin, nowMs);
    activateTracer(this._tracers, weaponType, origin, aimDirection, nowMs);
  }

  /**
   * Compatibility shim: muzzle flash only (no tracer). Existing GameRuntime
   * wiring calls this; prefer {@link playShot} for new wiring.
   */
  triggerMuzzleFlash(weaponType: WeaponType, muzzlePosition: Vector3): void {
    if (this._disposed) return;
    activateMuzzleFlash(this._muzzleFlashes, weaponType, muzzlePosition, Date.now());
  }

  /**
   * Confirmed player hit: brief center-screen hit marker in front of the
   * active camera.
   */
  triggerHitMarker(): void {
    if (this._disposed) return;
    activateHitMarker(this._hitMarkers, this._scene, Date.now());
  }

  /**
   * Confirmed structure hit: brief world-anchored spark at `worldPosition`.
   */
  playBuildImpact(worldPosition: Vector3): void {
    if (this._disposed) return;
    activateBuildImpact(this._buildImpacts, worldPosition, Date.now());
  }

  /** Immediately deactivate every live effect without disposing anything. */
  reset(): void {
    if (this._disposed) return;
    this._muzzleFlashes.deactivateAll();
    this._tracers.deactivateAll();
    this._hitMarkers.deactivateAll();
    this._buildImpacts.deactivateAll();
  }

  /**
   * Dispose every owned mesh and material and remove the scene render
   * observer. Safe to call multiple times.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this._scene.onBeforeRenderObservable.remove(this._observer);
    this._muzzleFlashes.dispose();
    this._tracers.dispose();
    this._hitMarkers.dispose();
    this._buildImpacts.dispose();
  }

  private _tick(): void {
    const nowMs = Date.now();
    this._muzzleFlashes.tick(nowMs);
    this._tracers.tick(nowMs);
    this._hitMarkers.tick(nowMs);
    this._buildImpacts.tick(nowMs);
  }
}
