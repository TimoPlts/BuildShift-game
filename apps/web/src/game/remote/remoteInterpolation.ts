/**
 * Pure remote-player interpolation buffer and angle math.
 *
 * This module is the *pure* layer of remote-player presentation (Stage 2D-2A).
 * It has NO Babylon, DOM, physics, network-SDK, or browser dependency — it
 * operates on plain data only, so it is fully testable under node without
 * WebGL. Runtime wiring (feeding real `receivedAtMs` timestamps and driving
 * `RemotePlayerManager`) is deliberately deferred to Stage 2D-2B.
 *
 * The idea: instead of rendering the newest authoritative packet immediately,
 * we render a little in the past (`now - REMOTE_INTERPOLATION_DELAY_MS`) and
 * linearly interpolate between the two samples that bracket that time. This
 * smooths the ~20 Hz authoritative updates.
 *
 * Deliberately out of scope for this stage:
 *  - extrapolation beyond the newest authoritative sample (we HOLD instead),
 *  - adaptive / dynamic delay (the delay is fixed),
 *  - any coupling to Babylon meshes or the network stack.
 */

/**
 * One received authoritative snapshot. `receivedAtMs` is a client-local
 * monotonic receive time in milliseconds — Stage 2D-2B will populate it with
 * the value the network layer stamps at receive time.
 */
export interface RemoteInterpolationSample {
  /** Capsule-centre position (world X/Z, Y up). */
  position: { x: number; y: number; z: number };
  /** Facing yaw in radians. */
  yaw: number;
  /** Client-local monotonic receive time in ms. */
  receivedAtMs: number;
}

/**
 * The interpolated presentation result for a requested render time. Always a
 * fresh copy (never a reference into stored history).
 */
export interface RemoteInterpolatedSample {
  position: { x: number; y: number; z: number };
  /** Facing yaw in radians, normalized to [-PI, PI). */
  yaw: number;
}

/**
 * How far behind "now" remote players are rendered, in ms. Rendering at
 * `now - REMOTE_INTERPOLATION_DELAY_MS` gives the buffer enough history to
 * interpolate the typical ~20 Hz authoritative updates instead of snapping to
 * the newest packet.
 *
 * This is a FIXED value — no adaptive delay in this stage.
 */
export const REMOTE_INTERPOLATION_DELAY_MS = 100;

/** Bounded number of samples retained per remote player. */
export const REMOTE_INTERPOLATION_BUFFER_CAP = 32;

/**
 * The render time to request from a buffer for a given "now" clock.
 * Conceptually `targetTime = nowMs - REMOTE_INTERPOLATION_DELAY_MS`.
 */
export function remoteRenderTimeFor(nowMs: number): number {
  return nowMs - REMOTE_INTERPOLATION_DELAY_MS;
}

const TWO_PI = Math.PI * 2;

/** Clamp a value to [0, 1]. */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Linear interpolation between two scalars. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Normalize a radian angle to the half-open range [-PI, PI).
 */
export function normalizeAngle(angle: number): number {
  let x = angle % TWO_PI;
  if (x >= Math.PI) {
    x -= TWO_PI;
  } else if (x < -Math.PI) {
    x += TWO_PI;
  }
  return x;
}

/**
 * The signed shortest rotation from `from` to `to`, in (-PI, PI]. This is what
 * makes yaw interpolation take the SHORTEST angular path across the wrap —
 * e.g. +179° -> -179° is +2°, not the -358° long way around.
 */
export function shortestAngleDelta(from: number, to: number): number {
  let d = (to - from) % TWO_PI;
  if (d > Math.PI) {
    d -= TWO_PI;
  } else if (d < -Math.PI) {
    d += TWO_PI;
  }
  return d;
}

/**
 * Linearly interpolate an angle from `from` to `to` by `alpha` (clamped) along
 * the SHORTEST angular path, returning the result normalized to [-PI, PI).
 */
export function interpolateAngle(from: number, to: number, alpha: number): number {
  const a = clamp01(alpha);
  const delta = shortestAngleDelta(from, to);
  return normalizeAngle(from + delta * a);
}

/**
 * Bounded per-player snapshot buffer for remote-player interpolation.
 *
 * Responsibilities:
 *  - append snapshots in receive order (a defensive copy is stored, so later
 *    mutation of the caller's object cannot corrupt history),
 *  - retain only a bounded number (oldest evicted first),
 *  - expose {@link interpolateAt} for a requested render time,
 *  - never mutate caller-owned snapshots.
 *
 * Timestamp policy (deterministic, no sorting on every append):
 *  - `receivedAtMs` < the latest retained timestamp → the sample is IGNORED
 *    (out-of-order / late), `append` returns `false`;
 *  - `receivedAtMs` == the latest retained timestamp → the latest sample is
 *    REPLACED in place (duplicate timestamp), `append` returns `true`;
 *  - `receivedAtMs` > the latest retained timestamp → the sample is pushed,
 *    and if the buffer exceeds its cap the OLDEST sample is evicted,
 *    `append` returns `true`.
 */
export class RemoteInterpolationBuffer {
  private readonly cap: number;
  private readonly samples: RemoteInterpolationSample[] = [];

  constructor(cap: number = REMOTE_INTERPOLATION_BUFFER_CAP) {
    this.cap = cap;
  }

  /** Number of retained samples. */
  get size(): number {
    return this.samples.length;
  }

  /** True when no samples have been stored yet. */
  get isEmpty(): boolean {
    return this.samples.length === 0;
  }

  /**
   * Append a snapshot in receive order. See the class doc for the timestamp
   * policy. Returns `true` when the sample was stored (pushed or replaced the
   * latest), `false` when it was ignored as out-of-order.
   */
  append(sample: RemoteInterpolationSample): boolean {
    // Defensive copy — the caller retains ownership of its own object.
    const copy: RemoteInterpolationSample = {
      position: {
        x: sample.position.x,
        y: sample.position.y,
        z: sample.position.z,
      },
      yaw: sample.yaw,
      receivedAtMs: sample.receivedAtMs,
    };

    const last = this.samples[this.samples.length - 1];
    if (last !== undefined) {
      if (copy.receivedAtMs < last.receivedAtMs) {
        // Out-of-order (late) sample — ignore it.
        return false;
      }
      if (copy.receivedAtMs === last.receivedAtMs) {
        // Duplicate timestamp — replace the latest sample in place.
        this.samples[this.samples.length - 1] = copy;
        return true;
      }
    }

    this.samples.push(copy);
    if (this.samples.length > this.cap) {
      this.samples.shift();
    }
    return true;
  }

  /**
   * Compute the interpolated presentation sample for a requested render time.
   *
   * Returns `null` when no samples have been stored. Otherwise:
   *  - exactly one sample (or a time at/after the newest sample) → the newest
   *    sample is HELD (NO extrapolation beyond the newest authoritative
   *    sample);
   *  - a time before the oldest sample → the oldest sample;
   *  - a time between two samples → linear position lerp + shortest-path yaw.
   *
   * A zero-width (duplicate-timestamp) span is guarded so the result is always
   * finite for finite input — no divide-by-zero / NaN.
   *
   * The returned object is a fresh copy; mutating it does not affect stored
   * history.
   */
  interpolateAt(renderTimeMs: number): RemoteInterpolatedSample | null {
    const n = this.samples.length;
    if (n === 0) {
      return null;
    }
    if (n === 1) {
      return toInterpolated(this.samples[0]);
    }

    const oldest = this.samples[0];
    const newest = this.samples[n - 1];

    // Hold at the oldest when we are before it (incl. exactly at it).
    if (renderTimeMs <= oldest.receivedAtMs) {
      return toInterpolated(oldest);
    }
    // Hold at the newest when we are at/after it — no extrapolation.
    if (renderTimeMs >= newest.receivedAtMs) {
      return toInterpolated(newest);
    }

    // Find the bracketing pair (older, newer) with older.time <= t < newer.time.
    // Timestamps are strictly increasing (duplicate timestamps replace in
    // place), so exactly one such pair exists for t in (oldest, newest).
    let i = 0;
    while (i < n - 1 && this.samples[i + 1].receivedAtMs <= renderTimeMs) {
      i += 1;
    }
    const older = this.samples[i];
    const newer = this.samples[i + 1];

    const span = newer.receivedAtMs - older.receivedAtMs;
    if (span <= 0) {
      // Defensive: identical timestamps (should not occur via the buffer's
      // replace policy) → deterministic hold, no divide-by-zero / NaN.
      return toInterpolated(newer);
    }

    const alpha = clamp01((renderTimeMs - older.receivedAtMs) / span);
    return {
      position: {
        x: lerp(older.position.x, newer.position.x, alpha),
        y: lerp(older.position.y, newer.position.y, alpha),
        z: lerp(older.position.z, newer.position.z, alpha),
      },
      yaw: interpolateAngle(older.yaw, newer.yaw, alpha),
    };
  }
}

/** Build a fresh interpolated view (copy) from a stored sample. */
function toInterpolated(sample: RemoteInterpolationSample): RemoteInterpolatedSample {
  return {
    position: {
      x: sample.position.x,
      y: sample.position.y,
      z: sample.position.z,
    },
    yaw: normalizeAngle(sample.yaw),
  };
}
