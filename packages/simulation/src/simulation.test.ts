import { describe, expect, it } from "vitest";
import {
  JumpController,
  SIMULATION_VERSION,
  gameConfigVersion,
  movementInputToWorld,
  stepHorizontalMovement,
  stepVerticalMovement,
} from "./index.js";
import {
  GAME_CONFIG_VERSION,
  JUMP_INPUT_TIMING,
  PLAYER_MOVEMENT,
  PLAYER_PHYSICS,
} from "@buildshift/game-config";

describe("simulation scaffold", () => {
  it("exposes a simulation version", () => {
    expect(SIMULATION_VERSION).toBe("0.1.0");
  });

  it("resolves the shared game-config version across the workspace", () => {
    expect(gameConfigVersion()).toBe(GAME_CONFIG_VERSION);
  });
});

describe("stepHorizontalMovement", () => {
  it("leaves the position unchanged without movement input", () => {
    const position = { x: 2, z: -3 };
    const result = stepHorizontalMovement(
      position,
      { x: 0, z: 0 },
      1,
      PLAYER_MOVEMENT,
    );

    expect(result).toEqual(position);
    expect(result).not.toBe(position);
  });

  it("moves forward at the configured speed", () => {
    const result = stepHorizontalMovement(
      { x: 0, z: 0 },
      { x: 0, z: -1 },
      0.5,
      PLAYER_MOVEMENT,
    );

    expect(result).toEqual({ x: 0, z: -3 });
  });

  it("normalizes diagonal input to the straight-line speed", () => {
    const forward = stepHorizontalMovement(
      { x: 0, z: 0 },
      { x: 0, z: -1 },
      1,
      PLAYER_MOVEMENT,
    );
    const diagonal = stepHorizontalMovement(
      { x: 0, z: 0 },
      { x: 1, z: -1 },
      1,
      PLAYER_MOVEMENT,
    );

    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(
      Math.hypot(forward.x, forward.z),
    );
  });

  it("produces the same displacement across equivalent time steps", () => {
    const oneStep = stepHorizontalMovement(
      { x: 0, z: 0 },
      { x: 0.6, z: -0.8 },
      1,
      PLAYER_MOVEMENT,
    );
    let manySteps = { x: 0, z: 0 };

    for (let step = 0; step < 10; step += 1) {
      manySteps = stepHorizontalMovement(
        manySteps,
        { x: 0.6, z: -0.8 },
        0.1,
        PLAYER_MOVEMENT,
      );
    }

    expect(manySteps.x).toBeCloseTo(oneStep.x);
    expect(manySteps.z).toBeCloseTo(oneStep.z);
  });
});

describe("movementInputToWorld", () => {
  const forward = { x: 0, z: -1 };
  const right = { x: 1, z: 0 };

  it("keeps forward on -Z at yaw zero", () => {
    expect(movementInputToWorld(forward, 0)).toEqual({ x: 0, z: -1 });
  });

  it("rotates forward toward +X at positive 90-degree yaw", () => {
    const result = movementInputToWorld(forward, Math.PI / 2);

    expect(result.x).toBeCloseTo(1);
    expect(result.z).toBeCloseTo(0);
  });

  it("rotates forward toward +Z at 180-degree yaw", () => {
    const result = movementInputToWorld(forward, Math.PI);

    expect(result.x).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(1);
  });

  it("rotates right strafe consistently with camera yaw", () => {
    const result = movementInputToWorld(right, Math.PI / 2);

    expect(result.x).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(1);
  });

  it("preserves vector magnitude while rotating", () => {
    const input = { x: 0.6, z: -0.8 };
    const result = movementInputToWorld(input, 1.234);

    expect(Math.hypot(result.x, result.z)).toBeCloseTo(
      Math.hypot(input.x, input.z),
    );
  });

  it("retains normalized diagonal speed through movement stepping", () => {
    const worldDiagonal = movementInputToWorld({ x: 1, z: -1 }, Math.PI / 3);
    const result = stepHorizontalMovement(
      { x: 0, z: 0 },
      worldDiagonal,
      1,
      PLAYER_MOVEMENT,
    );

    expect(Math.hypot(result.x, result.z)).toBeCloseTo(
      PLAYER_MOVEMENT.moveSpeed,
    );
  });
});

describe("stepVerticalMovement", () => {
  it("integrates gravity into the velocity", () => {
    // No jump, airborne: pure gravity accumulation from rest.
    const result = stepVerticalMovement(
      0,
      false,
      false,
      1,
      PLAYER_PHYSICS,
    );

    expect(result).toBeCloseTo(PLAYER_PHYSICS.gravity * 1);
  });

  it("starts a jump at the jump speed when a launch is requested", () => {
    // dt = 0.1 keeps the post-jump velocity (9 - 2.5 = 6.5) positive, so the
    // grounded downward clamp does not kick in and the jump launch is visible.
    const dt = 0.1;
    const result = stepVerticalMovement(
      0,
      true,
      true,
      dt,
      PLAYER_PHYSICS,
    );

    expect(result).toBeCloseTo(
      PLAYER_PHYSICS.jumpSpeed + PLAYER_PHYSICS.gravity * dt,
    );
  });

  it("applies jump speed whenever a launch is requested (grounded flag no longer gates it)", () => {
    // The launch *decision* is owned upstream by JumpController (buffer +
    // coyote). Once decided, stepVerticalMovement simply applies jumpSpeed
    // regardless of the lagged grounded flag — so an airborne launch request
    // behaves exactly like a grounded one.
    const airborneLaunch = stepVerticalMovement(0, true, false, 0.1, PLAYER_PHYSICS);
    const groundedLaunch = stepVerticalMovement(0, true, true, 0.1, PLAYER_PHYSICS);

    expect(airborneLaunch).toBeCloseTo(groundedLaunch);
    expect(groundedLaunch).toBeCloseTo(
      PLAYER_PHYSICS.jumpSpeed + PLAYER_PHYSICS.gravity * 0.1,
    );
  });

  it("clamps downward velocity to zero while grounded", () => {
    // A grounded character never accumulates velocity into the floor, so
    // standing still stays at exactly zero.
    const result = stepVerticalMovement(
      -3,
      false,
      true,
      1,
      PLAYER_PHYSICS,
    );

    expect(result).toBe(0);
  });

  it("produces the same velocity change for equivalent elapsed time", () => {
    const oneStep = stepVerticalMovement(0, false, false, 1, PLAYER_PHYSICS);

    let velocity = 0;
    for (let step = 0; step < 10; step += 1) {
      velocity = stepVerticalMovement(
        velocity,
        false,
        false,
        0.1,
        PLAYER_PHYSICS,
      );
    }

    expect(velocity).toBeCloseTo(oneStep);
  });
});

describe("JumpController", () => {
  // A modest, sub-frame-step buffer and coyote window so the tests exercise
  // the windows' edges without needing long timelines.
  const config = { jumpBufferTime: 0.12, coyoteTime: 0.1 };
  const dt = 1 / 60;

  it("launches immediately when grounded and a press arrives", () => {
    const jc = new JumpController(config);

    expect(jc.step(dt, true, true)).toBe(true);
  });

  it("does not launch when there is no buffered press", () => {
    const jc = new JumpController(config);

    expect(jc.step(dt, true, false)).toBe(false);
  });

  it("buffers a press so a later grounded step launches", () => {
    const jc = new JumpController(config);

    // Press while airborne — buffered, no launch yet.
    expect(jc.step(dt, false, true)).toBe(false);
    // Next step the character is grounded; the buffered press launches.
    expect(jc.step(dt, true, false)).toBe(true);
    // The press was consumed: no further launch without a new press.
    expect(jc.step(dt, true, false)).toBe(false);
  });

  it("expires the buffered press after the buffer window", () => {
    const jc = new JumpController(config);
    // 20 steps * (1/60) ≈ 0.333 s, well past the 0.12 s buffer.
    jc.step(dt, true, true); // consume the launch, leaving a fresh press slot
    jc.step(dt, true, true); // one grounded press launches...
    // Now press once while airborne, then stay airborne past the buffer.
    const jc2 = new JumpController(config);
    jc2.step(dt, false, true); // press while airborne (buffered)
    for (let i = 0; i < 20; i += 1) {
      jc2.step(dt, false, false);
    }
    // Now grounded, but the press expired — no launch.
    expect(jc2.step(dt, true, false)).toBe(false);
  });

  it("grants a coyote-time jump after leaving the ground", () => {
    const jc = new JumpController(config);
    // Establish a grounded state to seed the coyote window.
    jc.step(dt, true, false);
    // Walk off the ledge (grounded -> false); coyote window starts decaying.
    // A press within coyoteTime still launches.
    expect(jc.step(dt, false, true)).toBe(true);
  });

  it("rejects a jump once the coyote window has expired", () => {
    const jc = new JumpController(config);
    jc.step(dt, true, false); // grounded, seed coyote
    // Stay airborne long enough for the coyote window (0.1 s) to elapse.
    // 8 steps * (1/60) ≈ 0.133 s > 0.1 s.
    for (let i = 0; i < 8; i += 1) {
      jc.step(dt, false, false);
    }
    // Now grounded again, but no fresh press -> nothing to launch. And a
    // fresh press while grounded should launch (grounded, not coyote).
    expect(jc.step(dt, true, true)).toBe(true);
    // And a press while airborne with no coyote and no buffer must not launch.
    const jc2 = new JumpController(config);
    jc2.step(dt, true, false); // grounded
    for (let i = 0; i < 8; i += 1) {
      jc2.step(dt, false, false);
    }
    expect(jc2.step(dt, false, true)).toBe(false);
  });

  it("never double-jumps from a single press across multiple steps", () => {
    const jc = new JumpController(config);
    const launches: boolean[] = [];
    // Press once while grounded; track launches over the following steps as
    // the character goes airborne and back down.
    launches.push(jc.step(dt, true, true)); // press + launch
    for (let i = 0; i < 4; i += 1) {
      launches.push(jc.step(dt, false, false));
    }
    launches.push(jc.step(dt, true, false)); // land, no new press

    // Exactly one launch total.
    expect(launches.filter(Boolean).length).toBe(1);
  });

  it("resets buffered and coyote state", () => {
    const jc = new JumpController(config);
    jc.step(dt, true, true); // launch, consuming the buffer
    jc.step(dt, true, true); // fresh grounded press -> launch
    jc.reset();

    // After reset, no buffered press remains, so a grounded step with no press
    // must not launch.
    expect(jc.step(dt, true, false)).toBe(false);
  });

  it("uses the shared JUMP_INPUT_TIMING config shape", () => {
    // Guard against accidental divergence between the config and the controller.
    const jc = new JumpController(JUMP_INPUT_TIMING);

    expect(jc.step(JUMP_INPUT_TIMING.jumpBufferTime, true, true)).toBe(true);
  });
});
