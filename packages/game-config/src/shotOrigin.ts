/**
 * The canonical SHOT-EYE origin height — the height above a player's feet
 * that the authoritative shot ray starts from, and that the remote-player
 * hit-sphere centres are measured from. Shared by the server (`rf`), the
 * client aim/camera parity layer (`authoritativeAim`), and any consumer that
 * must agree with the server about where a shot begins.
 *
 * This is a DEDICATED combat constant, deliberately distinct from the
 * collider-derived values:
 *
 *  - `VERTICAL_MOVEMENT.playerHalfHeight` (0.9) and
 *    `PLAYER_COLLIDER_HALF_TOTAL_HEIGHT` (0.9) remain the CAPSULE CENTRE /
 *    ground-check tolerance for physics and movement. They are NOT shot
 *    origins anymore.
 *  - `PLAYER_CROUCH_COLLIDER_HALF_TOTAL_HEIGHT` (0.6) likewise remains the
 *    crouched collider half-height, used for collision and prediction.
 *
 * Why these values (see the framing-20261119 diagnosis):
 *
 *  - The camera pivot, the client centre-ray reticle, and the server shot
 *    origin must be the SAME point (the centred-aim invariant). With the
 *    old 0.9 m origin the reticle met a wall at 23 % of its height — the
 *    middle of the bottom edit row — reading as a waist-height crosshair.
 *    1.2 m places the level reticle at the bottom/middle edit-row boundary
 *    (1.2 / 3.84 layer height) and at 67 % of the 1.8 m body — sternum
 *    height, the Fortnite-order aim line.
 *  - Standing and crouched origins (and target-sphere CENTRES) move
 *    together. Because shooter origin and same-state target centre share the
 *    constant, pitch-0 same-state parity is exact at any eye height. What
 *    must stay bounded is the standing-vs-crouch GAP d = 1.2 − 0.9 = 0.3:
 *    a pitch-0 cross-state shot passes d below/above the target centre, and
 *    the crouch target sphere radius is 0.35 — d ≤ 0.35 keeps the current
 *    crossfire hit validity with the same margin as before (0.3 → 0.3).
 *    Raising standing to 1.55 (true eye) without retuning radii would make
 *    pitch-0 crossfire miss both states (a new crouch-dodge meta) — that is
 *    a hitbox-balance change, deliberately out of scope here.
 */
export const SHOT_EYE_HEIGHT_STANDING = 1.2;
export const SHOT_EYE_HEIGHT_CROUCHED = 0.9;

/** Canonical shot-eye height for a crouch state, above the feet position. */
export function shotEyeHeight(crouched: boolean): number {
  return crouched ? SHOT_EYE_HEIGHT_CROUCHED : SHOT_EYE_HEIGHT_STANDING;
}
