/**
 * Pure, Babylon-free per-remote interpolation-buffer bookkeeping.
 *
 * This is the *wiring* layer that sits between the authoritative snapshot
 * stream (Stage 2D-1's `reconcileRemotePlayers` create/update/remove ops) and
 * the Babylon meshes that Stage 2D-2B renders. It owns one
 * {@link RemoteInterpolationBuffer} per remote player (keyed by `playerId`)
 * and knows nothing about meshes, materials, physics, the network, or the
 * DOM — so the whole create/update/remove/rejoin/render contract is testable
 * under node without WebGL.
 *
 * `RemotePlayerManager` uses this as its single source of truth for
 * interpolation history; the Babylon side (one capsule per id) is kept in
 * lockstep, created and destroyed by the same ops.
 *
 * Deliberately minimal: a `Map` of buffers plus the small number of transitions
 * the presentation path needs. No abstraction framework, no scheduling, no
 * extrapolation.
 */
import {
  RemoteInterpolationBuffer,
  type RemoteInterpolatedSample,
  type RemoteInterpolationSample,
  remoteRenderTimeFor,
} from "./remoteInterpolation";

export class RemoteInterpolationRegistry {
  private readonly buffers = new Map<string, RemoteInterpolationBuffer>();

  /** Number of remotes currently tracked. */
  get size(): number {
    return this.buffers.size;
  }

  /** The tracked remote ids, in insertion order (deterministic). */
  trackedIds(): string[] {
    return [...this.buffers.keys()];
  }

  has(playerId: string): boolean {
    return this.buffers.has(playerId);
  }

  /**
   * The buffer owned by `playerId`, or `undefined` when the remote is not
   * tracked. Exposed read-only for inspection (and tests); callers must not
   * treat a returned buffer as an insertion point — use {@link appendSample}.
   */
  bufferFor(playerId: string): RemoteInterpolationBuffer | undefined {
    return this.buffers.get(playerId);
  }

  /**
   * Ensure a buffer exists for `playerId` and append `sample` to it.
   *
   *  - Absent id → a FRESH buffer is created and seeded with `sample`
   *    (a create, or a rejoin after a previous drop — never a reuse of stale
   *    history).
   *  - Present id → the existing buffer simply appends `sample`
   *    (an update). A later identical transform is still appended, because it
   *    carries a NEW receive timestamp and is useful interpolation history.
   *
   * Returns whether the sample was stored (the buffer's own out-of-order /
   * duplicate-timestamp policy decides).
   */
  appendSample(playerId: string, sample: RemoteInterpolationSample): boolean {
    let buffer = this.buffers.get(playerId);
    if (buffer === undefined) {
      buffer = new RemoteInterpolationBuffer();
      this.buffers.set(playerId, buffer);
    }
    return buffer.append(sample);
  }

  /**
   * Drop a remote's interpolation state. Idempotent. A subsequent rejoin
   * starts with a fresh, empty buffer — no stale history is reused.
   */
  drop(playerId: string): void {
    this.buffers.delete(playerId);
  }

  /** Drop every remote's interpolation state (disconnect / dispose). */
  clear(): void {
    this.buffers.clear();
  }

  /**
   * Sample every tracked remote at the render time `nowMs -
   * REMOTE_INTERPOLATION_DELAY_MS`. Returns a fresh map of `playerId` →
   * interpolated sample. Remotes whose buffer yields no usable sample are
   * omitted (in practice a tracked remote always has ≥1 sample, so this is
   * effectively all tracked ids).
   *
   * The receive timestamps (`receivedAtMs`) are a distinct concept from the
   * render clock: interpolation is evaluated at `nowMs - delay`, NOT at
   * `nowMs`, so the newest packet is held back by the fixed delay.
   */
  sampleAll(nowMs: number): Record<string, RemoteInterpolatedSample> {
    const targetTime = remoteRenderTimeFor(nowMs);
    const result: Record<string, RemoteInterpolatedSample> = {};
    for (const [id, buffer] of this.buffers) {
      const sample = buffer.interpolateAt(targetTime);
      if (sample !== null) {
        result[id] = sample;
      }
    }
    return result;
  }
}
