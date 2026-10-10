/**
 * Reconnect grace period for the canonical two-player movement room.
 *
 * When a player disconnects, their authoritative state is preserved for a
 * bounded grace period. If the same session reconnects within the grace
 * window, the state is restored (no duplicate, no round re-award). If the
 * grace window expires, the player is permanently removed and the disconnect
 * consequence (round loss) is applied.
 *
 * This module is transport-agnostic: it manages a map of pending snapshots
 * and a timer per session. The room class provides the snapshot/restore/
 * expire callbacks.
 */

/** Default grace period in milliseconds. Small enough to avoid stalling the
 *  match, large enough for a client to detect a network blip and rejoin. */
export const RECONNECT_GRACE_MS = 3_000;

export interface ReconnectGraceManager {
  /** Whether the given session currently has a pending grace snapshot. */
  isInGrace(sessionId: string): boolean;

  /**
   * Save a snapshot for the given session, starting (or restarting) the
   * grace timer. If a snapshot is already pending for this session the old
   * timer is replaced.
   */
  save(sessionId: string, snapshot: unknown): void;

  /**
   * Retrieve and remove the pending snapshot (successful reconnection).
   * Returns `undefined` if no snapshot is pending (session already expired
   * or was never saved).
   */
  restore(sessionId: string): unknown | undefined;

  /** Cancel any pending timer without invoking the expire callback. */
  cancel(sessionId: string): void;

  /** Cancel all pending timers and clear the map (room dispose). */
  dispose(): void;

  /** Cancel all pending timers and clear the map without signaling room
   *  disposal. Use when the match context is invalidated (e.g. match reset
   *  or rematch) so that stale snapshots are not restored into a new match. */
  clearAll(): void;

  /** Number of sessions currently in the grace period (for tests/observability). */
  readonly pendingCount: number;
}

/**
 * Create a reconnect-grace manager.
 *
 * @param graceMs   Duration of the grace window in milliseconds.
 * @param onExpire  Callback invoked when the grace window elapses without a
 *                  reconnection. Receives the session id and the saved
 *                  snapshot. The manager removes the entry before calling.
 */
export function createReconnectGraceManager(
  graceMs: number,
  onExpire: (sessionId: string, snapshot: unknown) => void,
): ReconnectGraceManager {
  const pending = new Map<string, { snapshot: unknown; timer: ReturnType<typeof setTimeout> }>();

  function save(sessionId: string, snapshot: unknown): void {
    // Replace any existing pending entry for this session.
    const existing = pending.get(sessionId);
    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
      const entry = pending.get(sessionId);
      if (entry) {
        pending.delete(sessionId);
        onExpire(sessionId, entry.snapshot);
      }
    }, graceMs);
    // Allow the Node.js process to exit even if a grace timer is still
    // pending (e.g. during test teardown).
    if (typeof timer.unref === "function") timer.unref();

    pending.set(sessionId, { snapshot, timer });
  }

  function restore(sessionId: string): unknown | undefined {
    const entry = pending.get(sessionId);
    if (!entry) return undefined;
    clearTimeout(entry.timer);
    pending.delete(sessionId);
    return entry.snapshot;
  }

  function cancel(sessionId: string): void {
    const entry = pending.get(sessionId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(sessionId);
  }

  function clearAll(): void {
    for (const [, entry] of pending) clearTimeout(entry.timer);
    pending.clear();
  }

  function dispose(): void {
    clearAll();
  }

  return {
    isInGrace: (sessionId) => pending.has(sessionId),
    save,
    restore,
    cancel,
    clearAll,
    dispose,
    get pendingCount() {
      return pending.size;
    },
  };
}
