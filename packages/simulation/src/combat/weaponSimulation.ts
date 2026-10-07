/**
 * Canonical weapon simulation helpers for the 1v1 Energy Box Fight mode.
 *
 * This module is a *new, additive* simulation surface. It owns the shared,
 * pure, platform-independent math that the authoritative Energy Box Fight room
 * and the client prediction share for the weapon system:
 *
 *  - {@link WeaponState}: the shared shape of a player's active-weapon state
 *    (current weapon id, ammo, max ammo, reload flag, and the absolute
 *    `reloadEndTime` timestamp);
 *  - {@link computeShotgunSpread}: fan a shotgun shot into `pellets` rays
 *    across a `spreadAngle` cone around the aim direction;
 *  - {@link raycastHits}: resolve a single aim ray against a set of live
 *    spherical targets within a `maxRange` (nearest hit wins);
 *  - {@link isReloadComplete}: whether a reload that ends at `reloadEndTime`
 *    has finished at time `now`.
 *
 * Everything here is pure vector/timestamp math with no side effects, so the
 * authoritative server and the client predict the *identical* result from the
 * *same* inputs. It depends on no shared-config or protocol package (the `Vec3`
 * shape is declared locally, type-only) to keep the platform-specific surface
 * minimal.
 */

// ─────────────────────────── Geometry types ───────────────────────────

/** A 3D vector (metres, Y-up). Mirrors the shared combat `Vec3` shape. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * A single aimable target for {@link raycastHits}.
 *
 * Modelled as a collision *sphere* at {@link position} with radius
 * {@link radius} — the milestone approximation of a player/structure capsule.
 */
export interface RaycastTarget {
  /** Stable identifier of the target (e.g. a Colyseus `sessionId`). */
  id: string;
  /** Centre of the target collision sphere, metres (Y-up). */
  position: Readonly<Vec3>;
  /** Radius of the target collision sphere, metres (> 0). */
  radius: number;
}

/** A single resolved hit produced by {@link raycastHits}. */
export interface RaycastHit {
  /** Identifier of the target that was hit. */
  targetId: string;
  /** True Euclidean distance from the ray origin to the hit point, metres. */
  distance: number;
  /** World-space point (metres, Y-up) where the shot landed on the target. */
  hitPoint: Vec3;
}

/** One ray produced by {@link computeShotgunSpread}. */
export interface ShotgunRay {
  /** Origin of the ray (the shooter's aim origin, unchanged per pellet). */
  origin: Vec3;
  /** The pellet's aim direction after applying the spread offset. */
  direction: Vec3;
}

// ─────────────────────────── Weapon state ───────────────────────────

/**
 * Authoritative weapon state for a player's *active* weapon.
 *
 * This is the shared contract between the authoritative server and the client
 * for the weapon-switch / fire / reload system. `reloadEndTime` is an absolute
 * timestamp (the same time base as {@link isReloadComplete}'s `now`) rather
 * than a remaining-time count, so the reload completes deterministically on
 * every participant without per-tick progress bookkeeping.
 */
export interface WeaponState {
  /** Stable id of the currently active weapon (e.g. `"assaultRifle"`). */
  currentWeaponId: string;
  /** Rounds currently loaded in the magazine. */
  ammo: number;
  /** Maximum rounds the magazine holds. */
  maxAmmo: number;
  /** `true` while the active weapon is in the middle of a reload. */
  isReloading: boolean;
  /**
   * Absolute timestamp (same base as {@link isReloadComplete}'s `now`) at
   * which the in-progress reload completes. Meaningful only while
   * {@link isReloading} is `true`.
   */
  reloadEndTime: number;
}

// ─────────────────────────── Reload helper ───────────────────────────

/**
 * Report whether a reload that is scheduled to end at `reloadEndTime` has
 * completed (or already completed) at time `now`.
 *
 * A reload is complete the moment `now` reaches `reloadEndTime` (inclusive).
 * Both arguments are on the same time base (e.g. `performance.now()`
 * milliseconds, or the server tick clock in ms).
 *
 * @param now - the current time on the reload time base.
 * @param reloadEndTime - the absolute time the reload was scheduled to end.
 * @returns `true` when `now >= reloadEndTime` (reload done), else `false`.
 */
export function isReloadComplete(now: number, reloadEndTime: number): boolean {
  return now >= reloadEndTime;
}

// ─────────────────────────── Shotgun spread ───────────────────────────

/**
 * Compute the per-pellet rays for a shotgun shot.
 *
 * Fans `pellets` rays across a total `spreadAngle` cone (in **radians**)
 * centred on `direction`. The aim keeps its pitch and only fans left/right
 * (a horizontal/yaw spread, the common shotgun model): each pellet direction is
 * the base `direction` rotated about the world **+Y** up axis by its offset
 * (see {@link computePelletOffsets}). Every ray shares the shooter's `origin`,
 * so the result is an array of `{ origin, direction }` rays ready to be
 * ray-cast through {@link raycastHits} (or the shared `hitscan` resolver).
 *
 * Rotation convention (0 faces −Z, positive rotates toward +X, matching the
 * game's yaw):
 *   - `x' =  x·cosθ − z·sinθ`
 *   - `z' =  x·sinθ + z·cosθ`
 *   - `y' =  y`
 *
 * Boundary semantics:
 *  - **`pellets <= 0`** or non-integer → `[]` (no rays).
 *  - **`pellets === 1`** → a single ray down the aim centre (`direction`).
 *  - **`spreadAngle <= 0`** → `pellets` rays all down the aim centre (no fan).
 *
 * The spread is a pure rotation, so each returned direction has the same
 * length as `direction` (no normalisation is applied or required).
 *
 * @param origin - the shooter's aim origin, metres (Y-up).
 * @param direction - the base aim direction; any magnitude.
 * @param spreadAngle - total cone width of the spread, in **radians**.
 * @param pellets - number of pellets in the shot.
 * @returns an array of `pellets` `{ origin, direction }` rays (same order as
 *   the spread offsets).
 */
export function computeShotgunSpread(
  origin: Readonly<Vec3>,
  direction: Readonly<Vec3>,
  spreadAngle: number,
  pellets: number,
): ShotgunRay[] {
  if (!Number.isInteger(pellets) || pellets <= 0) {
    return [];
  }

  const offsets = computePelletOffsets(pellets, spreadAngle);
  const rays: ShotgunRay[] = new Array<ShotgunRay>(offsets.length);
  for (let i = 0; i < offsets.length; i += 1) {
    const theta = offsets[i];
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    rays[i] = {
      origin: { x: origin.x, y: origin.y, z: origin.z },
      direction: {
        x: direction.x * cos - direction.z * sin,
        y: direction.y,
        z: direction.x * sin + direction.z * cos,
      },
    };
  }
  return rays;
}

/**
 * Compute the per-pellet angular offsets for a shotgun-style spread.
 *
 * Evenly distributes `pelletCount` angular offsets (in **radians**) symmetrically
 * about `0` across the *total* `spreadAngle` cone — i.e. the pellets fan from
 * `-spreadAngle / 2` to `+spreadAngle / 2`. The first and last elements are the
 * two edges of the cone and the middle is `0` (the aim centre), so the pattern
 * is centred on the player's aim.
 *
 * Boundary semantics:
 *  - **`pelletCount <= 0`** or non-integer → `[]`.
 *  - **`pelletCount === 1`** → `[0]`.
 *  - **`spreadAngle <= 0`** → `pelletCount` copies of `0` (no fan).
 */
function computePelletOffsets(
  pelletCount: number,
  spreadAngle: number,
): number[] {
  if (!Number.isInteger(pelletCount) || pelletCount <= 0) {
    return [];
  }
  if (pelletCount === 1) {
    return [0];
  }
  if (!(spreadAngle > 0)) {
    return new Array<number>(pelletCount).fill(0);
  }

  const half = spreadAngle / 2;
  const step = spreadAngle / (pelletCount - 1);
  const angles: number[] = [];
  for (let i = 0; i < pelletCount; i += 1) {
    angles.push(-half + i * step);
  }
  return angles;
}

// ─────────────────────────── Raycast hit detection ───────────────────────────

/** Squared length of a 3D vector. */
function lengthSq(v: Readonly<Vec3>): number {
  return v.x * v.x + v.y * v.y + v.z * v.z;
}

/**
 * Test whether a single ray reaches a target's collision sphere within
 * `maxRange`.
 *
 * Uses the standard ray–sphere intersection derived from the quadratic
 * `a·t² + b·t + c = 0`:
 *
 *   - ray:    P(t) = origin + t·direction,   t ≥ 0
 *   - sphere: centre `centre`, radius `radius`
 *   - L       = origin − centre
 *   - a       = direction · direction
 *   - b       = 2 · (L · direction)
 *   - c       = L · L − radius²
 *   - disc    = b² − 4ac
 *
 * The nearest non-negative root is chosen. When the ray origin lies *inside*
 * the sphere only the far (exit) root is non-negative, which is the correct
 * "hit" behaviour. Returns `null` on a miss (negative discriminant, target
 * entirely behind the ray, or a hit beyond `maxRange`).
 *
 * The reported `distance` is the true Euclidean distance from the origin to the
 * intersection (`t·|direction|`), so `direction` need not be unit-length.
 */
function rayIntersectsSphere(
  origin: Readonly<Vec3>,
  direction: Readonly<Vec3>,
  centre: Readonly<Vec3>,
  radius: number,
  maxRange: number,
): number | null {
  // Guard against a degenerate (zero-length) direction.
  const a = lengthSq(direction);
  if (a < 1e-12) {
    return null;
  }

  const lx = origin.x - centre.x;
  const ly = origin.y - centre.y;
  const lz = origin.z - centre.z;

  const b = 2 * (lx * direction.x + ly * direction.y + lz * direction.z);
  const c = lx * lx + ly * ly + lz * lz - radius * radius;

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return null;
  }

  const sqrtDisc = Math.sqrt(discriminant);
  const t0 = (-b - sqrtDisc) / (2 * a);
  const t1 = (-b + sqrtDisc) / (2 * a);

  let t: number;
  if (t0 >= 0) {
    t = t0; // origin outside (or on) the sphere: near surface is the hit.
  } else if (t1 >= 0) {
    t = t1; // origin inside the sphere: only the far (exit) surface is in front.
  } else {
    return null; // both roots negative — sphere entirely behind the ray.
  }

  const distance = t * Math.sqrt(a);
  if (distance > maxRange) {
    return null; // range clamp: a hit beyond maxRange does not count.
  }
  return distance;
}

/**
 * Resolve an aim ray against a set of live spherical targets within `maxRange`.
 *
 * This is the shared hit-detection the authoritative room invokes per pellet
 * (or per single-shot weapon fire). It ray-casts the ray against every
 * target's collision sphere and selects the *nearest* hit — the canonical
 * "first hit wins" rule. The resolver performs **no** state mutation: it only
 * reports *which* target is hit and *where*, and (via the hit's `distance`) how
 * far away. Applying damage and updating health/elimination is the room's job.
 *
 * @param origin - the ray origin (the shooter's aim origin), metres (Y-up).
 * @param direction - the aim direction; any magnitude (unit or not).
 * @param maxRange - maximum effective range, metres (hits are clamped to this).
 * @param targets - the set of live, aimable targets (id + sphere centre + radius).
 * @returns the single nearest hit, or `null` when the ray misses every target
 *   (no target in range, all behind the ray, or a degenerate direction).
 */
export function raycastHits(
  origin: Readonly<Vec3>,
  direction: Readonly<Vec3>,
  maxRange: number,
  targets: ReadonlyArray<RaycastTarget>,
): RaycastHit | null {
  let bestTarget: RaycastTarget | null = null;
  let bestDistance = 0;

  for (const target of targets) {
    const distance = rayIntersectsSphere(
      origin,
      direction,
      target.position,
      target.radius,
      maxRange,
    );
    if (distance !== null && (bestTarget === null || distance < bestDistance)) {
      bestTarget = target;
      bestDistance = distance;
    }
  }

  if (bestTarget === null) {
    return null;
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

  return {
    targetId: bestTarget.id,
    distance: bestDistance,
    hitPoint,
  };
}
