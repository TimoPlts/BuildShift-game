/**
 * Behavioral NullEngine tests for the live animation wiring
 * (Batch 2B, Task B): `mapCharacterClips` + `CharacterAnimationDriver`.
 *
 *  - clip-name mapping: real-style names (Idle / Running / Jump_Start /
 *    FallLoop / CrouchIdle / Fire_01 ...) map cleanly to slots; unknown
 *    names and missing states are REPORTED, never thrown;
 *  - state derives from the existing canonical position stream: idle,
 *    walk→run, run, jump, fall, crouch (grounded) — airborne beats crouch;
 *  - remote player support: the same driver consumes an interpolated stream
 *    (any cadence) plus the replicated crouch flag;
 *  - safe when clips are absent: no clips at all is a no-op; a derived
 *    state without a clip falls back to idle instead of freezing;
 *  - zero root motion: root-position animations are stripped and the
 *    gameplay-mirror root is never mutated across a full state + fire
 *    cycle driven through the live sync path;
 *  - lifecycle: repeated attachClips never adds duplicate AnimationGroup
 *    observers; dispose is idempotent and every API is a no-op afterwards.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import {
  Animation,
  AnimationGroup,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import {
  CharacterAnimationDriver,
  mapCharacterClips,
  normalizeClipName,
  type CharacterAnimationSyncInput,
} from "./characterAnimationAdapter";
import type { CharacterAnimState } from "./characterAnimationController";

const FPS = 30;

function makeRig(scene: Scene): { root: TransformNode; limb: TransformNode } {
  const root = new TransformNode("char-root", scene);
  root.position = new Vector3(3, 1, 2);
  root.rotation = new Vector3(0, 0.6, 0);
  root.scaling = new Vector3(1.5, 1.5, 1.5);
  const limb = new TransformNode("limb", scene);
  root.addChild(limb);
  return { root, limb };
}

interface ClipOptions {
  /** Baked root-motion clip: animates the root's position (must be stripped). */
  rootMotion?: boolean;
  /** Animates the limb's rotation (a normal, non-root clip). */
  limbSwing?: boolean;
}

function makeClip(
  scene: Scene,
  root: TransformNode,
  limb: TransformNode,
  name: string,
  seconds: number,
  options: ClipOptions = {},
): AnimationGroup {
  const frames = Math.max(1, Math.round(seconds * FPS));
  const group = new AnimationGroup(name, scene);
  if (options.rootMotion) {
    const pos = new Animation(
      `${name}_rootpos`,
      "position",
      FPS,
      Animation.ANIMATIONTYPE_VECTOR3,
      0,
    );
    pos.setKeys([
      { frame: 0, value: new Vector3(0, 0, 0) },
      { frame: frames, value: new Vector3(5, 0, 0) },
    ]);
    group.addTargetedAnimation(pos, root);
  }
  if (options.limbSwing) {
    const rot = new Animation(
      `${name}_limbrot`,
      "rotation",
      FPS,
      Animation.ANIMATIONTYPE_VECTOR3,
      0,
    );
    rot.setKeys([
      { frame: 0, value: new Vector3(0, 0, 0) },
      { frame: frames, value: new Vector3(0, 0, 1) },
    ]);
    group.addTargetedAnimation(rot, limb);
  }
  return group;
}

interface Step {
  x: number;
  y?: number;
  z?: number;
  crouch?: number;
}

/**
 * One continuous canonical position stream: time and position advance
 * monotonically across calls (like the runtime feeds the same player every
 * frame). Returns the playable state pushed by each `sync`.
 */
function makeStream(): (
  driver: CharacterAnimationDriver,
  steps: Step[],
  dtSeconds?: number,
) => CharacterAnimState[] {
  let timeMs = 0;
  return (driver, steps, dtSeconds = 0.05) => {
    const out: CharacterAnimState[] = [];
    for (const s of steps) {
      timeMs += dtSeconds * 1000;
      const input: CharacterAnimationSyncInput = {
        x: s.x,
        y: s.y ?? 0,
        z: s.z ?? 0,
        timeMs,
        deltaSeconds: dtSeconds,
        crouchBlend: s.crouch ?? 0,
      };
      out.push(driver.sync(input));
    }
    return out;
  };
}

/**
 * A continuous position line at constant horizontal speed (m/s): step i
 * sits at `offset + speed * dt * (i + 1)`, so consecutive `drive` calls can
 * chain at `offset = previous end` without fake teleports.
 */
function line(
  length: number,
  speedX: number,
  offset: number,
  dtSeconds = 0.05,
): Step[] {
  return Array.from(
    { length },
    (_, i) => ({ x: offset + speedX * dtSeconds * (i + 1) }),
  );
}

function snapshot(root: TransformNode): {
  position: Vector3;
  rotation: Vector3;
  scaling: Vector3;
} {
  return {
    position: root.position.clone(),
    rotation: root.rotation.clone(),
    scaling: root.scaling.clone(),
  };
}

describe("mapCharacterClips", () => {
  let scene: Scene;

  beforeEach(() => {
    scene = new Scene(new NullEngine());
  });

  afterEach(() => {
    scene.dispose();
  });

  function clip(name: string): AnimationGroup {
    return new AnimationGroup(name, scene);
  }

  it("normalises names and maps real-style clip names to the right slots", () => {
    const idle = clip("Idle");
    const run = clip("Running");
    const jump = clip("Jump_Start");
    const fall = clip("fall_loop");
    const crouch = clip("CrouchIdle");
    const aim = clip("Aim_Rifle");
    const build = clip("Build_Place");
    const edit = clip("Edit_Select");
    const fire = clip("Fire_01");
    const mystery = clip("Mystery_FX");

    const mapping = mapCharacterClips([
      idle,
      run,
      jump,
      fall,
      crouch,
      aim,
      build,
      edit,
      fire,
      mystery,
    ]);

    expect(mapping.clips.idle).toBe(idle);
    expect(mapping.clips.run).toBe(run);
    expect(mapping.clips.jump).toBe(jump);
    expect(mapping.clips.fall).toBe(fall);
    expect(mapping.clips.crouch).toBe(crouch);
    expect(mapping.clips.aim).toBe(aim);
    expect(mapping.clips.build).toBe(build);
    expect(mapping.clips.edit).toBe(edit);
    expect(mapping.clips.fire).toBe(fire);
    expect(mapping.unmappedNames).toEqual(["Mystery_FX"]);
    expect(mapping.missingStates).toEqual([]);
  });

  it("reports missing states for partial sets and never throws on any subset", () => {
    const mapping = mapCharacterClips([clip("Idle"), clip("Run")]);
    expect(Object.keys(mapping.clips).sort()).toEqual(["idle", "run"]);
    expect(mapping.unmappedNames).toEqual([]);
    expect(mapping.missingStates).toEqual([
      "jump",
      "fall",
      "crouch",
      "aim",
      "build",
      "edit",
    ]);

    const empty = mapCharacterClips([]);
    expect(empty.clips).toEqual({});
    expect(empty.unmappedNames).toEqual([]);
    expect(empty.missingStates).toHaveLength(8);
  });

  it("honours explicit name overrides over keyword matching", () => {
    const run = clip("WeirdName");
    const mapping = mapCharacterClips([run], {
      nameOverrides: { run: "WeirdName" },
    });
    expect(mapping.clips.run).toBe(run);
    expect(mapping.unmappedNames).toEqual([]);

    expect(normalizeClipName("Jump_Start")).toBe("jumpstart");
  });
});

describe("CharacterAnimationDriver", () => {
  let engine: NullEngine;
  let scene: Scene;
  let rig: { root: TransformNode; limb: TransformNode };

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
    scene.useConstantAnimationDeltaTime = true;
    rig = makeRig(scene);
  });

  afterEach(() => {
    scene.dispose();
    engine.dispose();
  });

  it("is fully safe with no clips attached: every state syncs, nothing plays, root untouched", () => {
    const driver = new CharacterAnimationDriver(rig.root);
    const feed = makeStream();
    const before = snapshot(rig.root);

    const states = feed(driver, [
      { x: 0 }, // idle
      { x: 1 }, // moving
      { x: 2, y: 0.3 }, // airborne
      { x: 3, crouch: 1 }, // descending (airborne beats crouch)
    ]);

    // States are derived from the stream even with no clips attached...
    expect(states).toEqual(["idle", "run", "jump", "fall"]);
    // ...but nothing ever plays.
    expect(driver.activeClip()).toBeNull();
    expect(scene.animatables.length).toBe(0);
    expect(rig.root.position.clone()).toEqual(before.position);
    expect(driver.mapping).toBeNull();
    expect(driver.dispose()).toBeUndefined();
  });

  it("derives idle, then walk→run, then full run from the canonical position stream", () => {
    const driver = new CharacterAnimationDriver(rig.root);
    const feed = makeStream();
    driver.attachClips([
      makeClip(scene, rig.root, rig.limb, "Idle", 1, { limbSwing: true }),
      makeClip(scene, rig.root, rig.limb, "Running", 1, { limbSwing: true }),
    ]);

    // Stationary: the idle clip is the playable state.
    const atRest = feed(driver, line(10, 0, 0));
    expect(atRest[0]).toBe("idle");
    expect(atRest[9]).toBe("idle");
    expect(driver.activeClip()).toBe("idle");

    // 1.5 m/s is the procedural "walk" state: it maps onto the run clip
    // (gait), not a freeze.
    const walking = feed(driver, line(20, 1.5, 0));
    expect(walking[19]).toBe("run");
    expect(driver.activeClip()).toBe("run");

    // 6 m/s (full move speed) is an unambiguous run.
    const sprinting = feed(driver, line(10, 6, 3));
    expect(sprinting[9]).toBe("run");
    expect(driver.activeClip()).toBe("run");
  });

  it("derives jump then fall from the vertical stream, then returns to ground locomotion", () => {
    const driver = new CharacterAnimationDriver(rig.root);
    const feed = makeStream();
    driver.attachClips([
      makeClip(scene, rig.root, rig.limb, "Idle", 1, { limbSwing: true }),
      makeClip(scene, rig.root, rig.limb, "Running", 1, { limbSwing: true }),
      makeClip(scene, rig.root, rig.limb, "Jump_Start", 1, { limbSwing: true }),
      makeClip(scene, rig.root, rig.limb, "FallLoop", 1, { limbSwing: true }),
    ]);

    // Grounded run first (6 m/s horizontal → ends at x = 3.6).
    feed(driver, line(12, 6, 0));
    expect(driver.activeClip()).toBe("run");

    // A jump: y rises then falls back down (dt = 50 ms steps).
    const yProfile = [0.25, 0.45, 0.6, 0.7, 0.75, 0.7, 0.6, 0.4, 0.15, 0, 0, 0];
    const states = feed(
      driver,
      yProfile.map((y, i) => ({ x: 3.6 + 0.3 * (i + 1), y })),
    );

    expect(states[0]).toBe("jump"); // vy +5 m/s launches airborne
    expect(states.indexOf("fall")).toBeGreaterThan(0); // descent reads as fall
    expect(states[states.length - 1]).toBe("run"); // landed, still running
    expect(driver.activeClip()).toBe("run");
  });

  it("crouch wins over grounded locomotion; airborne wins over crouch", () => {
    const driver = new CharacterAnimationDriver(rig.root);
    const feed = makeStream();
    driver.attachClips([
      makeClip(scene, rig.root, rig.limb, "Idle", 1, { limbSwing: true }),
      makeClip(scene, rig.root, rig.limb, "Running", 1, { limbSwing: true }),
      makeClip(scene, rig.root, rig.limb, "Jump_Start", 1, { limbSwing: true }),
      makeClip(scene, rig.root, rig.limb, "CrouchIdle", 1, { limbSwing: true }),
    ]);

    // Eased crouch blend past the threshold → the crouch clip.
    const crouched = feed(driver, [
      { x: 0, crouch: 0.9 },
      { x: 0, crouch: 0.9 },
      { x: 0, crouch: 0.9 },
    ]);
    expect(crouched[2]).toBe("crouch");
    expect(driver.activeClip()).toBe("crouch");

    // Below the threshold (blend still easing in) → idle.
    const easing = feed(driver, [{ x: 0, crouch: 0.3 }]);
    expect(easing[0]).toBe("idle");
    expect(driver.activeClip()).toBe("idle");

    // Crouched then airborne: jump beats crouch.
    const jumpOut = feed(driver, [
      { x: 0, y: 0.25, crouch: 0.9 },
      { x: 0, y: 0.4, crouch: 0.9 },
    ]);
    expect(jumpOut[0]).toBe("jump");
    expect(driver.activeClip()).toBe("jump");
  });

  it("supports the remote player: interpolated stream + replicated crouch, with missing-clip fallback to idle", () => {
    const driver = new CharacterAnimationDriver(rig.root);
    const feed = makeStream();
    // The remote presentation only gets whatever clips the asset provides:
    // here idle + crouch only — movement/airborne states must fall back.
    const mapping = driver.attachClips([
      makeClip(scene, rig.root, rig.limb, "Idle", 1, { limbSwing: true }),
      makeClip(scene, rig.root, rig.limb, "Crouch", 1, { limbSwing: true }),
    ]);
    expect(mapping.missingStates).toEqual([
      "run",
      "jump",
      "fall",
      "aim",
      "build",
      "edit",
    ]);

    // Remote stream at interpolation cadence (~30 Hz) moving at 6 m/s:
    // derived "run" has no clip → falls back to the idle clip (never frozen).
    const moving = feed(driver, line(20, 6, 0, 1 / 30));
    expect(moving[19]).toBe("idle"); // playable state (fallback)
    expect(driver.activeClip()).toBe("idle");

    // The replicated crouch flag drives the crouch clip the same way.
    const crouched = feed(driver, [{ x: 4, crouch: 1 }], 1 / 30);
    expect(crouched[0]).toBe("crouch");
    expect(driver.activeClip()).toBe("crouch");

    // Remote airborne without a jump clip: safe idle fallback, no throw.
    const airborne = feed(driver, [{ x: 4, y: 0.3 }], 1 / 30);
    expect(airborne[0]).toBe("idle");
    expect(driver.activeClip()).toBe("idle");
  });

  it("never modifies the presentation/gameplay root: full state + fire cycle through the live sync path", () => {
    const driver = new CharacterAnimationDriver(rig.root);
    const feed = makeStream();
    const groups = [
      makeClip(scene, rig.root, rig.limb, "Idle", 1, {
        rootMotion: true,
        limbSwing: true,
      }),
      makeClip(scene, rig.root, rig.limb, "Running", 1, {
        rootMotion: true,
        limbSwing: true,
      }),
      makeClip(scene, rig.root, rig.limb, "Jump", 1, {
        rootMotion: true,
        limbSwing: true,
      }),
      makeClip(scene, rig.root, rig.limb, "Fall", 1, {
        rootMotion: true,
        limbSwing: true,
      }),
      makeClip(scene, rig.root, rig.limb, "Crouch", 1, {
        rootMotion: true,
        limbSwing: true,
      }),
      makeClip(scene, rig.root, rig.limb, "Fire", 1, {
        rootMotion: true,
        limbSwing: true,
      }),
    ];
    driver.attachClips(groups);
    const before = snapshot(rig.root);

    // Walk the full visual state space, including the fire one-shot.
    feed(driver, line(8, 0, 0)); // idle
    feed(driver, line(10, 6, 0)); // run (ends at x = 3)
    feed(driver, [
      { x: 3.3, y: 0.25 },
      { x: 3.6, y: 0.5 },
    ]); // jump (vy +5 m/s)
    feed(driver, [
      { x: 3.9, y: 0.2 },
      { x: 4.2, y: 0 },
      { x: 4.5, y: 0 },
    ]); // fall → land
    feed(driver, line(5, 0, 4.5, 0.05).map((s) => ({ ...s, crouch: 0.9 }))); // crouch
    feed(driver, [
      { x: 4.5, y: 0 },
      { x: 4.5, y: 0 },
    ]); // uncrouch → grounded locomotion
    driver.triggerFire();
    for (let i = 0; i < 70; i += 1) scene.animate(); // fire finishes

    // The gameplay-mirror root is untouched (position animations were
    // stripped); the non-root clip still actually plays.
    expect(rig.root.position.clone()).toEqual(before.position);
    expect(rig.root.rotation.clone()).toEqual(before.rotation);
    expect(rig.root.scaling.clone()).toEqual(before.scaling);
    expect(rig.limb.rotation.z).not.toBeCloseTo(0, 5);
    expect(driver.activeClip()).toBe("run"); // returned to locomotion
  });

  it("repeated attachClips adds no duplicate observers; dispose is idempotent and no-ops every API", async () => {
    const driver = new CharacterAnimationDriver(rig.root);
    const feed = makeStream();
    const idle = makeClip(scene, rig.root, rig.limb, "Idle", 1, { limbSwing: true });
    const run = makeClip(scene, rig.root, rig.limb, "Running", 1, { limbSwing: true });
    const fire = makeClip(scene, rig.root, rig.limb, "Fire", 1, { limbSwing: true });

    driver.attachClips([idle, run, fire]);
    driver.attachClips([idle, run, fire]); // loader re-emit: must be a no-op
    driver.attachClips([idle, run, fire]);
    expect(fire.onAnimationGroupEndObservable.observers.length).toBe(1);

    feed(driver, line(10, 6, 0));
    expect(driver.activeClip()).toBe("run");
    driver.triggerFire();
    expect(driver.activeClip()).toBe("fire");
    for (let i = 0; i < 70; i += 1) scene.animate();
    expect(driver.activeClip()).toBe("run"); // one-shot returned to locomotion

    driver.dispose();
    expect(driver.isDisposed).toBe(true);
    // Babylon 9 detaches removed observers on the next timer tick
    // (deferred unregister — see the `observers` getter docs).
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fire.onAnimationGroupEndObservable.observers.length).toBe(0);
    expect(Boolean(idle.isStarted)).toBe(false);
    expect(Boolean(run.isStarted)).toBe(false);
    expect(Boolean(fire.isStarted)).toBe(false);

    // Every API is a safe no-op after dispose.
    expect(
      driver.sync({ x: 1, y: 0, z: 0, timeMs: 100, deltaSeconds: 0.05 }),
    ).toBe("idle");
    expect(() => driver.attachClips([idle])).not.toThrow();
    expect(() => driver.triggerFire()).not.toThrow();
    expect(() => driver.reset()).not.toThrow();
    expect(() => driver.dispose()).not.toThrow();
    for (let i = 0; i < 30; i += 1) scene.animate();
    expect(scene.animatables.length).toBe(0);
    expect(driver.activeClip()).toBeNull();
  });
});
