/**
 * Unit tests for buildPresentation structure effect state and composition.
 */
import { describe, expect, it } from "vitest";
import {
  composeVisual,
  createConstructionEffects,
  createDestructionEffects,
  startEditTransition,
  triggerHitFlash,
  CONSTRUCTION_DURATION,
  DESTRUCTION_DURATION,
  DESTRUCTION_IMPACT_RATIO,
  EDIT_TRANSITION_DURATION,
  HIT_FLASH_DURATION,
  type StructureEffects,
} from "./structureEffects";

const NOW = 10_000;

describe("createConstructionEffects", () => {
  it("has an active construction animation and no other effects", () => {
    const effects = createConstructionEffects(NOW);
    expect(effects.construction).not.toBeNull();
    expect(effects.construction!.startTime).toBe(NOW);
    expect(effects.construction!.duration).toBe(CONSTRUCTION_DURATION);
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
    const { visual, allDone } = composeVisual(effects, 1, 0, NOW + CONSTRUCTION_DURATION);
    expect(visual.uniformScale).toBeCloseTo(1, 2);
    expect(allDone).toBe(true);
  });
});

describe("createDestructionEffects", () => {
  it("has an active destruction animation and no other effects", () => {
    const effects = createDestructionEffects(NOW);
    expect(effects.destruction).not.toBeNull();
    expect(effects.destruction!.startTime).toBe(NOW);
    expect(effects.destruction!.duration).toBe(DESTRUCTION_DURATION);
    expect(effects.construction).toBeNull();
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
    expect(allDone).toBe(true);
    expect(shouldRemove).toBe(false);
  });
});
