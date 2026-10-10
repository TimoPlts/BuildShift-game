/**
 * Unit tests for the pure local-HUD view mapper.
 *
 * `buildLocalHudView` normalises the runtime's existing authoritative /
 * predicted values into the flat display view; `localHudChangeKey` quantises
 * that view so the runtime only re-emits when a player-visible value
 * changes.
 */
import { describe, expect, it } from "vitest";
import {
  buildLocalHudView,
  localHudChangeKey,
  localHudViewChangeKeyFromInput,
  type LocalHudView,
  type LocalHudViewInput,
} from "./localHudView";
import { type BuildEditHudState } from "./buildEdit/buildEditHudView";
import {
  ENERGY,
  MAX_HEALTH,
  MAX_SHIELD,
} from "@buildshift/game-config";

/** A well-formed baseline input used to vary one field per test. */
function baselineInput(): LocalHudViewInput {
  return {
    health: MAX_HEALTH,
    shield: 0,
    energy: 42,
    weaponType: "assault_rifle",
    magazineAmmo: 30,
    magazineSize: 30,
    isReloading: false,
    reloadProgress: 0,
    eliminated: false,
    buildMode: false,
    selectedBuildType: "wall",
    placementValid: null,
    gridPosition: null,
    buildEdit: { mode: false, target: null, selectedEdit: "door", allowedEdits: [], feedback: null, applyReady: false },
    roundTimer: null,
    countdownSeconds: 0,
  };
}

describe("buildLocalHudView", () => {
  it("passes authoritative vitals through with the shared config ceilings", () => {
    const view = buildLocalHudView(baselineInput());
    expect(view.maxHealth).toBe(MAX_HEALTH);
    expect(view.maxShield).toBe(MAX_SHIELD);
    expect(view.maxEnergy).toBe(ENERGY.maxEnergy);
    expect(view.health).toBe(MAX_HEALTH);
    expect(view.shield).toBe(0);
    expect(view.energy).toBe(42);
  });

  it("clamps vitals into the valid ranges", () => {
    const view = buildLocalHudView({
      ...baselineInput(),
      health: MAX_HEALTH + 50,
      shield: MAX_SHIELD + 10,
      energy: ENERGY.maxEnergy + 5,
    });
    expect(view.health).toBe(MAX_HEALTH);
    expect(view.shield).toBe(MAX_SHIELD);
    expect(view.energy).toBe(ENERGY.maxEnergy);

    const negatives = buildLocalHudView({
      ...baselineInput(),
      health: -20,
      shield: -5,
      energy: -1,
    });
    expect(negatives.health).toBe(0);
    expect(negatives.shield).toBe(0);
    expect(negatives.energy).toBe(0);
  });

  it("maps non-finite vitals to safe defaults", () => {
    const view = buildLocalHudView({
      ...baselineInput(),
      health: Number.NaN,
      shield: Number.POSITIVE_INFINITY,
      energy: Number.NEGATIVE_INFINITY,
      reloadProgress: Number.NaN,
    });
    expect(view.health).toBe(MAX_HEALTH);
    expect(view.shield).toBe(0);
    expect(view.energy).toBe(0);
    expect(view.reloadProgress).toBe(0);
  });

  it("floors and clamps ammo / countdown to non-negative integers", () => {
    const view = buildLocalHudView({
      ...baselineInput(),
      magazineAmmo: 12.9,
      magazineSize: 29.4,
      countdownSeconds: 2.9,
    });
    expect(view.magazineAmmo).toBe(12);
    expect(view.magazineSize).toBe(29);
    expect(view.countdownSeconds).toBe(2);

    const negatives = buildLocalHudView({
      ...baselineInput(),
      magazineAmmo: -1,
      countdownSeconds: -3,
    });
    expect(negatives.magazineAmmo).toBe(0);
    expect(negatives.countdownSeconds).toBe(0);
  });

  it("clamps reload progress into [0, 1]", () => {
    expect(
      buildLocalHudView({ ...baselineInput(), reloadProgress: 1.5 }).reloadProgress,
    ).toBe(1);
    expect(
      buildLocalHudView({ ...baselineInput(), reloadProgress: -0.2 }).reloadProgress,
    ).toBe(0);
  });

  it("passes the build-mode state through unchanged", () => {
    const off = buildLocalHudView(baselineInput());
    expect(off.buildMode).toBe(false);
    expect(off.selectedBuildType).toBe("wall");
    expect(off.placementValid).toBeNull();
    expect(off.gridPosition).toBeNull();

    const on = buildLocalHudView({
      ...baselineInput(),
      buildMode: true,
      selectedBuildType: "ramp",
      placementValid: false,
      gridPosition: { x: 2, y: 0, z: -3 },
    });
    expect(on.buildMode).toBe(true);
    expect(on.selectedBuildType).toBe("ramp");
    expect(on.placementValid).toBe(false);
    expect(on.gridPosition).toEqual({ x: 2, y: 0, z: -3 });
  });

  it("normalises the authoritative round timer and rejects malformed payloads", () => {
    const view = buildLocalHudView({
      ...baselineInput(),
      roundTimer: { remainingMs: 45_000, totalMs: 90_000 },
    });
    expect(view.roundTimer).toEqual({ remainingMs: 45_000, totalMs: 90_000 });

    const clamped = buildLocalHudView({
      ...baselineInput(),
      roundTimer: { remainingMs: 120_000, totalMs: 90_000 },
    });
    expect(clamped.roundTimer?.remainingMs).toBe(90_000);

    expect(
      buildLocalHudView({
        ...baselineInput(),
        roundTimer: { remainingMs: 5_000, totalMs: 0 },
      }).roundTimer,
    ).toBeNull();
    expect(
      buildLocalHudView({
        ...baselineInput(),
        roundTimer: { remainingMs: Number.NaN, totalMs: 90_000 },
      }).roundTimer,
    ).toBeNull();
  });

  it("maps the elimination flag to a strict boolean", () => {
    expect(buildLocalHudView(baselineInput()).eliminated).toBe(false);
    expect(
      buildLocalHudView({ ...baselineInput(), eliminated: true }).eliminated,
    ).toBe(true);
  });
});

describe("localHudChangeKey", () => {
  it("is stable for the same player-visible values", () => {
    const a = buildLocalHudView(baselineInput());
    const b = buildLocalHudView(baselineInput());
    expect(localHudChangeKey(a)).toBe(localHudChangeKey(b));
  });

  it("changes when a vitals, ammo or weapon value changes", () => {
    const base = buildLocalHudView(baselineInput());
    const baseKey = localHudChangeKey(base);

    const variants: LocalHudView[] = [
      { ...base, health: base.health - 1 },
      { ...base, shield: base.shield + 1 },
      { ...base, energy: base.energy + 1 },
      { ...base, magazineAmmo: base.magazineAmmo - 1 },
      { ...base, weaponType: "shotgun" },
      { ...base, eliminated: true },
    ];
    for (const variant of variants) {
      expect(localHudChangeKey(variant)).not.toBe(baseKey);
    }
  });

  it("changes when build mode, the selected piece or placement validity change", () => {
    const base = buildLocalHudView(baselineInput());
    const baseKey = localHudChangeKey(base);

    const variants: LocalHudView[] = [
      { ...base, buildMode: true },
      { ...base, selectedBuildType: "cone" },
      { ...base, placementValid: true },
      { ...base, gridPosition: { x: 1, y: 0, z: 1 } },
    ];
    for (const variant of variants) {
      expect(localHudChangeKey(variant)).not.toBe(baseKey);
    }
  });

  it("changes when the build-edit presentation state changes", () => {
    const base = buildLocalHudView(baselineInput());
    const baseKey = localHudChangeKey(base);

    const variants: LocalHudView[] = [
      { ...base, buildEdit: { ...base.buildEdit, mode: true } },
      { ...base, buildEdit: { ...base.buildEdit, selectedEdit: "window" } },
      {
        ...base,
        buildEdit: {
          ...base.buildEdit,
          target: { structureId: "wall1", buildType: "wall", grid: { x: 1, y: 0, z: 1 } },
        },
      },
      {
        ...base,
        buildEdit: {
          ...base.buildEdit,
          feedback: { kind: "accepted", message: "Edit applied" },
        },
      },
    ];
    for (const variant of variants) {
      expect(localHudChangeKey(variant)).not.toBe(baseKey);
    }
  });

  it("quantises the round timer to whole seconds (sub-second jitter is ignored)", () => {
    const withTimer = (remainingMs: number): LocalHudView =>
      buildLocalHudView({
        ...baselineInput(),
        roundTimer: { remainingMs, totalMs: 90_000 },
      });

    const start = withTimer(90_000);
    // 33 ms of server tick jitter inside the same displayed second:
    expect(localHudChangeKey(withTimer(89_967))).toBe(localHudChangeKey(start));
    // Crossing into the next displayed second changes the key:
    expect(localHudChangeKey(withTimer(89_000))).not.toBe(
      localHudChangeKey(start),
    );
    expect(localHudChangeKey(buildLocalHudView(baselineInput()))).not.toBe(
      localHudChangeKey(start),
    );
  });

  it("quantises reload progress to ~2% steps", () => {
    const key = (progress: number): string =>
      localHudChangeKey(
        buildLocalHudView({
          ...baselineInput(),
          isReloading: true,
          reloadProgress: progress,
        }),
      );
    // 1% apart — same quantised step (bucket 5 covers [0.09, 0.11)).
    expect(key(0.095)).toBe(key(0.105));
    // 4% apart — different step.
    expect(key(0.105)).not.toBe(key(0.145));
    // Not reloading always yields the "no reload" step regardless of progress.
    expect(key(0.1)).not.toBe(
      localHudChangeKey(buildLocalHudView(baselineInput())),
    );
  });
});

describe("localHudViewChangeKeyFromInput", () => {
  function buildEditState(o: Partial<BuildEditHudState> = {}): BuildEditHudState {
    return {
      mode: false,
      target: null,
      selectedEdit: "door",
      allowedEdits: [],
      feedback: null,
      applyReady: false,
      ...o,
    };
  }

  /** Deterministic PRNG so the sweep is reproducible across runs. */
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("equals localHudChangeKey(buildLocalHudView(input)) across a randomized sweep", () => {
    const rand = mulberry32(0xcafe_bab1);
    const pick = <T,>(values: readonly T[]): T =>
      values[Math.floor(rand() * values.length)];
    const numbers = [0, 1, 12.9, 99, MAX_HEALTH, MAX_HEALTH + 40, -7, NaN, Infinity, -Infinity];
    const buildTypes = ["wall", "floor", "ramp", "cone"] as const;
    const weapons = ["assault_rifle", "shotgun"] as const;
    const feedbacks = [
      null,
      { kind: "accepted" as const, message: "Edit applied" },
      { kind: "rejected" as const, message: "Not yours" },
      { kind: "info" as const, message: "Aim at your wall" },
    ];

    for (let i = 0; i < 300; i += 1) {
      const targeted = rand() < 0.5;
      const input: LocalHudViewInput = {
        health: pick(numbers),
        shield: pick(numbers),
        energy: pick(numbers),
        weaponType: pick(weapons),
        magazineAmmo: pick(numbers),
        magazineSize: pick(numbers),
        isReloading: rand() < 0.5,
        reloadProgress: pick([0, 0.095, 0.105, 0.5, 1, 1.5, -0.2, NaN]),
        eliminated: rand() < 0.25,
        buildMode: rand() < 0.4,
        selectedBuildType: pick(buildTypes),
        placementValid: pick([null, true, false]),
        gridPosition: rand() < 0.5 ? null : { x: Math.floor(rand() * 20) - 10, y: Math.floor(rand() * 5), z: Math.floor(rand() * 20) - 10 },
        buildEdit: buildEditState({
          mode: rand() < 0.5,
          target: targeted
            ? {
                structureId: `wall${Math.floor(rand() * 9)}`,
                buildType: "wall",
                grid: { x: Math.floor(rand() * 9), y: 0, z: Math.floor(rand() * 9) },
              }
            : null,
          selectedEdit: pick(["door", "window", "half_top", "half_bottom", "clear"] as const),
          allowedEdits: rand() < 0.5 ? ["door", "window"] : [],
          feedback: pick(feedbacks),
          applyReady: rand() < 0.3,
        }),
        roundTimer: rand() < 0.6
          ? {
              remainingMs: rand() < 0.1 ? Number.NaN : Math.floor(rand() * 120_000),
              totalMs: rand() < 0.1 ? 0 : Math.floor(rand() * 90_000) + 1,
            }
          : null,
        countdownSeconds: pick([0, 2, 2.9, -1, NaN]),
      };

      expect(
        localHudViewChangeKeyFromInput(input),
        `mismatch on iteration ${i}`,
      ).toBe(localHudChangeKey(buildLocalHudView(input)));
    }
  });

  it("tracks the same player-visible changes as the view-side key", () => {
    const base = baselineInput();
    const baseKey = localHudViewChangeKeyFromInput(base);
    expect(baseKey).toBe(localHudChangeKey(buildLocalHudView(base)));

    const variants: LocalHudViewInput[] = [
      { ...base, health: base.health - 1 },
      { ...base, energy: base.energy + 1 },
      { ...base, magazineAmmo: base.magazineAmmo - 1 },
      { ...base, weaponType: "shotgun" },
      { ...base, eliminated: true },
      { ...base, buildMode: true, placementValid: false, gridPosition: { x: 1, y: 0, z: 1 } },
      { ...base, buildEdit: { ...base.buildEdit, mode: true } },
      {
        ...base,
        buildEdit: {
          ...base.buildEdit,
          target: { structureId: "wall1", buildType: "wall", grid: { x: 1, y: 0, z: 1 } },
        },
      },
      { ...base, roundTimer: { remainingMs: 45_000, totalMs: 90_000 } },
      { ...base, countdownSeconds: 3 },
    ];
    for (const variant of variants) {
      expect(localHudViewChangeKeyFromInput(variant)).not.toBe(baseKey);
    }
  });

  it("treats sub-second round-timer jitter as unchanged (matching the view-side key)", () => {
    const withTimer = (remainingMs: number): LocalHudViewInput => ({
      ...baselineInput(),
      roundTimer: { remainingMs, totalMs: 90_000 },
    });
    expect(localHudViewChangeKeyFromInput(withTimer(89_967))).toBe(
      localHudViewChangeKeyFromInput(withTimer(90_000)),
    );
    expect(localHudViewChangeKeyFromInput(withTimer(89_000))).not.toBe(
      localHudViewChangeKeyFromInput(withTimer(90_000)),
    );
  });
});
