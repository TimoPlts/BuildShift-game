import {
  Collider,
  ColliderDesc,
  RigidBody,
  RigidBodyDesc,
  World,
  init,
} from "@dimforge/rapier3d-compat";
import { PLAYER_PHYSICS } from "@buildshift/game-config";
import { ARENA, PLAYER_SPAWN } from "../scene/arena";

/**
 * The `@dimforge/rapier3d-compat` build loads its WASM asynchronously and must
 * be initialised before any Rapier API is used. We cache the init promise so
 * every `PhysicsWorld.create()` in the same page shares a single WASM load.
 */
let rapierInitPromise: Promise<void> | null = null;
function ensureRapierReady(): Promise<void> {
  if (!rapierInitPromise) {
    rapierInitPromise = init();
  }
  return rapierInitPromise;
}

/**
 * Total height of the character collider, matching the visible capsule.
 *
 * A Rapier capsule's total height is `2 * (halfHeight + radius)` (a cylinder of
 * half-length `halfHeight` with a hemispherical cap of `radius` on each end).
 * Solving `2 * (halfHeight + 0.35) = 1.8` gives `halfHeight = 0.55`, so the
 * physical capsule is exactly 1.8 m tall with the same radius as the mesh.
 */
export const CHARACTER_RADIUS = 0.35;
export const CHARACTER_HALF_HEIGHT = 0.55;
/** Half the total collider height — used to convert body-centre to feet. */
export const CHARACTER_HEIGHT_OVER_2 = 0.9;

/**
 * The character-controller contact offset. A small non-zero gap keeps the
 * capsule from sitting exactly on a collider's face, which avoids precision /
 * contact jitter. 0.02 m is invisible but stable.
 */
const CHARACTER_CONTROLLER_OFFSET = 0.02;

/** Fixed physics timestep (seconds) — 60 Hz. */
export const FIXED_DT = 1 / 60;

export interface Translation3 {
  x: number;
  y: number;
  z: number;
}

/**
 * The local Rapier physics layer. This is the collision/physics authority for
 * the single local player; Babylon is only the visual presentation that copies
 * the resulting position (see docs/TECHNICAL_ARCHITECTURE.md §26).
 *
 * It owns:
 * - the Rapier `World` (gravity, fixed timestep)
 * - the static arena colliders (built from the shared `ARENA` table)
 * - the kinematic character body + capsule collider + character controller
 * - physics cleanup
 *
 * It is deliberately low-level: it knows how to move a collider by a desired
 * translation and report whether the result was collision-corrected and
 * grounded. It does NOT decide *what* the player wants to move — that stays in
 * the shared movement math driven by `PlayerController`.
 */
export class PhysicsWorld {
  private readonly world: World;
  private readonly characterBody: RigidBody;
  private readonly characterCollider: Collider;
  private readonly controller: ReturnType<World["createCharacterController"]>;
  private readonly scratch = { x: 0, y: 0, z: 0 };
  private disposed = false;

  /**
   * Creates a fully-initialised physics world. The constructor is not public
   * because the compat build must finish loading its WASM (an async step)
   * before the Rapier `World` can be constructed.
   */
  public static async create(): Promise<PhysicsWorld> {
    await ensureRapierReady();
    return new PhysicsWorld();
  }

  private constructor() {
    this.world = new World({ x: 0, y: PLAYER_PHYSICS.gravity, z: 0 });
    this.world.timestep = FIXED_DT;

    // Static arena colliders — one fixed body per cuboid, collider parented to
    // it so the collider's transform is the arena object's transform.
    for (const object of ARENA) {
      const body = this.world.createRigidBody(RigidBodyDesc.fixed());
      const { position, halfExtents } = object.collider;
      const colliderDesc = ColliderDesc.cuboid(
        halfExtents[0],
        halfExtents[1],
        halfExtents[2],
      );
      colliderDesc.setTranslation(position[0], position[1], position[2]);
      this.world.createCollider(colliderDesc, body);
    }

    // Kinematic character: a position-based body whose translation we drive
    // directly through the character controller each fixed step.
    this.characterBody = this.world.createRigidBody(
      RigidBodyDesc.kinematicPositionBased(),
    );
    this.characterBody.setTranslation(
      {
        x: PLAYER_SPAWN.x,
        y: PLAYER_SPAWN.y,
        z: PLAYER_SPAWN.z,
      },
      true,
    );

    const colliderDesc = ColliderDesc.capsule(
      CHARACTER_HALF_HEIGHT,
      CHARACTER_RADIUS,
    );
    this.characterCollider = this.world.createCollider(
      colliderDesc,
      this.characterBody,
    );

    // Built-in kinematic character controller: handles wall collision, sliding
    // and ground contact for us instead of hand-rolled collision code.
    this.controller = this.world.createCharacterController(
      CHARACTER_CONTROLLER_OFFSET,
    );
    // Disable auto-step: the arena has no stairs to climb, and auto-step can
    // fight jump correctness (see Stage 1D notes).
    this.controller.disableAutostep();
    // A small ground snap keeps the character stable over tiny height
    // transitions without pulling a jumping character back down (0.1 m is well
    // below the jump height).
    this.controller.enableSnapToGround(0.1);
  }

  /**
   * Advances the character by `desiredTranslation` (a world-space delta for one
   * fixed step) against the static arena. The character controller returns the
   * collision-corrected translation, which is applied to the body.
   *
   * Returns whether the character is grounded after the step (from the
   * character controller's ground detection).
   */
  public step(desiredTranslation: Readonly<Translation3>): boolean {
    if (this.disposed) {
      return false;
    }

    this.scratch.x = desiredTranslation.x;
    this.scratch.y = desiredTranslation.y;
    this.scratch.z = desiredTranslation.z;

    this.controller.computeColliderMovement(
      this.characterCollider,
      this.scratch,
    );
    const movement = this.controller.computedMovement();
    const current = this.characterBody.translation();
    this.characterBody.setTranslation(
      {
        x: current.x + movement.x,
        y: current.y + movement.y,
        z: current.z + movement.z,
      },
      true,
    );
    const grounded = this.controller.computedGrounded();

    // Propagate the kinematic body's new translation to its collider and run
    // the (fixed + kinematic only) simulation step so the next frame's
    // collision query sees the updated collider position.
    this.world.step();

    return grounded;
  }

  /** The character body's current world position (capsule centre). */
  public getPosition(): Translation3 {
    const t = this.characterBody.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    // Removing the controller and then freeing the world also frees the
    // character body + collider and all static colliders.
    this.world.removeCharacterController(this.controller);
    this.world.free();
    this.disposed = true;
  }
}
