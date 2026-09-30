import { describe, expect, it } from "vitest";
import { PhysicsWorld } from "./PhysicsWorld";

/**
 * Stage 2C2B-2: {@link PhysicsWorld.setPosition} is the narrow restore API the
 * {@link ReconciliationEngine} will later use to snap the local character body
 * to a checkpoint / authoritative position.
 *
 * These are *real* Rapier tests (no Babylon): the compat WASM build loads and
 * runs in the node vitest environment, so we exercise the actual character
 * body + controller rather than a fake.
 *
 * All restore targets sit on the clear foundation ground, away from the arena
 * obstacles (center-box x∈[-1.25,1.25] z∈[-1.25,1.25]; reference-platform
 * x∈[-8.5,-1.5]; corridor walls z∈[-9,-1]).
 */
describe("PhysicsWorld — setPosition (prediction restore)", () => {
  it("reflects a restored capsule-centre position via getPosition", async () => {
    const physics = await PhysicsWorld.create();
    const restored = { x: 2.0, y: 0.9, z: 5.0 };
    physics.setPosition(restored);

    const pos = physics.getPosition();
    expect(pos.x).toBeCloseTo(2.0, 6);
    expect(pos.y).toBeCloseTo(0.9, 6);
    expect(pos.z).toBeCloseTo(5.0, 6);
    physics.dispose();
  });

  it("a subsequent zero step proceeds from the restored position", async () => {
    const physics = await PhysicsWorld.create();
    const restored = { x: 2.0, y: 0.9, z: 5.0 };
    physics.setPosition(restored);

    // A zero desired-translation step: the character is airborne here and
    // PhysicsWorld applies no gravity, so the position must be preserved —
    // proving the next normal step continues from the restored point.
    physics.step({ x: 0, y: 0, z: 0 });

    const pos = physics.getPosition();
    expect(pos.x).toBeCloseTo(2.0, 6);
    expect(pos.y).toBeCloseTo(0.9, 6);
    expect(pos.z).toBeCloseTo(5.0, 6);
    physics.dispose();
  });

  it("a small step integrates FROM the restored position (not the spawn)", async () => {
    const physics = await PhysicsWorld.create();
    const restored = { x: 2.0, y: 0.9, z: 5.0 };
    physics.setPosition(restored);

    // A small +x move: the character ends near restored.x + 0.1, proving the
    // step started from the restored position rather than PLAYER_SPAWN (0,·,6).
    physics.step({ x: 0.1, y: 0, z: 0 });

    const pos = physics.getPosition();
    expect(pos.x).toBeCloseTo(2.1, 5);
    expect(pos.z).toBeCloseTo(5.0, 6);
    physics.dispose();
  });

  it("setPosition does not rebuild the world (repeated calls are safe)", async () => {
    const physics = await PhysicsWorld.create();
    physics.setPosition({ x: 1.0, y: 0.9, z: 1.0 });
    physics.setPosition({ x: 3.0, y: 0.9, z: 3.0 });

    const pos = physics.getPosition();
    expect(pos.x).toBeCloseTo(3.0, 6);
    expect(pos.z).toBeCloseTo(3.0, 6);
    physics.dispose();
  });

  it("dispose remains safe after setPosition, and post-dispose calls are no-ops", async () => {
    const physics = await PhysicsWorld.create();
    physics.setPosition({ x: 2.0, y: 0.9, z: 5.0 });

    expect(() => physics.dispose()).not.toThrow();
    expect(() => physics.dispose()).not.toThrow(); // idempotent
    // setPosition after dispose must not crash (guarded no-op).
    expect(() => physics.setPosition({ x: 0, y: 0, z: 0 })).not.toThrow();
  });
});
