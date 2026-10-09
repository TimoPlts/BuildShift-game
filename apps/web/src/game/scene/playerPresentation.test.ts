/**
 * Behavioral NullEngine tests for PlayerPresentation — the modular low-poly
 * player body:
 *  - built from a bounded set of Babylon primitives/materials, no external
 *    assets, inside the player collider envelope (feet at -0.9 m)
 *  - local vs remote variants are visually distinct
 *  - setTransform moves the body and orients the forward visor (yaw 0 = -Z,
 *    positive yaw toward +X — the shared movement convention)
 *  - applyState: eliminated palette, hit-flash decay contract, base restore
 *  - setEnabled hides/shows every owned mesh
 *  - procedural pose (derived from the same canonical position stream):
 *    idle breathing, walk/run gait, jump tuck, fall, landing dip, and the
 *    local weapon-aim stance from the active camera
 *  - the invariant that visual animation NEVER mutates gameplay transforms
 *    (root / visualRoot stay exactly at the setTransform values)
 *  - exactly one scene before-render observer, removed on dispose; dispose
 *    releases every owned mesh, material, and pivot and is idempotent; all
 *    methods are safe no-ops after dispose
 */
import { afterEach, describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import {
  PLAYER_COLLIDER_HALF_TOTAL_HEIGHT,
  PLAYER_COLLIDER_TOTAL_HEIGHT,
} from "@buildshift/game-config";
import { PlayerPresentation } from "./PlayerPresentation";

/** One frame at the canonical presentation cadence (ms). */
const FRAME_MS = 1000 / 30;

function makeScene(): { engine: NullEngine; scene: Scene } {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  return { engine, scene };
}

function ownedMeshes(scene: Scene, prefix: string) {
  return scene.meshes.filter((m) => m.name.startsWith(prefix));
}

function ownedMaterials(scene: Scene, prefix: string) {
  return scene.materials.filter((m) => m.name.startsWith(prefix));
}

/** The owned animation pivot with the given full name (throws if missing). */
function pivot(scene: Scene, name: string): TransformNode {
  const node = scene.transformNodes.find((t) => t.name === name);
  expect(node, `pivot ${name}`).toBeDefined();
  return node as TransformNode;
}

/**
 * World-space Y extent [min, max] of every owned mesh. Transforms each mesh's
 * local bounding-box corners through its world matrix (Babylon 9 no longer
 * exposes getWorldBoundingBox).
 */
function worldYExtent(scene: Scene, prefix: string): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const mesh of ownedMeshes(scene, prefix)) {
    mesh.computeWorldMatrix(true);
    const worldMatrix = mesh.getWorldMatrix();
    const localBox = mesh.getBoundingInfo().boundingBox;
    // Enumerate the 8 corners of the axis-aligned local box.
    const xs = [localBox.minimum.x, localBox.maximum.x];
    const ys = [localBox.minimum.y, localBox.maximum.y];
    const zs = [localBox.minimum.z, localBox.maximum.z];
    for (const x of xs) {
      for (const y of ys) {
        for (const z of zs) {
          const world = Vector3.TransformCoordinates(
            new Vector3(x, y, z),
            worldMatrix,
          );
          min = Math.min(min, world.y);
          max = Math.max(max, world.y);
        }
      }
    }
  }
  return [min, max];
}

/**
 * A presentation rigged with a manual clock so tests can drive both the
 * canonical position stream (setTransform) and the render-frame pose clock
 * (before-render observable) deterministically.
 */
function makeRig(
  rigRegistry: Array<{ dispose(): void }>,
  variant: "local" | "remote",
  prefix = "p",
) {
  const { engine, scene } = makeScene();
  let nowMs = 1_000_000;
  const pres = PlayerPresentation.create(scene, variant, prefix, {
    clock: () => nowMs,
  });
  const rig = {
    engine,
    scene,
    pres,
    now: () => nowMs,
    /** Advance the manual clock and run one render frame. */
    frame: (ms: number = FRAME_MS) => {
      nowMs += ms;
      scene.onBeforeRenderObservable.notifyObservers(scene);
    },
    dispose: () => {
      pres.dispose();
      engine.dispose();
    },
  };
  rigRegistry.push(rig);
  return rig;
}

describe("PlayerPresentation", () => {
  const rigs: Array<{ dispose(): void }> = [];

  afterEach(() => {
    for (const rig of rigs.splice(0)) {
      rig.dispose();
    }
  });

  it("builds a bounded body from primitives inside the collider envelope", () => {
    const rig = makeRig(rigs, "local", "local-player");

    const meshes = ownedMeshes(rig.scene, "local-player");
    const materials = ownedMaterials(rig.scene, "local-player");
    // 12 primitive meshes, 3 shared materials — a bounded, lightweight body.
    expect(meshes).toHaveLength(12);
    expect(materials).toHaveLength(3);
    // Low-poly: every material is plain (no textures) and every mesh is safe
    // (not pickable, no collisions), parented to visualRoot or an owned pivot.
    for (const material of materials) {
      expect((material as StandardMaterial).diffuseTexture).toBeNull();
    }
    for (const mesh of meshes) {
      expect(mesh.isPickable).toBe(false);
      expect(mesh.checkCollisions).toBe(false);
      expect(mesh.parent?.name.startsWith("local-player")).toBe(true);
    }
    // Exactly 5 owned animation pivots (spine, 2 legs, 2 arms) plus the
    // root/visual-root transforms — no other transforms introduced.
    const pivots = rig.scene.transformNodes.filter((t) =>
      t.name.startsWith("local-player-pivot"),
    );
    expect(pivots).toHaveLength(5);

    // The body stands on the same feet line the capsule collider implies
    // (centre at 0, feet at -0.9) and never exceeds the collider envelope.
    const [minY, maxY] = worldYExtent(rig.scene, "local-player");
    expect(minY).toBeCloseTo(-PLAYER_COLLIDER_TOTAL_HEIGHT / 2, 4);
    expect(maxY).toBeLessThanOrEqual(PLAYER_COLLIDER_TOTAL_HEIGHT / 2);
  });

  it("local and remote variants are visually distinct", () => {
    const localRig = makeRig(rigs, "local", "local-player");
    const remoteRig = makeRig(rigs, "remote", "remote-player");

    const localBody = localRig.pres.bodyMaterial.diffuseColor;
    const remoteBody = remoteRig.pres.bodyMaterial.diffuseColor;
    // Green side vs red side — distinct at a glance and from a distance.
    expect(localBody.g).toBeGreaterThan(localBody.r + 0.2);
    expect(remoteBody.r).toBeGreaterThan(remoteBody.g + 0.2);
    // No shared material instances between the two players.
    expect(localRig.pres.bodyMaterial).not.toBe(remoteRig.pres.bodyMaterial);
    expect(localRig.pres.bodyMaterial.name).not.toBe(
      remoteRig.pres.bodyMaterial.name,
    );
  });

  it("setTransform moves the body and orients the visor along the facing yaw", () => {
    const rig = makeRig(rigs, "local", "local-player");
    const local = rig.pres;

    // Yaw 0 faces -Z: the visor sits in front of the head toward -Z.
    local.setTransform({ x: 0, y: 0, z: 0 }, 0);
    local.root.computeWorldMatrix(true);
    local.visorMesh.computeWorldMatrix(true);
    expect(local.visorMesh.getAbsolutePosition().z).toBeLessThan(-0.1);

    // Yaw PI/2 rotates forward toward +X (shared movement convention).
    local.setTransform({ x: 2, y: 0.5, z: -1 }, Math.PI / 2);
    expect(local.root.position.asArray()).toEqual([2, 0.5, -1]);
    local.root.computeWorldMatrix(true);
    local.visorMesh.computeWorldMatrix(true);
    const visorPos = local.visorMesh.getAbsolutePosition();
    expect(visorPos.x).toBeGreaterThan(local.root.position.x + 0.1);
    expect(Math.abs(visorPos.z - local.root.position.z)).toBeLessThan(0.1);
  });

  it("keeps the gameplay root unchanged while lifting replicated feet-based visuals", () => {
    const localRig = makeRig(rigs, "local", "local-player");
    const remoteRig = makeRig(rigs, "remote", "remote-player");

    localRig.pres.setTransform({ x: 1, y: 0, z: 2 }, 0);
    remoteRig.pres.setTransform({ x: -1, y: 0, z: -2 }, 0);

    expect(localRig.pres.root.position.y).toBe(0);
    expect(remoteRig.pres.root.position.y).toBe(0);
    expect(localRig.pres.visualRoot.position.y).toBeCloseTo(0.9, 6);
    expect(remoteRig.pres.visualRoot.position.y).toBeCloseTo(0.9, 6);
  });

  it("applyState: eliminated darkens, hit flash decays, base colors restore", () => {
    const rig = makeRig(rigs, "local", "local-player");
    const local = rig.pres;

    const body = local.bodyMaterial;
    const baseEmissive = body.emissiveColor.clone();

    // Eliminated: shared dark palette, flash counter untouched.
    let frames = local.applyState(true, 4);
    expect(frames).toBe(4);
    expect(body.diffuseColor.r).toBeLessThan(0.2);
    {
      const e = body.emissiveColor;
      expect(e.r * e.r + e.g * e.g + e.b * e.b).toBeCloseTo(0, 5);
    }

    // Hit flash: warm emissive and the frame counter decays by one per call.
    frames = local.applyState(false, 3);
    expect(frames).toBe(2);
    expect(body.emissiveColor.r).toBeGreaterThan(0.5);
    frames = local.applyState(false, 2);
    expect(frames).toBe(1);

    // When the counter runs out the variant's base palette is restored.
    frames = local.applyState(false, 1);
    expect(frames).toBe(0);
    local.applyState(false, 0);
    expect(body.emissiveColor.asArray()).toEqual(baseEmissive.asArray());
    expect(body.emissiveColor.asArray()).not.toEqual([0.75, 0.22, 0.05]);
  });

  it("setEnabled hides and shows every owned mesh", () => {
    const rig = makeRig(rigs, "local", "local-player");

    rig.pres.setEnabled(false);
    const meshes = ownedMeshes(rig.scene, "local-player");
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      expect(mesh.isEnabled()).toBe(false);
    }

    rig.pres.setEnabled(true);
    for (const mesh of meshes) {
      expect(mesh.isEnabled()).toBe(true);
    }
  });

  it("registers exactly one render observer, removed on dispose", async () => {
    const rig = makeRig(rigs, "local", "local-player");

    expect(rig.scene.onBeforeRenderObservable.observers).toHaveLength(1);
    rig.pres.dispose();
    // Babylon defers observer removal to the next tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rig.scene.onBeforeRenderObservable.observers).toHaveLength(0);
    // Idempotent: the second dispose must not throw or re-register.
    expect(() => rig.pres.dispose()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rig.scene.onBeforeRenderObservable.observers).toHaveLength(0);
  });

  it("walking/running animates the gait; idle stops it and breathes", () => {
    const rig = makeRig(rigs, "remote", "p");
    const leg = pivot(rig.scene, "p-pivot-leg-left");
    const arm = pivot(rig.scene, "p-pivot-arm-left");

    // Run at 4 m/s for 1.5 s (canonical position stream + render frames).
    let maxLeg = 0;
    let maxArm = 0;
    for (let i = 0; i < 45; i++) {
      const t = i * FRAME_MS;
      rig.pres.setTransform({ x: (4 * t) / 1000, y: 0, z: 0 }, 0);
      rig.frame();
      maxLeg = Math.max(maxLeg, Math.abs(leg.rotation.x));
      maxArm = Math.max(maxArm, Math.abs(arm.rotation.x));
    }
    expect(rig.pres.pose.state).toBe("run");
    expect(maxLeg).toBeGreaterThan(0.2);
    expect(maxArm).toBeGreaterThan(0.05);

    // Stop: the gait fades out and the body settles to idle breathing.
    const xFinal = (4 * 45 * FRAME_MS) / 1000;
    const spineYs: number[] = [];
    for (let i = 0; i < 90; i++) {
      rig.pres.setTransform({ x: xFinal, y: 0, z: 0 }, 0);
      rig.frame();
      spineYs.push(rig.pres.spinePivot.position.y);
    }
    expect(rig.pres.pose.state).toBe("idle");
    // The gait fully fades: the legs are at rest again.
    expect(Math.abs(leg.rotation.x)).toBeLessThan(0.02);
    // Idle is not frozen: the upper body breathes (subtle spine bob).
    expect(Math.max(...spineYs) - Math.min(...spineYs)).toBeGreaterThan(0.001);
  });

  it("jump arc: airborne poses, landing dip sinks the spine, then recovers", () => {
    const rig = makeRig(rigs, "remote", "p");
    const leg = pivot(rig.scene, "p-pivot-leg-left");

    let sawJump = false;
    let sawFall = false;
    let maxJumpTuck = 0;
    let maxDip = 0;
    const spineYs: number[] = [];

    // Full jump under the shared tuning (v0 = 9 m/s, g = -25 m/s²).
    for (let i = 0; i < 60; i++) {
      const t = (i * FRAME_MS) / 1000;
      const y = Math.max(0, 9 * t - 12.5 * t * t);
      rig.pres.setTransform({ x: 0, y, z: 0 }, 0);
      rig.frame();
      const pose = rig.pres.pose;
      if (pose.state === "jump") {
        sawJump = true;
        maxJumpTuck = Math.max(maxJumpTuck, leg.rotation.x);
      }
      if (pose.state === "fall") sawFall = true;
      maxDip = Math.max(maxDip, pose.landingDip);
      spineYs.push(rig.pres.spinePivot.position.y);
    }
    expect(sawJump).toBe(true);
    expect(sawFall).toBe(true);
    // The jump tucks the legs forward.
    expect(maxJumpTuck).toBeGreaterThan(0.3);
    // A full jump lands near 9 m/s: the dip is well above zero ...
    expect(maxDip).toBeGreaterThan(0.4);
    // ... and it sinks the spine below its rest height (-0.18 + tiny bob).
    expect(Math.min(...spineYs)).toBeLessThan(-0.25);
    // Then the body recovers to the rest height.
    expect(Math.abs(spineYs[spineYs.length - 1] - -0.18)).toBeLessThan(0.02);
  });

  it("visual animation never mutates gameplay transforms", () => {
    const rig = makeRig(rigs, "local", "p");

    let sawRun = false;
    let sawJump = false;
    let sawFall = false;
    let sawDip = false;
    const speed = 6;

    // One full sequence: 2 s of running, a full jump/fall/landing, then
    // running again — while turning. The gameplay transforms must stay
    // EXACTLY at the canonical values on every single frame.
    for (let i = 0; i < 150; i++) {
      const t = (i * FRAME_MS) / 1000;
      let x = speed * Math.min(t, 2);
      let y = 0;
      if (t >= 2) {
        x = speed * 2;
        const jt = t - 2;
        y = Math.max(0, 9 * jt - 12.5 * jt * jt);
      }
      const yaw = t * 0.3;
      rig.pres.setTransform({ x, y, z: 0 }, yaw);

      // Let the pose run a full frame ...
      rig.frame();

      // ... and verify the gameplay mirror is still exact.
      expect(rig.pres.root.position.x).toBe(x);
      expect(rig.pres.root.position.y).toBe(y);
      expect(rig.pres.root.position.z).toBe(0);
      expect(rig.pres.root.rotation.y).toBe(-yaw);
      expect(rig.pres.visualRoot.position.y).toBe(
        PLAYER_COLLIDER_HALF_TOTAL_HEIGHT,
      );

      const pose = rig.pres.pose;
      if (pose.state === "run") sawRun = true;
      if (pose.state === "jump") sawJump = true;
      if (pose.state === "fall") sawFall = true;
      if (pose.landingDip > 0) sawDip = true;
    }

    // The animation actually ran the full state sequence (so the invariance
    // above was exercised under motion, not a frozen body).
    expect(sawRun).toBe(true);
    expect(sawJump).toBe(true);
    expect(sawFall).toBe(true);
    expect(sawDip).toBe(true);
  });

  it("local aim stance: arms raise toward the camera aim and follow its pitch", () => {
    const rig = makeRig(rigs, "local", "p");
    // Camera looking up: direction (0, 2, -6) → pitch ≈ +0.32 rad.
    const camera = new UniversalCamera("cam", new Vector3(0, 1.4, 12), rig.scene);
    camera.setTarget(new Vector3(0, 3.4, 6));
    rig.scene.activeCamera = camera;

    for (let i = 0; i < 90; i++) rig.frame();

    expect(rig.pres.pose.armRaise).toBeGreaterThan(0.95);
    expect(rig.pres.pose.aimPitch).toBeCloseTo(0.32, 1);
    const armLeft = pivot(rig.scene, "p-pivot-arm-left");
    const armRight = pivot(rig.scene, "p-pivot-arm-right");
    // Hands are raised forward-up (not hanging at the sides) and tilted by
    // the upward aim.
    expect(armLeft.rotation.x).toBeLessThan(-1.0);
    expect(armRight.rotation.x).toBeLessThan(-0.8);
    // The visor tilts up with the aim pitch.
    expect(rig.pres.visorMesh.rotation.x).toBeGreaterThan(0.05);
  });

  it("remote stance: no aim raise without replicated aim data", () => {
    const rig = makeRig(rigs, "remote", "q");

    for (let i = 0; i < 90; i++) rig.frame();

    expect(rig.pres.pose.armRaise).toBeLessThan(0.05);
    const arm = pivot(rig.scene, "q-pivot-arm-left");
    // Relaxed: arms hang at the sides.
    expect(Math.abs(arm.rotation.x)).toBeLessThan(0.05);
  });

  it("setEnabled(false) pauses the pose until re-enabled", () => {
    const rig = makeRig(rigs, "remote", "p");
    const arm = pivot(rig.scene, "p-pivot-arm-left");

    // Get the gait moving ...
    for (let i = 0; i < 30; i++) {
      rig.pres.setTransform({ x: (4 * i * FRAME_MS) / 1000, y: 0, z: 0 }, 0);
      rig.frame();
    }
    expect(rig.pres.pose.state).toBe("run");

    // ... hide the body: the pose freezes (no render-frame work) ...
    rig.pres.setEnabled(false);
    const frozen = arm.rotation.x;
    const frozenSpine = rig.pres.spinePivot.position.y;
    for (let i = 0; i < 30; i++) rig.frame();
    expect(arm.rotation.x).toBe(frozen);
    expect(rig.pres.spinePivot.position.y).toBe(frozenSpine);

    // ... and resumes when shown again (streaming a moving position, since
    // the stale-gap guard resets kinematics across the hidden interval).
    rig.pres.setEnabled(true);
    for (let i = 0; i < 30; i++) {
      rig.pres.setTransform(
        { x: 8.0 + (4 * i * FRAME_MS) / 1000, y: 0, z: 0 },
        0,
      );
      rig.frame();
    }
    expect(rig.pres.pose.state).toBe("run");
  });

  it("dispose releases every owned mesh, material, and pivot and is idempotent", async () => {
    const localRig = makeRig(rigs, "local", "local-player");
    const remoteRig = makeRig(rigs, "remote", "remote-player");
    const scene = localRig.scene;
    expect(ownedMeshes(scene, "local-player").length).toBeGreaterThan(0);
    expect(ownedMeshes(remoteRig.scene, "remote-player").length).toBeGreaterThan(0);

    localRig.pres.dispose();
    expect(localRig.pres.isDisposed).toBe(true);
    expect(() => localRig.pres.dispose()).not.toThrow();
    // Babylon defers observer/mesh bookkeeping to the next tick in places;
    // the owned node lists update synchronously with dispose().
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ownedMeshes(scene, "local-player")).toHaveLength(0);
    expect(ownedMaterials(scene, "local-player")).toHaveLength(0);
    // Owned pivots are gone too (root/visual-root included).
    expect(
      scene.transformNodes.filter((t) =>
        t.name.startsWith("local-player"),
      ),
    ).toHaveLength(0);
    // The other player's presentation is untouched.
    expect(ownedMeshes(remoteRig.scene, "remote-player").length).toBeGreaterThan(0);
  });

  it("every method is a safe no-op after dispose", () => {
    const rig = makeRig(rigs, "local", "local-player");
    rig.pres.dispose();

    expect(() => rig.pres.setTransform({ x: 1, y: 2, z: 3 }, 1)).not.toThrow();
    expect(() => rig.pres.setEnabled(false)).not.toThrow();
    expect(rig.pres.applyState(true, 2)).toBe(2);
    // The render loop may still fire the (removed) observer list safely.
    expect(() => rig.scene.onBeforeRenderObservable.notifyObservers(rig.scene)).not.toThrow();
    expect(ownedMeshes(rig.scene, "local-player")).toHaveLength(0);
    expect(ownedMaterials(rig.scene, "local-player")).toHaveLength(0);
  });
});
