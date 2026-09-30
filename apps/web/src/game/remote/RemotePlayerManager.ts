import { Color3, MeshBuilder, Scene, StandardMaterial, type AbstractMesh } from "@babylonjs/core";
import { PLAYER_COLLIDER, PLAYER_COLLIDER_TOTAL_HEIGHT } from "@buildshift/game-config";

import type { PlayerSnapshotMap } from "../../network/colyseus/playerSnapshot";
import {
  mapPlayersToRemoteViews,
  reconcileRemotePlayers,
  type RemotePlayerView,
} from "./remotePlayerSet";

/**
 * The one Babylon mesh (+ material + forward marker) owned per remote player.
 *
 *  - `mesh`: the capsule, sized identically to the local player
 *    (`PLAYER_COLLIDER_TOTAL_HEIGHT` × `PLAYER_COLLIDER.radius`), but rendered
 *    in a DISTINCT colour so it is visually obvious it is a remote player.
 *  - `marker`: a small box parented to the capsule, offset toward -Z, to make
 *    the facing direction readable (mirrors the local player's marker).
 *  - `material`: the capsule material (disposed with the mesh).
 */
interface RemotePlayerMesh {
  mesh: AbstractMesh;
  marker: AbstractMesh;
  /** Capsule material. */
  material: StandardMaterial;
  /** Forward-marker material (disposed separately — mesh.dispose() doesn't dispose materials). */
  markerMaterial: StandardMaterial;
  /**
   * The last-applied snapshot. The manager skips the mesh write when a new
   * snapshot is byte-for-byte identical, so a repeated snapshot never triggers
   * a redundant transform update.
   */
  last: RemotePlayerView;
}

/**
 * Presentation-only lifecycle manager for REMOTE player meshes.
 *
 * It owns one Babylon capsule per remote player, keyed by `playerId`, and
 * creates/updates/removes them in response to the authoritative snapshot map
 * from the existing `FoundationNetwork` (`NetworkUiState.players`). It is
 * driven exclusively by {@link reconcileRemotePlayers}, which decides the
 * create/update/remove set — keeping the decision logic pure and node-testable
 * while this class owns only the Babylon side-effects.
 *
 * Deliberate non-goals (see Stage 2D-1):
 *  - The LOCAL player is NEVER rendered here; it stays driven by
 *    `PlayerController` prediction/reconciliation. The local session id is
 *    excluded from every operation.
 *  - No physics bodies, no `PlayerController`, no prediction, no
 *    interpolation. Remote snapshots are applied directly (snap-placement).
 *  - Disposal is idempotent and tears down every owned mesh + material.
 */
export class RemotePlayerManager {
  /**
   * Distinct from the local player's green (0.25, 0.9, 0.48): remote capsules
   * use a cool cyan so local vs remote is immediately legible.
   */
  private static readonly REMOTE_COLOR = new Color3(0.2, 0.62, 0.95);
  private static readonly REMOTE_EMISSIVE = new Color3(0.0, 0.1, 0.2);

  private readonly scene: Scene;
  /** Live remote meshes, keyed by playerId. Empty after {@link dispose}. */
  private readonly meshes = new Map<string, RemotePlayerMesh>();
  private disposed = false;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /**
   * Reconcile the live remote-mesh set against the authoritative snapshot map.
   *
   * `players` is the `NetworkUiState.players` root (playerId → validated
   * snapshot). `localSessionId` is the current local session (the key that is
   * NEVER rendered as a remote player). Calling this on every network-state
   * emit keeps meshes in sync: new players spawn, moved players move, and
   * departed players (including a cleared/empty map on disconnect) are
   * disposed.
   */
  sync(players: Readonly<PlayerSnapshotMap>, localSessionId: string | null): void {
    if (this.disposed) {
      return;
    }

    const latest = mapPlayersToRemoteViews(players, localSessionId);
    const ops = reconcileRemotePlayers(
      [...this.meshes.keys()],
      latest,
      localSessionId,
    );

    for (const op of ops.creates) {
      this.createRemote(op.playerId, op.snapshot);
    }
    for (const op of ops.updates) {
      this.applySnapshot(op.playerId, op.snapshot);
    }
    for (const op of ops.removals) {
      this.removeRemote(op.playerId);
    }
  }

  /**
   * Dispose every owned remote mesh + material and clear tracking. Idempotent:
   * safe to call more than once (a second call is a no-op).
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const entry of this.meshes.values()) {
      this.disposeEntry(entry);
    }
    this.meshes.clear();
  }

  /** Create a fresh remote capsule for `playerId` and place it at `snapshot`. */
  private createRemote(playerId: string, snapshot: RemotePlayerView): void {
    // One mesh per playerId — the helper only emits a create for an id we do
    // not already track, so this cannot duplicate an existing remote.
    if (this.meshes.has(playerId)) {
      return;
    }

    const material = new StandardMaterial(`remote-player-${playerId}-material`, this.scene);
    material.diffuseColor = RemotePlayerManager.REMOTE_COLOR;
    material.emissiveColor = RemotePlayerManager.REMOTE_EMISSIVE;

    const mesh = MeshBuilder.CreateCapsule(
      `remote-player-${playerId}`,
      {
        height: PLAYER_COLLIDER_TOTAL_HEIGHT,
        radius: PLAYER_COLLIDER.radius,
        tessellation: 16,
      },
      this.scene,
    );
    mesh.material = material;

    // Forward-facing marker, identical geometry/offset to the local player so
    // facing is readable: a small white box parented toward -Z (the forward
    // axis at yaw 0).
    const markerMaterial = new StandardMaterial(
      `remote-player-${playerId}-marker-material`,
      this.scene,
    );
    markerMaterial.diffuseColor = new Color3(1, 1, 1);
    const marker = MeshBuilder.CreateBox(
      `remote-player-${playerId}-forward-marker`,
      { width: 0.22, height: 0.08, depth: 0.06 },
      this.scene,
    );
    marker.material = markerMaterial;
    marker.parent = mesh;
    marker.position.set(0, 0.2, -0.35);
    marker.isPickable = false;

    // `last` is seeded with the spawn snapshot; `applySnapshot` is called so
    // the mesh is positioned/rotated to it (it is NOT a no-op here because
    // `last` was just written, so the write goes through).
    const entry: RemotePlayerMesh = {
      mesh,
      marker,
      material,
      markerMaterial,
      last: snapshot,
    };
    this.meshes.set(playerId, entry);
    // Initial placement must always write (the no-op guard below would skip it
    // because `last` already equals the spawn snapshot).
    this.write(entry, snapshot);
  }

  /** Unconditional position/rotate write for a tracked remote. */
  private write(entry: RemotePlayerMesh, snapshot: RemotePlayerView): void {
    // Authoritative position is the capsule-centre (world X/Z, Y up).
    entry.mesh.position.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
    // Yaw convention matches the local player: `rotation.y` in radians, yaw 0
    // faces -Z, positive yaw rotates toward +X.
    entry.mesh.rotation.y = snapshot.yaw;
  }

  /**
   * Place/rotate a tracked remote at its authoritative snapshot. Skips the
   * transform write entirely when the snapshot is unchanged (a repeated
   * identical snapshot is a no-op).
   */
  private applySnapshot(playerId: string, snapshot: RemotePlayerView): void {
    const entry = this.meshes.get(playerId);
    if (!entry) {
      return;
    }
    // A repeated identical snapshot is a no-op (no redundant transform write).
    if (isSameSnapshot(entry.last, snapshot)) {
      return;
    }
    entry.last = snapshot;
    this.write(entry, snapshot);
  }

  /** Dispose a single tracked remote (mesh + marker + both materials). */
  private removeRemote(playerId: string): void {
    const entry = this.meshes.get(playerId);
    if (!entry) {
      return;
    }
    this.disposeEntry(entry);
    this.meshes.delete(playerId);
  }

  /** Tear down one remote's meshes and materials. */
  private disposeEntry(entry: RemotePlayerMesh): void {
    entry.marker.dispose();
    entry.mesh.dispose();
    entry.material.dispose();
    entry.markerMaterial.dispose();
  }
}

/**
 * Structural equality on the two presentation fields only. `snapshot.position`
 * is a plain `{x,y,z}` object, so we compare component-wise.
 */
function isSameSnapshot(a: RemotePlayerView, b: RemotePlayerView): boolean {
  return (
    a.yaw === b.yaw &&
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    a.position.z === b.position.z
  );
}
