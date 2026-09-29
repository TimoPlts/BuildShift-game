/**
 * Stage 2C0 drift tests: pin the shared physics / arena / spawn configuration
 * that the client and (Stage 2C1 on) the authoritative server must both use.
 *
 * These are small, focused assertions on the exact values — not snapshots —
 * so any accidental re-tune of collider dimensions, controller tuning,
 * timestep, spawn, or arena collider geometry fails the build loudly.
 */
import { describe, expect, it } from "vitest";
import {
  ARENA_COLLIDERS,
  PLAYER_CHARACTER_CONTROLLER,
  PLAYER_COLLIDER,
  PLAYER_COLLIDER_HALF_TOTAL_HEIGHT,
  PLAYER_COLLIDER_TOTAL_HEIGHT,
  PLAYER_SPAWN,
  PHYSICS_TIMING,
} from "./index.js";

describe("PLAYER_COLLIDER (character collider)", () => {
  it("uses radius 0.35", () => {
    expect(PLAYER_COLLIDER.radius).toBe(0.35);
  });

  it("uses Rapier capsule half-height 0.55", () => {
    expect(PLAYER_COLLIDER.halfHeight).toBe(0.55);
  });

  it("derives centre-to-feet (half total height) as 0.9", () => {
    expect(PLAYER_COLLIDER_HALF_TOTAL_HEIGHT).toBe(0.9);
    // The derived value must actually be halfHeight + radius, not a re-typed
    // literal that could drift from the collider above.
    expect(PLAYER_COLLIDER_HALF_TOTAL_HEIGHT).toBe(
      PLAYER_COLLIDER.halfHeight + PLAYER_COLLIDER.radius,
    );
  });

  it("derives total capsule height as 1.8", () => {
    expect(PLAYER_COLLIDER_TOTAL_HEIGHT).toBe(1.8);
    // Total height is 2 * half-total (centre-to-feet).
    expect(PLAYER_COLLIDER_TOTAL_HEIGHT).toBe(
      2 * PLAYER_COLLIDER_HALF_TOTAL_HEIGHT,
    );
    // Sanity: total height is 2 * (halfHeight + radius).
    expect(PLAYER_COLLIDER_TOTAL_HEIGHT).toBe(
      2 * (PLAYER_COLLIDER.halfHeight + PLAYER_COLLIDER.radius),
    );
  });
});

describe("PLAYER_CHARACTER_CONTROLLER (controller tuning)", () => {
  it("uses contact offset 0.02", () => {
    expect(PLAYER_CHARACTER_CONTROLLER.contactOffset).toBe(0.02);
  });

  it("uses snap-to-ground 0.1", () => {
    expect(PLAYER_CHARACTER_CONTROLLER.snapToGround).toBe(0.1);
  });

  it("has autostep disabled", () => {
    expect(PLAYER_CHARACTER_CONTROLLER.autostepEnabled).toBe(false);
  });
});

describe("PHYSICS_TIMING (fixed substep)", () => {
  it("uses a 1/60 second fixed substep", () => {
    expect(PHYSICS_TIMING.fixedStepDurationSeconds).toBe(1 / 60);
  });
});

describe("PLAYER_SPAWN (gameplay spawn)", () => {
  it("is the capsule-centre position {0, 0.9, 6}", () => {
    expect(PLAYER_SPAWN).toEqual({ x: 0, y: 0.9, z: 6 });
  });

  it("keeps an explicit capsule-centre semantic", () => {
    // The capsule is 1.8 tall, so a centre at y = 0.9 puts the feet at y = 0.
    expect(PLAYER_SPAWN.y).toBe(PLAYER_COLLIDER_HALF_TOTAL_HEIGHT);
    expect(PLAYER_SPAWN.y).toBe(
      PLAYER_COLLIDER_TOTAL_HEIGHT - PLAYER_COLLIDER_HALF_TOTAL_HEIGHT,
    );
  });
});

describe("ARENA_COLLIDERS (shared collision geometry)", () => {
  it("contains exactly the expected Stage 1E collider ids", () => {
    expect(ARENA_COLLIDERS.map((c) => c.id).sort()).toEqual(
      [
        "center-box",
        "foundation-ground",
        "jump-platform",
        "low-block",
        "reference-platform",
        "reference-tower",
        "slide-corridor-wall-east",
        "slide-corridor-wall-west",
      ].sort(),
    );
  });

  it("has unique collider ids", () => {
    const ids = ARENA_COLLIDERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("stores the exact Stage 1E collider geometry (position + halfExtents)", () => {
    // A full expected-value table so a silent re-tune of any collider fails.
    const expected: Record<string, {
      position: [number, number, number];
      halfExtents: [number, number, number];
    }> = {
      "foundation-ground": {
        position: [0, -0.25, 0],
        halfExtents: [15, 0.25, 15],
      },
      "center-box": {
        position: [0, 1.25, 0],
        halfExtents: [1.25, 1.25, 1.25],
      },
      "reference-platform": {
        position: [-5, 0.25, 4],
        halfExtents: [3.5, 0.25, 2],
      },
      "reference-tower": {
        position: [5, 2.5, -3],
        halfExtents: [0.75, 2.5, 0.75],
      },
      "slide-corridor-wall-west": {
        position: [-2, 1.5, -5],
        halfExtents: [0.25, 1.5, 4],
      },
      "slide-corridor-wall-east": {
        position: [2, 1.5, -5],
        halfExtents: [0.25, 1.5, 4],
      },
      "low-block": {
        position: [-8, 0.5, 0],
        halfExtents: [1.5, 0.5, 1.5],
      },
      "jump-platform": {
        position: [9, 1, -1],
        halfExtents: [2, 1, 2],
      },
    };

    for (const collider of ARENA_COLLIDERS) {
      const wanted = expected[collider.id];
      expect(wanted, `collider "${collider.id}" has no expected entry`).toBeDefined();
      expect(collider.position, `position of "${collider.id}"`).toEqual(wanted!.position);
      expect(
        collider.halfExtents,
        `halfExtents of "${collider.id}"`,
      ).toEqual(wanted!.halfExtents);
    }
  });

  it("has finite positions and halfExtents on every collider", () => {
    for (const collider of ARENA_COLLIDERS) {
      for (const value of [...collider.position, ...collider.halfExtents]) {
        expect(Number.isFinite(value), `${collider.id} has non-finite value ${value}`).toBe(true);
      }
    }
  });

  it("has strictly positive halfExtents on every collider", () => {
    for (const collider of ARENA_COLLIDERS) {
      for (const value of collider.halfExtents) {
        expect(value, `halfExtent of "${collider.id}" must be > 0`).toBeGreaterThan(0);
      }
    }
  });
});
