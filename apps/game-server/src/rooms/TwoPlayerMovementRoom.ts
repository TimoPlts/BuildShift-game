/**
 * Stage 2D (consolidated) — the canonical authoritative two-player Colyseus
 * movement room.
 *
 * This is the single, canonical implementation of the two-player multiplayer
 * movement system used by the BuildShift game runtime. It is wired into the
 * server under the `two-player-movement` route (see `server.ts`).
 *
 * Authority contract:
 *  - the client sends ONLY a {@link PlayerNetworkInput} intent (never a
 *    position or velocity);
 *  - the server owns every player's position / velocity / grounded state and
 *    advances it with the SHARED deterministic movement step
 *    (`stepPlayerMovement` from `@buildshift/simulation`) using the EXACT
 *    balance values from `@buildshift/game-config`;
 *  - the resulting state is written onto the synchronized
 *    {@link RoomStateSchema} so Colyseus' built-in state synchronisation
 *    patches every client.
 *
 * State model:
 *  - The room's logical state conforms to {@link GameStateSchema}
 *    (`{ players: Record<string, PlayerNetworkState> }`). The Colyseus
 *    wire form is `RoomStateSchema` (a `MapSchema` of `PlayerStateSchema`
 *    keyed by `sessionId`).
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
 *  - if valid, `stepPlayerMovement` advances the player and the player's
 *    `lastInputSequence` (wire: `sequence`) is updated.
 *
 * Spawn:
 *  - The first player to join spawns at x = -5, y = ground, z = 0.
 *  - The second player to join spawns at x = +5, y = ground, z = 0.
 *
 * Deliberately framework-light: no Babylon, no browser APIs, no Rapier —
 * just the pure shared simulation step driven by Colyseus' fixed-timestep
 * mechanism at 30 Hz.
 */
import { Room, type Client } from "@colyseus/core";

import {
  RoomStateSchema,
  PlayerStateSchema,
  type RoomStateSchemaInstance,
  type PlayerNetworkInput,
  PLAYER_NETWORK_INPUT_LIMITS,
} from "@buildshift/protocol";
import {
  stepPlayerMovement,
  movementInputToWorld,
  type PlayerMovementState,
  type PlayerMovementConfig,
} from "@buildshift/simulation";
import { PLAYER_MOVEMENT, VERTICAL_MOVEMENT } from "@buildshift/game-config";

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
 * Spawn positions for the two players.
 * Player A (first to join): x = -5.
 * Player B (second to join): x = +5.
 * Both at ground level, z = 0.
 */
const SPAWN_POSITIONS: ReadonlyArray<{ x: number; y: number; z: number }> = [
  { x: -5, y: VERTICAL_MOVEMENT.groundY, z: 0 },
  { x: 5, y: VERTICAL_MOVEMENT.groundY, z: 0 },
];

/** Clamp a number to the inclusive [min, max] range. */
function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
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
 * The Stage 2D canonical two-player authoritative movement room.
 *
 * Extends Colyseus' `Room` typed on {@link RoomStateSchemaInstance} so the
 * `players` map is synchronised to every client automatically.
 */
export class TwoPlayerMovementRoom extends Room<{
  state: RoomStateSchemaInstance;
}> {
  /**
   * The synchronized room state (a `players` map keyed by client `sessionId`).
   * Populated in `onJoin`, emptied in `onLeave`; Colyseus patches it to clients.
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
    // mechanism. Each tick steps every player's simulation once with
    // `TICK_DELTA_SECONDS` (1/30 second).
    this.setFixedTimestep(() => this.tick(), TICK_RATE_HZ);
  }

  /**
   * A new client joined: create its authoritative player entry at the
   * assigned spawn point and register it in the synchronized map.
   */
  onJoin(client: Client): void {
    // Assign spawn slot based on join order (0 → x=-5, 1 → x=+5).
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
    player.lastInputSequence = -1; // no input processed yet
    this.state.players.set(client.sessionId, player);

    console.log(
      `${LOG} client joined (sessionId=${client.sessionId}, slot=${slotIndex}, x=${spawn.x}, clients=${this.clients.length})`,
    );
  }

  /**
   * A client left: remove its player from the synchronized map and drop its
   * buffered input so neither leaks.
   */
  onLeave(client: Client, code?: number): void {
    this.state.players.delete(client.sessionId);
    this.inputBuffers.delete(client.sessionId);

    console.log(
      `${LOG} client left (sessionId=${client.sessionId}, code=${code ?? "n/a"}, clients=${this.clients.length})`,
    );
  }

  /**
   * The room is being disposed (all clients left / server shutting down):
   * Colyseus' fixed-timestep loop is stopped automatically on dispose.
   * We clear the input buffers to prevent leaks.
   */
  onDispose(): void {
    this.inputBuffers.clear();
    console.log(`${LOG} room disposed (roomId=${this.roomId})`);
  }

  /**
   * One authoritative simulation tick (30 Hz).
   *
   * For every player, check for a pending buffered input:
   *  1. If present, validate: `sequence` must be > player's last processed
   *     sequence (otherwise reject — position unchanged).
   *  2. If valid, call `stepPlayerMovement` to advance the player.
   *  3. Write the result back to the synchronized schema so Colyseus
   *     propagates the change to all clients.
   *
   * If no buffered input exists, the player steps with a neutral (no-movement)
   * intent (gravity still applies so falling/jump arcs are maintained).
   */
  private tick(): void {
    for (const [sessionId, player] of this.state.players) {
      const buffered = this.inputBuffers.get(sessionId);

      if (buffered !== undefined) {
        // Validate sequence: must be strictly greater than last processed.
        if (buffered.sequence > player.lastInputSequence) {
          // Valid input — consume it and step the simulation.
          this.stepPlayer(player, buffered);
          // Update the player's processed sequence on the wire.
          player.lastInputSequence = buffered.sequence;
          // Clear the consumed input.
          this.inputBuffers.delete(sessionId);
        } else {
          // Out-of-order (lower or equal sequence): reject.
          // Position is unchanged; just clear the stale buffer.
          this.inputBuffers.delete(sessionId);
          console.warn(
            `${LOG} rejected out-of-order input (sessionId=${sessionId}, seq=${buffered.sequence} <= last=${player.lastInputSequence})`,
          );
        }
      } else {
        // No buffered input: step with a neutral intent (no movement, no jump)
        // so gravity still integrates (keeps airborne players falling).
        this.stepPlayer(player, {
          sequence: player.lastInputSequence,
          moveX: 0,
          moveZ: 0,
          lookYaw: player.yaw,
          lookPitch: 0,
          jump: false,
          sprint: false,
          crouch: false,
          primaryFire: false,
          secondaryFire: false,
        });
      }
    }
  }

  /**
   * Advance one player's simulation by one tick using the shared
   * `stepPlayerMovement` and write the result back to the wire schema.
   */
  private stepPlayer(
    player: InstanceType<typeof PlayerStateSchema>,
    input: PlayerNetworkInput,
  ): void {
    // Convert local movement to world space using the player's current yaw.
    const worldInput = movementInputToWorld(
      { x: input.moveX, z: input.moveZ },
      input.lookYaw,
    );

    // Build the current PlayerMovementState from the wire schema fields.
    const currentState: PlayerMovementState = {
      x: player.x,
      y: player.y,
      z: player.z,
      vx: 0, // horizontal velocity is recomputed each tick by stepPlayerMovement
      vy: player.velocityY,
      vz: 0,
      onGround: player.grounded,
    };

    // Step the shared deterministic simulation.
    const next = stepPlayerMovement(
      currentState,
      {
        moveX: worldInput.x,
        moveZ: worldInput.z,
        jump: input.jump,
      },
      TICK_DELTA_SECONDS,
      MOVEMENT_CONFIG,
    );

    // Write the authoritative result back so Colyseus' state synchronisation
    // emits a patch to every client in the room.
    player.x = next.x;
    player.y = next.y;
    player.z = next.z;
    player.velocityY = next.vy;
    player.grounded = next.onGround;
    // Update the player's facing from the latest input's absolute camera yaw.
    player.yaw = input.lookYaw;
  }

  /**
   * Handle one inbound {@link PlayerNetworkInput} frame.
   *
   * Validates the message structure and clamps fields. If valid, stores it in
   * the per-client buffer (latest wins). The authoritative tick consumes the
   * buffer and enforces the sequence rule.
   */
  private handleMovementInput(client: Client, message: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      // Input from a client with no player entry — nowhere to store it.
      console.warn(
        `${LOG} movement input from sessionId=${client.sessionId} with no player; ignored`,
      );
      return;
    }

    const input = parseInput(message);
    if (input === null) {
      console.warn(
        `${LOG} malformed movement input from sessionId=${client.sessionId}; ignored`,
      );
      return;
    }

    // Store in per-client buffer (latest wins).
    this.inputBuffers.set(client.sessionId, input);
  }
}
