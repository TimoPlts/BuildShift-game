/**
 * Per-structure visual effect state for build presentation.
 *
 * Tracks the three transient effects that can be active on a structure mesh
 * simultaneously:
 *  - **construction** — scale-in pop when a structure first appears
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
  type AnimationState,
} from "./animations";

// ─── Durations (ms) ──────────────────────────────────────────────────────────

/** Construction pop-in duration. */
export const CONSTRUCTION_DURATION = 200;
/** Hit flash duration. */
export const HIT_FLASH_DURATION = 150;
/** Destruction fade-out duration. */
export const DESTRUCTION_DURATION = 250;
/** Edit transition duration. */
export const EDIT_TRANSITION_DURATION = 200;

// ─── State ───────────────────────────────────────────────────────────────────

/**
 * The transient visual effects tracked per structure.
 * Each field is null when that effect is not active.
 */
export interface StructureEffects {
  construction: AnimationState | null;
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

/** Fresh effects for a newly-constructed structure (construction pop active). */
export function createConstructionEffects(now: number): StructureEffects {
  return {
    construction: createAnimation(now, CONSTRUCTION_DURATION),
    hitFlash: null,
    destruction: null,
    editTransition: null,
  };
}

/** Effects for a structure entering destruction (scale-out + fade). */
export function createDestructionEffects(now: number): StructureEffects {
  return {
    construction: null,
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
  /** Additional emissive color to add (hit flash). */
  emissiveBoost: [number, number, number];
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
  let uniformScale = 1;
  let scaleY = baseScaleY;
  let yOffset = baseYOffset;
  let alpha = 1;
  const emissiveBoost: [number, number, number] = [0, 0, 0];
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

  // Destruction scale-out + fade
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
  }

  // Hit flash (additive emissive)
  if (effects.hitFlash && !effects.hitFlash.done) {
    const t = animationProgress(effects.hitFlash, now);
    const flash = 1 - t;
    emissiveBoost[0] = flash * 0.8;
    emissiveBoost[1] = flash * 0.8;
    emissiveBoost[2] = flash * 0.9;
    if (!effects.hitFlash.done) allDone = false;
  }

  return {
    visual: { uniformScale, scaleY, yOffset, alpha, emissiveBoost },
    allDone,
    shouldRemove,
  };
}
