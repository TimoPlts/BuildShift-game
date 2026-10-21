/**
 * Behavioral NullEngine tests for CharacterAnimationController:
 *  - optional clips: any subset (or none) of idle/run/jump/fall/crouch/aim/
 *    build/edit + fire may be attached; missing clips are safe no-ops;
 *  - frame-driven setState does NOT restart a running group — exactly one
 *    start per real state change;
 *  - the fire one-shot plays once, is not re-triggerable while playing, and
 *    returns to the locomotion clip current when it ends;
 *  - zero root motion: root position animations are stripped at attach and
 *    the root transform is untouched while non-root clips play;
 *  - gameplay-facing transforms (root position/rotation/scaling) are never
 *    changed by any animation sequence;
 *  - reset returns to idle; dispose is idempotent and every API is a no-op
 *    afterwards.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import {
  Animation,
  AnimationGroup,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import {
  CHARACTER_ANIM_STATES,
  CharacterAnimationController,
} from "./characterAnimationController";

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
    const pos = new Animation(name + "_rootpos", "position", FPS, Animation.ANIMATIONTYPE_VECTOR3, 0);
    pos.setKeys([
      { frame: 0, value: new Vector3(0, 0, 0) },
      { frame: frames, value: new Vector3(5, 0, 0) },
    ]);
    group.addTargetedAnimation(pos, root);
  }
  if (options.limbSwing) {
    const rot = new Animation(name + "_limbrot", "rotation", FPS, Animation.ANIMATIONTYPE_VECTOR3, 0);
    rot.setKeys([
      { frame: 0, value: new Vector3(0, 0, 0) },
      { frame: frames, value: new Vector3(0, 0, 1) },
    ]);
    group.addTargetedAnimation(rot, limb);
  }
  return group;
}

/**
 * Advance the scene's animation clock by `frames` render steps. With
 * `useConstantAnimationDeltaTime` each step is a deterministic 16 ms.
 */
function step(scene: Scene, frames: number): void {
  for (let i = 0; i < frames; i += 1) scene.animate();
}

describe("CharacterAnimationController", () => {
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

  function makeController(): CharacterAnimationController {
    return new CharacterAnimationController(rig.root);
  }

  it("is fully safe with no clips attached at all (optional clips)", () => {
    const controller = makeController();
    for (const state of CHARACTER_ANIM_STATES) {
      expect(() => controller.setState(state)).not.toThrow();
      expect(controller.activeClip()).toBeNull();
      expect(controller.getState()).toBe(state);
    }
    expect(() => controller.triggerFire()).not.toThrow();
    expect(controller.isFireActive()).toBe(false);
    expect(() => controller.reset()).not.toThrow();
    expect(controller.getState()).toBe("idle");
    step(scene, 30);
    expect(scene.animatables.length).toBe(0);
    expect(() => controller.dispose()).not.toThrow();
  });

  it("plays a registered locomotion clip exactly once across per-frame setState (no restarts)", () => {
    const controller = makeController();
    const idle = makeClip(scene, rig.root, rig.limb, "idle", 1, { limbSwing: true });
    const run = makeClip(scene, rig.root, rig.limb, "run", 1, { limbSwing: true });
    controller.attach("idle", idle);
    controller.attach("run", run);

    const startRun = vi.fn(run.start.bind(run));
    run.start = startRun as typeof run.start;

    controller.setState("run");
    expect(run.isStarted).toBe(true);
    expect(Boolean(idle.isStarted)).toBe(false);
    expect(controller.activeClip()).toBe("run");

    // The loader contract: setState runs every frame with the derived state.
    for (let frame = 0; frame < 90; frame += 1) {
      controller.setState("run");
      step(scene, 1);
    }
    expect(startRun).toHaveBeenCalledTimes(1); // the single entry, never re-run
    expect(run.isStarted).toBe(true);
  });

  it("transitions start exactly one group per real state change; missing clips are safe", () => {
    const controller = makeController();
    const idle = makeClip(scene, rig.root, rig.limb, "idle", 1, { limbSwing: true });
    const run = makeClip(scene, rig.root, rig.limb, "run", 1, { limbSwing: true });
    const jump = makeClip(scene, rig.root, rig.limb, "jump", 1, { limbSwing: true });
    controller.attach("idle", idle);
    controller.attach("run", run);

    const startRun = vi.spyOn(run, "start");
    const startIdle = vi.spyOn(idle, "start");
    const startJump = vi.spyOn(jump, "start");

    controller.setState("run");
    expect(run.isStarted).toBe(true);

    // "jump" has no clip: the transition is safe and plays nothing.
    controller.setState("jump");
    expect(run.isStarted).toBe(false);
    expect(controller.activeClip()).toBeNull();
    expect(startJump).not.toHaveBeenCalled();

    // Returning to a real clip starts it exactly once.
    controller.setState("idle");
    expect(idle.isStarted).toBe(true);
    expect(startIdle).toHaveBeenCalledTimes(1);
    expect(startRun).toHaveBeenCalledTimes(1);

    // Attaching a clip for the CURRENT state auto-starts it.
    controller.setState("jump"); // again nothing (no clip yet)
    controller.attach("jump", jump);
    expect(jump.isStarted).toBe(true);
    expect(startJump).toHaveBeenCalledTimes(1);
    expect(controller.activeClip()).toBe("jump");
  });

  it("fire is a one-shot: plays once, ignores re-triggers, and returns to locomotion", () => {
    const controller = makeController();
    const run = makeClip(scene, rig.root, rig.limb, "run", 1, { limbSwing: true });
    const fire = makeClip(scene, rig.root, rig.limb, "fire", 1, { limbSwing: true });
    controller.attach("run", run);
    controller.attach("fire", fire);

    const startRun = vi.spyOn(run, "start");
    const startFire = vi.spyOn(fire, "start");

    controller.setState("run");
    expect(Boolean(fire.isStarted)).toBe(false); // fire never auto-plays

    controller.triggerFire();
    expect(fire.isStarted).toBe(true);
    expect(run.isStarted).toBe(false);
    expect(controller.isFireActive()).toBe(true);
    expect(controller.activeClip()).toBe("fire");
    // Repeated trigger spam (e.g. every frame while holding fire) is ignored.
    controller.triggerFire();
    controller.triggerFire();
    expect(startFire).toHaveBeenCalledTimes(1);

    // Let the 1s one-shot finish (16 ms steps -> ~63 steps).
    step(scene, 70);
    expect(controller.isFireActive()).toBe(false);
    expect(controller.activeClip()).toBe("run");
    expect(run.isStarted).toBe(true);
    expect(startRun).toHaveBeenCalledTimes(2); // entry + post-fire return
    expect(startFire).toHaveBeenCalledTimes(1); // no loop-back into fire
  });

  it("fire returns to the locomotion state current when the one-shot ends", () => {
    const controller = makeController();
    const idle = makeClip(scene, rig.root, rig.limb, "idle", 1, { limbSwing: true });
    const run = makeClip(scene, rig.root, rig.limb, "run", 1, { limbSwing: true });
    const fire = makeClip(scene, rig.root, rig.limb, "fire", 1, { limbSwing: true });
    controller.attach("idle", idle);
    controller.attach("run", run);
    controller.attach("fire", fire);

    const startIdle = vi.spyOn(idle, "start");
    const startRun = vi.spyOn(run, "start");

    controller.setState("run");
    controller.triggerFire();
    expect(run.isStarted).toBe(false);

    // Locomotion state changes while the one-shot is playing: it must not
    // start the locomotion group yet...
    controller.setState("idle");
    expect(idle.isStarted).toBe(false);
    expect(startIdle).not.toHaveBeenCalled();
    expect(controller.isFireActive()).toBe(true);

    // ...but when the one-shot ends, the CURRENT state resumes.
    step(scene, 70);
    expect(controller.isFireActive()).toBe(false);
    expect(idle.isStarted).toBe(true);
    expect(run.isStarted).toBe(false);
    expect(startIdle).toHaveBeenCalledTimes(1);
    expect(startRun).toHaveBeenCalledTimes(1);
  });

  it("strips baked root motion at attach: root position anim is removed, parts still play", () => {
    const controller = makeController();
    const run = makeClip(scene, rig.root, rig.limb, "run", 1, {
      rootMotion: true,
      limbSwing: true,
    });
    expect(run.targetedAnimations.some((ta) => ta.target === rig.root)).toBe(true);

    controller.attach("run", run);
    expect(run.targetedAnimations.some((ta) => ta.target === rig.root)).toBe(false);
    expect(run.targetedAnimations.length).toBe(1); // only the limb survives

    controller.setState("run");
    step(scene, 45); // > 1 full loop
    expect(rig.limb.rotation.z).not.toBeCloseTo(0, 5); // the clip still plays
  });

  it("never changes the root (gameplay) transform across a full state + fire cycle", () => {
    const controller = makeController();
    const idle = makeClip(scene, rig.root, rig.limb, "idle", 1, {
      rootMotion: true,
      limbSwing: true,
    });
    const run = makeClip(scene, rig.root, rig.limb, "run", 1, {
      rootMotion: true,
      limbSwing: true,
    });
    const fire = makeClip(scene, rig.root, rig.limb, "fire", 1, {
      rootMotion: true,
      limbSwing: true,
    });
    controller.attach("idle", idle);
    controller.attach("run", run);
    controller.attach("fire", fire);

    const before = {
      position: rig.root.position.clone(),
      rotation: rig.root.rotation.clone(),
      scaling: rig.root.scaling.clone(),
    };

    for (const state of ["idle", "run", "jump", "fall", "crouch", "aim", "build", "edit"] as const) {
      controller.setState(state);
      step(scene, 5);
    }
    controller.setState("run");
    controller.triggerFire();
    step(scene, 70); // fire finishes and returns to run
    controller.setState("idle");
    step(scene, 10);

    expect(rig.root.position.x).toBe(before.position.x);
    expect(rig.root.position.y).toBe(before.position.y);
    expect(rig.root.position.z).toBe(before.position.z);
    expect(rig.root.rotation.x).toBe(before.rotation.x);
    expect(rig.root.rotation.y).toBe(before.rotation.y);
    expect(rig.root.rotation.z).toBe(before.rotation.z);
    expect(rig.root.scaling.x).toBe(before.scaling.x);
    expect(rig.root.scaling.y).toBe(before.scaling.y);
    expect(rig.root.scaling.z).toBe(before.scaling.z);
    expect(controller.activeClip()).toBe("idle");
  });

  it("reset returns to idle immediately; dispose is idempotent and no-ops every API", () => {
    const controller = makeController();
    const idle = makeClip(scene, rig.root, rig.limb, "idle", 1, { limbSwing: true });
    const run = makeClip(scene, rig.root, rig.limb, "run", 1, { limbSwing: true });
    const fire = makeClip(scene, rig.root, rig.limb, "fire", 1, { limbSwing: true });
    controller.attach("idle", idle);
    controller.attach("run", run);
    controller.attach("fire", fire);

    controller.setState("run");
    controller.triggerFire();
    expect(controller.isFireActive()).toBe(true);

    controller.reset();
    expect(controller.isFireActive()).toBe(false);
    expect(controller.getState()).toBe("idle");
    expect(controller.activeClip()).toBe("idle");
    expect(Boolean(fire.isStarted)).toBe(false);
    expect(Boolean(run.isStarted)).toBe(false);

    controller.dispose();
    expect(() => controller.dispose()).not.toThrow();
    expect(Boolean(run.isStarted)).toBe(false);
    expect(Boolean(idle.isStarted)).toBe(false);
    // Every API is a safe no-op after dispose...
    expect(() => controller.setState("run")).not.toThrow();
    expect(() => controller.triggerFire()).not.toThrow();
    expect(() =>
      controller.attach("jump", makeClip(scene, rig.root, rig.limb, "jump", 1)),
    ).not.toThrow();
    expect(() => controller.reset()).not.toThrow();
    // ...and nothing starts.
    step(scene, 30);
    expect(scene.animatables.length).toBe(0);
    expect(controller.activeClip()).toBeNull();
  });

  it("honours optional blending and per-clip speed ratio configuration", () => {
    const { root, limb } = rig;
    const run = makeClip(scene, root, limb, "run", 1, { limbSwing: true });
    const controller = new CharacterAnimationController(root, {
      transitionSpeed: 10,
      speedRatio: { run: 1.5, fire: 2 },
    });
    controller.attach("run", run);
    const startRun = vi.spyOn(run, "start");

    controller.setState("run");

    expect(run.enableBlending).toBe(true);
    expect(run.blendingSpeed).toBe(10);
    expect(startRun).toHaveBeenCalledWith(true, 1.5);
    expect(controller.activeClip()).toBe("run");
    controller.dispose();
  });
});
