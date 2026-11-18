/**
 * weaponAttachmentTransforms — per-weapon hand-seating transforms for the
 * held weapon, expressed relative to the character's right-hand socket
 * (`<prefix>-hand_r` joint exposed by `CharacterModel`).
 *
 * This is a small, immutable tuning table consumed by the character weapon
 * attachment (`CharacterWeaponAttachment` / `WeaponModelPresentation.attachTo`).
 * It carries no meshes, no scene state, and no gameplay logic.
 *
 * Frame & units
 * -------------
 * Every value is in the HAND JOINT'S LOCAL SPACE, in asset-space metres
 * (the pre-character-scale space; the overall character scale is applied
 * by the character root and affects the weapon automatically because it is
 * parented under the hand joint).
 *
 * On the instantiated base character (Quaternius rigged GLB) WITH the
 * default asset orientation normalization applied (the shipped rig carries a
 * measured 180° correction so its anatomical front sits on local −Z — see
 * `characterAsset.ts`), the `hand_r` rest-pose local frame measures as:
 *   - local +X → world UP
 *   - local +Y → world RIGHT (character's outward side; −Y is toward the
 *     body centreline)
 *   - local +Z → world BACK (character forward is local −Z)
 *
 * In the ANIMATED ready pose (authored idle / crouch clips, batch-2A) the
 * hand is pulled in front of the chest with the fingers pointing forward,
 * so the same hand-joint local frame is rotated far from the rest pose.
 * The table values are tuned against that animated ready frame. In the
 * unanimated rest pose the muzzle points laterally; the ready pose is the
 * production hold.
 *
 * Weapon mesh convention (see `WeaponModelPresentation`): barrel along the
 * weapon's local −Z, weapon "up" along +Y, stock along +Z, and the rear
 * (trigger) grip centred near local (0, −0.04…−0.05, −0.075).
 *
 * Value semantics
 * ---------------
 * - `position` — weapon root offset from the hand joint. Chosen so the rear
 *   grip box sits under the character's palm in the ready pose.
 * - `rotation` — weapon root Euler rotation (Babylon `TransformNode.rotation`
 *   order, radians) relative to the hand joint. These are compound angles
 *   (not a small pitch/yaw on top of a fixed mount roll), because the ready
 *   hand frame itself is already rotated far from the rest-pose frame.
 * - `scale` — uniform multiplier on the weapon mesh. `1.0` preserves the
 *   authored, gameplay-consistent weapon dimensions.
 *
 * Tuning note: values were derived numerically on 2026-11-18 against the
 * real 65-joint `BuildShiftBaseCharacter.glb` IN THE CORRECTED PRODUCTION
 * DEFAULT SETUP (asset orientation normalization applied, anatomical front
 * on local −Z) in a NullEngine scene playing the authored idle / crouch
 * clips: the weapon root parented under `hand_r` exactly as
 * `CharacterWeaponAttachment` does, measuring the muzzle world axis (weapon
 * −Z), weapon up (weapon +Y), and rear-grip world position, then solving the
 * hand-local transform directly so the corrected seating reproduces the
 * previously shipped weapon world exactly: identical muzzle axis and weapon
 * up, and the rear grip box holding the same mirrored palm offset (≈17 mm)
 * from the mirrored hand joint (the hand-local position needed re-solving —
 * a mirrored root offset alone would swing the grip box off the palm
 * because the weapon world rotation is deliberately preserved).
 * Result with the table below —
 *   idle:   AR muzzle ≈ [0, −0.12, −0.99] (~7° down), grip 17 mm from the
 *           hand joint; SG muzzle ≈ [0, −0.155, −0.988] (~9° down).
 *   crouch: AR muzzle ≈ [−0.025, −0.104, −0.994]; SG ≈ [−0.031, −0.139, −0.990].
 *   rest:   the weapon stays hugged to the joint; the muzzle points off to
 *           the side (accepted tradeoff — the ready pose is the production
 *           hold, exactly as in the previous tuning).
 * Max muzzle-axis swing across a full idle breathing loop is ≈0.15°, so the
 * static table does not need to track the per-frame motion. They are
 * deliberately plain numbers so artists/developers can nudge them.
 */
import type { WeaponType } from "@buildshift/protocol";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

/** Plain frozen 3-component vector (hand-joint-local, metres / radians). */
export interface WeaponAttachmentVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Hand-seating transform for one weapon type, in the right-hand socket's
 * local space (see the module docs for frame and unit conventions).
 */
export interface WeaponAttachmentTransform {
  readonly weaponType: WeaponType;
  /** Weapon root offset from the hand joint (metres, hand-local). */
  readonly position: WeaponAttachmentVector3;
  /** Weapon root Euler rotation (radians, Babylon XYZ order, hand-local). */
  readonly rotation: WeaponAttachmentVector3;
  /** Uniform weapon mesh scale multiplier (1.0 = authored size). */
  readonly scale: number;
}

/**
 * Assault rifle: seated in the animated ready pose with the barrel aimed
 * forward and ~7° down (idle muzzle world axis ≈ [0, −0.12, −0.99]), the
 * rear grip ~17 mm from the hand joint under the palm, and the stock ~24 cm
 * behind the hand at shoulder height.
 */
const ASSAULT_RIFLE: WeaponAttachmentTransform = Object.freeze({
  weaponType: "assault_rifle",
  position: Object.freeze({ x: 0.04363, y: -0.07076, z: 0.01649 }),
  rotation: Object.freeze({ x: 1.49499, y: 1.03823, z: 0.21983 }),
  scale: 1.0,
});

/**
 * Shotgun: held slightly steeper than the rifle (idle muzzle world axis
 * ≈ [0, −0.155, −0.988], ~9° down); rear grip ~17 mm from the hand joint,
 * stock ~21 cm behind the hand, matching the chunkier silhouette.
 */
const SHOTGUN: WeaponAttachmentTransform = Object.freeze({
  weaponType: "shotgun",
  position: Object.freeze({ x: 0.04824, y: -0.06829, z: 0.02609 }),
  rotation: Object.freeze({ x: 1.46152, y: 0.91197, z: 0.17059 }),
  scale: 1.0,
});

/**
 * Immutable per-weapon hand-seating table keyed by weapon type. The record
 * and every nested value are frozen; treat it as read-only configuration.
 */
export const WEAPON_ATTACHMENT_TRANSFORMS: Readonly<
  Record<WeaponType, WeaponAttachmentTransform>
> = Object.freeze({
  assault_rifle: ASSAULT_RIFLE,
  shotgun: SHOTGUN,
});

/**
 * Looks up the hand-seating transform for `weaponType`. Throws for unknown
 * types so misconfiguration fails loudly instead of silently centering the
 * weapon on the joint.
 */
export function getWeaponAttachmentTransform(
  weaponType: WeaponType,
): WeaponAttachmentTransform {
  const transform = WEAPON_ATTACHMENT_TRANSFORMS[weaponType];
  if (!transform) {
    throw new Error(
      `weaponAttachmentTransforms: no transform for weapon "${String(weaponType)}"`,
    );
  }
  return transform;
}

/**
 * Applies a hand-seating transform to a weapon root node that is (or will
 * be) parented under the hand socket: writes `position`, `rotation`, and
 * uniform `scale` in one place. Pure transform write — no allocation, no
 * reparenting, no visibility changes.
 */
export function applyWeaponAttachmentTransform(
  root: TransformNode,
  transform: WeaponAttachmentTransform,
): void {
  root.position.set(
    transform.position.x,
    transform.position.y,
    transform.position.z,
  );
  root.rotation.set(
    transform.rotation.x,
    transform.rotation.y,
    transform.rotation.z,
  );
  root.scaling.set(transform.scale, transform.scale, transform.scale);
}
