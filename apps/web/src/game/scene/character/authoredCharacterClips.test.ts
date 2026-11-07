import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CharacterAsset } from "./characterAsset";
import { CharacterModel } from "./CharacterModel";
import { PlayerBodyFacade } from "./playerBodyFacade";

let engine: NullEngine;
let scene: Scene;
let now: number;
function setup() {
  engine = new NullEngine(); scene = new Scene(engine); now = 0;
  scene.useConstantAnimationDeltaTime = true;
}
async function model(prefix = "animated", variant: "local" | "remote" = "local") {
  const bytes = readFileSync(new URL("../../../../public/assets/character/BuildShiftBaseCharacter.glb", import.meta.url));
  const asset = await CharacterAsset.fromBuffer(new Uint8Array(bytes).buffer, scene);
  const body = await CharacterModel.create(scene, asset, variant, prefix, { animationClock: () => now });
  body.setEnabled(true);
  return { asset, body };
}
function tick(body: CharacterModel, x: number, y: number, z: number, frames = 1) {
  for (let i = 0; i < frames; i++) {
    now += 1000 / 60;
    body.setTransform({ x, y, z }, 0);
    scene.onBeforeAnimationsObservable.notifyObservers(scene);
    scene.animate();
  }
}
function joint(prefix: string, name: string) { return scene.getTransformNodeByName(`${prefix}-${name}`)!; }
afterEach(() => { vi.restoreAllMocks(); scene?.dispose(); engine?.dispose(); });

describe("authored Quaternius clips on the production character", () => {
  it("forwards the parsed authoritative crouch flag into remote presentation's existing interpolation path", () => {
    const runtime = readFileSync(new URL("../../GameRuntime.ts", import.meta.url), "utf8").replace(/\s+/g, "");
    const feed = runtime.match(/this\.remoteInterpolation\.addState\(\{([^}]+)\}/)?.[1];
    expect(feed).toContain("crouch:r.crouch");
  });
  it("creates five real instance-targeted skeletal groups, never root-motion tracks", async () => {
    setup(); const { body } = await model();
    expect(scene.animationGroups.map(g => g.name.split("-")[0]).sort()).toEqual(["crouch", "fall", "idle", "jump", "run"]);
    for (const group of scene.animationGroups) {
      expect(group.targetedAnimations.length).toBeGreaterThan(10);
      for (const { target, animation } of group.targetedAnimations) {
        expect(target).not.toBe(body.root);
        expect(target).not.toBe(body.visualRoot);
        expect(target.isDescendantOf(body.root)).toBe(true);
        expect(animation.getKeys().length).toBe(9);
      }
    }
    expect(body.animationState).toBe("idle");
  });

  it("actual render-frame position drives idle/run/jump/fall/crouch without per-frame restarts", async () => {
    setup(); const { body } = await model();
    tick(body, 0, 0, 0);
    for (let i = 1; i <= 15; i++) tick(body, i * 0.1, 0, 0);
    expect(body.animationState).toBe("run");
    const run = scene.animationGroups.find(g => g.name.startsWith("run-"))!;
    const start = vi.spyOn(run, "start");
    for (let i = 16; i <= 25; i++) tick(body, i * 0.1, 0, 0);
    expect(start).not.toHaveBeenCalled();
    tick(body, 2.5, 0.12, 0);
    expect(body.animationState).toBe("jump");
    for (let i = 0; i < 5; i++) tick(body, 2.5, 0.24 + i * 0.12, 0);
    for (let i = 0; i < 5; i++) tick(body, 2.5, 0.6 - i * 0.12, 0);
    expect(body.animationState).toBe("fall");
    tick(body, 2.5, 0, 0, 15);
    body.setCrouchBlend(1);
    tick(body, 2.5, 0, 0, 15);
    expect(body.animationState).toBe("crouch");
    expect(body.visualRoot.scaling.y).toBe(1); // no double squash
    body.setCrouchBlend(0);
    tick(body, 2.5, 0, 0, 90);
    expect(body.animationState).toBe("idle");
    expect(body.root.position.asArray()).toEqual([2.5, 0, 0]);
  });

  it("playing a clip deforms the real skinned mesh and moves the hand but not the gameplay transform", async () => {
    setup(); const { body } = await model();
    body.setTransform({ x: 3, y: 2, z: -5 }, 0.6);
    const hand = joint("animated", "hand_r");
    hand.computeWorldMatrix(true);
    const before = hand.getAbsolutePosition().clone();
    const thigh = joint("animated", "thigh_l");
    const beforeRotation = thigh.rotationQuaternion!.clone();
    const skin = body.root.getChildMeshes().find(m => m.skeleton && m instanceof Mesh)!;
    const verticesBefore = Array.from(skin.getPositionData(true, true)!);
    const run = scene.animationGroups.find(g => g.name.startsWith("run-"))!;
    scene.animationGroups.forEach(g => g.stop());
    run.enableBlending = false; // deterministic keyframe seek, not fade-in
    run.start(true); run.goToFrame(5);
    for (const n of body.root.getChildTransformNodes(false)) n.computeWorldMatrix(true);
    skin.skeleton!.prepare(true);
    expect(thigh.rotationQuaternion!.equalsWithEpsilon(beforeRotation)).toBe(false);
    expect(Vector3.Distance(hand.getAbsolutePosition(), before)).toBeGreaterThan(0.1);
    const verticesAfter = skin.getPositionData(true, true)!;
    expect(verticesAfter.some((v, i) => Math.abs(v - verticesBefore[i]) > 0.01)).toBe(true);
    expect(body.root.position.asArray()).toEqual([3, 2, -5]);
    expect(body.root.rotation.y).toBe(-0.6);
  });

  it("recognises remote motion at 2 FPS without treating ordinary samples as a tab-resume gap", async () => {
    setup(); const { body } = await model("slow", "remote");
    for (let i = 0; i < 4; i++) {
      now += 500;
      body.setTransform({ x: i * 2, y: 0, z: 0 }, 0);
      scene.onBeforeAnimationsObservable.notifyObservers(scene);
    }
    expect(body.animationState).toBe("run");
    now += 2000;
    scene.onBeforeAnimationsObservable.notifyObservers(scene);
    expect(body.animationState).toBe("idle");
    expect(body.root.position.x).toBe(6);
  });

  it("crouch bends the actual knees and lowers the pelvis while feet and root stay planted", async () => {
    setup(); const { body } = await model();
    const pelvis = joint("animated", "pelvis");
    const position = (n: TransformNode) => { n.computeWorldMatrix(true); return n.getAbsolutePosition().clone(); };
    const soleY = () => Math.min(...["foot_l", "ball_l", "ball_leaf_l", "foot_r", "ball_r", "ball_leaf_r"].map(n => position(joint("animated", n)).y));
    const hipBefore = position(pelvis), soleBefore = soleY();
    const kneeBefore = joint("animated", "calf_l").rotationQuaternion!.clone();
    const crouch = scene.animationGroups.find(g => g.name.startsWith("crouch-"))!;
    scene.animationGroups.forEach(g => g.stop());
    crouch.enableBlending = false;
    crouch.start(true); crouch.goToFrame(0);
    expect(position(pelvis).y).toBeLessThan(hipBefore.y - 0.2);
    expect(soleY()).toBeCloseTo(soleBefore, 4);
    expect(joint("animated", "calf_l").rotationQuaternion!.equalsWithEpsilon(kneeBefore)).toBe(false);
    expect(body.root.position.asArray()).toEqual([0, 0, 0]);
  });

  it("local/remote have independent clips/targets and observer/group cleanup is complete", async () => {
    setup(); const observerCount = scene.onBeforeAnimationsObservable.observers.length;
    const { body: local } = await model("local");
    const { body: remote } = await model("remote", "remote");
    expect(scene.animationGroups).toHaveLength(10);
    expect(scene.onBeforeAnimationsObservable.observers.length).toBe(observerCount + 2);
    const remoteThigh = joint("remote", "thigh_l").rotationQuaternion!.clone();
    const run = scene.animationGroups.find(g => g.name === "run-local")!;
    run.start(true); run.goToFrame(6);
    expect(joint("remote", "thigh_l").rotationQuaternion!.equalsWithEpsilon(remoteThigh)).toBe(true);
    local.dispose(); local.dispose(); remote.dispose();
    expect(scene.animationGroups).toHaveLength(0);
    await vi.waitFor(() => expect(scene.onBeforeAnimationsObservable.observers.length).toBe(observerCount));
  });

  it("normal local and remote facade swaps enable animation; failed asset stays fallback-only", async () => {
    setup();
    const bytes = readFileSync(new URL("../../../../public/assets/character/BuildShiftBaseCharacter.glb", import.meta.url));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array(bytes).buffer })));
    const local = new PlayerBodyFacade(scene, "local", "local"), remote = new PlayerBodyFacade(scene, "remote", "remote");
    local.startCharacterLoad(); remote.startCharacterLoad();
    await Promise.all([local.whenCharacterSettled(), remote.whenCharacterSettled()]);
    expect(local.characterModel!.animationState).toBe("idle");
    expect(remote.characterModel!.animationState).toBe("idle");
    local.dispose(); remote.dispose(); vi.unstubAllGlobals();
    expect(scene.animationGroups).toHaveLength(0);
  });
});
