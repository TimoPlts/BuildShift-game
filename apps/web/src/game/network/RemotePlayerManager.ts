/**
 * RemotePlayerManager — smooth interpolation for remote player positions
 * in the canonical multiplayer system.
 *
 * Maintains a buffer of the last 2-3 server states for the remote player,
 * timestamped with the local clock. Renders the remote player interpolated
 * between the two oldest buffered states, offset by ~100 ms behind the
 * latest, so that network jitter is absorbed by the interpolation buffer
 * rather than manifesting as position pops.
 *
 * The interpolation delay (REMOTE_INTERPOLATION_DELAY_MS) is chosen to be
 * longer than a typical RTT on a local network (~20-50 ms) so the buffer
 * always has at least two states to interpolate between.
 */

/**
 * The interpolation delay in milliseconds. The remote player is rendered
 * this many ms behind the latest server state, giving the buffer time to
 * fill and providing smooth interpolation.
 */
export const REMOTE_INTERPOLATION_DELAY_MS = 100;

/**
 * Maximum number of buffered states to retain. Old states beyond this are
 * discarded.
 */
export const REMOTE_BUFFER_SIZE = 4;

/**
 * A timestamped remote player state.
 */
export interface TimedRemoteState {
  /** The state received from the server. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  velocityY: number;
  grounded: boolean;
  /** Local clock timestamp (ms) when this state was received. */
  receivedAtMs: number;
}

/**
 * The interpolated remote player position.
 */
export interface InterpolatedRemoteState {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/**
 * Smooth interpolation buffer for one remote player.
 *
 * Usage:
 * ```ts
 * const interp = new RemotePlayerManager();
 *
 * // On each server state update:
 * interp.addState({ x, y, z, yaw, velocityY, grounded }, performance.now());
 *
 * // On each render frame:
 * const pos = interp.getInterpolated(performance.now());
 * // Use `pos` to drive the remote player mesh.
 * ```
 */
export class RemotePlayerManager {
  private buffer: TimedRemoteState[] = [];

  /**
   * Add a new server state to the interpolation buffer.
   * The buffer is capped at REMOTE_BUFFER_SIZE; the oldest entry is
   * evicted when full.
   *
   * @param state the authoritative state from the server.
   * @param receivedAtMs the local clock timestamp when the state arrived.
   */
  public addState(
    state: {
      x: number;
      y: number;
      z: number;
      yaw: number;
      velocityY: number;
      grounded: boolean;
    },
    receivedAtMs: number,
  ): void {
    this.buffer.push({
      x: state.x,
      y: state.y,
      z: state.z,
      yaw: state.yaw,
      velocityY: state.velocityY,
      grounded: state.grounded,
      receivedAtMs,
    });

    // Evict oldest entries beyond the buffer cap.
    while (this.buffer.length > REMOTE_BUFFER_SIZE) {
      this.buffer.shift();
    }
  }

  /**
   * Compute the interpolated remote player position for the given render
   * time.
   *
   * The render time is offset by REMOTE_INTERPOLATION_DELAY_MS behind the
   * latest state. We find the two buffered states that bracket this target
   * time and linearly interpolate between them.
   *
   * Edge cases:
   *  - Empty buffer: returns the last known position (or origin).
   *  - Only one state: returns that state's position (no interpolation).
   *  - Target time before the first buffered state: returns the first state.
   *  - Target time after the last buffered state: returns the last state
   *    (extrapolation is intentionally NOT done — we hold the last known
   *    position to avoid runaway drift).
   *
   * @param renderTimeMs the current local clock time in milliseconds.
   * @returns the interpolated position.
   */
  public getInterpolated(renderTimeMs: number): InterpolatedRemoteState {
    const buffer = this.buffer;
    const len = buffer.length;

    if (len === 0) {
      // No data yet: return origin (shouldn't happen in practice).
      return { x: 0, y: 0, z: 0, yaw: 0 };
    }

    if (len === 1) {
      const s = buffer[0];
      return { x: s.x, y: s.y, z: s.z, yaw: s.yaw };
    }

    // Target time: render time minus the interpolation delay.
    const targetTime = renderTimeMs - REMOTE_INTERPOLATION_DELAY_MS;

    // Find the two states that bracket targetTime.
    // We want buffer[i].receivedAtMs <= targetTime < buffer[i+1].receivedAtMs.
    let lowerIdx = 0;
    for (let i = len - 1; i >= 0; i--) {
      if (buffer[i].receivedAtMs <= targetTime) {
        lowerIdx = i;
        break;
      }
      // If target is before all states, clamp to the first.
      if (i === 0) {
        lowerIdx = 0;
      }
    }

    const upperIdx = Math.min(lowerIdx + 1, len - 1);

    const lower = buffer[lowerIdx];
    const upper = buffer[upperIdx];

    // If both indices point to the same state, no interpolation needed.
    if (lowerIdx === upperIdx) {
      return { x: lower.x, y: lower.y, z: lower.z, yaw: lower.yaw };
    }

    // Compute the interpolation factor.
    const timeSpan = upper.receivedAtMs - lower.receivedAtMs;
    if (timeSpan <= 0) {
      // Degenerate case (duplicate timestamps): return the upper state.
      return { x: upper.x, y: upper.y, z: upper.z, yaw: upper.yaw };
    }

    const t = clamp((targetTime - lower.receivedAtMs) / timeSpan, 0, 1);

    return {
      x: lerp(lower.x, upper.x, t),
      y: lerp(lower.y, upper.y, t),
      z: lerp(lower.z, upper.z, t),
      yaw: lerpAngle(lower.yaw, upper.yaw, t),
    };
  }

  /**
   * Whether the buffer has at least one state (i.e. the remote player has
   * been seen).
   */
  public get hasData(): boolean {
    return this.buffer.length > 0;
  }

  /**
   * The last received state (for debug / fallback). Returns null if empty.
   */
  public get lastState(): TimedRemoteState | null {
    return this.buffer.length > 0
      ? this.buffer[this.buffer.length - 1]
      : null;
  }

  /**
   * Reset the interpolation buffer. Called when the remote player leaves
   * or the connection is reset.
   */
  public reset(): void {
    this.buffer = [];
  }
}

/** Linear interpolation between a and b by factor t (0..1). */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Linear interpolation of angles, taking the shortest path.
 * Handles the wrap-around at ±π.
 */
function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  // Normalize to [-π, π].
  while (diff > Math.PI) {
    diff -= Math.PI * 2;
  }
  while (diff < -Math.PI) {
    diff += Math.PI * 2;
  }
  return a + diff * t;
}

/** Clamp value to [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
