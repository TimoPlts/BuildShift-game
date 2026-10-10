/**
 * Animation timing utilities for build presentation effects.
 *
 * Pure, transport-neutral helpers: no Babylon imports, no game state.
 * Used by {@link StructureEffects} and {@link BuildStructureRenderer} to
 * compute per-frame progression for construction pops, hit flashes,
 * destruction fades, and edit transitions.
 */

/** Clamp a value to [0, 1]. */
export function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

/**
 * Ease-out-back: overshoots slightly past 1 before settling.
 * Used for the construction "pop" scale-in.
 */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Ease-in-quadratic: accelerates from rest.
 * Used for destruction scale-out.
 */
export function easeInQuad(t: number): number {
  return t * t;
}

/**
 * Ease-out-quadratic: decelerates toward rest.
 * Used for the placement-confirmation glow decay.
 */
export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Ease-in-out-cubic: smooth acceleration then deceleration.
 * Used for edit transitions.
 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** A single timed animation track. */
export interface AnimationState {
  /** Timestamp (ms) when the animation started. */
  startTime: number;
  /** Total duration in milliseconds. */
  duration: number;
  /** Set to true by {@link animationProgress} when elapsed >= duration. */
  done: boolean;
}

/** Create a new animation state. */
export function createAnimation(startTime: number, duration: number): AnimationState {
  return { startTime, duration, done: false };
}

/**
 * Compute and advance the progress of an animation.
 * Returns a value in [0, 1]. Sets `state.done = true` when complete.
 */
export function animationProgress(state: AnimationState, now: number): number {
  const elapsed = now - state.startTime;
  if (elapsed >= state.duration) {
    state.done = true;
    return 1;
  }
  return clamp01(elapsed / state.duration);
}
