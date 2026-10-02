/**
 * Server-authoritative combat room with hitscan damage.
 *
 * Two players in a Colyseus room can aim and fire a hitscan weapon.
 * The server validates inputs, performs hitscan hit detection, and applies
 * damage authoritatively.
 *
 * Authority contract:
 *  - Clients send ONLY a `PlayerInput` intent (movement + aim + fire);
 *  - The server owns every player's position, yaw, health, and alive state;
 *  - Hitscan detection uses `rayIntersectsCapsule` from `@buildshift/simulation`;
 *  - Damage values come from `@buildshift/game-config` (`WEAPONS`, `PLAYER`).
 *
 * State model:
 *  - The room's state is a `RoomStateSchema` (a `MapSchema` of
 *    `PlayerStateSchema` keyed by Colyseus `sessionId`).
 *  - Colyseus automatically broadcasts incremental patches to all clients.
 */
import { Room, type Client, type StepContext } from "@colyseus/core";

import {
  RoomStateSchema,
  PlayerStateSchema,
  type RoomStateSchemaInstance,
  type PlayerInput,
  EVENTS,
  type HitEventPayload,
} from "@buildshift/protocol";
import {
  rayIntersectsCapsule,
  type Vec3,
} from "@buildshift/simulation";
import { WEAPONS, PLAYER } from "@buildshift/game-config";

/** Log prefix. */
const LOG = "[buildshift:combat]";

/**
 * The stable room name registered by the server.
 */
export const COMBAT_ROOM = "combat";

/**
 * Inbound message type carrying a single player input frame.
 */
const INPUT_MESSAGE = "input";

/**
 * Inbound message payload shape: `{ clientId: string, input: PlayerInput }`.
 */
interface InputMessage {
  clientId: string;
  input: PlayerInput;
}

/** Eye height offset above the player's stored position (metres). */
const EYE_HEIGHT = 1.5;

/** Target hitbox radius (metres). */
const TARGET_RADIUS = 0.5;

/** Player movement speed (metres per second) for the combat room. */
const MOVE_SPEED = 5;

/**
 * Spawn positions for the two players.
 * Player 0 (first to join): x = -5, z = 0, y = 0.
 * Player 1 (second to join): x = +5, z = 0, y = 0.
 */
const SPAWN_POSITIONS: ReadonlyArray<{ x: number; y: number; z: number }> = [
  { x: -5, y: 0, z: 0 },
  { x: 5, y: 0, z: 0 },
];

/**
 * The authoritative combat room.
 *
 * Extends Colyseus' `Room` with `RoomStateSchema` as the state type so the
 * `players` map is synchronised to every client automatically.
 */
export class CombatRoom extends Room<{
  state: RoomStateSchemaInstance;
}> {
  /**
   * The synchronized room state (a `players` map keyed by client `sessionId`).
   * Populated in `onJoin`, emptied in `onLeave`; Colyseus patches it to clients.
   */
  state = new RoomStateSchema();

  /**
   * Room capacity: this milestone is exactly two players.
   */
  maxPlayers = 2;

  /**
   * Tracks the last fire time per client `sessionId` (epoch milliseconds).
   * Used to enforce the weapon fire cooldown.
   */
  private readonly lastFireTime = new Map<string, number>();

  /**
   * Tracks how many players have joined (for spawn slot assignment).
   */
  private joinCount = 0;

  /**
   * Invoked by the matchmaker once, after the room is instantiated and before
   * any client joins. Wires the inbound message handler and the fixed
   * timestep tick hook.
   */
  onCreate(): void {
    console.log(`${LOG} room created (roomId=${this.roomId})`);

    this.onMessage(INPUT_MESSAGE, (client, message) => {
      this.handleInput(client, message);
    });

    // Keep the tick hook for future periodic work (e.g. regenerating health,
    // respawning, match timer). Not strictly needed this milestone but kept
    // as the authoritative fixed-timestep callback.
    this.setFixedTimestep((ctx: StepContext) => {
      this.tick(ctx);
    }, 30);
  }

  /**
   * Periodic tick callback (30 Hz). Not strictly needed this milestone but
   * kept as the hook for future periodic work (match timer, health regen,
   * respawn logic, etc.).
   */
  private tick(_ctx: StepContext): void {
    // Intentionally empty for this milestone.
  }

  /**
   * A new client joined: create its authoritative player entry at the
   * assigned spawn point and register it in the synchronized map.
   */
  onJoin(client: Client): void {
    // Assign spawn slot based on join order (0 -> x=-5, 1 -> x=+5).
    const slotIndex = this.joinCount % SPAWN_POSITIONS.length;
    const spawn = SPAWN_POSITIONS[slotIndex];
    this.joinCount++;

    const player = new PlayerStateSchema();
    player.x = spawn.x;
    player.y = spawn.y;
    player.z = spawn.z;
    player.yaw = 0;
    player.velocityY = 0;
    player.grounded = true;
    player.lastProcessedSequence = -1;
    player.health = PLAYER.maxHealth;
    player.alive = true;

    this.state.players.set(client.sessionId, player);
    this.lastFireTime.set(client.sessionId, 0);

    console.log(
      `${LOG} client joined (sessionId=${client.sessionId}, slot=${slotIndex}, x=${spawn.x}, clients=${this.clients.length})`,
    );
  }

  /**
   * A client left: remove its player from the synchronized map and drop its
   * fire cooldown tracking.
   */
  onLeave(client: Client, code?: number): void {
    this.state.players.delete(client.sessionId);
    this.lastFireTime.delete(client.sessionId);

    console.log(
      `${LOG} client left (sessionId=${client.sessionId}, code=${code ?? "n/a"}, clients=${this.clients.length})`,
    );
  }

  /**
   * The room is being disposed (all clients left / server shutting down):
   * Clear internal tracking maps to prevent leaks.
   */
  onDispose(): void {
    this.lastFireTime.clear();
    console.log(`${LOG} room disposed (roomId=${this.roomId})`);
  }

  /**
   * Handle one inbound input message.
   *
   * The message is expected to be `{ clientId: string, input: PlayerInput }`.
   * The server validates, applies movement, and processes fire intent
   * authoritatively.
   */
  private handleInput(client: Client, message: unknown): void {
    // Parse the message structure.
    if (message === null || message === undefined || typeof message !== "object") {
      console.warn(`${LOG} malformed input message from ${client.sessionId}; ignored`);
      return;
    }

    const msg = message as Partial<InputMessage>;

    // The clientId in the message should match the connecting client's
    // sessionId. We use the client's sessionId as the authoritative identity.
    const sessionId = client.sessionId;

    // Parse the PlayerInput from the message.
    const rawInput = msg.input;
    if (rawInput === null || rawInput === undefined || typeof rawInput !== "object") {
      console.warn(`${LOG} missing input payload from ${sessionId}; ignored`);
      return;
    }

    const input: PlayerInput = {
      sequence: typeof rawInput.sequence === "number" ? rawInput.sequence : 0,
      moveX: typeof rawInput.moveX === "number" ? rawInput.moveX : 0,
      moveZ: typeof rawInput.moveZ === "number" ? rawInput.moveZ : 0,
      lookYaw: typeof rawInput.lookYaw === "number" ? rawInput.lookYaw : 0,
      lookPitch: typeof rawInput.lookPitch === "number" ? rawInput.lookPitch : 0,
      jump: rawInput.jump === true,
      primaryFire: rawInput.primaryFire === true,
    };

    // Look up the player by sessionId.
    const player = this.state.players.get(sessionId);
    if (!player) {
      console.warn(`${LOG} input from ${sessionId} with no player entry; ignored`);
      return;
    }

    // If not alive, ignore all input.
    if (!player.alive) {
      return;
    }

    // ─── Movement ───────────────────────────────────────────────────────────
    // Convert local movement (moveX, moveZ) plus current yaw into world
    // direction and update position.
    const yaw = player.yaw;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);

    // Local axes in world space:
    //   forward (local -Z) -> (sin(yaw), 0, -cos(yaw))
    //   right   (local +X) -> (cos(yaw), 0, sin(yaw))
    // moveZ > 0 means moving forward (local -Z), moveX > 0 means moving right.
    const worldDirX = cosYaw * input.moveX + sinYaw * input.moveZ;
    const worldDirZ = sinYaw * input.moveX - cosYaw * input.moveZ;

    // Compute displacement (clamped to unit vector magnitude * speed * dt).
    // For this milestone we assume a fixed step of ~1 tick (33ms) for
    // simplicity; in practice the input arrives per-frame from the client.
    const dt = 0.033; // ~30 Hz
    const len = Math.sqrt(worldDirX * worldDirX + worldDirZ * worldDirZ);
    if (len > 0) {
      const scale = (MOVE_SPEED * dt * Math.min(len, 1)) / len;
      player.x += worldDirX * scale;
      player.z += worldDirZ * scale;
    }

    // Update yaw from input.
    player.yaw = input.lookYaw;

    // ─── Fire ───────────────────────────────────────────────────────────────
    if (input.primaryFire) {
      this.processFire(sessionId, player, input.lookYaw);
    }
  }

  /**
   * Process a fire intent from the given player.
   *
   *  1. Check fire cooldown (reject if within `WEAPONS.blaster.fireCooldownMs`).
   *  2. Compute aim direction from the player's yaw.
   *  3. For every other alive player, call `rayIntersectsCapsule`.
   *  4. If hit, apply damage, update state, and broadcast events.
   *  5. Update lastFireTime.
   */
  private processFire(
    shooterId: string,
    shooter: InstanceType<typeof PlayerStateSchema>,
    yaw: number,
  ): void {
    const weapon = WEAPONS.find((w) => w.id === "blaster")!;

    // ── Cooldown check ──
    const now = Date.now();
    const lastFire = this.lastFireTime.get(shooterId) ?? 0;
    if (now - lastFire < weapon.fireCooldownMs) {
      return; // Still in cooldown; reject.
    }

    // ── Compute aim ray ──
    // Origin: player position with eye height offset.
    const origin: Vec3 = {
      x: shooter.x,
      y: shooter.y + EYE_HEIGHT,
      z: shooter.z,
    };

    // Direction: forward from yaw (sin(yaw), 0, -cos(yaw)), unit length.
    const direction: Vec3 = {
      x: Math.sin(yaw),
      y: 0,
      z: -Math.cos(yaw),
    };

    // ── Hitscan against all other alive players ──
    let hitAny = false;

    for (const [targetId, target] of this.state.players) {
      if (targetId === shooterId) continue;
      if (!target.alive) continue;

      const targetPos: Vec3 = {
        x: target.x,
        y: target.y,
        z: target.z,
      };

      const result = rayIntersectsCapsule(
        origin,
        direction,
        targetPos,
        TARGET_RADIUS,
        weapon.range,
      );

      if (result.hit) {
        hitAny = true;

        // Apply damage authoritatively.
        const newHealth = target.health - weapon.damage;
        target.health = newHealth > 0 ? newHealth : 0;

        const eliminated = target.health <= 0;
        if (eliminated) {
          target.alive = false;
        }

        // Build the event payload.
        const payload: HitEventPayload = {
          shooterId,
          targetId,
          damage: weapon.damage,
          remainingHealth: target.health,
        };

        // Broadcast HIT event to all clients.
        this.broadcast(EVENTS.HIT, payload);

        // If the target was eliminated, also broadcast ELIMINATED.
        if (eliminated) {
          this.broadcast(EVENTS.ELIMINATED, payload);
        }

        console.log(
          `${LOG} hit: shooter=${shooterId} target=${targetId} damage=${weapon.damage} remaining=${target.health}${eliminated ? " ELIMINATED" : ""}`,
        );

        // For this milestone, one hit per shot (no multi-target piercing).
        break;
      }
    }

    // ── Update cooldown timestamp ──
    // Only update lastFireTime if the shot was actually processed (not
    // rejected by cooldown). This is the case since we returned early above.
    this.lastFireTime.set(shooterId, now);

    if (!hitAny) {
      console.log(`${LOG} shot by ${shooterId} missed (no target in range)`);
    }
  }
}
