/**
 * Stage 2D (consolidated) — the canonical authoritative two-player Colyseus
 * room: deterministic movement PLUS full server-authoritative hitscan combat.
 *
 * This is the single, canonical implementation of the multiplayer
 * movement + combat system used by the BuildShift game runtime. It is wired
 * into the server under the `two-player-movement` route (see `server.ts`) and
 * is the ONLY authoritative gameplay loop on the server. The earlier parallel
 * `CombatRoom` (time-based cooldown, `lastFireTime`) has been retired in favour
 * of this single tick-driven loop so that movement, prediction,
 * reconciliation, interpolation and combat all share one authoritative path.
 *
 * Authority contract:
 *  - the client sends ONLY a {@link PlayerNetworkInput} intent (movement +
 *    aim + fire); it NEVER claims a position, velocity, or damage value;
 *  - the server owns every player's position / velocity / grounded state AND
 *    its combat state (health, shield, ammo, fire gate, elimination) and
 *    advances them on a single fixed 30 Hz tick;
 *  - movement is advanced with the SHARED deterministic movement step
 *    (`stepPlayerMovement` from `@buildshift/simulation`);
 *  - combat is resolved with the SHARED combat math (`canFire`,
 *    `rayIntersectsCapsule` from `@buildshift/simulation`) so the client's
 *    local fire prediction and the server's authoritative validation agree;
 *  - the resulting state is written onto the synchronized
 *    {@link RoomStateSchema} so Colyseus' built-in state synchronisation
 *    patches every client; fire-and-forget combat notifications
 *    ({@link HitResultEvent}, {@link PlayerEliminatedEvent}) are broadcast in
 *    addition to the state patch.
 *
 * Input model (sequence-validated, latest-wins):
 *  - each inbound `PlayerNetworkInput` is stored in a per-client buffer
 *    (latest frame wins);
 *  - on each authoritative tick, the buffered input is validated:
 *      - `sequence` must be STRICTLY GREATER than the player's last
 *        processed sequence (otherwise the input is rejected and the
 *        player's position is unchanged);
 *      - `moveX` / `moveZ` are clamped to [-1, 1];
 *      - `lookYaw` / `lookPitch` are clamped to [-π, π];
 *  - if valid, `stepPlayerMovement` advances the player, the player's
 *    `lastProcessedSequence` is updated, and — when `primaryFire` is active —
 *    the authoritative fire pipeline (fire gate → ammo → hitscan → damage →
 *    elimination) runs for that player.
 *
 * Combat model:
 *  - every player holds the shared `ASSAULT_RIFLE` as its primary weapon;
 *  - a shot is only accepted when the shared `canFire` gate passes (not
 *    eliminated and the `fireIntervalTicks` cooldown has elapsed since
 *    `lastFireSequence`) AND the player has ammo;
 *  - a confirmed shot decrements `ammo`, records `lastFireSequence`, and casts
 *    a hitscan ray from the shooter's eye along the camera yaw/pitch direction
 *    against every other alive player's bounding sphere;
 *  - damage is absorbed by `shield` first, then `health`; when `health`
 *    reaches 0 the target is eliminated and a `PlayerEliminatedEvent` fires;
 *  - eliminated players stop processing inputs and respawn after
 *    {@link RESPAWN_TICKS} ticks with position/health/shield/ammo reset.
 *
 * Deliberately framework-light: no Babylon, no browser APIs, no Rapier —
 * just the pure shared simulation driven by Colyseus' fixed-timestep
 * mechanism at 30 Hz.
 */
import { Room, type Client } from "@colyseus/core";

import {
  RoomStateSchema,
  PlayerStateSchema,
  type RoomStateSchemaInstance,
  type PlayerNetworkInput,
  type HitPoint,
  type HitResultEvent,
  type PlayerEliminatedEvent,
  type WeaponId,
  PLAYER_NETWORK_INPUT_LIMITS,
  EVENTS,
} from "@buildshift/protocol";
import {
  stepPlayerMovement,
  movementInputToWorld,
  canFire,
  rayIntersectsCapsule,
  type PlayerMovementState,
  type PlayerMovementConfig,
  type Vec3,
} from "@buildshift/simulation";
import {
  PLAYER_MOVEMENT,
  VERTICAL_MOVEMENT,
  ASSAULT_RIFLE,
  MAX_HEALTH,
  MAX_SHIELD,
} from "@buildshift/game-config";

/** Log prefix. */
const LOG = "[buildshift:two-player-movement]";

/**
 * The stable room name registered by the server. Exported so the entry point
 * and tests reference the same identifier instead of re-inventing the string.
 * Matches `GAME_MODES.TWO_PLAYER_MOVEMENT` from `@buildshift/protocol`.
 */
export const TWO_PLAYER_MOVEMENT_ROOM = "two-player-movement";

/**
 * The inbound message type carrying one {@link PlayerNetworkInput} frame
 * (client → server, per player).
 */
export const TWO_PLAYER_MOVEMENT_INPUT = "two-player:input";

/** Authoritative simulation tick rate (Hz). */
const TICK_RATE_HZ = 30;

/** Tick duration in seconds (one 30 Hz step). */
const TICK_DELTA_SECONDS = 1 / TICK_RATE_HZ;

/**
 * Movement configuration for `stepPlayerMovement` — sourced from the shared
 * `@buildshift/game-config` balance values (no local retuning).
 */
const MOVEMENT_CONFIG: PlayerMovementConfig = {
  moveSpeed: PLAYER_MOVEMENT.moveSpeed,
  gravity: VERTICAL_MOVEMENT.gravity,
  jumpVelocity: VERTICAL_MOVEMENT.jumpVelocity,
  terminalVelocity: VERTICAL_MOVEMENT.terminalVelocity,
  groundY: VERTICAL_MOVEMENT.groundY,
};

/**
 * The player's primary weapon. All players carry the shared assault rifle; the
 * server looks it up by the shared config (no client-claimed weapon data is
 * trusted). Its `fireIntervalTicks` drives the `canFire` gate, `damage` drives
 * the hitscan damage, `range` bounds the ray, and `maxAmmo` seeds the magazine.
 */
const COMBAT_WEAPON = ASSAULT_RIFLE;

/**
 * The weapon id broadcast on {@link HitResultEvent}. `COMBAT_WEAPON.id` is a
 * plain `string` on `WeaponConfig`; the canonical roster guarantees it is one
 * of the {@link WeaponId} literals.
 */
const COMBAT_WEAPON_ID: WeaponId = COMBAT_WEAPON.id as WeaponId;

/**
 * Eye / aim-origin height above the player's stored (feet) position, in
 * metres. Sourced from the shared capsule half-height (0.9 m).
 */
const EYE_HEIGHT_OFFSET = VERTICAL_MOVEMENT.playerHalfHeight;

/**
 * Bounding-sphere radius used for hitscan target detection, in metres. The
 * shared sphere is centred on each (alive) player at position + EYE_HEIGHT
 * so a horizontal shot through the aim line connects.
 */
const TARGET_RADIUS = 0.4;

/**
 * Number of authoritative ticks an eliminated player waits before respawning
 * (v1: 60 ticks ≈ 2 s at 30 Hz).
 */
const RESPAWN_TICKS = 60;

/**
 * Spawn positions for the players.
 * Player A (first to join): x = -5.
 * Player B (second to join): x = +5.
 * Both at ground level, z = 0.
 */
const SPAWN_POSITIONS: ReadonlyArray<{ x: number; y: number; z: number }> = [
  { x: -5, y: VERTICAL_MOVEMENT.groundY, z: 0 },
  { x: 5, y: VERTICAL_MOVEMENT.groundY, z: 0 },
];

/** A schema instance for a player (the wire state we mutate authoritatively). */
type PlayerEntry = InstanceType<typeof PlayerStateSchema>;

/** Clamp a number to the inclusive [min, max] range. */
function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Compute the unit aim direction (metres, Y-up) for a camera yaw + pitch.
 *
 * Convention (shared with `movementInputToWorld`):
 *  - `lookYaw`: 0 faces -Z; positive rotates toward +X;
 *  - `lookPitch`: 0 = horizontal; positive = looking up.
 *
 * The horizontal forward vector at yaw `y` is `(sin y, 0, -cos y)`; pitching
 * up by `p` tilts that forward vector toward +Y:
 *   direction = ( sin y · cos p,  sin p,  -cos y · cos p ).
 * This is a unit vector, so `distance` from `rayIntersectsCapsule` maps
 * directly onto the aim line.
 */
function aimDirection(yaw: number, pitch: number): Vec3 {
  const cosPitch = Math.cos(pitch);
  return {
    x: Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch,
  };
}

/**
 * Validate and normalise a raw inbound message into a {@link PlayerNetworkInput}.
 *
 * Returns `null` if the message is structurally invalid (missing required
 * fields, non-finite numbers). Otherwise returns a normalised copy with:
 *  - `moveX` / `moveZ` clamped to [-1, 1]
 *  - `lookYaw` / `lookPitch` clamped to [-π, π]
 *  - boolean fields defaulted to `false` if missing
 */
function parseInput(message: unknown): PlayerNetworkInput | null {
  if (message === null || message === undefined || typeof message !== "object") {
    return null;
  }
  const raw = message as Record<string, unknown>;

  const sequence = raw.sequence;
  if (typeof sequence !== "number" || !Number.isFinite(sequence)) {
    return null;
  }

  const moveX =
    typeof raw.moveX === "number" && Number.isFinite(raw.moveX)
      ? clamp(raw.moveX, PLAYER_NETWORK_INPUT_LIMITS.movementMin, PLAYER_NETWORK_INPUT_LIMITS.movementMax)
      : 0;
  const moveZ =
    typeof raw.moveZ === "number" && Number.isFinite(raw.moveZ)
      ? clamp(raw.moveZ, PLAYER_NETWORK_INPUT_LIMITS.movementMin, PLAYER_NETWORK_INPUT_LIMITS.movementMax)
      : 0;

  const lookYaw =
    typeof raw.lookYaw === "number" && Number.isFinite(raw.lookYaw)
      ? clamp(raw.lookYaw, -Math.PI, Math.PI)
      : 0;
  const lookPitch =
    typeof raw.lookPitch === "number" && Number.isFinite(raw.lookPitch)
      ? clamp(raw.lookPitch, PLAYER_NETWORK_INPUT_LIMITS.pitchMin, PLAYER_NETWORK_INPUT_LIMITS.pitchMax)
      : 0;

  const jump = raw.jump === true;
  const sprint = raw.sprint === true;
  const crouch = raw.crouch === true;
  const primaryFire = raw.primaryFire === true;
  const secondaryFire = raw.secondaryFire === true;

  return { sequence, moveX, moveZ, lookYaw, lookPitch, jump, sprint, crouch, primaryFire, secondaryFire };
}

/**
 * The Stage 2D canonical two-player authoritative movement + combat room.
 *
 * Extends Colyseus' `Room` typed on {@link RoomStateSchemaInstance} so the
 * `players` map (position, facing, AND combat fields) is synchronised to
 * every client automatically.
 */
export class TwoPlayerMovementRoom extends Room<{
  state: RoomStateSchemaInstance;
}> {
  /**
   * The synchronized room state (a `players` map keyed by client `sessionId`).
   * Populated in `onJoin`, emptied in `onLeave`; Colyseus patches it to
   * clients. Each entry carries movement AND combat fields (health, shield,
   * energy, ammo, lastFireSequence, isEliminated).
   *
   * The logical state conforms to `GameStateSchema` from `@buildshift/protocol`
   * (`{ players: Record<string, PlayerNetworkState> }`).
   */
  state = new RoomStateSchema();

  /**
   * Room capacity: this milestone is exactly two players.
   */
  maxPlayers = 2;

  /**
   * Latest buffered {@link PlayerNetworkInput} per client `sessionId`.
   * Server-side only; the latest frame wins. Consumed by the tick.
   */
  private readonly inputBuffers = new Map<string, PlayerNetworkInput>();

  /**
   * Tracks how many players have joined (for spawn slot assignment).
   */
  private joinCount = 0;

  /**
   * The spawn slot index each player was assigned on join, so a respawn can
   * restore the player to their original spawn point. Keyed by sessionId.
   */
  private readonly spawnSlots = new Map<string, number>();

  /**
   * Per-player respawn countdown for eliminated players: remaining ticks until
   * the player respawns. Only present while a player is eliminated.
   */
  private readonly respawnTimers = new Map<string, number>();

  /**
   * Invoked by the matchmaker once, after the room is instantiated and before
   * any client joins. Wires the inbound message handler and starts the
   * authoritative fixed-timestep simulation loop at 30 Hz.
   */
  onCreate(): void {
    console.log(`${LOG} room created (roomId=${this.roomId})`);

    this.onMessage(TWO_PLAYER_MOVEMENT_INPUT, (client, message) => {
      this.handleMovementInput(client, message);
    });

    // Begin the authoritative 30 Hz simulation using Colyseus' fixed-timestep
    // mechanism. Each tick steps every player's movement once and resolves
    // any fire intents (hitscan combat) authoritatively.
    this.setFixedTimestep(() => this.tick(), TICK_RATE_HZ);
  }

  /**
   * A new client joined: create its authoritative player entry at the
   * assigned spawn point, seed its combat state, and register it in the
   * synchronized map.
   */
  onJoin(client: Client): void {
    // Assign spawn slot based on join order (0 → x=-5, 1 → x=+5).
    const slotIndex = this.joinCount % SPAWN_POSITIONS.length;
    const spawn = SPAWN_POSITIONS[slotIndex];
    this.joinCount++;
    this.spawnSlots.set(client.sessionId, slotIndex);

    const player = new PlayerStateSchema();
    player.x = spawn.x;
    player.y = spawn.y;
    player.z = spawn.z;
    player.yaw = 0;
    player.velocityY = 0;
    player.grounded = true;
    player.lastProcessedSequence = -1; // no input processed yet

    // Authoritative combat state seeded at full.
    player.health = MAX_HEALTH;
    player.shield = MAX_SHIELD;
    player.energy = 0;
    player.ammo = COMBAT_WEAPON.maxAmmo;
    player.lastFireSequence = -1; // no shot fired yet
    player.alive = true;
    player.isEliminated = false;

    this.state.players.set(client.sessionId, player);

    console.log(
      `${LOG} client joined (sessionId=${client.sessionId}, slot=${slotIndex}, x=${spawn.x}, clients=${this.clients.length})`,
    );
  }

  /**
   * A client left: remove its player from the synchronized map and drop its
   * buffered input, spawn slot, and respawn timer so nothing leaks.
   */
  onLeave(client: Client, code?: number): void {
    this.state.players.delete(client.sessionId);
    this.inputBuffers.delete(client.sessionId);
    this.spawnSlots.delete(client.sessionId);
    this.respawnTimers.delete(client.sessionId);

    console.log(
      `${LOG} client left (sessionId=${client.sessionId}, code=${code ?? "n/a"}, clients=${this.clients.length})`,
    );
  }

  /**
   * The room is being disposed (all clients left / server shutting down):
   * Colyseus' fixed-timestep loop is stopped automatically on dispose.
   * We clear all per-client bookkeeping to prevent leaks.
   */
  onDispose(): void {
    this.inputBuffers.clear();
    this.spawnSlots.clear();
    this.respawnTimers.clear();
    console.log(`${LOG} room disposed (roomId=${this.roomId})`);
  }

  /**
   * One authoritative simulation tick (30 Hz).
   *
   * For every player:
   *  1. If eliminated — advance the respawn countdown (and perform the respawn
   *     when it reaches zero). Eliminated players do NOT process inputs
   *     (movement or fire); any buffered frame is dropped.
   *  2. Otherwise, if there is a buffered input, validate it: `sequence` must