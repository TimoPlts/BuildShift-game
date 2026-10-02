/**
 * @deprecated Stage 2D — This legacy combat room has been RETIRED.
 *
 * The canonical, single authoritative combat path is now the
 * {@link TwoPlayerMovementRoom} (see `TwoPlayerMovementRoom.ts`), which
 * implements tick-based fire gating (`canFire`), hitscan, shield/health
 * damage, elimination, and respawn in a single 30 Hz authoritative loop.
 *
 * This file is retained ONLY so the legacy `combatRoom.test.ts` test suite
 * keeps compiling during the consolidation period. It is NO LONGER registered
 * by the production server (`server.ts`) and should be deleted in a future
 * cleanup pass.
 *
 * Key differences from the canonical path (why this was retired):
 *  - Time-based cooldown (`fireCooldownMs`, `Date.now()`) instead of
 *    tick-based (`fireIntervalTicks`, `lastFireSequence`) — incompatible
 *    with deterministic prediction/reconciliation.
 *  - No shield/energy/ammo tracking.
 *  - No respawn logic.
 *  - Separate from the movement loop (fire on input receipt, not on tick).
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
 * @deprecated No longer registered by the production server.
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
 * The authoritative combat room (LEGACY — retired).
 *
 * @deprecated Use {@link TwoPlayerMovementRoom} instead.
 */
export class CombatRoom extends Room<{
  state: RoomStateSchemaInstance;
}> {
  state = new RoomStateSchema();
  maxPlayers = 2;

  private readonly lastFireTime = new Map<string, number>();
  private joinCount = 0;

  onCreate(): void {
    console.log(`${LOG} room created (roomId=${this.roomId})`);
    this.onMessage(INPUT_MESSAGE, (client, message) => {
      this.handleInput(client, message);
    });
    this.setFixedTimestep((_ctx: StepContext) => {}, 30);
  }

  onJoin(client: Client): void {
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

  onLeave(client: Client, code?: number): void {
    this.state.players.delete(client.sessionId);
    this.lastFireTime.delete(client.sessionId);
    console.log(
      `${LOG} client left (sessionId=${client.sessionId}, code=${code ?? "n/a"}, clients=${this.clients.length})`,
    );
  }

  onDispose(): void {
    this.lastFireTime.clear();
    console.log(`${LOG} room disposed (roomId=${this.roomId})`);
  }

  private handleInput(client: Client, message: unknown): void {
    if (message === null || message === undefined || typeof message !== "object") {
      console.warn(`${LOG} malformed input message from ${client.sessionId}; ignored`);
      return;
    }

    const msg = message as Partial<InputMessage>;
    const sessionId = client.sessionId;

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
      primaryFire: typeof rawInput.primaryFire === "number" ? rawInput.primaryFire : 0,
    };

    const player = this.state.players.get(sessionId);
    if (!player) {
      console.warn(`${LOG} input from ${sessionId} with no player entry; ignored`);
      return;
    }

    if (!player.alive) {
      return;
    }

    const yaw = player.yaw;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const worldDirX = cosYaw * input.moveX + sinYaw * input.moveZ;
    const worldDirZ = sinYaw * input.moveX - cosYaw * input.moveZ;
    const dt = 0.033;
    const len = Math.sqrt(worldDirX * worldDirX + worldDirZ * worldDirZ);
    if (len > 0) {
      const scale = (MOVE_SPEED * dt * Math.min(len, 1)) / len;
      player.x += worldDirX * scale;
      player.z += worldDirZ * scale;
    }
    player.yaw = input.lookYaw;

    if (input.primaryFire) {
      this.processFire(sessionId, player, input.lookYaw);
    }
  }

  private processFire(
    shooterId: string,
    shooter: InstanceType<typeof PlayerStateSchema>,
    yaw: number,
  ): void {
    const weapon = WEAPONS.find((w) => w.id === "blaster")!;

    const now = Date.now();
    const lastFire = this.lastFireTime.get(shooterId) ?? 0;
    if (now - lastFire < weapon.fireCooldownMs) {
      return;
    }

    const origin: Vec3 = { x: shooter.x, y: shooter.y + EYE_HEIGHT, z: shooter.z };
    const direction: Vec3 = { x: Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
    let hitAny = false;

    for (const [targetId, target] of this.state.players) {
      if (targetId === shooterId) continue;
      if (!target.alive) continue;

      const targetPos: Vec3 = { x: target.x, y: target.y, z: target.z };
      const result = rayIntersectsCapsule(origin, direction, targetPos, TARGET_RADIUS, weapon.range);

      if (result.hit) {
        hitAny = true;
        const newHealth = target.health - weapon.damage;
        target.health = newHealth > 0 ? newHealth : 0;
        const eliminated = target.health <= 0;
        if (eliminated) { target.alive = false; }

        const payload: HitEventPayload = {
          shooterId,
          targetId,
          damage: weapon.damage,
          remainingHealth: target.health,
        };
        this.broadcast(EVENTS.HIT, payload);
        if (eliminated) {
          this.broadcast(EVENTS.ELIMINATED, payload);
        }
        console.log(
          `${LOG} hit: shooter=${shooterId} target=${targetId} damage=${weapon.damage} remaining=${target.health}${eliminated ? " ELIMINATED" : ""}`,
        );
        break;
      }
    }

    this.lastFireTime.set(shooterId, now);
    if (!hitAny) {
      console.log(`${LOG} shot by ${shooterId} missed (no target in range)`);
    }
  }
}
