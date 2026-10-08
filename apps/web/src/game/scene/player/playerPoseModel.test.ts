/**
 * Unit tests for playerPoseModel — the pure (Babylon-free) procedural pose
 * math:
 *  - state-to-pose transitions: idle → walk → run, jump → fall → landing
 *  - the landing dip is set on grounded contact, scaled by fall speed, and
 *    decays; single-sample step glitches and teleports never produce one
 *  - duplicate / stale timestamps are ignored (no fake speed spikes)
 *  - the aim stance (armRaise / aimPitch) blends toward its input
 *  - reset returns to the idle baseline
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYER_POSE_CONFIG,
  PlayerPoseModel,
  type PlayerPoseState,
} from "./playerPoseModel";

/** One simulation tick at the canonical 30 Hz presentation cadence. */
const DT_MS = 1000 / 30;
const DT_S = DT_MS / 1000;

/** Feed `n` samples advancing `stepMs` apart, advancing the pose each step. */
function feed(
  model: PlayerPoseModel,
  n: number,
  position: (i: number) => { x: number; y: number; z: number },
  startMs = 0,
  stepMs = DT_MS,
): void {
  for (let i = 0; i < n; i++) {
    const p = position(i);
    model.sample(p.x, p.y, p.z, startMs + i * stepMs);
    model.advance(stepMs / 1000);
  }
}

describe("PlayerPoseModel", () => {
  it("starts idle at rest", () => {
    const model = new PlayerPoseModel();
    feed(model, 90, () => ({ x: 0, y: 0, z: 0 }));

    expect(model.pose.state).toBe("idle");
    expect(model.pose.speed).toBeLessThan(0.05);
    expect(model.pose.legSwing).toBeCloseTo(0, 5);
    expect(model.pose.armSwing).toBeCloseTo(0, 5);
    expect(model.pose.airborne).toBe(false);
    // Idle still breathes: the oscillator is alive and bounded.
    expect(model.pose.breath).toBeGreaterThanOrEqual(-1);
    expect(model.pose.breath).toBeLessThanOrEqual(1);
  });

  it("walks: state, swing, walk phase, and bob follow a 2 m/s stream", () => {
    const model = new PlayerPoseModel();
    const step = 2 * DT_S;
    feed(model, 90, (i) => ({ x: i * step, y: 0, z: 0 }));

    expect(model.pose.state).toBe("walk");
    expect(model.pose.speed).toBeGreaterThan(1.8);
    expect(model.pose.legSwing).toBeGreaterThan(0.2);
    expect(model.pose.armSwing).toBeGreaterThan(0.1);

    // The walk cycle keeps advancing while moving on the ground.
    const phases = new Set<number>();
    for (let i = 0; i < 30; i++) {
      model.sample((90 + i) * step, 0, 0, 90 * DT_MS + i * DT_MS);
      model.advance(DT_S);
      phases.add(model.pose.walkPhase);
    }
    expect(phases.size).toBeGreaterThan(5);

    // The upper body bobs with the gait (twice per cycle).
    const bobs: number[] = [];
    for (let i = 0; i < 30; i++) {
      model.sample((120 + i) * step, 0, 0, 120 * DT_MS + i * DT_MS);
      model.advance(DT_S);
      bobs.push(model.pose.bob);
    }
    expect(Math.max(...bobs) - Math.min(...bobs)).toBeGreaterThan(0.008);
  });

  it("runs harder than it walks", () => {
    const walk = new PlayerPoseModel();
    feed(walk, 90, (i) => ({ x: i * 2 * DT_S, y: 0, z: 0 }));

    const run = new PlayerPoseModel();
    feed(run, 90, (i) => ({ x: i * 6 * DT_S, y: 0, z: 0 }));

    expect(walk.pose.state).toBe("walk");
    expect(run.pose.state).toBe("run");
    expect(run.pose.legSwing).toBeGreaterThan(walk.pose.legSwing + 0.1);
    expect(run.pose.lean).toBeGreaterThan(walk.pose.lean);
  });

  it("settles back to idle after stopping", () => {
    const model = new PlayerPoseModel();
    feed(model, 90, (i) => ({ x: i * 6 * DT_S, y: 0, z: 0 }));
    expect(model.pose.state).toBe("run");

    feed(model, 90, () => ({ x: 6 * 90 * DT_S, y: 0, z: 0 }));
    expect(model.pose.state).toBe("idle");
    expect(model.pose.speed).toBeLessThan(0.05);
    expect(model.pose.legSwing).toBeLessThan(0.05);
  });

  it("jump arc: jump -> fall -> grounded landing with a decaying dip", () => {
    const model = new PlayerPoseModel();
    const states = new Set<PlayerPoseState>();
    let landedAt = -1;
    let maxDip = 0;

    // Full jump under the shared tuning (v0 = 9 m/s, g = -25 m/s²).
    for (let i = 0; i < 40; i++) {
      const t = i * DT_S;
      const y = Math.max(0, 9 * t - 12.5 * t * t);
      model.sample(0, y, 0, i * DT_MS);
      model.advance(DT_S);
      states.add(model.pose.state);
      if (landedAt === -1 && !model.pose.airborne && i > 5) landedAt = i;
      maxDip = Math.max(maxDip, model.pose.landingDip);
    }

    expect(states.has("jump")).toBe(true);
    expect(states.has("fall")).toBe(true);
    expect(landedAt).toBeGreaterThan(-1);
    // A full jump lands near 9 m/s: the dip PEAKS near its maximum ...
    expect(maxDip).toBeGreaterThan(0.6);
    // ... then decays fully back to zero while grounded.
    feed(model, 90, () => ({ x: 0, y: 0, z: 0 }), 40 * DT_MS);
    expect(model.pose.landingDip).toBe(0);
    expect(model.pose.state).toBe("idle");
  });

  it("falling off a ledge (no upward launch) still reads as a fall + landing", () => {
    const model = new PlayerPoseModel();
    const states = new Set<PlayerPoseState>();
    let maxDip = 0;

    // Free fall from 2 m starting at rest: y(t) = 2 - 12.5t², lands at 10 m/s.
    for (let i = 0; i < 30; i++) {
      const t = i * DT_S;
      const y = Math.max(0, 2 - 12.5 * t * t);
      model.sample(0, y, 0, i * DT_MS);
      model.advance(DT_S);
      states.add(model.pose.state);
      maxDip = Math.max(maxDip, model.pose.landingDip);
    }

    expect(states.has("fall")).toBe(true);
    expect(model.pose.airborne).toBe(false);
    // A 2 m fall lands at ~10 m/s: a strong dip at its peak ...
    expect(maxDip).toBeGreaterThan(0.5);
    // ... that has decayed most of the way by the end of the 30 frames.
    expect(model.pose.landingDip).toBeLessThan(0.3);
  });

  it("a single-sample step-down never registers a landing dip", () => {
    const model = new PlayerPoseModel();
    feed(model, 30, () => ({ x: 0, y: 0.1, z: 0 }));
    feed(model, 30, () => ({ x: 0, y: 0, z: 0 }), 30 * DT_MS);

    expect(model.pose.airborne).toBe(false);
    expect(model.pose.landingDip).toBe(0);
    expect(model.pose.state).toBe("idle");
  });

  it("a teleport sample resets the kinematics instead of faking a run", () => {
    const model = new PlayerPoseModel();
    feed(model, 30, () => ({ x: 0, y: 0, z: 0 }));

    // 50 m in one sample (reconciliation jump / respawn).
    model.sample(50, 0, 0, 30 * DT_MS);
    model.advance(DT_S);
    model.sample(50, 0, 0, 31 * DT_MS);
    model.advance(DT_S);

    feed(model, 30, () => ({ x: 50, y: 0, z: 0 }), 32 * DT_MS);
    expect(model.pose.state).toBe("idle");
    expect(model.pose.speed).toBeLessThan(0.05);
  });

  it("a stale gap (tab hidden / reconnect) never produces a speed spike", () => {
    const model = new PlayerPoseModel();
    feed(model, 30, () => ({ x: 0, y: 0, z: 0 }));

    // Five seconds with no samples, then the stream resumes.
    model.sample(0, 0, 0, 30 * DT_MS + 5000);
    model.advance(DT_S);
    feed(model, 30, () => ({ x: 0, y: 0, z: 0 }), 30 * DT_MS + 5000 + DT_MS);

    expect(model.pose.state).toBe("idle");
    expect(model.pose.speed).toBeLessThan(0.05);
  });

  it("duplicate timestamps are ignored", () => {
    const model = new PlayerPoseModel();
    model.sample(0, 0, 0, 1000);
    const after = { ...model.pose };
    // Same timestamp again — must not divide by zero or move state.
    model.sample(4, 0, 0, 1000);
    model.advance(0);
    expect(model.pose.state).toBe(after.state);
    expect(model.pose.walkPhase).toBe(after.walkPhase);
  });

  it("the aim stance raises the arms and follows the aim pitch", () => {
    const model = new PlayerPoseModel();
    model.setAim(0.5, true);
    for (let i = 0; i < 90; i++) model.advance(DT_S);

    expect(model.pose.armRaise).toBeGreaterThan(0.95);
    expect(model.pose.aimPitch).toBeCloseTo(0.5, 1);

    model.setAim(-0.5, false);
    for (let i = 0; i < 90; i++) model.advance(DT_S);

    expect(model.pose.armRaise).toBeLessThan(0.05);
    expect(model.pose.aimPitch).toBeCloseTo(-0.5, 1);
  });

  it("the aim pitch is clamped to a presentation-safe range", () => {
    const model = new PlayerPoseModel();
    model.setAim(9, true);
    for (let i = 0; i < 90; i++) model.advance(DT_S);
    expect(model.pose.aimPitch).toBeLessThanOrEqual(1.3);
  });

  it("reset returns to the idle baseline and clears the sample history", () => {
    const model = new PlayerPoseModel();
    feed(model, 90, (i) => ({ x: i * 6 * DT_S, y: 0, z: 0 }));
    model.setAim(0.5, true);

    model.reset();

    const p = model.pose;
    expect(p.state).toBe("idle");
    expect(p.speed).toBe(0);
    expect(p.walkPhase).toBe(0);
    expect(p.armRaise).toBe(0);
    expect(p.aimPitch).toBe(0);
    expect(p.landingDip).toBe(0);
    expect(p.airborne).toBe(false);

    // After reset the next sample is a fresh baseline (no velocity spike
    // from the pre-reset position).
    model.sample(100, 0, 0, 1_000_000);
    model.advance(DT_S);
    expect(model.pose.state).toBe("idle");
    expect(model.pose.speed).toBeLessThan(0.05);
  });

  it("advance is a no-op for non-positive deltas", () => {
    const model = new PlayerPoseModel();
    feed(model, 30, () => ({ x: 0, y: 0, z: 0 }));
    const before = { ...model.pose };
    expect(() => {
      model.advance(0);
      model.advance(-1);
    }).not.toThrow();
    expect(model.pose).toEqual(before);
  });

  it("exposes bounded default tuning", () => {
    const c = DEFAULT_PLAYER_POSE_CONFIG;
    expect(c.idleSpeed).toBeGreaterThan(0);
    expect(c.runSpeed).toBeGreaterThan(c.idleSpeed);
    expect(c.fullLandingFallSpeed).toBeGreaterThanOrEqual(c.minLandingFallSpeed);
    expect(c.maxLandingDipMeters).toBeGreaterThan(0);
    expect(c.maxSampleIntervalSeconds).toBeGreaterThan(0);
    expect(c.maxPlausibleSpeed).toBeGreaterThan(6); // above the shared moveSpeed
  });
});
