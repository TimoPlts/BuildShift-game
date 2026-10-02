/**
 * A client-side, plain-object snapshot of one player's authoritative state.
 * Mirrors the accepted AuthoritativePlayerState contract field-for-field.
 */
export interface ClientPlayerSnapshot {
  playerId: string;
  position: { x: number; y: number; z: number };
  yaw: number;
  acknowledgedSequence: number;
}

/** A plain map of `playerId` → {@link ClientPlayerSnapshot}. */
export type PlayerSnapshotMap = Record<string, ClientPlayerSnapshot>;

/**
 * A presentation-only view of one remote player's authoritative position +
 * facing. This is the minimal shape the remote rendering layer needs from a
 * {@link ClientPlayerSnapshot}; the full network snapshot carries the same
 * fields (plus `playerId`, which is redundant with the map key).
 */
export interface RemotePlayerView {
  /** Capsule-centre position (world X/Z, Y up). */
  position: { x: number; y: number; z: number };
  /** Facing yaw in radians (Babylon convention: 0 faces -Z, positive → +X). */
  yaw: number;
}

/** A plain map of `playerId` → authoritative remote snapshot. */
export type RemotePlayerSnapshotMap = Record<string, RemotePlayerView>;

/**
 * One presentation operation to reconcile the live set of remote-player meshes
 * against the authoritative remote snapshot set.
 *
 *  - `create`: a remote player has appeared; spawn a new mesh from `snapshot`.
 *  - `update`: a tracked remote player still exists; place/rotate the existing
 *    mesh to `snapshot` (the manager may skip the write when the snapshot is
 *    unchanged — see {@link reconcileRemotePlayers}).
 *  - `remove`: a remote player has left; dispose its mesh.
 */
export type RemotePlayerCreateOp = { type: "create"; playerId: string; snapshot: RemotePlayerView };
export type RemotePlayerUpdateOp = { type: "update"; playerId: string; snapshot: RemotePlayerView };
export type RemotePlayerRemoveOp = { type: "remove"; playerId: string };

export type RemotePlayerOp =
  | RemotePlayerCreateOp
  | RemotePlayerUpdateOp
  | RemotePlayerRemoveOp;

/**
 * The grouped set of operations to apply. Each bucket is typed with its
 * specific member so consumers (and the tests) can access `snapshot` on
 * creates/updates without narrowing the union.
 */
export interface RemotePlayerOps {
  creates: RemotePlayerCreateOp[];
  updates: RemotePlayerUpdateOp[];
  removals: RemotePlayerRemoveOp[];
}

/**
 * Pure reconciliation of the "remote" player set — the part of remote-player
 * rendering that is *not* Babylon, so it is fully node-testable without WebGL.
 *
 * Given the ids the manager currently has a live mesh for (`trackedIds`) and
 * the latest authoritative snapshot map, it decides exactly which meshes to
 * create, update, and remove.
 *
 * Rules:
 *  - The LOCAL session (`localSessionId`) is NEVER rendered as a remote player.
 *    It is excluded from the remote set, so the local player remains driven
 *    exclusively by PlayerController prediction/reconciliation.
 *  - A tracked entry whose id equals the current local session is removed —
 *    this keeps classification correct across a session-id change even if the
 *    `players` root lags the session transition by an emit.
 *  - A tracked remote whose id is no longer present in `latest` is removed
 *    (defensive: the snapshot root lost it, e.g. a disconnect).
 *  - A tracked remote whose latest snapshot is still present produces an
 *    `update` op; the MANAGER (not this helper) may skip the mesh write when
 *    the snapshot is byte-for-byte unchanged, so a repeated identical snapshot
 *    is a no-op (no wasted mesh write, no re-create).
 *  - Order: creates/updates in Object.keys order of `latest`, removals in
 *    `trackedIds` order, so the helper is deterministic.
 *
 * The helper is pure: it inspects only the two plain-data inputs and returns a
 * plain list of operations. It never touches the DOM, physics, or Babylon.
 */
export function reconcileRemotePlayers(
  trackedIds: readonly string[],
  latest: RemotePlayerSnapshotMap,
  localSessionId: string | null,
): RemotePlayerOps {
  // `trackedSet` drives the create-vs-update decision. We keep the FULL tracked
  // set here (a now-local session is still "tracked" and therefore never
  // re-created); the local session is simply skipped in the `latest` loop.
  const trackedSet = new Set(trackedIds);

  const creates: RemotePlayerCreateOp[] = [];
  const updates: RemotePlayerUpdateOp[] = [];
  const removals: RemotePlayerRemoveOp[] = [];

  // Creates / updates: walk the LATEST remote set in Object.keys order. The
  // local session is skipped even if it appears as a key (defensive) — it is
  // never rendered as a remote player.
  for (const id of Object.keys(latest)) {
    if (id === localSessionId) {
      continue;
    }
    const snapshot = latest[id];
    if (snapshot === undefined) {
      continue;
    }
    if (!trackedSet.has(id)) {
      creates.push({ type: "create", playerId: id, snapshot });
    } else {
      updates.push({ type: "update", playerId: id, snapshot });
    }
  }

  // Removals: every tracked id that is (a) no longer present in `latest` (left
  // the room / disconnected) OR (b) is now the local session (session change
  // reclassifies it — its remote mesh must be dropped so the local player is
  // driven only by PlayerController, never a remote mesh).
  for (const id of trackedIds) {
    if (id === localSessionId || latest[id] === undefined) {
      removals.push({ type: "remove", playerId: id });
    }
  }

  return { creates, updates, removals };
}

/**
 * Map a validated {@link ClientPlayerSnapshot} set (the `players` root of the
 * `NetworkUiState`) into the minimal {@link RemotePlayerSnapshotMap} the
 * remote-rendering layer consumes. Excludes `localSessionId` so the local
 * player never leaks into remote rendering. Pure and node-testable.
 */
export function mapPlayersToRemoteViews(
  players: Readonly<Record<string, ClientPlayerSnapshot>>,
  localSessionId: string | null,
): RemotePlayerSnapshotMap {
  const result: RemotePlayerSnapshotMap = {};
  for (const [id, snap] of Object.entries(players)) {
    if (id === localSessionId) {
      continue;
    }
    result[id] = {
      position: snap.position,
      yaw: snap.yaw,
    };
  }
  return result;
}
