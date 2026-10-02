/**
 * Hitscan combat simulation — shared, pure geometry used by both the
 * authoritative server and (later) client prediction.
 *
 * For the first combat milestone a target is modelled as a *sphere* at
 * `targetPosition` with radius `targetRadius` (a simplification of the full
 * capsule). The weapon's projectile is a *ray* and we test whether the ray
 * reaches the sphere within the weapon's `maxRange`.
 *
 * This module contains no platform-specific code and no shared-config
 * dependency — it is pure vector math so the server can run it deterministically
 * and the client can reuse the identical test for prediction.
 */

/** A 3D vector (metres, Y-up). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Result of a {@link rayIntersectsCapsule} test. */
export interface RayIntersectionResult {
  /** True when the ray reaches the sphere within `maxRange`. */
  hit: boolean;
  /**
   * Distance in metres from the ray origin to the point of intersection.
   * Meaningful only when {@link hit} is true; `0` for a miss.
   */
  distance: number;
}

/** Squared length of a 3D vector. */
function lengthSq(a: Readonly<Vec3>): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

/**
 * Test whether a ray hits a sphere (the milestone approximation of the
 * player capsule) within a maximum range.
 *
 * Uses the standard ray–sphere intersection derived from the quadratic
 * `a·t² + b·t + c = 0`:
 *
 *   - ray:      P(t) = origin + t·direction,   t ≥ 0
 *   - sphere:   centre `targetPosition`, radius `targetRadius`
 *   - L        = origin − centre
 *   - a        = direction · direction
 *   - b        = 2 · (L · direction)
 *   - c        = L · L − targetRadius²
 *   - t0 = (−b − √disc) / (2a),  t1 = (−b + √disc) / (2a),  disc = b² − 4ac
 *
 * The nearest non-negative root is chosen. When the ray origin lies *inside*
 * the sphere only the far (exit) root is non-negative, which is the correct
 * "hit" behaviour (a shot fired from inside a target still counts).
 *
 * The reported `distance` is the true Euclidean distance from the origin to
 * the intersection point (`t · |direction|`), so `direction` need not be
 * unit-length.
 *
 * Returns `hit: false` when:
 *  - the ray misses the sphere entirely (negative discriminant),
 *  - the sphere is entirely behind the ray (both roots negative), or
 *  - the intersection distance exceeds `maxRange` (range clamp).
 *
 * @param origin - Ray origin (the shooter's aim origin), metres.
 * @param direction - Ray direction; any magnitude (unit or not).
 * @param targetPosition - Centre of the target sphere, metres.
 * @param targetRadius - Target sphere radius, metres (> 0).
 * @param maxRange - Maximum effective range, metres.
 * @returns `{ hit, distance }` — `distance` is `0` on a miss.
 */
export function rayIntersectsCapsule(
  origin: Readonly<Vec3>,
  direction: Readonly<Vec3>,
  targetPosition: Readonly<Vec3>,
  targetRadius: number,
  maxRange: number,
): RayIntersectionResult {
  const miss: RayIntersectionResult = { hit: false, distance: 0 };

  // Guard against a degenerate (zero-length) direction.
  const a = lengthSq(direction);
  if (a < 1e-12) {
    return miss;
  }

  // L = origin − centre
  const lx = origin.x - targetPosition.x;
  const ly = origin.y - targetPosition.y;
  const lz = origin.z - targetPosition.z;

  const b = 2 * (lx * direction.x + ly * direction.y + lz * direction.z);
  const c = lx * lx + ly * ly + lz * lz - targetRadius * targetRadius;

  const discriminant = b * b - 4 * a * c;

  // No real intersection — the ray misses the sphere.
  if (discriminant < 0) {
    return miss;
  }

  const sqrtDisc = Math.sqrt(discriminant);
  const t0 = (-b - sqrtDisc) / (2 * a);
  const t1 = (-b + sqrtDisc) / (2 * a);

  // Choose the nearest intersection that lies in front of the origin.
  let t: number;
  if (t0 >= 0) {
    // Origin outside (or on) the sphere: the near surface is the hit.
    t = t0;
  } else if (t1 >= 0) {
    // Origin inside the sphere: only the far (exit) surface is in front.
    t = t1;
  } else {
    // Both roots are negative — the sphere is entirely behind the ray.
    return miss;
  }

  // True Euclidean distance from the origin to the intersection point.
  const distance = t * Math.sqrt(a);

  // Range clamp: a hit beyond the weapon's effective range does not count.
  if (distance > maxRange) {
    return miss;
  }

  return { hit: true, distance };
}

/**
 * Convenience: the distance from a point to another point (metres).
 *
 * Exported for the combat milestone so the server can, e.g., fall back to a
 * nearest-aimable check. Pure helper, no side effects.
 */
export function distance3d(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ─── Multi-target hitscan resolution (canonical contract) ───────────────────
//
// The single-target {@link rayIntersectsCapsule} above is the core geometry
// math. The {@link hitscan} function below is the authoritative, multi-target
// resolver the room invokes on an approved fire intent: it ray-casts against
// every live target, picks the *nearest* hit (the first target the hitscan
// ray reaches), and reports the hit result. The room owns the *state mutation*
// (applying damage, elimination); the simulation owns only the *math* of which
// target is hit and where.

/** Default target collision-sphere radius (metres) when the weapon omits one. */
export const DEFAULT_TARGET_RADIUS = 0.4;

/** A single aimable target for {@link hitscan}. */
export interface HitscanTarget {
  /** Stable identifier of the target (e.g. the Colyseus `sessionId`). */
  id: string;
  /** Centre of the target collision sphere, metres (Y-up). */
  position: Readonly<Vec3>;
}

/**
 * The weapon parameters the multi-target {@link hitscan} resolver needs.
 *
 * Deliberately a *structural* subset of `@buildshift/game-config`'s
 * `WeaponConfig` (only `damage`, `range`, and an optional `targetRadius`) so
 * this module stays free of any shared-config dependency. Callers pass the
 * matching fields straight through from the shared weapon definition.
 */
export interface HitscanWeapon {
  /** Damage dealt on a hit, in health points. */
  damage: number;
  /** Maximum effective range in metres (hitscan stop distance). */
  range: number;
  /**
   * Radius of each target collision sphere, metres. Defaults to
   * {@link DEFAULT_TARGET_RADIUS} when omitted.
   */
  targetRadius?: number;
}

/** A single resolved hit from {@link hitscan}. */
export interface HitscanHit {
  /** Identifier of the target that was hit. */
  targetId: string;
  /** Damage the hit deals, in health points (from the weapon). */
  damage: number;
  /**
   * Distance from the shooter origin to the hit point, in metres (true
   * Euclidean distance, independent of direction magnitude).
   */
  distance: number;
  /** World-space point (metres, Y-up) where the shot landed on the target. */
  hitPoint: Vec3;
  /**
   * Whether this shot is allowed to continue past this target (penetration).
   *
   * Hitscan weapons do **not** penetrate: the shot stops at the first (nearest)
   * target it reaches, so the resolver reports a single hit and this flag is
   * always `false`. The field is carried on the result shape so a future
   * penetrating weapon (or a client predicting penetration) can extend the
   * contract without changing the result type.
   */
  penetrates: boolean;
}

/**
 * Resolve an approved hitscan fire intent against a set of live targets.
 *
 * This is the authoritative, multi-target resolver the room invokes once the
 * fire gate has approved a shot. It:
 *  1. ray-casts the shooter's aim ray against every target's collision sphere
 *     (via the pure {@link rayIntersectsCapsule} geometry — the core combat
 *     math is *never* reimplemented here or in the room);
 *  2. selects the *nearest* hit (the first target the ray reaches within
 *     `weapon.range`) — the canonical hitscan "first-hit wins" rule;
 *  3. returns the hit result: target id, the weapon's damage, the hit distance,
 *     the world-space hit point, and the (always-`false`) penetration flag.
 *
 * The resolver performs **no** state mutation: it only reports *which* target
 * is hit and *where*. Applying damage, updating health/shield, and triggering
 * elimination are the room's responsibilities (see the authoritative combat
 * room, and `docs/TECHNICAL_ARCHITECTURE.md` §3.4 for shield-before-health).
 *
 * @param origin - The shooter's aim origin, metres (Y-up).
 * @param direction - The aim direction; any magnitude (unit or not).
 * @param weapon - The weapon's `damage`, `range`, and optional `targetRadius`.
 * @param targets - The set of live, aimable targets (id + sphere centre).
 * @returns - An empty array on a miss (no target in range), or a single-element
 *   array containing the nearest hit when a target is hit.
 */
export function hitscan(
  origin: Readonly<Vec3>,
  direction: Readonly<Vec3>,
  weapon: HitscanWeapon,
  targets: ReadonlyArray<HitscanTarget>,
): HitscanHit[] {
  const targetRadius =
    weapon.targetRadius !== undefined ? weapon.targetRadius : DEFAULT_TARGET_RADIUS;

  let bestTarget: HitscanTarget | null = null;
  let bestDistance = 0;

  for (const target of targets) {
    const result = rayIntersectsCapsule(
      origin,
      direction,
      target.position,
      targetRadius,
      weapon.range,
    );
    if (result.hit && (bestTarget === null || result.distance < bestDistance)) {
      bestTarget = target;
      bestDistance = result.distance;
    }
  }

  // No target in range — the shot misses.
  if (bestTarget === null) {
    return [];
  }

  // Convert the Euclidean hit distance back to the ray parameter `t` so the
  // hit point is correct regardless of the direction's magnitude:
  //   P(t) = origin + t·direction,   distance = t·|direction|  →  t = d/|dir|.
  const dirLen = Math.sqrt(lengthSq(direction));
  const t = dirLen > 1e-12 ? bestDistance / dirLen : 0;
  const hitPoint: Vec3 = {
    x: origin.x + direction.x * t,
    y: origin.y + direction.y * t,
    z: origin.z + direction.z * t,
  };

  return [
    {
      targetId: bestTarget.id,
      damage: weapon.damage,
      distance: bestDistance,
      hitPoint,
      penetrates: false,
    },
  ];
}
