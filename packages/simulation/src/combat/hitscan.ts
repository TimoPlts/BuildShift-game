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
