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
  /**
   * World-space cuboids backing each structure's collision geometry, keyed by
   * structure id. This in-memory mirror of the Rapier structure colliders is
   * the authoritative source for *pure-geometry* queries (e.g. the crouch
   * stand-up obstruction check). It is deliberately decoupled from the Rapier
   * broadphase because the canonical movement room never steps its physics
   * world, so Rapier spatial queries would never see the (static) structure
   * colliders. The registry stays in lock-step with the Rapier colliders.
   */
  private readonly structureCuboids = new Map<
    string,
    Array<{ center: Translation3; halfExtents: HalfExtents3 }>
  >();
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
    this.structureCuboids.set(structureId, [
      { center: { x: center.x, y: center.y, z: center.z }, halfExtents: { x: halfExtents.x, y: halfExtents.y, z: halfExtents.z } },
    ]);
  }

  /**
   * Replaces a structure's static collision geometry with the given set of
   * world-space cuboids (one parented cuboid collider per entry on a single
   * fixed body at the origin). Used by the floor edit system to regenerate a
   * structure's collision geometry from its canonical tile edit state.
   *
   * Any existing body for `structureId` is removed first, so this is a full
   * replacement. An empty list leaves the structure with no collision body.
   * No-op when the world is disposed.
   */
  public setStructureColliders(
    structureId: string,
    cuboids: ReadonlyArray<{ center: Readonly<Translation3>; halfExtents: Readonly<HalfExtents3> }>,
  ): void {
    if (this.disposed) {
      return;
    }
    this.removeStructureCollider(structureId);
    if (cuboids.length === 0) {
      return;
    }
    const body = this.world.createRigidBody(RigidBodyDesc.fixed());
    body.setTranslation({ x: 0, y: 0, z: 0 }, true);
    for (const cuboid of cuboids) {
      const colliderDesc = ColliderDesc.cuboid(
        cuboid.halfExtents.x,
        cuboid.halfExtents.y,
        cuboid.halfExtents.z,
      );
      colliderDesc.setTranslation(cuboid.center.x, cuboid.center.y, cuboid.center.z);
      this.world.createCollider(colliderDesc, body);
    }
    this.structures.set(structureId, { body, collider: body.collider(0) });
    this.structureCuboids.set(
      structureId,
      cuboids.map((c) => ({
        center: { x: c.center.x, y: c.center.y, z: c.center.z },
        halfExtents: { x: c.halfExtents.x, y: c.halfExtents.y, z: c.halfExtents.z },
      })),
    );
  }

  /**
   * The number of colliders currently backing a structure's physics body
   * (`0` when the structure has no body). Exposed for authoritative tests.
   */
  public structureColliderCount(structureId: string): number {
    const structure = this.structures.get(structureId);
    return structure ? structure.body.numColliders() : 0;
  }

  /** The exact cuboids currently installed in Rapier, also used by the
   * canonical room's deterministic movement pass. */
  public getStructureCuboids(): Array<{ center: Translation3; halfExtents: HalfExtents3 }> {
    return [...this.structureCuboids.values()].flat();
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
    this.structureCuboids.delete(structureId);
    this.structures.delete(structureId);
  }

  // ─── Shape queries ─────────────────────────────────────────────────────────

  /**
   * Tests whether an axis-aligned capsule standing on the given feet
   * position intersects any *structure* collider.
   *
   * This is the authoritative stand-up obstruction query for crouching: the
   * caller passes the full *standing* capsule dimensions and a small
   * `liftOffset` that keeps the capsule bottom just above the surface the
   * player stands on (so the ground / floor under the player's feet is never
   * a false positive). Only structure colliders are considered — the static
   * arena (floor + perimeter walls) intentionally never obstructs
   * standing up.
   *
   * The check is a **pure-geometry** capsule-vs-cuboid overlap against the
   * in-memory structure-cuboid registry ({@link structureCuboids}). It does
   * NOT use the Rapier broadphase, so it is correct even in rooms that never
   * step their physics world (the canonical movement room drives players with
   * the pure `stepPlayerMovement` and only bookkeeps structure colliders
   * here).
   *
   * The capsule spans `[feetY + liftOffset, feetY + liftOffset + 2 * halfTotalHeight]`
   * vertically, centred on the given X/Z.
   *
   * @param x feet world X (metres).
   * @param feetY feet world Y (metres; 0 on the ground plane).
   * @param z feet world Z (metres).
   * @param halfTotalHeight half the standing capsule height (centre to feet),
   *        metres.
   * @param radius capsule radius, metres.
   * @param liftOffset vertical lift of the capsule bottom above the feet,
   *        metres (use the character-controller contact offset).
   * @returns `true` when a structure collider obstructs the capsule.
   */
  public isStructureObstructingCapsule(
    x: number,
    feetY: number,
    z: number,
    halfTotalHeight: number,
    radius: number,
    liftOffset: number,
  ): boolean {
    if (this.disposed) {
      return false;
    }
    for (const cuboids of this.structureCuboids.values()) {
      for (const c of cuboids) {
        if (
          capsuleIntersectsCuboid(
            x,
            feetY,
            z,
            halfTotalHeight,
            radius,
            liftOffset,
            c.center,
            c.halfExtents,
          )
        ) {
          return true;
        }
      }
    }
    return false;
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
    this.structureCuboids.clear();
    this.disposed = true;
  }
}

/**
 * Exact axis-aligned capsule-vs-AABB overlap test.
 *
 * The capsule is vertical, modelled as the Minkowski sum of a line segment
 * (the cylindrical axis, of half-length `halfTotalHeight - radius`, centred
 * at `feetY + liftOffset + halfTotalHeight`) and a sphere of `radius`. The
 * AABB is a structure-collision cuboid with world-space `center` and
 * `halfExtents`.
 *
 * The test reduces to: is the distance from the capsule's axis segment to the
 * AABB ≤ `radius`? Because the axis is vertical (constant X/Z), the closest
 * AABB point is found by clamping the axis's X/Z into the box's X/Z footprint
 * and the segment's Y range into the box's Y span.
 */
function capsuleIntersectsCuboid(
  x: number,
  feetY: number,
  z: number,
  halfTotalHeight: number,
  radius: number,
  liftOffset: number,
  center: { x: number; y: number; z: number },
  halfExtents: { x: number; y: number; z: number },
): boolean {
  const r2 = radius * radius;
  const x0 = center.x - halfExtents.x;
  const x1 = center.x + halfExtents.x;
  const y0 = center.y - halfExtents.y;
  const y1 = center.y + halfExtents.y;
  const z0 = center.z - halfExtents.z;
  const z1 = center.z + halfExtents.z;

  // Closest point on the box X/Z footprint to the axis (constant x, z).
  const hx = x < x0 ? x0 : x > x1 ? x1 : x;
  const hz = z < z0 ? z0 : z > z1 ? z1 : z;
  const dxz = (x - hx) * (x - hx) + (z - hz) * (z - hz);
  if (dxz > r2) {
    // Even the nearest X/Z point on the box is farther than the radius: no
    // vertical alignment can bring the capsule into the box.
    return false;
  }

  // Capsule axis segment (cylindrical core) endpoints, bottom then top.
  const hh = halfTotalHeight - radius;
  const cy = feetY + liftOffset + halfTotalHeight;
  const segBottom = cy - hh;
  const segTop = cy + hh;

  let dy: number;
  if (segTop < y0) {
    // Segment entirely below the box: closest box point is its top face.
    dy = y0 - segTop;
  } else if (segBottom > y1) {
    // Segment entirely above the box: closest box point is its bottom face.
    dy = segBottom - y1;
  } else {
    // Y ranges overlap: the axis reaches the box's vertical span, so the
    // vertical gap is zero.
    dy = 0;
  }

  return dxz + dy * dy <= r2;
}
