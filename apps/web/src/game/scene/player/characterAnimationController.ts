/**
 * characterAnimationController — Babylon-only AnimationGroup state controller
 * for character model clips (Batch 2A, animation controller v1).
 *
 * The model loader produces the {@link AnimationGroup}s (one per clip) and
 * hands them to this controller; the controller owns only *playback*:
 *
 *   1. `attach(clip, group)` — register a clip for a state
 *      (`idle | run | jump | fall | crouch | aim | build | edit`) or the
 *      `fire` one-shot. Clips are optional: any subset (or none) may be
 *      attached, and every call is safe. Root-motion (position) animations
 *      targeting the transform root are stripped at attach time, so the
 *      controller guarantees zero root motion even for clips authored with
 *      baked translation.
 *
 *   2. `setState(state)` — intended to be called once per render frame with
 *      the derived locomotion state. A group is (re)started exactly once per
 *      real state change; repeated calls with the same state are strict
 *      no-ops — no per-frame restarts.
 *
 *   3. `triggerFire()` — plays the `fire` clip exactly once, non-looping.
 *      When it ends, the controller returns to the locomotion clip that is
 *      current at that moment. Re-triggering while the one-shot is playing
 *      is ignored (no restart, no double-fire).
 *
 *   4. `reset()` / `dispose()` — lifecycle.
 *
 * Guarantees / boundaries:
 *   - Presentation-only: the controller reads and writes only Babylon
 *     AnimationGroups and their targets; it never writes positions,
 *     velocities, colliders, input, prediction/reconciliation, or anything
 *     gameplay-owned. The character transform is driven by the loader /
 *     presentation, never by animation.
 *   - The controller never disposes the AnimationGroups it plays — those
 *     belong to the loaded model. It stops them and detaches its own
 *     observers on `dispose()`, which is idempotent; every API is a no-op
 *     afterwards.
 *   - Blending is optional: `transitionSpeed` (per second) enables
 *     cross-fade-in on group start; default 0 = hard cut.
 */
import type { AnimationGroup, Node, Observer } from "@babylonjs/core";

/** The persistent (frame-driven) character display states. */
export type CharacterAnimState =
  | "idle"
  | "run"
  | "jump"
  | "fall"
  | "crouch"
  | "aim"
  | "build"
  | "edit";

/** A clip slot: any persistent state, plus the `fire` one-shot. */
export type CharacterAnimClip = CharacterAnimState | "fire";

/** All persistent states, for iteration (tests, loader diagnostics). */
export const CHARACTER_ANIM_STATES: readonly CharacterAnimState[] = [
  "idle",
  "run",
  "jump",
  "fall",
  "crouch",
  "aim",
  "build",
  "edit",
];

export interface CharacterAnimationControllerOptions {
  /**
   * Cross-fade-in speed (per second) applied to clips when they start.
   * 0 (default) means hard cuts (Babylon default blending behaviour).
   */
  readonly transitionSpeed?: number;
  /** Optional per-clip playback speed multiplier (1 = authored speed). */
  readonly speedRatio?: Partial<Record<CharacterAnimClip, number>>;
}

export class CharacterAnimationController {
  private readonly _rootNode: Node;
  private readonly _transitionSpeed: number;
  private readonly _speedRatio: Readonly<Partial<Record<CharacterAnimClip, number>>>;
  private readonly _clips = new Map<CharacterAnimClip, AnimationGroup>();
  private readonly _fireEndObservers = new Map<AnimationGroup, Observer<AnimationGroup>>();
  private _persistentState: CharacterAnimState = "idle";
  private _activeGroup: AnimationGroup | null = null;
  private _fireActive = false;
  private _disposed = false;

  /**
   * @param rootNode the character transform root. Position animations
   *   targeting this node are stripped from every attached clip so
   *   animation can never move the character (zero root motion).
   */
  public constructor(rootNode: Node, options: CharacterAnimationControllerOptions = {}) {
    this._rootNode = rootNode;
    this._transitionSpeed = options.transitionSpeed ?? 0;
    this._speedRatio = options.speedRatio ?? {};
  }

  /**
   * Register (or replace) the clip for a slot. Safe with partial sets:
   * states without a clip simply play nothing. If the attached locomotion
   * clip matches the current state and nothing else is playing, it starts
   * immediately (covers clips arriving after `setState`).
   */
  public attach(clip: CharacterAnimClip, group: AnimationGroup): void {
    if (this._disposed) return;
    const previous = this._clips.get(clip);
    if (previous && previous !== group) {
      if (previous === this._activeGroup) this._stopActive();
      this._forgetFireObserver(previous);
      this._clips.delete(clip);
    }

    this._stripRootMotion(group);
    const isFire = clip === "fire";
    group.loopAnimation = !isFire;
    if (this._transitionSpeed > 0) {
      group.enableBlending = true;
      group.blendingSpeed = this._transitionSpeed;
    }
    this._clips.set(clip, group);

    if (isFire) {
      // Fire only ever starts through triggerFire(); the end observer is the
      // one-and-only return path to locomotion.
      const observer = group.onAnimationGroupEndObservable.add((finished) =>
        this._onFireGroupEnd(finished),
      );
      this._fireEndObservers.set(group, observer);
      return;
    }
    if (
      clip === this._persistentState &&
      !this._fireActive &&
      (this._activeGroup === null || this._activeGroup === previous)
    ) {
      this._playLocomotion(clip);
    }
  }

  /**
   * Frame-driven locomotion update. Repeated calls with the current state
   * are strict no-ops — groups are (re)started only on real transitions.
   * While a fire one-shot is playing this only records the state; the
   * locomotion clip resumes (in the new state) when the one-shot ends.
   */
  public setState(state: CharacterAnimState): void {
    if (this._disposed) return;
    if (state === this._persistentState) return;
    this._persistentState = state;
    if (this._fireActive) return;
    this._playLocomotion(state);
  }

  /** Play the fire one-shot once; returns to locomotion when it ends. */
  public triggerFire(): void {
    if (this._disposed || this._fireActive) return;
    const fire = this._clips.get("fire");
    if (!fire) return;
    this._fireActive = true;
    this._stopActive();
    fire.start(false, this._ratioFor("fire"));
    this._activeGroup = fire;
  }

  /** Back to idle immediately (round reset / reconnect). */
  public reset(): void {
    if (this._disposed) return;
    this._fireActive = false;
    this._persistentState = "idle";
    this._playLocomotion("idle");
  }

  /**
   * Idempotent teardown: stops the active group and detaches the
   * controller's fire-end observers. The AnimationGroups themselves are
   * model-owned and are NOT disposed here.
   */
  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._fireActive = false;
    for (const [group, observer] of this._fireEndObservers) {
      group.onAnimationGroupEndObservable.remove(observer);
    }
    this._fireEndObservers.clear();
    this._stopActive();
    this._clips.clear();
  }

  /** The last requested persistent state. */
  public getState(): CharacterAnimState {
    return this._persistentState;
  }

  /** True while the fire one-shot is playing. */
  public isFireActive(): boolean {
    return this._fireActive;
  }

  /** Whether a clip is registered for the slot. */
  public hasClip(clip: CharacterAnimClip): boolean {
    return this._clips.has(clip);
  }

  /** The clip slot currently actually playing, or null. */
  public activeClip(): CharacterAnimClip | null {
    if (this._fireActive) return "fire";
    if (this._activeGroup && this._activeGroup.isStarted) {
      return this._clipForGroup(this._activeGroup) ?? null;
    }
    return null;
  }

  // --- internals -----------------------------------------------------------

  /**
   * Zero root motion: drop every position animation targeting the transform
   * root so baked root-motion clips cannot move the character. Non-root and
   * non-position (e.g. skeleton) animations are untouched.
   */
  private _stripRootMotion(group: AnimationGroup): void {
    const targeted = [...group.targetedAnimations];
    for (const ta of targeted) {
      if (ta.target === this._rootNode && ta.animation.targetProperty === "position") {
        group.removeTargetedAnimation(ta.animation);
      }
    }
  }

  private _playLocomotion(state: CharacterAnimState): void {
    const group = this._clips.get(state);
    if (!group) {
      this._stopActive();
      return;
    }
    if (this._activeGroup === group && group.isStarted) return; // no restart
    this._stopActive();
    group.start(true, this._ratioFor(state));
    this._activeGroup = group;
  }

  private _stopActive(): void {
    if (this._activeGroup) {
      // skipOnAnimationEnd: transitions must not fire end callbacks.
      this._activeGroup.stop(true);
      this._activeGroup = null;
    }
  }

  private _onFireGroupEnd(finished: AnimationGroup): void {
    if (this._disposed || !this._fireActive) return;
    if (finished !== this._clips.get("fire")) return;
    this._fireActive = false;
    this._playLocomotion(this._persistentState);
  }

  private _forgetFireObserver(group: AnimationGroup): void {
    const observer = this._fireEndObservers.get(group);
    if (observer) {
      group.onAnimationGroupEndObservable.remove(observer);
      this._fireEndObservers.delete(group);
    }
  }

  private _ratioFor(clip: CharacterAnimClip): number {
    return this._speedRatio[clip] ?? 1;
  }

  private _clipForGroup(group: AnimationGroup): CharacterAnimClip | null {
    for (const [clip, candidate] of this._clips) {
      if (candidate === group) return clip;
    }
    return null;
  }
}
