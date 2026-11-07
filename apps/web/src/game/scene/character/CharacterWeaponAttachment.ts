/**
 * CharacterWeaponAttachment — presentation-only seam that attaches a
 * {@link WeaponModelPresentation} to one rigged-GLB character instance.
 *
 * Skeleton discovery is asset-agnostic: the current Quaternius character has
 * a standard `hand_r` joint, while supported future assets may expose other
 * right-hand/wrist naming conventions.
 *  - Babylon's glTF loader materializes every joint as a named
 *    `TransformNode` in the instantiated clone (named
 *    `${namePrefix}-<joint name>`), and the cloned animation groups animate
 *    those very nodes, so parenting a weapon under the wrist node makes the
 *    weapon follow the animated hand automatically.
 *  - A recognised right-hand joint is the attachment socket.
 *
 * Resilient fallback (when no right-hand joint is recognisable — e.g. a
 * future asset with different joint names): the attachment creates ONE
 * owned geometry-free `TransformNode` socket, parented to the character's
 * normalisation node (`<prefix>-model-scale`, falling back to
 * `<prefix>-visual-root`, `<prefix>-root`, or the scene) at a configurable
 * asset-space position (a conservative presentation-only hand location).
 * The discovered-joint path never creates or owns nodes.
 *
 * Ownership / lifecycle:
 *  - `attach(weapon)` reparents the weapon's existing `root` under the
 *    socket (via the narrow `WeaponModelPresentation.attachTo` seam) with a
 *    configurable local offset/rotation. It NEVER clones: switching
 *    weapons detaches the previous weapon (`root.parent = null`) and
 *    attaches the new one, so no duplicate meshes or nodes can accumulate.
 *  - The attachment does not own the weapon: `dispose()` only detaches the
 *    weapon and releases the owned fallback socket (if one was created).
 *    The weapon stays fully functional (visibility, dip, muzzle anchor,
 *    disposal) and all weapon gameplay/authority is untouched.
 *  - `dispose()` is idempotent; afterwards every method is a safe no-op.
 *
 * Live wiring (Batch 2C, Task B): `GameRuntime` creates one attachment per
 * settled local character instance (`local-player`) and attaches the
 * `WeaponModelPresentation` root under the discovered hand joint through
 * `attach`. Until the rigged body settles (or on a genuine asset failure)
 * the runtime keeps the weapon on the player's presentation root — the
 * procedural-body fallback mount.
 *
 * Presentation only: no picking, no collision, no gameplay state.
 */
import type { Nullable, Scene } from "@babylonjs/core";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { WeaponModelPresentation } from "../WeaponModelPresentation";

/**
 * Minimal 3-component vector shape (assignable from Babylon `Vector3`),
 * so callers can pass either real vectors or plain literals.
 */
export interface Vector3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Socket candidates (right hand / wrist), checked in priority order against
 * the instantiated clone's node names (`<namePrefix>-<candidate>`).
 * `hand_r` is the Quaternius Superhero Male's right hand.
 */
const HAND_JOINT_CANDIDATES = [
  "arm_joint_R_3",
  "hand_R_1",
  "hand_R",
  "wrist_R",
] as const;

/**
 * Heuristic for generic right-hand joints on unknown assets: the joint
 * name (after the prefix) must describe an arm/hand/wrist element and
 * carry a right-side marker (`_R`, `_right`, …). Among matches, the
 * deepest (longest-named) node wins — the wrist is the terminal joint.
 */
const RIGHT_HAND_JOINT_PATTERN = /(^|_)(arm|hand|wrist).*_(r|right)(\d)*(_|$)/i;

/** Default hold: weapon root sits just in front of the hand (asset-space metres). */
export const DEFAULT_WEAPON_HOLD_OFFSET: Vector3Like = { x: 0, y: 0.01, z: -0.08 };

/**
 * Default fallback socket position in asset space (used only when no hand
 * joint is discovered).
 */
export const DEFAULT_FALLBACK_SOCKET_POSITION: Vector3Like = {
  x: 0.447,
  y: 0.882,
  z: 0.065,
};

/** Options for {@link CharacterWeaponAttachment.create}. */
export interface WeaponAttachmentOptions {
  /**
   * Local offset of the weapon root from the socket (asset-space metres
   * when the socket is a character joint). Defaults to
   * {@link DEFAULT_WEAPON_HOLD_OFFSET}.
   */
  readonly localOffset?: Vector3Like;
  /** Local rotation (radians, x/y/z) of the weapon root relative to the socket. Defaults to identity. */
  readonly localRotation?: Vector3Like;
  /**
   * Uniform scale of the weapon root relative to the socket. Defaults to
   * 1. This is the per-weapon sizing hook used by the Batch 2C transform
   * tuning; it never touches the weapon silhouettes' own geometry.
   */
  readonly localScale?: number;
  /**
   * Socket position in asset space used by the fallback strategy when no
   * hand/weapon joint exists on the character. Defaults to
   * {@link DEFAULT_FALLBACK_SOCKET_POSITION}.
   */
  readonly fallbackSocketPosition?: Vector3Like;
}

/** Which strategy produced the attachment socket. */
export type WeaponAttachmentSocketSource = "joint" | "fallback";

/**
 * Finds the character's right-wrist joint `TransformNode` by name.
 * Returns null when the character exposes no recognisable hand joint.
 */
export function findCharacterHandSocket(
  scene: Scene,
  namePrefix: string,
): Nullable<TransformNode> {
  for (const candidate of HAND_JOINT_CANDIDATES) {
    const node = scene.getTransformNodeByName(`${namePrefix}-${candidate}`);
    if (node) return node;
  }
  // Generic scan over the character's own nodes (prefix-scoped), preferring
  // the deepest candidate so the terminal wrist wins over shoulder/elbow.
  let best: Nullable<TransformNode> = null;
  const prefixLength = namePrefix.length + 1; // trailing "-"
  for (const node of scene.transformNodes) {
    if (!node.name.startsWith(namePrefix)) continue;
    const suffix = node.name.slice(prefixLength);
    if (!suffix || !RIGHT_HAND_JOINT_PATTERN.test(suffix)) continue;
    if (!best || suffix.length > best.name.slice(prefixLength).length) {
      best = node;
    }
  }
  return best;
}

/**
 * Resolves the node the fallback socket is parented to, in priority order:
 * the normalisation scale node (asset-space coordinates), the presentation
 * lift, the gameplay root, or the scene itself.
 */
function resolveFallbackParent(
  scene: Scene,
  namePrefix: string,
): Nullable<TransformNode> {
  return (
    scene.getTransformNodeByName(`${namePrefix}-model-scale`) ??
    scene.getTransformNodeByName(`${namePrefix}-visual-root`) ??
    scene.getTransformNodeByName(`${namePrefix}-root`) ??
    null
  );
}

export class CharacterWeaponAttachment {
  /**
   * The socket the weapon is (or would be) attached under: either the
   * character's right-wrist joint node (never owned) or a geometry-free
   * fallback node owned by this attachment.
   */
  readonly socket: TransformNode;
  /** Which strategy produced {@link socket}. */
  readonly socketSource: WeaponAttachmentSocketSource;

  private readonly _ownedFallbackSocket: Nullable<TransformNode>;
  private readonly _defaultOffset: Vector3Like;
  private readonly _defaultRotation: Vector3Like;
  private readonly _defaultScale: number;
  private _current: Nullable<WeaponModelPresentation> = null;
  private _disposed = false;

  private constructor(
    scene: Scene,
    namePrefix: string,
    options: WeaponAttachmentOptions,
  ) {
    this._defaultOffset = options.localOffset ?? DEFAULT_WEAPON_HOLD_OFFSET;
    this._defaultRotation = options.localRotation ?? { x: 0, y: 0, z: 0 };
    this._defaultScale = options.localScale ?? 1;

    const joint = findCharacterHandSocket(scene, namePrefix);
    if (joint) {
      this.socket = joint;
      this.socketSource = "joint";
      this._ownedFallbackSocket = null;
      return;
    }
    // Clean, resilient fallback: one owned, geometry-free socket node.
    const socket = new TransformNode(`${namePrefix}-weapon-socket`, scene);
    const parent = resolveFallbackParent(scene, namePrefix);
    if (parent) socket.parent = parent;
    const pos = options.fallbackSocketPosition ?? DEFAULT_FALLBACK_SOCKET_POSITION;
    socket.position.set(pos.x, pos.y, pos.z);
    this.socket = socket;
    this.socketSource = "fallback";
    this._ownedFallbackSocket = socket;
  }

  /**
   * Creates the attachment for the character instance identified by
   * `namePrefix` (the same prefix passed to `CharacterModel.create`).
   */
  public static create(
    scene: Scene,
    namePrefix: string,
    options: WeaponAttachmentOptions = {},
  ): CharacterWeaponAttachment {
    return new CharacterWeaponAttachment(scene, namePrefix, options);
  }

  /** True once {@link dispose} has run. */
  public get isDisposed(): boolean {
    return this._disposed;
  }

  /** The weapon currently attached (null when detached / disposed). */
  public get attachedWeapon(): Nullable<WeaponModelPresentation> {
    return this._disposed ? null : this._current;
  }

  /**
   * Attaches `weapon` under the socket with the configured (or per-call
   * overridden) local offset/rotation, detaching the previously attached
   * weapon. Pure reparenting — no clone, no new meshes. Calling with the
   * already-attached weapon simply re-applies the transform (idempotent).
   * Safe no-op when this attachment or the weapon is disposed.
   */
  public attach(
    weapon: WeaponModelPresentation,
    options: WeaponAttachmentOptions = {},
  ): void {
    if (this._disposed || weapon.isDisposed) return;
    if (this._current !== weapon) {
      if (this._current) {
        this._detachWeapon(this._current);
      }
      this._current = weapon;
    }
    const offset = options.localOffset ?? this._defaultOffset;
    const rotation = options.localRotation ?? this._defaultRotation;
    const scale = options.localScale ?? this._defaultScale;
    weapon.attachTo(this.socket, offset, rotation, scale);
  }

  /** Detaches the currently attached weapon (its root is reparented to null). */
  public detach(): void {
    if (this._disposed) return;
    if (!this._current) return;
    this._detachWeapon(this._current);
    this._current = null;
  }

  /**
   * Idempotent teardown: detaches the current weapon (which stays fully
   * functional) and disposes the owned fallback socket when one was
   * created. Never disposes the weapon or any discovered joint.
   */
  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    if (this._current) {
      this._detachWeapon(this._current);
      this._current = null;
    }
    if (this._ownedFallbackSocket) {
      this._ownedFallbackSocket.dispose();
    }
  }

  // --- internals -----------------------------------------------------------

  private _detachWeapon(weapon: WeaponModelPresentation): void {
    // Detach back to the scene root at identity so the weapon is ready for
    // any later re-parent (including the presentation-root fallback mount).
    weapon.attachTo(null, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 1);
  }
}
