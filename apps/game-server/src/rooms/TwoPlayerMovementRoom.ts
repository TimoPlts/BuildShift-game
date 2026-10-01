/**
 * Stage 2D — the first REAL two-player Colyseus movement room.
 *
 * This is the authoritative server room for the two-player movement milestone:
 * two clients in the same room can see each other move, rotate, jump, fall,
 * and land while the server remains the single source of truth.
 *
 * Authority contract:
 *  - the client sends ONLY a {@link MovementInput} intent (never a position or
 *    velocity);
 *  - the server owns every player's position / velocity / grounded state and
 *    advances it with the SHARED deterministic movement math
 *    (`@buildshift/simulation` `stepFullMovement`) using the EXACT balance
 *    values from `@buildshift/game-config`;
 *  - the resulting state is written onto the synchronized
 *    {@link RoomStateSchema} so Colyseus' built-in state synchronisation
 *    patches every client.
 *
 * Input model (Stage 2D, latest-wins):
 *  - each inbound `MovementInput` is stored in a per-client buffer (the latest
 *    frame wins — the client sends a fresh frame each of its own ticks);
 *  - the player's `lastInputSequence` is raised to the sequence of the frame
 *    received, so the owning client can reconcile by re-applying any local
 *    inputs with sequence > `lastInputSequence`;
 *  - the authoritative 30 Hz tick consumes each player's latest buffered input
 *    (or a neutral frame if the player has not sent any yet).
 *
 * Deliberately framework-light: no Babylon, no browser APIs, no Rapier — just
 * the pure shared simulation step driven by a fixed 30 Hz `setInterval`.
 */
import { Room, type Client } from "@colyseus/core";

import {
  RoomStateSchema,
  PlayerStateSchema,
  type RoomStateSchemaInstance,
  type MovementInput,
} from "@buildshift/protocol";
import {
  movementInputToWorld,
  stepFullMovement,
  type HorizontalMovementConfig,
  type VerticalMovementConfig,
} from "@buildshift/simulation";
import {
  PLAYER_MOVEMENT,
  VERTICAL_MOVEMENT,
} from "@buildshift/game-config";

/** Log prefix (kept distinct from the foundation room's prefix). */
const LOG = "[buildshift:two-player]";

/**
 * The stable room name registered by the server. Exported so the entry point
 * and tests reference the same identifier instead of re-inventing the string.
 */
export const TWO_PLAYER_MOVEMENT_ROOM = "two-player-movement";

/**
 * The inbound message type carrying one {@link MovementInput} frame
 * (client → server, per player). Exported so the client/tests use the same
 * name the server listens on.
 */
export const TWO_PLAYER_MOVEMENT_INPUT = "two-player:input";

/** Authoritative simulation tick rate (Hz) — the fixed 30 Hz cadence. */
const TICK_RATE_HZ = 30;

/** Tick duration in seconds (one 30 Hz step). */
const TICK_DELTA_SECONDS = 1 / TICK_RATE_HZ;

/**
 * Horizontal movement config for {@link stepFullMovement} — the exact shared
 * `moveSpeed` from `@buildshift/game-config` (no local retuning).
 */
const HORIZONTAL_CONFIG: HorizontalMovementConfig = {
  moveSpeed: PLAYER_MOVEMENT.moveSpeed,
};

/**
 * Vertical movement config for {@link stepFullMovement} — the exact shared
 * gravity / jump / terminal-velocity / ground-reference tuning from
 * `@buildshift/game-config`. `jumpSpeed` is the legacy fallback required by
 * the config interface; `stepVerticalMovement` prefers `jumpVelocity` when
 * present, so both are kept equal to the shared value.
 */
const VERTICAL_CONFIG: VerticalMovementConfig = {
  gravity: VERTICAL_MOVEMENT.gravity,
  jumpVelocity: VERTICAL_MOVEMENT.jumpVelocity,
  maxFallSpeed: VERTICAL_MOVEMENT.maxFallSpeed,
  groundY: VERTICAL_MOVEMENT.groundY,
  jumpSpeed: VERTICAL_MOVEMENT.jumpVelocity,
};

/**
 * Neutral intent used to step a player that has not sent any input yet: no
 * movement, no jump, facing -Z (yaw 0). This keeps a freshly-joined player at
 * rest until their first real frame arrives.
 */
function neutralInput(): MovementInput {
  return {
    sequence: 0,
    moveX: 0,
    moveZ: 0,
    yaw: 0,
    pitch: 0,
    jump: false,
    crouch: false,
  };
}

/**
 * The Stage 2D two-player authoritative movement room.
 *
 * Extends Colyseus' `Room` (v0.18 single-generic `RoomOptions` form) typed on
 * the shared {@link RoomStateSchemaInstance} so the `players` map is
 * synchronised to every client automatically.
 */
export class TwoPlayerMovementRoom extends Room<{
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
   * Latest buffered {@link MovementInput} per client `sessionId`
   * (server-side only; the latest frame wins). Consumed by the tick.
   *
   * Named `inputBuffers` (NOT `inputs`) to avoid clashing with the Colyseus
   * base `Room.inputs` per-client input accessor.
   */
  private readonly inputBuffers = new Map<string, MovementInput>();

  /** Handle for the authoritative 30 Hz simulation loop (cleared on dispose). */
  private tickTimer: NodeJS.Timeout | null = null;

  /**
   * Invoked by the matchmaker once, after the room is instantiated and before
   * any client joins. Wires the inbound message handler and starts the
   * authoritative simulation loop.
   */
  onCreate(): void {
    console.log(`${LOG} room created (roomId=${this.roomId})`);

    this.onMessage(TWO_PLAYER_MOVEMENT_INPUT, (client, message) => {
      this.handleMovementInput(client, message);
    });

    // Begin the authoritative 30 Hz simulation. `setInterval` is used (rather
    // than Colyseus' `setFixedTimestep`) per the task: a plain fixed-rate loop
    // that consumes each player's latest buffered input and steps the shared
    // movement math.
    this.tickTimer = setInterval(() => this.tick(), 1000 / TICK_RATE_HZ);
  }

  /**
   * A new client joined: create its authoritative player entry at the shared
   * ground reference and register it in the synchronized map.
   */
  onJoin(client: Client): void {
    const player = new PlayerStateSchema();
    player.x = 0;
    player.y = VERTICAL_MOVEMENT.groundY;
    player.z = 0;
    player.yaw = 0;
    player.velocityY = 0;
    player.grounded = true;
    player.lastInputSequence = 0;
    this.state.players.set(client.sessionId, player);

    console.log(
      `${LOG} client joined (sessionId=${client.sessionId}, clients=${this.clients.length})`,
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
   * stop the authoritative simulation loop so the interval does not leak.
   */
  onDispose(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.inputBuffers.clear();
    console.log(`${LOG} room disposed (roomId=${this.roomId})`);
  }

  /**
   * One authoritative simulation tick (30 Hz).
   *
   * For every player, consume the latest buffered {@link MovementInput} (or a
   * neutral frame), run the shared deterministic {@link stepFullMovement} for
   * one tick, and write the result back onto the player's synchronized schema
   * fields so Colyseus propagates the change to all clients.
   */
  private tick(): void {
    for (const [sessionId, player] of this.state.players) {
      const input = this.inputBuffers.get(sessionId) ?? neutralInput();

      // Rotate the player-local movement axes into world X/Z using the shared
      // movement math (yaw 0 faces -Z, positive rotates toward +X).
      const worldInput = movementInputToWorld(
        { x: input.moveX, z: input.moveZ },
        input.yaw,
      );

      const next = stepFullMovement(
        {
          x: player.x,
          y: player.y,
          z: player.z,
          yaw: player.yaw,
          velocityY: player.velocityY,
          grounded: player.grounded,
        },
        worldInput,
        { jump: input.jump },
        TICK_DELTA_SECONDS,
        HORIZONTAL_CONFIG,
        VERTICAL_CONFIG,
      );

      // Write the authoritative result back so Colyseus' state synchronisation
      // emits a patch to every client in the room.
      player.x = next.x;
      player.y = next.y;
      player.z = next.z;
      player.velocityY = next.velocityY;
      player.grounded = next.grounded;
      // `stepFullMovement` carries `yaw` through unchanged, so the player's
      // facing is set explicitly from the latest input's absolute camera yaw.
      player.yaw = input.yaw;
    }
  }

  /**
   * Handle one inbound {@link MovementInput} frame.
   *
   * Store it in the per-client buffer (latest wins) and record its sequence as
   * the player's `lastInputSequence` (used by the owning client for
   * reconciliation). Malformed frames are logged and ignored; no error is
   * propagated to the transport.
   */
  private handleMovementInput(client: Client, message: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      // Input from a client with no player entry (should not happen after
      // onJoin; guard against it) — nowhere to store it.
      console.warn(
        `${LOG} movement input from sessionId=${client.sessionId} with no player; ignored`,
      );
      return;
    }

    const input = message as MovementInput | undefined;
    if (
      input === null ||
      input === undefined ||
      typeof input.sequence !== "number" ||
      !Number.isFinite(input.sequence)
    ) {
      console.warn(
        `${LOG} malformed movement input from sessionId=${client.sessionId}; ignored`,
      );
      return;
    }

    // Latest-wins buffer + raise the reconcilable sequence marker.
    this.inputBuffers.set(client.sessionId, input);
    player.lastInputSequence = input.sequence;
  }
}
