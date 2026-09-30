import { describe, expect, it } from "vitest";

import {
  mapPlayersToRemoteViews,
  reconcileRemotePlayers,
  type RemotePlayerSnapshotMap,
} from "./remotePlayerSet";

/**
 * Build a snapshot map with stable, predictable values. `positions` maps
 * playerId → [x, z] (y fixed at the capsule centre height); yaws default to 0.
 */
function views(entries: Array<[string, [number, number]?, number?]>): RemotePlayerSnapshotMap {
  const out: RemotePlayerSnapshotMap = {};
  for (const [id, pos, yaw] of entries) {
    out[id] = {
      position: { x: pos?.[0] ?? 0, y: 0.9, z: pos?.[1] ?? 0 },
      yaw: yaw ?? 0,
    };
  }
  return out;
}

describe("reconcileRemotePlayers (pure remote-set reconciliation)", () => {
  it("excludes the local player from remote operations", () => {
    // `me` is the local session — it appears in the snapshot map (as the server
    // guarantees key === sessionId) but must NEVER produce a create/update.
    const latest = views([
      ["me", [0, 0]],
      ["other", [2, -1]],
    ]);
    const ops = reconcileRemotePlayers([], latest, "me");
    expect(ops.creates.map((o) => o.playerId)).toEqual(["other"]);
    expect(ops.updates).toEqual([]);
    expect(ops.removals).toEqual([]);
  });

  it("creates a remote player when one appears", () => {
    const ops = reconcileRemotePlayers([], views([["a", [1, 2]]]), null);
    expect(ops.creates).toEqual([
      { type: "create", playerId: "a", snapshot: { position: { x: 1, y: 0.9, z: 2 }, yaw: 0 } },
    ]);
    expect(ops.updates).toEqual([]);
    expect(ops.removals).toEqual([]);
  });

  it("updates an existing remote player (not re-created)", () => {
    const first = reconcileRemotePlayers([], views([["a", [0, 0]]]), null);
    // Now the manager tracks `a`; a NEW position arrives → update, not create.
    const ops = reconcileRemotePlayers(["a"], views([["a", [5, 3]]]), null);
    expect(first.creates).toHaveLength(1);
    expect(ops.creates).toEqual([]);
    expect(ops.updates).toHaveLength(1);
    expect(ops.updates[0].playerId).toBe("a");
    expect(ops.updates[0].snapshot.position).toEqual({ x: 5, y: 0.9, z: 3 });
  });

  it("creates a second remote player independently of the first", () => {
    // Manager already tracks `a`; `b` appears in the same snapshot.
    const ops = reconcileRemotePlayers(["a"], views([["a", [0, 0]], ["b", [4, -2]]]), null);
    expect(ops.creates.map((o) => o.playerId)).toEqual(["b"]);
    expect(ops.updates.map((o) => o.playerId)).toEqual(["a"]);
    expect(ops.removals).toEqual([]);
  });

  it("removes only the leaving remote player", () => {
    // Both tracked; the snapshot now contains only `a` → `b` is removed.
    const ops = reconcileRemotePlayers(["a", "b"], views([["a", [0, 0]]]), null);
    expect(ops.creates).toEqual([]);
    expect(ops.updates.map((o) => o.playerId)).toEqual(["a"]);
    expect(ops.removals).toEqual([{ type: "remove", playerId: "b" }]);
  });

  it("removes all remote players on an empty snapshot (disconnect)", () => {
    const ops = reconcileRemotePlayers(["a", "b"], {}, null);
    expect(ops.creates).toEqual([]);
    expect(ops.updates).toEqual([]);
    expect(ops.removals.map((o) => o.playerId).sort()).toEqual(["a", "b"]);
  });

  it("reclassifies correctly when the local session id changes", () => {
    // The manager was tracking `a` and `b` as remotes. Now the LOCAL session
    // is `a` (a re-join / session change). `a` must be removed as a remote
    // (never re-created) and `b` kept as a tracked remote (update, not create).
    const ops = reconcileRemotePlayers(["a", "b"], views([["a", [0, 0]], ["b", [1, 1]]]), "a");
    expect(ops.creates).toEqual([]);
    expect(ops.updates.map((o) => o.playerId)).toEqual(["b"]);
    expect(ops.removals).toEqual([{ type: "remove", playerId: "a" }]);
  });

  it("never re-creates a repeated identical snapshot (no duplicate mesh)", () => {
    // Call the helper twice with the same tracked id + same snapshot. The
    // second call must produce only an update (no create), so the manager
    // never spawns a second mesh for the same player.
    const first = reconcileRemotePlayers([], views([["a", [1, 1]]]), null);
    const second = reconcileRemotePlayers(["a"], views([["a", [1, 1]]]), null);
    expect(first.creates).toHaveLength(1);
    expect(second.creates).toEqual([]);
    expect(second.updates).toHaveLength(1);
  });

  it("is deterministic and independent of the local player's presence in latest", () => {
    // Even if the local session (`me`) appears in BOTH the tracked set and the
    // snapshot, it is dropped from every create/update and only ever removed.
    // The other tracked remote `a` gets an update, not a create.
    const latest = views([["me", [0, 0]], ["a", [1, 1]]]);
    const ops = reconcileRemotePlayers(["me", "a"], latest, "me");
    expect(ops.creates).toEqual([]);
    expect(ops.updates.map((o) => o.playerId)).toEqual(["a"]);
    expect(ops.removals).toEqual([{ type: "remove", playerId: "me" }]);
  });
});

describe("mapPlayersToRemoteViews (NetworkUiState.players → remote views)", () => {
  it("excludes the local session and preserves position + yaw", () => {
    const players = {
      me: {
        playerId: "me",
        position: { x: 0, y: 0.9, z: 0 },
        yaw: 1.1,
        acknowledgedSequence: 10,
      },
      a: {
        playerId: "a",
        position: { x: 3, y: 0.9, z: -4 },
        yaw: -0.6,
        acknowledgedSequence: 11,
      },
    };
    const remote = mapPlayersToRemoteViews(players, "me");
    expect(Object.keys(remote)).toEqual(["a"]);
    expect(remote.a).toEqual({
      position: { x: 3, y: 0.9, z: -4 },
      yaw: -0.6,
    });
    // acknowledgedSequence / playerId are presentation-irrelevant and dropped.
    expect("acknowledgedSequence" in (remote.a as object)).toBe(false);
  });
});
