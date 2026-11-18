/**
 * Authoritative-shot-ray aim resolution **for presentation only**.
 *
 * The server (`TwoPlayerMovementRoom.rf`) resolves every shot as a hitscan from the
 * shooter's eye origin — the server *feet* position raised by the collider half
 * total height (crouch-aware) — along `ad(yaw, pitch)`, against remote players
 * (capsule-centre targets with the standing/crouch target radii) and replicated
 * structures, taking the nearest intersection within the weapon range. The
 * client camera SHARES that ray: the line-sharing third-person camera sits
 * behind the eye origin and looks along the same `ad(yaw, pitch)` direction,
 * so the CSS-centred crosshair IS the shot ray at every range, and the
 * endpoints resolved here are exactly what the centre sight marks.
 *
 * This module answers "where does the authoritative shot actually go?" by reusing
 * the **exact shared simulation/config functions the server uses**
 * ({@link hitscan}, {@link rayStructureIntersection}, {@link structureCuboids}) on
 * the client-side predicted/replicated state. It is a *display resolver*: it
 * computes no damage, never gates fire, and changes no authority — the server
 * remains the sole judge of hits. `GameRuntime` feeds the result to the local
 * converging tracer so the streak ends at the true hit point.
 */
import {
  hitscan,
  type HitscanTarget,
} from "@buildshift/simulation";
import {
  rayStructureIntersection,
  structureCuboids,
  VERTICAL_MOVEMENT,
  PLAYER_CROUCH_COLLIDER_HALF_TOTAL_HEIGHT,
  PLAYER_CROUCH_COLLIDER,
  type GeometryEditState,
} from "@buildshift/game-config";

/** A minimal `Vec3`-shaped plain point (avoids leaking Babylon types here). */
export interface AimVec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Standing eye/capsule-centre height above the server *feet* position — the
 * server `rf` fires from `y + VERTICAL_MOVEMENT.playerHalfHeight` (0.9 m), so
 * this mirrors that exact constant (pinned equal to
 * `PLAYER_COLLIDER_HALF_TOTAL_HEIGHT` by `authoritativeAim.test.ts`).
 */
export const AIM_EYE_HEIGHT_STANDING = VERTICAL_MOVEMENT.playerHalfHeight;
/** Crouched eye height above the feet — same constant the server `rf` uses. */
export const AIM_EYE_HEIGHT_CROUCHED = PLAYER_CROUCH_COLLIDER_HALF_TOTAL_HEIGHT;

/** Standing remote-player target radius used by the server hitscan (`TR`). */
export const AIM_TARGET_RADIUS_STANDING = 0.4;
/** Crouched remote-player target radius used by the server `rf` crouch pass. */
export const AIM_TARGET_RADIUS_CROUCHED = PLAYER_CROUCH_COLLIDER.radius;

/** A remote player snapshot for aim resolution (server feet convention). */
export interface AimPlayer {
  /** Identifier for the resolved hit (informational only). */
  id: string;
  /** Feet position (metres, server convention: y = feet). */
  feet: AimVec3;
  /** Whether the player is crouched (selects centre + radius, as on the server). */
  crouch: boolean;
}

/** A replicated structure in the shape `structureCuboids` consumes. */
export interface AimStructure {
  buildType: "wall" | "floor" | "cone" | "ramp";
  grid: { x: number; y: number; z: number };
  rotation: number;
  editGrid?: GeometryEditState;
}

/** What the resolved aim point represents. */
export type AimPointKind = "player" | "structure" | "range-end";

/** The point the authoritative shot ray terminates at. */
export interface ResolvedAimPoint {
  /** World-space endpoint of the shot ray (hit point or range endpoint). */
  point: AimVec3;
  /** Distance along the shot ray from the eye origin, in metres. */
  distance: number;
  /** Which candidate won (or the bare range endpoint on a clean shot). */
  kind: AimPointKind;
  /** Target identifier when `kind` is `"player"` or `"structure"`. */
  targetId?: string;
}

/** Inputs for one {@link resolveAuthoritativeAimPoint} call (per frame). */
export interface AimResolutionInput {
  /** Local player's feet position in the server convention (y = feet). */
  feet: AimVec3;
  /** Local crouch state (the boolean the input sample carries, not the blend). */
  crouched: boolean;
  /** Unit aim direction — `ad(yaw, pitch)` (the sent/authoritative direction). */
  aimDirection: AimVec3;
  /** Effective hitscan range of the equipped weapon, metres (`weapon.range`). */
  weaponRange: number;
  /** Remote players (interpolated, feet convention). The local player is never a target. */
  remotePlayers: ReadonlyArray<AimPlayer>;
  /** Replicated structures to occlude/resolve against. */
  structures: ReadonlyArray<AimStructure>;
}

/**
 * The server's aim eye origin for a feet position and crouch state:
 * `feet + up * (crouch ? crouchHalfTotal : halfTotal)` — a literal mirror of the
 * `o = { x, y: y + shH, z }` line in `rf`.
 */
export function authoritativeAimOrigin(
  feet: AimVec3,
  crouched: boolean,
  out: AimVec3 = { x: 0, y: 0, z: 0 },
): AimVec3 {
  out.x = feet.x;
  out.y = feet.y + (crouched ? AIM_EYE_HEIGHT_CROUCHED : AIM_EYE_HEIGHT_STANDING);
  out.z = feet.z;
  return out;
}

/**
 * Resolve the endpoint of the authoritative shot ray — nearest of
 * standing-player hit, crouched-player hit, structure intersection, else the
 * weapon-range endpoint — reproducing the candidate-selection order and shared
 * math of the server `rf` handler. Presentation use only (reticle + tracer).
 */
export function resolveAuthoritativeAimPoint(
  input: AimResolutionInput,
): ResolvedAimPoint {
  const origin = authoritativeAimOrigin(input.feet, input.crouched);
  const direction = input.aimDirection;

  // Player candidates: exactly the server's two-pass targets (standing targets
  // are tested with the standing radius, crouched ones with the crouch radius),
  // nearest-hit-wins inside each pass via the shared `hitscan` resolver.
  const standTargets: HitscanTarget[] = [];
  const crouchTargets: HitscanTarget[] = [];
  for (const p of input.remotePlayers) {
    const centre: AimVec3 = {
      x: p.feet.x,
      // Same centre convention the server uses for hitscan targets.
      y: p.feet.y + (p.crouch ? AIM_EYE_HEIGHT_CROUCHED : AIM_EYE_HEIGHT_STANDING),
      z: p.feet.z,
    };
    (p.crouch ? crouchTargets : standTargets).push({ id: p.id, position: centre });
  }
  // `damage` is irrelevant to point resolution (distances only); pass 0 so this
  // presentation path can never be mistaken for a damage computation.
  const weapon = { damage: 0, range: input.weaponRange };
  const standHit = hitscan(
    origin,
    direction,
    { ...weapon, targetRadius: AIM_TARGET_RADIUS_STANDING },
    standTargets,
  )[0];
  const crouchHit = hitscan(
    origin,
    direction,
    { ...weapon, targetRadius: AIM_TARGET_RADIUS_CROUCHED },
    crouchTargets,
  )[0];

  // Structure candidates: nearest ray/structure intersection within range,
  // same per-structure shared geometry + intersection as the server `rf`.
  let structureHit: { distance: number; point: AimVec3; id: string } | undefined;
  for (const structure of input.structures) {
    const cuboids = structureCuboids(structure);
    if (cuboids.length === 0) continue;
    const hit = rayStructureIntersection(origin, direction, input.weaponRange, cuboids);
    if (hit && (!structureHit || hit.distance < structureHit.distance)) {
      structureHit = { distance: hit.distance, point: hit.point, id: structureKey(structure) };
    }
  }

  // Nearest candidate wins (server `rf`: candidates.reduce by distance).
  const candidates: Array<{ kind: AimPointKind; distance: number; point: AimVec3; id?: string }> = [];
  if (standHit) candidates.push({ kind: "player", distance: standHit.distance, point: standHit.hitPoint, id: standHit.targetId });
  if (crouchHit) candidates.push({ kind: "player", distance: crouchHit.distance, point: crouchHit.hitPoint, id: crouchHit.targetId });
  if (structureHit) candidates.push({ kind: "structure", distance: structureHit.distance, point: structureHit.point, id: structureHit.id });

  if (candidates.length > 0) {
    const best = candidates.reduce((a, b) => (a.distance <= b.distance ? a : b));
    return { point: best.point, distance: best.distance, kind: best.kind, targetId: best.id };
  }

  // Clean shot: the ray terminates at the weapon-range endpoint (same as the
  // server's max hitscan distance), so the reticle stays truthful far away.
  const range = Math.max(0, input.weaponRange);
  return {
    point: {
      x: origin.x + direction.x * range,
      y: origin.y + direction.y * range,
      z: origin.z + direction.z * range,
    },
    distance: range,
    kind: "range-end",
  };
}

function structureKey(s: AimStructure): string {
  return `${s.buildType}@${s.grid.x},${s.grid.y},${s.grid.z}`;
}
