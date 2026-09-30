import { Color3, MeshBuilder, Scene, StandardMaterial, type AbstractMesh } from "@babylonjs/core";
import { PLAYER_COLLIDER, PLAYER_COLLIDER_TOTAL_HEIGHT } from "@buildshift/game-config";

import type { PlayerSnapshotMap } from "../../network/colyseus/playerSnapshot";
import { RemoteInterpolationRegistry } from "./remoteInterpolationRegistry";
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
 *
 * The per-remote interpolation buffer is NOT stored here — it lives in the
 * manager's {@link RemoteInterpolationRegistry}, keyed by the same `playerId`,
 * so the mesh set and the interpolation history stay in lockstep but have a
 * single, pure, testable source of truth for the history.
 */
interface RemotePlayerMesh {
  mesh: AbstractMesh;
  marker: AbstractMesh;
  /** Capsule material. */
  material: StandardMaterial;
  /** Forward-marker material (disposed separately — mesh.dispose() doesn't dispose materials). */
  markerMaterial: StandardMaterial;
}

/**
 * Presentation-only lifecycle manager for REMOTE player meshes.
 *
 * It owns one Babylon capsule per remote player (plus a matching
 * {@link RemoteInterpolationBuffer}), keyed by `playerId`, and
 * creates/updates/removes them in response to the authoritative snapshot map
 * from the existing `FoundationNetwork` (`NetworkUiState.players`). It is
 * driven exclusively by {@link reconcileRemotePlayers}, which decides the
 * create/update/remove set — keeping the decision logic pure and node-testable
 * while this class owns only the Babylon side-effects and the per-remote
 * interpolation history.
 *
 * Presentation is INTERPOLATION, not snapping: each network snapshot is
 * appended to that remote's buffer (with a client-local monotonic receive
 * timestamp); the mesh transform is driven only by {@link render}, which
 * samples every buffer at `now - REMOTE_INTERPOLATION_DELAY_MS`. A snapshot is
 * NEVER applied to the mesh the instant it arrives, and a later identical
 * snapshot is still buffered (its new receive timestamp is useful history).
 *
 * Deliberate non-goals:
 *  - The LOCAL player is NEVER rendered here; it stays driven by
 *    `PlayerController` prediction/reconciliation. The local session id is
 *    excluded from every operation. The interpolation buffers NEVER feed back
 *    into prediction/reconciliation.
 *  - No physics bodies, no `PlayerController`, no prediction, no
 *    extrapolation, no adaptive delay (the delay is a fixed
 *    `REMOTE_INTERPOLATION_DELAY_MS`).
 *  - Disposal is idempotent and tears down every owned mesh, material, and
 *    interpolation buffer.
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
  /**
   * Per-remote interpolation history, keyed by the same playerId as
   * {@link meshes}. Pure and Babylon-free so the wiring contract is
   * node-testable; the Babylon meshes are its mirror.
   */
  private readonly interpolation = new RemoteInterpolationRegistry();
  private disposed = false;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /**
   * Reconcile the live remote-mesh set against the authoritative snapshot map
   * and append each snapshot to that remote's interpolation buffer.
   *
   * `players` is the `NetworkUiState.players` root (playerId → validated
   * snapshot). `localSessionId` is the current local session (the key that is
   * NEVER rendered as a remote player). `receivedAtMs` is the ONE client-local
   * monotonic receive time (`performance.now()`) captured by the caller at the
   * moment this network-state update was observed; it is shared by every
   * snapshot in this call and is the ONLY input to the interpolation clock.
   *
   * Calling this on every network-state emit keeps both the mesh set and the
   * interpolation history in sync: new players get a mesh + a fresh buffer
   * seeded with their spawn snapshot, moved players get the new snapshot
   * APPENDED (not snapped to), and departed players (including a cleared/empty
   * map on disconnect) lose both their mesh and their buffer.
   *
   * This does NOT move any mesh. Presentation is driven by {@link render},
   * which samples the buffers at `now - REMOTE_INTERPOLATION_DELAY_MS`.
   */
  sync(
    players: Readonly<PlayerSnapshotMap>,
    localSessionId: string | null,
    receivedAtMs: number,
  ): void {
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
      this.createRemote(op.playerId, op.snapshot, receivedAtMs);
    }
    for (const op of ops.updates) {
      this.appendRemoteSample(op.playerId, op.snapshot, receivedAtMs);
    }
    for (const op of ops.removals) {
      this.removeRemote(op.playerId);
    }
  }

  /**
   * Drive every remote mesh to its interpolated presentation at the current
   * "now" clock. Call once per render frame, before `scene.render()`, with
   * `nowMs = performance.now()`.
   *
   * Each remote's buffer is sampled at `nowMs - REMOTE_INTERPOLATION_DELAY_MS`
   * and, when a sample exists, the capsule position + yaw are written to it.
   * The mesh transform is therefore ALWAYS held back by the fixed delay — the
   * newest packet is never shown immediately. This method never mutates the
   * authoritative network data or the interpolation history; it only reads the
   * buffers and writes the meshes.
   */
  render(nowMs: number): void {
    if (this.disposed) {
      return;
    }
    const sampled = this.interpolation.sampleAll(nowMs);
    for (const [playerId, sample] of Object.entries(sampled)) {
      this.write(playerId, sample.position, sample.yaw);
    }
  }

  /**
   * Dispose every owned remote mesh, material, and interpolation buffer and
   * clear tracking. Idempotent: safe to call more than once (a second call is
   * a no-op).
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
    this.interpolation.clear();
  }

  /**
   * Create a fresh remote capsule for `playerId` and seed its interpolation
   * buffer with the spawn snapshot.
   *
   * The mesh is placed immediately at the spawn snapshot so a newly joined
   * remote appears on the very next frame even though it has only one sample
   * (the buffer returns that single sample until the next one arrives). The
   * buffer is a fresh, empty registry entry before seeding — a rejoin after a
   * prior drop never reuses stale history.
   */
  private createRemote(
    playerId: string,
    snapshot: RemotePlayerView,
    receivedAtMs: number,
  ): void {
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

    const entry: RemotePlayerMesh = {
      mesh,
      marker,
      material,
      markerMaterial,
    };
    this.meshes.set(playerId, entry);
    // Seed the fresh buffer with the spawn snapshot (receive time stamped) and
    // place the mesh at it immediately so the remote is visible next frame.
    this.interpolation.appendSample(playerId, {
      position: snapshot.position,
      yaw: snapshot.yaw,
      receivedAtMs,
    });
    this.write(playerId, snapshot.position, snapshot.yaw);
  }

  /**
   * Append a tracked remote's new authoritative snapshot to its interpolation
   * buffer. This is the update path: the sample is buffered (with its new
   * receive timestamp) but the mesh is NOT snapped to it — presentation is
   * deferred to {@link render}.
   *
   * A snapshot identical in position/yaw to the previous one is still
   * appended: it carries a fresh receive timestamp and is useful
   * interpolation history, so there is deliberately NO identical-snapshot
   * skip here (the Stage 2D-1 transform-write cache is gone).
   */
  private appendRemoteSample(
    playerId: string,
    snapshot: RemotePlayerView,
    receivedAtMs: number,
  ): void {
    if (!this.meshes.has(playerId)) {
      return;
    }
    this.interpolation.appendSample(playerId, {
      position: snapshot.position,
      yaw: snapshot.yaw,
      receivedAtMs,
    });
  }

  /** Unconditional position/rotate write for a tracked remote. */
  private write(
    playerId: string,
    position: { x: number; y: number; z: number },
    yaw: number,
  ): void {
    const entry = this.meshes.get(playerId);
    if (!entry) {
      return;
    }
    // Authoritative position is the capsule-centre (world X/Z, Y up).
    entry.mesh.position.set(position.x, position.y, position.z);
    // Yaw convention matches the local player: `rotation.y` in radians, yaw 0
    // faces -Z, positive yaw rotates toward +X.
    entry.mesh.rotation.y = yaw;
  }

  /** Dispose a single tracked remote (mesh + marker + materials + buffer). */
  private removeRemote(playerId: string): void {
    const entry = this.meshes.get(playerId);
    if (!entry) {
      return;
    }
    this.disposeEntry(entry);
    this.meshes.delete(playerId);
    this.interpolation.drop(playerId);
  }

  /** Tear down one remote's meshes and materials. */
  private disposeEntry(entry: RemotePlayerMesh): void {
    entry.marker.dispose();
    entry.mesh.dispose();
    entry.material.dispose();
    entry.markerMaterial.dispose();
  }
}
