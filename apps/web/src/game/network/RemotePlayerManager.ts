/**
 * RemotePlayerManager — presentation-only renderer for REMOTE players in the
 * combat milestone.
 *
 * Given the authoritative {@link RoomStateSchemaInstance}, it ensures one
 * simple Babylon mesh per remote player (any player that is NOT the local
 * client), placed at the player's authoritative position and yaw. Meshes for
 * players that are no longer in the state are disposed, and a player whose
 * `alive` flag is `false` has its mesh scaled down so the eliminated state is
 * visible without destroying the mesh (it re-expands if the server ever
 * revives them).
 *
 * The LOCAL player is NEVER rendered here — it stays driven by the local
 * `PlayerController` / prediction loop. The local client id is excluded from
 * every operation.
 *
 * Deliberately minimal for the first playable milestone: one capsule per
 * remote player, snap-placed directly from the authoritative state (no
 * interpolation, no physics, no prediction).
 */
import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  type AbstractMesh,
  type Scene,
} from "@babylonjs/core";
import type {
  PlayerStateSchemaInstance,
  RoomStateSchemaInstance,
} from "@buildshift/protocol";

/**
 * Cool cyan — distinct from the local player's green so local vs. remote is
 * immediately legible (matches the existing remote-player colour convention).
 */
const REMOTE_DIFFUSE = new Color3(0.2, 0.62, 0.95);
const REMOTE_EMISSIVE = new Color3(0.0, 0.1, 0.2);

/** Full scale while a player is alive. */
const ALIVE_SCALE = 1;
/** Scaled-down (nearly collapsed) scale once a player is eliminated. */
const DEAD_SCALE = 0.15;

/**
 * Presentation-only lifecycle manager for REMOTE player meshes in the combat
 * milestone.
 *
 * Owns one Babylon mesh per remote player, keyed by Colyseus `clientId`
 * (session id), and creates / updates / removes them in response to
 * {@link update} calls driven by the synced {@link RoomStateSchema}.
 */
export class RemotePlayerManager {
  /** Live remote meshes, keyed by clientId. Empty after {@link dispose}. */
  private readonly meshes = new Map<string, AbstractMesh>();
  private readonly materials = new Map<string, StandardMaterial>();
  private disposed = false;

  /**
   * Reconcile the live remote-mesh set against the authoritative room state.
   *
   * For every player in `state.players` that is NOT `localClientId`, ensure a
   * mesh exists at the player's authoritative position and yaw. Meshes whose
   * clientId is no longer present in the state are disposed. A player whose
   * `alive` is `false` is scaled down.
   *
   * @param state     the synced authoritative {@link RoomStateSchemaInstance}.
   * @param scene     the Babylon scene to create/update meshes in.
   * @param localClientId the local client id, excluded from remote rendering.
   */
  public update(
    state: RoomStateSchemaInstance,
    scene: Scene,
    localClientId: string,
  ): void {
    if (this.disposed) {
      return;
    }

    const present = new Set<string>();

    for (const [clientId, player] of iteratePlayers(state.players)) {
      // Never render the local player as a remote.
      if (clientId === localClientId) {
        continue;
      }
      if (!player || typeof player !== "object") {
        continue;
      }
      present.add(clientId);
      this.ensureMesh(clientId, player, scene);
    }

    // Remove meshes whose owner is no longer in the authoritative state.
    for (const [clientId, mesh] of this.meshes) {
      if (!present.has(clientId)) {
        this.disposeRemote(clientId);
      }
    }
  }

  /**
   * Dispose every owned remote mesh + material and clear tracking. Idempotent:
   * safe to call more than once (a second call is a no-op).
   */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const clientId of this.meshes.keys()) {
      this.disposeRemote(clientId);
    }
  }

  /**
   * Ensure a mesh exists for `clientId` and place/rotate/scale it to the
   * player's authoritative transform + liveness.
   */
  private ensureMesh(
    clientId: string,
    player: PlayerStateSchemaInstance,
    scene: Scene,
  ): void {
    let mesh = this.meshes.get(clientId);
    if (!mesh || mesh.isDisposed()) {
      const material = new StandardMaterial(
        `combat-remote-${clientId}-material`,
        scene,
      );
      material.diffuseColor = REMOTE_DIFFUSE;
      material.emissiveColor = REMOTE_EMISSIVE;
      this.materials.set(clientId, material);

      mesh = MeshBuilder.CreateCapsule(
        `combat-remote-${clientId}`,
        { height: 1.8, radius: 0.35, tessellation: 16 },
        scene,
      );
      mesh.material = material;
      this.meshes.set(clientId, mesh);
    }

    // Authoritative position is the capsule centre (world X/Z, Y up).
    mesh.position.set(player.x, player.y, player.z);
    // Yaw convention matches the local player: `rotation.y` in radians, yaw 0
    // faces -Z, positive yaw rotates toward +X.
    mesh.rotation.y = player.yaw;

    // Eliminated players are scaled down (visible "downed" hint); alive players
    // are full scale.
    const scale = player.alive ? ALIVE_SCALE : DEAD_SCALE;
    mesh.scaling.set(scale, scale, scale);
    // Keep the mesh pickable off — remote combat meshes are not interactive.
    mesh.isPickable = false;
  }

  /** Dispose one remote player's mesh + material and drop tracking. */
  private disposeRemote(clientId: string): void {
    const mesh = this.meshes.get(clientId);
    if (mesh && !mesh.isDisposed()) {
      mesh.dispose();
    }
    this.meshes.delete(clientId);

    const material = this.materials.get(clientId);
    if (material && !material.isDisposed()) {
      material.dispose();
    }
    this.materials.delete(clientId);
  }
}

/**
 * Iterate the authoritative `state.players` map, yielding `[clientId, player]`
 * pairs. The real wire shape is a Colyseus `MapSchema` (iterable as
 * `[key, value]` pairs); this helper also tolerates a plain keyed object so a
 * shape drift (or a test double) never crashes the renderer.
 */
function* iteratePlayers(
  players: unknown,
): Generator<[string, PlayerStateSchemaInstance]> {
  if (players == null) {
    return;
  }

  // MapSchema / Map: iterable of [key, value] pairs.
  if (
    typeof (players as { [Symbol.iterator]?: unknown })[Symbol.iterator] ===
    "function"
  ) {
    for (const item of players as Iterable<unknown>) {
      if (Array.isArray(item) && item.length >= 2) {
        yield [String(item[0]), item[1] as PlayerStateSchemaInstance];
      }
    }
    return;
  }

  // Plain keyed object fallback.
  if (typeof players === "object") {
    for (const key of Object.keys(players)) {
      yield [
        key,
        (players as Record<string, PlayerStateSchemaInstance>)[key],
      ];
    }
  }
}
