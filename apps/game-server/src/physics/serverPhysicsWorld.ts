/**
 * Stage 2C1 — server-side authoritative physics layer.
 *
 * This is the SERVER's Rapier world, built from the exact same shared
 * `@buildshift/game-config` values the browser uses (`ARENA_COLLIDERS`,
 * `PLAYER_SPAWN`, `PLAYER_COLLIDER`, `PLAYER_CHARACTER_CONTROLLER`,
 * `PLAYER_PHYSICS`, `PHYSICS_TIMING`), so the authoritative simulation and the
 * local client prediction share one physics definition.
 *
 * Responsibilities (mirroring the browser `PhysicsWorld`, but multi-player):
 *  - own the single Rapier `World` (shared gravity + fixed timestep);
 *  - build the static arena colliders from `ARENA_COLLIDERS`;
 *  - create/dispose a kinematic character body + capsule collider + character
 *    controller per player;
 *  - resolve each player's desired translation against the arena via that
 *    player's character controller;
 *  - add/remove static collision bodies for placed structures.
 *
 * Deliberately low-level, exactly like the browser layer: it knows how to move
 * one player's collider by a desired translation and report the resulting
 * grounded state. It does NOT decide *what* a player wants to move — that is
 * the shared deterministic movement math driven by the room's authoritative
 * tick (see `rooms/TwoPlayerMovementRoom.ts`).
 *
 * Per-substep contract (docs/TECHNICAL_ARCHITECTURE.md §7.4 / task §8): the
 * caller applies EVERY player's desired movement for a substep (via
 * {@link movePlayer}, which does NOT advance the world) and then advances the
 * world exactly ONCE for that substep (via {@link step}). This guarantees one
 * player's character step never advances the whole world multiple times.
 */
import {
  ColliderDesc,
  RigidBodyDesc,
  World,
  init,
  type Collider,
  type RigidBody,
} from "@dimforge/rapier3d-compat";
import {
  ARENA_COLLIDERS,
  PLAYER_CHARACTER_CONTROLLER,
  PLAYER_COLLIDER,
  PLAYER_PHYSICS,
  PLAYER_SPAWN,
  PHYSICS_TIMING,
} from "@buildshift/game-config";

/**
 * The `@dimforge/rapier3d-compat` build loads its WASM asynchronously and must
 * be initialised before any Rapier API is used. Cache the init promise so
 * every room in this process shares a single WASM load.
 */
let rapierInitPromise: Promise<void> | null = null;
function ensureRapierReady(): Promise<void> {
  if (!rapierInitPromise) {
    rapierInitPromise = init();
  }
  return rapierInitPromise;
}

/** A plain world-space translation (metres, Y-up). */
export interface Translation3 {
  x: number;
  y: number;
  z: number;
}

/** World-space half-extents of a cuboid collider. */
export interface HalfExtents3 {
  x: number;
  y: number;
  z: number;
}

/** The per-player physics handle the room stores and drives. */
interface PlayerPhysics {
  body: RigidBody;
  collider: Collider;
  controller: ReturnType<World["createCharacterController"]>;
}

/** A static structure collision body tracked by the physics world. */
interface StructurePhysics {
  body: RigidBody;
  collider: Collider;
}

/**
 * The authoritative multi-player physics world for a single room.
 */
export class ServerPhysicsWorld {
  private readonly world: World;
  /** Per-player physics handles, keyed by player id (the session id). */
  private readonly players = new Map<string, PlayerPhysics>();
  /** Maps a player collider back to its owner so other players' character
   * movement queries can exclude it (task §8). */
  private readonly colliderOwner = new Map<Collider, string>();
  /** Per-structure static collision bodies, keyed by structure id. */
  private readonly structures = new Map<string, StructurePhysics>();
  private readonly scratch: Translation3 = { x: 0, y: 0, z: 0 };
  private disposed = false;

  /**
   * Creates a fully-initialised physics world with the static arena colliders
   * built. The constructor is not public because the compat build must finish
   * loading its WASM (an async step) before the Rapier `World` can be
   * constructed.
   */
  public static async create(): Promise<ServerPhysicsWorld> {
    await ensureRapierReady();
    return new ServerPhysicsWorld();
  }

  private constructor() {
    this.world = new World({ x: 0, y: PLAYER_PHYSICS.gravity, z: 0 });
    this.world.timestep = PHYSICS_TIMING.fixedStepDurationSeconds;

    // Static arena colliders — one fixed body per cuboid, collider parented to
    // it so the collider's transform is the arena object's transform.
    for (const collider of ARENA_COLLIDERS) {
      const body = this.world.createRigidBody(RigidBodyDesc.fixed());
      const { position, halfExtents } = collider;
      const colliderDesc = ColliderDesc.cuboid(
        halfExtents[0],
        halfExtents[1],
        halfExtents[2],
      );
      colliderDesc.setTranslation(position[0], position[1], position[2]);
      this.world.createCollider(colliderDesc, body);
    }
  }

  /**
   * Creates a player's kinematic character at `spawn` (defaults to the shared
   * `PLAYER_SPAWN` when omitted).
   *
   * No-op if a physics handle already exists for `playerId` (defensive against
   * a double-join on the same session).
   */
  public createPlayer(playerId: string, spawn?: Translation3): void {
    if (this.disposed || this.players.has(playerId)) {
      return;
    }

    const s =
      spawn ?? { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y, z: PLAYER_SPAWN.z };

    const body = this.world.createRigidBody(
      RigidBodyDesc.kinematicPositionBased(),
    );
    body.setTranslation({ x: s.x, y: s.y, z: s.z }, true);

    const colliderDesc = ColliderDesc.capsule(
      PLAYER_COLLIDER.halfHeight,
      PLAYER_COLLIDER.radius,
    );
    const collider = this.world.createCollider(colliderDesc, body);

    const controller = this.world.createCharacterController(
      PLAYER_CHARACTER_CONTROLLER.contactOffset,
    );
    // Auto-step is shared gameplay tuning; the arena has no stairs to climb
    // and auto-step can fight jump correctness, so mirror the browser's choice.
    if (!PLAYER_CHARACTER_CONTROLLER.autostepEnabled) {
      controller.disableAutostep();
    }
    // A small ground snap keeps the character stable over tiny height
    // transitions without pulling a jumping character back down.
    controller.enableSnapToGround(PLAYER_CHARACTER_CONTROLLER.snapToGround);

    this.players.set(playerId, { body, collider, controller });
    this.colliderOwner.set(collider, playerId);
  }

  /**
   * Resolves `desiredTranslation` (a world-space delta for ONE physics
   * substep) for the given player against the arena, applying the
   * collision-corrected movement to that player's body.
   *
   * Other players' colliders are excluded from this player's character
   * movement queries (task §8 — player-vs-player collision is intentionally
   * not required in this stage), while the static arena still collides.
   *
   * Does NOT advance the world — the caller advances it ONCE per substep after
   * every player has moved. Returns whether the player is grounded after the
   * resolved movement.
   */
  public movePlayer(playerId: string, desiredTranslation: Readonly<Translation3>): boolean {
    if (this.disposed) {
      return false;
    }
    const player = this.players.get(playerId);
    if (!player) {
      return false;
    }

    this.scratch.x = desiredTranslation.x;
    this.scratch.y = desiredTranslation.y;
    this.scratch.z = desiredTranslation.z;

    // Exclude colliders owned by any other player; keep the arena (unowned)
    // and this player's own collider.
    player.controller.computeColliderMovement(
      player.collider,
      this.scratch,
      undefined,
      undefined,
      (collider) => {
        const owner = this.colliderOwner.get(collider);
        return owner === undefined || owner === playerId;
      },
    );
    const movement = player.controller.computedMovement();
    const current = player.body.translation();
    player.body.setTranslation(
      {
        x: current.x + movement.x,
        y: current.y + movement.y,
        z: current.z + movement.z,
      },
      true,
    );
    return player.controller.computedGrounded();
  }

  /**
   * Advances the Rapier world exactly ONCE for the current fixed timestep.
   * The room calls this once per substep, after applying every player's
   * desired movement for that substep.
   */
  public step(): void {
    if (this.disposed) {
      return;
    }
    this.world.step();
  }

  /** The player's current world position (capsule centre), metres Y-up. */
  public getPosition(playerId: string): Translation3 {
    const player = this.players.get(playerId);
    if (!player) {
      return { x: 0, y: 0, z: 0 };
    }
    const t = player.body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  // ─── Structure collision bodies ──────────────────────────────────────────────

  /**
   * Adds a static collision body for a placed structure. The collider is a
   * cuboid centered at `center` with the given `halfExtents` (metres).
   *
   * No-op if a structure body already exists for `structureId`.
   */
  public addStructureCollider(
    structureId: string,
    center: Readonly<Translation3>,
    halfExtents: Readonly<HalfExtents3>,
  ): void {
    if (this.disposed || this.structures.has(structureId)) {
      return;
    }

    const body = this.world.createRigidBody(RigidBodyDesc.fixed());
    body.setTranslation({ x: center.x, y: center.y, z: center.z }, true);

    const colliderDesc = ColliderDesc.cuboid(
      halfExtents.x,
      halfExtents.y,
      halfExtents.z,
    );
    const collider = this.world.createCollider(colliderDesc, body);

    this.structures.set(structureId, { body, collider });
  }

  /**
   * Removes a structure's collision body from the physics world.
   * Idempotent and safe to call after {@link dispose}.
   */
  public removeStructureCollider(structureId: string): void {
    const structure = this.structures.get(structureId);
    if (!structure) {
      return;
    }
    if (!this.disposed) {
      this.world.removeRigidBody(structure.body);
    }
    this.structures.delete(structureId);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Removes a player's physics handle (controller, body, and its collider).
   * Idempotent and safe to call after {@link dispose}.
   */
  public disposePlayer(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) {
      return;
    }
    if (!this.disposed) {
      this.world.removeCharacterController(player.controller);
      // Removing the body also frees its parented collider.
      this.world.removeRigidBody(player.body);
    }
    this.players.delete(playerId);
    this.colliderOwner.delete(player.collider);
  }

  /**
   * Frees the whole world (and any remaining player handles and structure
   * bodies). Idempotent — safe to call from both `onDispose` and per-player
   * cleanup.
   */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    // Remove all remaining controllers before freeing the world so the WASM
    // character-controller resources are released explicitly.
    for (const player of this.players.values()) {
      this.world.removeCharacterController(player.controller);
    }
    // Remove all structure bodies.
    for (const structure of this.structures.values()) {
      this.world.removeRigidBody(structure.body);
    }
    this.world.free();
    this.players.clear();
    this.colliderOwner.clear();
    this.structures.clear();
    this.disposed = true;
  }
}
