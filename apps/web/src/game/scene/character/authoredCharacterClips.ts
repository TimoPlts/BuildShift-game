/** Original BuildShift keyframed motion for the Quaternius humanoid.
 *
 * Authoring only: produces instance-owned AnimationGroups for the EXISTING
 * animation driver. No observer, playback/state machine, root motion or assets.
 * Bone directions are authored in the character frame, then baked against the
 * loaded rig's actual bind transforms (not guessed bone-local Euler axes).
 */
import { Animation } from "@babylonjs/core/Animations/animation";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

const CLIPS = ["idle", "run", "jump", "fall", "crouch"] as const;
const SEGMENTS = [
  ["spine_01", "spine_02"],
  ["upperarm_l", "lowerarm_l"], ["lowerarm_l", "hand_l"],
  ["upperarm_r", "lowerarm_r"], ["lowerarm_r", "hand_r"],
  ["hand_l", "middle_01_l"], ["hand_r", "middle_01_r"],
  ["thigh_l", "calf_l"], ["calf_l", "foot_l"], ["foot_l", "ball_l"],
  ["thigh_r", "calf_r"], ["calf_r", "foot_r"], ["foot_r", "ball_r"],
] as const;

export function createAuthoredCharacterClips(root: TransformNode, prefix: string): AnimationGroup[] {
  const nodes = new Map(root.getChildTransformNodes(false).map(n => [n.name.slice(prefix.length + 1), n]));
  const pelvis = nodes.get("pelvis");
  if (!pelvis || SEGMENTS.some(([a, b]) => !nodes.has(a) || !nodes.has(b))) return [];
  const tracked = SEGMENTS.map(([name]) => nodes.get(name)!);
  const rest = new Map(tracked.map(n => [n, (n.rotationQuaternion ?? Quaternion.FromEulerVector(n.rotation)).clone()]));
  const pelvisRest = pelvis.position.clone();
  const world = (n: TransformNode) => { n.computeWorldMatrix(true); return n.getWorldMatrix(); };
  const rootWorld = world(root).clone();
  const rootInverse = rootWorld.clone().invert();
  const inRoot = (n: TransformNode) => Vector3.TransformCoordinates(world(n).getTranslation(), rootInverse);
  // The asset, rather than a naming convention, defines its forward axis.
  const forward = inRoot(nodes.get("ball_l")!).subtract(inRoot(nodes.get("foot_l")!));
  forward.y = 0; forward.normalize();
  const right = inRoot(nodes.get("thigh_r")!).subtract(inRoot(nodes.get("thigh_l")!));
  right.y = 0; right.normalize();
  const up = Vector3.Up();
  const dir = (x: number, y: number, z: number) => right.scale(x).add(up.scale(y)).add(forward.scale(z)).normalize();
  const soles = ["foot_l", "ball_l", "ball_leaf_l", "foot_r", "ball_r", "ball_leaf_r"].map(n => nodes.get(n)).filter((n): n is TransformNode => !!n);
  const restSole = Math.min(...soles.map(n => inRoot(n).y));
  const restore = () => {
    for (const [node, q] of rest) node.rotationQuaternion = q.clone();
    pelvis.position.copyFrom(pelvisRest);
  };
  const aimSegment = (name: string, childName: string, direction: Vector3) => {
    const node = nodes.get(name)!, child = nodes.get(childName)!;
    // Convert the desired character-frame direction into the node's REST
    // frame after the already-posed parents. Postmultiply its bind quaternion.
    const inverse = world(node).clone().invert();
    const desired = Vector3.TransformNormal(Vector3.TransformNormal(direction, rootWorld), inverse).normalize();
    const delta = Quaternion.FromUnitVectorsToRef(child.position.clone().normalize(), desired, Quaternion.Identity());
    node.rotationQuaternion = rest.get(node)!.multiply(delta).normalize();
  };
  const groups: AnimationGroup[] = [];
  try {
    for (const state of CLIPS) {
      const seconds = state === "run" ? 0.72 : state === "idle" ? 2.4 : 1.2;
      const frames = seconds * 30;
      const rotations = new Map(tracked.map(n => [n, [] as { frame: number; value: Quaternion }[]]));
      const positions: { frame: number; value: Vector3 }[] = [];
      // Nine authored poses, closed endpoints, quaternion interpolation.
      for (let key = 0; key <= 8; key++) {
        restore();
        const phase = key / 8 * Math.PI * 2;
        const stride = state === "run" ? Math.sin(phase) : 0;
        const breath = Math.sin(phase) * (state === "idle" ? 0.015 : 0.008);
        const crouched = state === "crouch";
        aimSegment("spine_01", "spine_02", dir(0, 1, (crouched ? 0.22 : state === "run" ? 0.12 : 0.025) + breath));
        for (const [side, sign] of [["l", 1], ["r", -1]] as const) {
          let hip = stride * sign * 0.64;
          let knee = 0.07 + Math.max(0, -stride * sign) * 1.05;
          if (crouched) { hip = 0.92; knee = 1.84; }
          if (state === "jump") { hip = side === "l" ? 0.7 : 0.38; knee = 1.15; }
          if (state === "fall") { hip = side === "l" ? 0.16 : -0.14; knee = 0.4; }
          aimSegment(`upperarm_${side}`, `lowerarm_${side}`, dir(-sign * 0.14, -0.76, 0.64 + stride * sign * 0.035));
          aimSegment(`lowerarm_${side}`, `hand_${side}`, dir(sign * 0.1, 0.1 + breath, 1));
          aimSegment(`hand_${side}`, `middle_01_${side}`, dir(sign * 0.08, 0.03, 1));
          aimSegment(`thigh_${side}`, `calf_${side}`, dir(0, -Math.cos(hip), Math.sin(hip)));
          aimSegment(`calf_${side}`, `foot_${side}`, dir(0, -Math.cos(hip - knee), Math.sin(hip - knee)));
          aimSegment(`foot_${side}`, `ball_${side}`, dir(0, -0.3, 0.954));
        }
        // Grounded poses lower the pelvis to keep the supporting foot planted;
        // never translate the gameplay mirror, lift node, or collider.
        if (state !== "jump" && state !== "fall") {
          const lift = restSole - Math.min(...soles.map(n => inRoot(n).y));
          const delta = Vector3.TransformNormal(up.scale(lift), rootWorld);
          const local = Vector3.TransformNormal(delta, world(pelvis.parent as TransformNode).clone().invert());
          pelvis.position.addInPlace(local);
        }
        const frame = key / 8 * frames;
        for (const [node, keys] of rotations) keys.push({ frame, value: node.rotationQuaternion!.clone() });
        positions.push({ frame, value: pelvis.position.clone() });
      }
      const group = new AnimationGroup(`${prefix}-${state}`, root.getScene());
      // Prefix-independent slot mapping via metadata is unnecessary: names
      // start with the canonical state; prefix is retained after it.
      group.name = `${state}-${prefix}`;
      groups.push(group);
      for (const [node, keys] of rotations) {
        const animation = new Animation(`${state}-${node.name}`, "rotationQuaternion", 30, Animation.ANIMATIONTYPE_QUATERNION, Animation.ANIMATIONLOOPMODE_CYCLE);
        animation.setKeys(keys);
        group.addTargetedAnimation(animation, node);
      }
      const translation = new Animation(`${state}-pelvis`, "position", 30, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
      translation.setKeys(positions);
      group.addTargetedAnimation(translation, pelvis);
    }
    return groups;
  } catch (error) {
    for (const group of groups) group.dispose();
    throw error;
  } finally {
    restore();
  }
}
