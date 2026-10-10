/**
 * Unit tests for buildPresentation structure effect state and composition.
 */
import { describe, expect, it } from "vitest";
import {
  composeVisual,
  composeVisualInto,
  createComposedVisual,
  createConstructionEffects,
  createDestructionEffects,
  startEditTransition,
  triggerHitFlash,
  CONSTRUCTION_DURATION,
  DESTRUCTION_DURATION,
  DESTRUCTION_IMPACT_RATIO,
  EDIT_TRANSITION_DURATION,
  HIT_FLASH_DURATION,
  PLACEMENT_CONFIRM_DURATION,
  type StructureEffects,
} from "./structureEffects";

const NOW = 10_000;

describe("createConstructionEffects", () => {
  it("has an active construction + confirmation animation and no other effects", () => {
    const effects = createConstructionEffects(NOW);
    expect(effects.construction).not.toBeNull();
    expect(effects.construction!.startTime).toBe(NOW);
    expect(effects.construction!.duration).toBe(CONSTRUCTION_DURATION);
    expect(effects.confirmation).not.toBeNull();
    expect(effects.confirmation!.startTime).toBe(NOW);
    expect(effects.confirmation!.duration).toBe(PLACEMENT_CONFIRM_DURATION);
    expect(effects.hitFlash).toBeNull();
    expect(effects.destruction).toBeNull();
    expect(effects.editTransition).toBeNull();
  });

  it("composeVisual at start gives scale 0", () => {
    const effects = createConstructionEffects(NOW);
    const { visual, allDone } = composeVisual(effects, 1, 0, NOW);
    expect(visual.uniformScale).toBeCloseTo(0, 2);
    expect(visual.scaleY).toBe(1);
    expect(visual.alpha).toBe(1);
    expect(allDone).toBe(false);
  });

  it("composeVisual after duration gives scale 1 and allDone", () => {
    const effects = createConstructionEffects(NOW);
    const { visual, allDone } = composeVisual(effects, 1, 0, NOW + PLACEMENT_CONFIRM_DURATION);
    expect(visual.uniformScale).toBeCloseTo(1, 2);
    expect(allDone).toBe(true);
  });
});

describe("placement confirmation glow", () => {
  it("decays from full strength to zero over the confirm duration", () => {
    const effects = createConstructionEffects(NOW);

    const atStart = composeVisual(effects, 1, 0, NOW);
    expect(atStart.visual.confirmStrength).toBeCloseTo(1, 5);
    expect(atStart.allDone).toBe(false);

    const mid = composeVisual(effects, 1, 0, NOW + PLACEMENT_CONFIRM_DURATION * 0.5);
    expect(mid.visual.confirmStrength).toBeGreaterThan(0);
    expect(mid.visual.confirmStrength).toBeLessThan(1);

    const after = composeVisual(effects, 1, 0, NOW + PLACEMENT_CONFIRM_DURATION);
    expect(after.visual.confirmStrength).toBe(0);
    expect(after.allDone).toBe(true);
  });

  it("keeps allDone false while the confirm glow is still decaying", () => {
    const effects = createConstructionEffects(NOW);
    // Construction (200ms) finishes before confirmation (220ms).
    const { allDone } = composeVisual(effects, 1, 0, NOW + CONSTRUCTION_DURATION);
    expect(allDone).toBe(false);
  });

  it("is absent from destruction effects", () => {
    const effects = createDestructionEffects(NOW);
    expect(effects.confirmation).toBeNull();
    const { visual } = composeVisual(effects, 1, 0, NOW);
    expect(visual.confirmStrength).toBe(0);
  });
});

describe("createDestructionEffects", () => {
  it("has an active destruction animation and no other effects", () => {
    const effects = createDestructionEffects(NOW);
    expect(effects.destruction).not.toBeNull();
    expect(effects.destruction!.startTime).toBe(NOW);
    expect(effects.destruction!.duration).toBe(DESTRUCTION_DURATION);
    expect(effects.construction).toBeNull();
    expect(effects.confirmation).toBeNull();
    expect(effects.hitFlash).toBeNull();
    expect(effects.editTransition).toBeNull();
  });

  it("composeVisual at start gives full scale and alpha", () => {
    const effects = createDestructionEffects(NOW);
    const { visual, shouldRemove } = composeVisual(effects, 1, 0, NOW);
    expect(visual.uniformScale).toBeCloseTo(1, 2);
    expect(visual.alpha).toBeCloseTo(1, 2);
    expect(shouldRemove).toBe(false);
  });

  it("composeVisual mid-destruction gives reduced scale and alpha", () => {
    const effects = createDestructionEffects(NOW);
    const mid = NOW + DESTRUCTION_DURATION * 0.5;
    const { visual } = composeVisual(effects, 1, 0, mid);
    expect(visual.uniformScale).toBeLessThan(1);
    expect(visual.alpha).toBeLessThan(1);
  });

  it("composeVisual after duration signals removal", () => {
    const effects = createDestructionEffects(NOW);
    const { visual, shouldRemove } = composeVisual(effects, 1, 0, NOW + DESTRUCTION_DURATION);
    expect(visual.uniformScale).toBeCloseTo(0.01, 2);
    expect(visual.alpha).toBeCloseTo(0, 2);
    expect(shouldRemove).toBe(true);
  });

  it("composeVisual shows an impact flash emissive at the start of destruction", () => {
    const effects = createDestructionEffects(NOW);
    // At t=0: full impact flash
    const { visual } = composeVisual(effects, 1, 0, NOW);
    expect(visual.emissiveBoost[0]).toBeGreaterThan(1);
    expect(visual.emissiveBoost[1]).toBeGreaterThan(0.5);
    expect(visual.emissiveBoost[2]).toBeGreaterThan(0);

    // After the impact phase (past DESTRUCTION_IMPACT_RATIO of duration): flash is gone
    const afterImpact = NOW + DESTRUCTION_DURATION * (DESTRUCTION_IMPACT_RATIO + 0.1);
    const { visual: v2 } = composeVisual(effects, 1, 0, afterImpact);
    expect(v2.emissiveBoost[0]).toBe(0);
    expect(v2.emissiveBoost[1]).toBe(0);
    expect(v2.emissiveBoost[2]).toBe(0);
  });
});

describe("triggerHitFlash", () => {
  it("sets a hit flash animation", () => {
    const effects = createConstructionEffects(NOW);
    triggerHitFlash(effects, NOW + 100);
    expect(effects.hitFlash).not.toBeNull();
    expect(effects.hitFlash!.startTime).toBe(NOW + 100);
    expect(effects.hitFlash!.duration).toBe(HIT_FLASH_DURATION);
  });

  it("composeVisual shows emissive and diffuse boost during flash", () => {
    const effects = createConstructionEffects(NOW);
    triggerHitFlash(effects, NOW + CONSTRUCTION_DURATION);
    const { visual } = composeVisual(effects, 1, 0, NOW + CONSTRUCTION_DURATION + 50);
    expect(visual.emissiveBoost[0]).toBeGreaterThan(0);
    expect(visual.emissiveBoost[1]).toBeGreaterThan(0);
    expect(visual.emissiveBoost[2]).toBeGreaterThan(0);
    expect(visual.diffuseBoost[0]).toBeGreaterThan(0);
    expect(visual.diffuseBoost[1]).toBeGreaterThan(0);
    expect(visual.diffuseBoost[2]).toBeGreaterThan(0);
  });

  it("composeVisual has no emissive or diffuse boost after flash completes", () => {
    const effects = createConstructionEffects(NOW);
    triggerHitFlash(effects, NOW + CONSTRUCTION_DURATION);
    const after = NOW + CONSTRUCTION_DURATION + HIT_FLASH_DURATION;
    const { visual, allDone } = composeVisual(effects, 1, 0, after);
    expect(visual.emissiveBoost[0]).toBe(0);
    expect(visual.diffuseBoost[0]).toBe(0);
    expect(allDone).toBe(true);
  });
});

describe("startEditTransition", () => {
  it("interpolates from full to half-top over duration", () => {
    const effects: StructureEffects = {
      construction: null,
      confirmation: null,
      hitFlash: null,
      destruction: null,
      editTransition: null,
    };
    startEditTransition(effects, 1, 0, 0.5, 0.25, NOW);

    // At start: should be at "from" values
    const start = composeVisual(effects, 0.5, 0.25, NOW);
    expect(start.visual.scaleY).toBeCloseTo(1, 3);
    expect(start.visual.yOffset).toBeCloseTo(0, 3);

    // At midpoint: should be between
    const mid = composeVisual(effects, 0.5, 0.25, NOW + EDIT_TRANSITION_DURATION * 0.5);
    expect(mid.visual.scaleY).toBeCloseTo(0.75, 1);

    // At end: should be at "to" values
    const end = composeVisual(effects, 0.5, 0.25, NOW + EDIT_TRANSITION_DURATION);
    expect(end.visual.scaleY).toBeCloseTo(0.5, 3);
    expect(end.visual.yOffset).toBeCloseTo(0.25, 3);
    expect(end.allDone).toBe(true);
  });

  it("interpolates from half-top back to full", () => {
    const effects: StructureEffects = {
      construction: null,
      confirmation: null,
      hitFlash: null,
      destruction: null,
      editTransition: null,
    };
    startEditTransition(effects, 0.5, 0.25, 1, 0, NOW);

    const end = composeVisual(effects, 1, 0, NOW + EDIT_TRANSITION_DURATION);
    expect(end.visual.scaleY).toBeCloseTo(1, 3);
    expect(end.visual.yOffset).toBeCloseTo(0, 3);
    expect(end.allDone).toBe(true);
  });
});

describe("composeVisual with no effects", () => {
  it("returns identity visual and allDone", () => {
    const effects: StructureEffects = {
      construction: null,
      confirmation: null,
      hitFlash: null,
      destruction: null,
      editTransition: null,
    };
    const { visual, allDone, shouldRemove } = composeVisual(effects, 1, 0, NOW);
    expect(visual.uniformScale).toBe(1);
    expect(visual.scaleY).toBe(1);
    expect(visual.yOffset).toBe(0);
    expect(visual.alpha).toBe(1);
    expect(visual.emissiveBoost).toEqual([0, 0, 0]);
    expect(visual.diffuseBoost).toEqual([0, 0, 0]);
    expect(visual.confirmStrength).toBe(0);
    expect(allDone).toBe(true);
    expect(shouldRemove).toBe(false);
  });
});

describe("composeVisualInto (in-place composition)", () => {
  it("writes into the caller-provided buffer and returns flags only", () => {
    const effects = createConstructionEffects(NOW);
    const out = createComposedVisual();

    const atStart = composeVisualInto(effects, 1, 0, NOW, out);
    expect(out.uniformScale).toBeCloseTo(0, 2);
    expect(out.alpha).toBe(1);
    expect(atStart.allDone).toBe(false);
    expect(atStart.shouldRemove).toBe(false);

    // Reuse the same buffer on the next frame: values are fully rewritten.
    const mid = composeVisualInto(effects, 1, 0, NOW + CONSTRUCTION_DURATION / 2, out);
    expect(out.uniformScale).toBeGreaterThan(0.01);
    expect(out.uniformScale).toBeLessThan(1.2);
    expect(mid.allDone).toBe(false);

    const done = composeVisualInto(effects, 1, 0, NOW + CONSTRUCTION_DURATION, out);
    expect(out.uniformScale).toBeCloseTo(1, 2);
    expect(done.allDone).toBe(false); // confirm glow (220ms) still decaying

    const settled = composeVisualInto(effects, 1, 0, NOW + PLACEMENT_CONFIRM_DURATION, out);
    expect(settled.allDone).toBe(true);
    expect(out.confirmStrength).toBe(0);
  });

  it("agrees with composeVisual for the same inputs", () => {
    const effects = createDestructionEffects(NOW);
    const viaAlloc = composeVisual(effects, 1, 0, NOW + 50);

    const sameEffects = createDestructionEffects(NOW);
    const out = createComposedVisual();
    const viaInPlace = composeVisualInto(sameEffects, 1, 0, NOW + 50, out);

    expect(out.uniformScale).toBeCloseTo(viaAlloc.visual.uniformScale, 5);
    expect(out.alpha).toBeCloseTo(viaAlloc.visual.alpha, 5);
    expect(out.emissiveBoost).toEqual(viaAlloc.visual.emissiveBoost);
    expect(out.diffuseBoost).toEqual(viaAlloc.visual.diffuseBoost);
    expect(viaInPlace.allDone).toBe(viaAlloc.allDone);
    expect(viaInPlace.shouldRemove).toBe(viaAlloc.shouldRemove);
  });

  it("resets boosts when a later frame has no active boosts", () => {
    const effects = createDestructionEffects(NOW);
    const out = createComposedVisual();
    // Frame during the impact flash carries an emissive boost.
    composeVisualInto(effects, 1, 0, NOW, out);
    expect(out.emissiveBoost[2]).toBeGreaterThan(0);
    // A later frame (flash over) must not keep the stale boost.
    composeVisualInto(effects, 1, 0, NOW + DESTRUCTION_DURATION, out);
    expect(out.emissiveBoost).toEqual([0, 0, 0]);
    expect(out.diffuseBoost).toEqual([0, 0, 0]);
    expect(out.confirmStrength).toBe(0);
  });

  it("resets confirmStrength on frames without a confirmation glow", () => {
    const effects = createConstructionEffects(NOW);
    const out = createComposedVisual();
    composeVisualInto(effects, 1, 0, NOW, out);
    expect(out.confirmStrength).toBeGreaterThan(0);
    // A frame with no active confirmation (destruction effects) resets it.
    composeVisualInto(createDestructionEffects(NOW), 1, 0, NOW, out);
    expect(out.confirmStrength).toBe(0);
  });
});
