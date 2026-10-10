/**
 * Per-structure visual effect state for build presentation.
 *
 * Tracks the transient visual effects that can be active on a structure mesh
 * simultaneously:
 *  - **construction** — scale-in pop when a structure first appears
 *  - **confirmation** — short emissive glow confirming an accepted placement
 *  - **hitFlash** — brief emissive flash when durability decreases
 *  - **destruction** — scale-out + fade when a structure is authoritatively removed
 *
 * Also tracks an **edit transition** for smooth half-wall shape changes.
 *
 * This module is pure: no Babylon imports, no scene, no game state.
 * The {@link BuildStructureRenderer} owns the meshes and calls
 * {@link applyEffects} each frame to compose the final visual state.
 */

import {
  animationProgress,
  createAnimation,
  easeInQuad,
  easeInOutCubic,
  easeOutBack,
  easeOutQuad,
  type AnimationState,
} from "./animations";

// ─── Durations (ms) ──────────────────────────────────────────────────────────

/** Construction pop-in duration. */
export const CONSTRUCTION_DURATION = 200;
/**
 * Placement-confirmation glow duration: the short authoritative acceptance
 * pulse that plays (on top of the pop-in) when a structure first appears in
 * the replicated state. Kept at or under the construction duration so the
 * structure is fully settled once both transient effects are done.
 */
export const PLACEMENT_CONFIRM_DURATION = 220;
/** Hit flash duration. */
export const HIT_FLASH_DURATION = 180;
/** Destruction fade-out duration. */
export const DESTRUCTION_DURATION = 250;
/** Edit transition duration. */
export const EDIT_TRANSITION_DURATION = 200;
/** Durability fraction below which a structure is considered "nearly broken". */
export const NEARLY_BROKEN_THRESHOLD = 0.25;
/** Warning pulse frequency for nearly-broken structures (cycles per second). */
export const WARNING_PULSE_FREQ = 3.0;
/** Peak warning pulse emissive strength. */
export const WARNING_PULSE_STRENGTH = 0.35;
/** Fraction of the destruction duration used for the impact flash. */
export const DESTRUCTION_IMPACT_RATIO = 0.3;

// ─── State ───────────────────────────────────────────────────────────────────

/**
 * The transient visual effects tracked per structure.
 * Each field is null when that effect is not active.
 */
export interface StructureEffects {
  construction: AnimationState | null;
  /** Short acceptance glow when the structure first appears (authoritative). */
  confirmation: AnimationState | null;
  hitFlash: AnimationState | null;
  destruction: AnimationState | null;
  editTransition: EditTransition | null;
}

/** A smooth interpolation between two edit poses (full ↔ half-top ↔ half-bottom). */
export interface EditTransition {
  fromScaleY: number;
  fromYOffset: number;
  toScaleY: number;
  toYOffset: number;
  startTime: number;
  duration: number;
  done: boolean;
}

// ─── Factories ───────────────────────────────────────────────────────────────

/** Fresh effects for a newly-constructed structure (construction pop +
 * authoritative placement-confirmation glow active). */
export function createConstructionEffects(now: number): StructureEffects {
  return {
    construction: createAnimation(now, CONSTRUCTION_DURATION),
    confirmation: createAnimation(now, PLACEMENT_CONFIRM_DURATION),
    hitFlash: null,
    destruction: null,
    editTransition: null,
  };
}

/** Effects for a structure entering destruction (scale-out + fade). */
export function createDestructionEffects(now: number): StructureEffects {
  return {
    construction: null,
    confirmation: null,
    hitFlash: null,
    destruction: createAnimation(now, DESTRUCTION_DURATION),
    editTransition: null,
  };
}

/** Start an edit transition from one pose to another. */
export function startEditTransition(
  effects: StructureEffects,
  fromScaleY: number,
  fromYOffset: number,
  toScaleY: number,
  toYOffset: number,
  now: number,
): void {
  effects.editTransition = {
    fromScaleY,
    fromYOffset,
    toScaleY,
    toYOffset,
    startTime: now,
    duration: EDIT_TRANSITION_DURATION,
    done: false,
  };
}

/** Trigger a hit flash on existing effects. */
export function triggerHitFlash(effects: StructureEffects, now: number): void {
  effects.hitFlash = createAnimation(now, HIT_FLASH_DURATION);
}

// ─── Application ─────────────────────────────────────────────────────────────

/**
 * The composed visual state to apply to a structure mesh this frame.
 *
 * Instances can be reused across frames ({@link createComposedVisual} +
 * {@link composeVisualInto}) so per-frame composition does not allocate.
 */
export interface ComposedVisual {
  /** Uniform scale multiplier (construction pop, destruction shrink). */
  uniformScale: number;
  /** Y-axis scale (1 = full height, 0.5 = half-wall). */
  scaleY: number;
  /** Y position offset in world units (for half-wall shifts). */
  yOffset: number;
  /** Material alpha (1 = opaque, fades during destruction). */
  alpha: number;
  /** Additional emissive color to add (hit flash, destruction impact). */
  emissiveBoost: [number, number, number];
  /** Additional diffuse color to add (hit flash white-shift). */
  diffuseBoost: [number, number, number];
  /**
   * Placement-confirmation glow strength (0..1): 1 when a structure is first
   * accepted, decaying to 0 over {@link PLACEMENT_CONFIRM_DURATION}.
   */
  confirmStrength: number;
}

/**
 * Create a reusable {@link ComposedVisual} buffer for per-frame composition
 * ({@link composeVisualInto}).
 */
export function createComposedVisual(): ComposedVisual {
  return {
    uniformScale: 1,
    scaleY: 1,
    yOffset: 0,
    alpha: 1,
    emissiveBoost: [0, 0, 0],
    diffuseBoost: [0, 0, 0],
    confirmStrength: 0,
  };
}

/**
 * Compute the composed visual state from the current effects and the
 * structure's base edit pose.
 *
 * @param effects       The per-structure effect state.
 * @param baseScaleY    The edit-derived Y scale (1 for full wall, 0.5 for half).
 * @param baseYOffset   The edit-derived Y position offset.
 * @param now           Current timestamp in ms.
 * @returns The composed visual to apply to the mesh this frame, plus
 *          whether all transient animations are complete.
 */
export function composeVisual(
  effects: StructureEffects,
  baseScaleY: number,
  baseYOffset: number,
  now: number,
): { visual: ComposedVisual; allDone: boolean; shouldRemove: boolean } {
  const visual = createComposedVisual();
  const flags = composeVisualInto(effects, baseScaleY, baseYOffset, now, visual);
  return { visual, ...flags };
}

/**
 * Compute the composed visual state in place into a caller-owned
 * {@link ComposedVisual} buffer — no allocation per call. The caller must
 * consume (or overwrite) `out` before passing it to the next call.
 *
 * Returns the completion flags only; the visual itself is written into
 * `out`.
 */
export function composeVisualInto(
  effects: StructureEffects,
  baseScaleY: number,
  baseYOffset: number,
  now: number,
  out: ComposedVisual,
): { allDone: boolean; shouldRemove: boolean } {
  let uniformScale = 1;
  let scaleY = baseScaleY;
  let yOffset = baseYOffset;
  let alpha = 1;
  const emissiveBoost = out.emissiveBoost;
  const diffuseBoost = out.diffuseBoost;
  emissiveBoost[0] = 0;
  emissiveBoost[1] = 0;
  emissiveBoost[2] = 0;
  diffuseBoost[0] = 0;
  diffuseBoost[1] = 0;
  diffuseBoost[2] = 0;
  out.confirmStrength = 0;
  let allDone = true;

  // Edit transition: lerp between old and new edit pose
  if (effects.editTransition && !effects.editTransition.done) {
    const t = animationProgress(effects.editTransition, now);
    const e = easeInOutCubic(t);
    scaleY = effects.editTransition.fromScaleY + (effects.editTransition.toScaleY - effects.editTransition.fromScaleY) * e;
    yOffset = effects.editTransition.fromYOffset + (effects.editTransition.toYOffset - effects.editTransition.fromYOffset) * e;
    if (!effects.editTransition.done) allDone = false;
  }

  // Construction pop-in
  if (effects.construction && !effects.construction.done) {
    const t = animationProgress(effects.construction, now);
    uniformScale = easeOutBack(t);
    if (!effects.construction.done) allDone = false;
  }

  // Placement-confirmation glow (short authoritative acceptance pulse)
  if (effects.confirmation && !effects.confirmation.done) {
    const t = animationProgress(effects.confirmation, now);
    out.confirmStrength = 1 - easeOutQuad(t);
    if (!effects.confirmation.done) allDone = false;
  }

  // Destruction scale-out + fade, with an impact flash at the start
  let shouldRemove = false;
  if (effects.destruction && !effects.destruction.done) {
    const t = animationProgress(effects.destruction, now);
    const shrink = 1 - easeInQuad(t);
    uniformScale *= Math.max(0.01, shrink);
    alpha = 1 - easeInQuad(t);
    allDone = false;
    if (effects.destruction.done) {
      shouldRemove = true;
    }
    // Impact flash: brief orange-white spike during the first portion of destruction
    if (t < DESTRUCTION_IMPACT_RATIO) {
      const flashT = t / DESTRUCTION_IMPACT_RATIO;
      const flashStrength = 1 - flashT;
      emissiveBoost[0] += flashStrength * 1.2;
      emissiveBoost[1] += flashStrength * 0.7;
      emissiveBoost[2] += flashStrength * 0.3;
    }
  }

  // Hit flash (additive emissive + diffuse white-shift)
  if (effects.hitFlash && !effects.hitFlash.done) {
    const t = animationProgress(effects.hitFlash, now);
    const flash = 1 - t;
    emissiveBoost[0] += flash * 1.0;
    emissiveBoost[1] += flash * 1.0;
    emissiveBoost[2] += flash * 1.2;
    diffuseBoost[0] = flash * 0.4;
    diffuseBoost[1] = flash * 0.4;
    diffuseBoost[2] = flash * 0.4;
    if (!effects.hitFlash.done) allDone = false;
  }

  out.uniformScale = uniformScale;
  out.scaleY = scaleY;
  out.yOffset = yOffset;
  out.alpha = alpha;

  return { allDone, shouldRemove };
}
