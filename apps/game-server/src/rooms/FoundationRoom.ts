/**
 * Stage 2C1 foundational room — now the first REAL AUTHORITATIVE MOVEMENT
 * simulation.
 *
 * Stage 2B2 gave this room the minimal authoritative `players` state and an
 * input-receipt acknowledgement. Stage 2C1 turns it into a
 * genuine authoritative movement server:
 *
 *  - the client sends ONLY intent (`EVENTS.PLAYER_INPUT` +
 *    `PlayerInputFrame` from `@buildshift/protocol`) — never a position or
 *    velocity;
 *  - the server owns position, gravity, jump result, collisions, grounded
 *    state, and acknowledgement, via a single Rapier world
 *    (`ServerPhysicsWorld`) driven by the shared deterministic movement math
 *    (`AuthoritativeMovement`, backed by `@buildshift/simulation`);
 *  - input is QUEUED on receipt and validated/rejected (malformed, duplicate,
 *    stale, non-monotonic); the authoritative 30 Hz tick consumes at most one
 *    frame per player and advances the physics in two 60 Hz substeps;
 *  - `acknowledgedSequence` is raised only to the sequence of the frame whose
 *    movement has ACTUALLY been simulated — a queued frame is never
 *    acknowledged before the simulation uses it.
 *
 * What this room deliberately does NOT do (later stages):
 *  - client reconciliation (the client still predicts/moves locally,
 *    independently) — Stage 2C2;
 *  - interpolation, combat, building, teams, match rules — later stages.
 *
 * Authority contract (task §2): the server NEVER accepts a client position or
 * velocity. `position.{x,y,z}` and `acknowledgedSequence` on the wire are
 * derived exclusively from the authoritative Rapier body and the input queue.
 */
import { Room, type Client, type StepContext } from "@colyseus/core";

import {
  EVENTS,
  validatePlayerInputFrame,
  type PlayerInputFrame,
} from "@buildshift/protocol";

import {
  FoundationRoomState,
  NO_SEQUENCE_ACKNOWLEDGED,
  PlayerState,
} from "../state/foundationState.js";
import type {
  FoundationRoomStateInstance,
  PlayersMap,
} from "../state/foundationState.js";
import {
  AuthoritativeMovement,
  type TickInput,
} from "../physics/authoritativeMovement.js";

/**
 * Log prefix kept stable from Stage 2A so existing log-based assertions
 * (and the entry-point startup logs) remain consistent.
 */
const LOG = "[buildshift:foundation]";

/**
 * The authoritative simulation tick rate (Hz) and physics substeps per tick.
 * The tick runs at 30 Hz; each tick advances the shared fixed physics step
 * (`PHYSICS_TIMING.fixedStepDurationSeconds = 1/60`) twice, so the effective
 * physics rate is 60 Hz. These are NOT magic tuning — they are the
 * authoritative cadence from the architecture (task §4).
 */
const AUTHORITY_TICK_RATE = 30;
const AUTHORITY_SUB_STEPS = 2;

export class FoundationRoom extends Room {
  /**
   * Room state instance. The base `Room` constructor installs an accessor for
   * `state` (whose setter wires the schema serializer), so this class field is
   * what gets captured and serialized — the canonical Colyseus v0.18 pattern.
   */
  state = new FoundationRoomState();

  /**
   * The authoritative movement simulation (Rapier world + per-player runtime
   * input state). Created in the async `onCreate`; the 30 Hz tick starts only
   * after physics is ready.
   */
  private movement!: AuthoritativeMovement;

  /**
   * Typed access to the `players` collection on the room state.
   */
  private get players(): PlayersMap {
    return (this.state as FoundationRoomStateInstance).players;
  }

  /**
   * Invoked by the matchmaker once, after the room has been instantiated and
   * before any client joins. The matchmaker AWAITs this, so we may initialise
   * the (async WASM) physics before the authoritative tick begins.
   */
  async onCreate(): Promise<void> {
    // Initialise the authoritative physics first (async WASM load); the
    // simulation only starts once this resolves.
    this.movement = await AuthoritativeMovement.create();

    console.log(`${LOG} room created (roomId=${this.roomId})`);

    // Stage 2C1 defines exactly one inbound message type
    // (`EVENTS.PLAYER_INPUT`); the wildcard lets the room grow further types
    // later without re-wiring.
    this.onMessage("*", (client, type, message) => {
      this.routeMessage(client, type, message);
    });

    // Begin the authoritative 30 Hz simulation using Colyseus' fixed-timestep
    // room mechanism (NOT a raw setInterval). Each tick consumes at most one
    // queued input frame per player and runs two 60 Hz physics substeps.
    this.setFixedTimestep(
      (ctx) => this.authoritativeTick(ctx),
      AUTHORITY_TICK_RATE,
      { subSteps: AUTHORITY_SUB_STEPS },
    );
  }

  /**
   * One authoritative tick. Consumes input, advances the physics substeps,
   * then publishes each player's authoritative position + yaw + ack to the
   * room state (which Colyseus serializes and sends on its patch cadence).
   */
  private authoritativeTick(ctx: StepContext): void {
    const tick: TickInput = { subSteps: ctx.subSteps, subDt: ctx.subDt };
    this.movement.runTick(tick);
    this.publishAuthoritativeState();
  }

  /**
   * Copies the authoritative simulation's per-player state (position from the
   * Rapier body, yaw, and processed-sequence ack) onto the synchronized room
   * state. Pitch is intentionally NOT synced (server-runtime only).
   */
  private publishAuthoritativeState(): void {
    for (const [sessionId, player] of this.players) {
      const publishable = this.movement.getPublishable(sessionId);
      if (!publishable) {
        continue;
      }
      player.position.x = publishable.position.x;
      player.position.y = publishable.position.y;
      player.position.z = publishable.position.z;
      player.yaw = publishable.yaw;
      player.acknowledgedSequence = publishable.acknowledgedSequence;
    }
  }

  /**
   * Route an inbound message by type.
   */
  private routeMessage(
    client: Client,
    type: string | number,
    message: unknown,
  ): void {
    if (type === EVENTS.PLAYER_INPUT) {
      this.handlePlayerInput(client, message);
      return;
    }
    // Unknown message type: no defined semantics in Stage 2C1 → ignore.
    console.warn(
      `${LOG} ignoring unknown message type "${String(type)}" from sessionId=${client.sessionId}`,
    );
  }

  /**
   * Invoked on the server whenever a new client joins this room. Creates the
   * player's authoritative entry at the shared `PLAYER_SPAWN` and its
   * simulation runtime.
   */
  onJoin(client: Client): void {
    this.createPlayer(client);
    console.log(
      `${LOG} client joined (sessionId=${client.sessionId}, clients=${this.clients.length})`,
    );
  }

  /**
   * Invoked on the server whenever a client leaves this room. Removes the
   * player's authoritative state and frees its physics + runtime input state.
   */
  onLeave(client: Client, code?: number): void {
    this.removePlayer(client.sessionId);
    console.log(
      `${LOG} client left (sessionId=${client.sessionId}, code=${code ?? "n/a"}, clients=${this.clients.length})`,
    );
  }

  /**
   * Invoked on the server when the room is disposed (all clients have left and
   * autoDispose kicks in, or the server is shutting down). Frees the physics
   * world so no timers/resources leak.
   */
  onDispose(): void {
    this.movement?.dispose();
    console.log(`${LOG} room disposed (roomId=${this.roomId})`);
  }

  /**
   * Create and register the authoritative entry + simulation for a
   * newly-joined client. Idempotent.
   *
   * The player starts at the shared `PLAYER_SPAWN` (capsule centre), yaw 0,
   * and `acknowledgedSequence = -1` (no input processed yet).
   */
  private createPlayer(client: Client): void {
    if (this.players.has(client.sessionId)) {
      return;
    }

    this.movement.createPlayer(client.sessionId);

    const player = new PlayerState();
    player.playerId = client.sessionId;

    // Reflect the authoritative spawn position on the wire immediately (before
    // the first tick), so a freshly-joined player has a correct capsule-centre
    // position. The authoritative movement simulation keeps this value.
    const spawn = this.movement.getPublishable(client.sessionId);
    if (spawn) {
      player.position.x = spawn.position.x;
      player.position.y = spawn.position.y;
      player.position.z = spawn.position.z;
    }
    player.yaw = 0;
    player.acknowledgedSequence = NO_SEQUENCE_ACKNOWLEDGED;
    this.players.set(client.sessionId, player);
  }

  /**
   * Removes a player's authoritative state and simulation (physics body +
   * runtime input state). Idempotent.
   */
  private removePlayer(sessionId: string): void {
    this.players.delete(sessionId);
    this.movement?.removePlayer(sessionId);
  }

  /**
   * Stage 2C1 input handling for one `PLAYER_INPUT` frame.
   *
   *  1. PROTOCOL (structural): `validatePlayerInputFrame` — pure, never
   *     throws. If malformed, we log and store nothing (no throw propagates to
   *     the transport).
   *  2. ENQUEUE: the validated frame is handed to the simulation's input
   *     queue, which rejects duplicate/stale/non-monotonic received sequences
   *     (`sequence <= lastReceivedSequence`) and enqueues the rest.
   *
   * Note: receipt here does NOT acknowledge the frame. The frame's sequence
   * becomes the player's `acknowledgedSequence` only once the authoritative
   * tick has actually simulated its movement (task §5).
   */
  private handlePlayerInput(client: Client, message: unknown): void {
    // 1) Protocol / structural validation.
    const validation = validatePlayerInputFrame(message);
    if (!validation.ok) {
      console.warn(
        `${LOG} malformed PLAYER_INPUT from sessionId=${client.sessionId}: ${validation.errors.join("; ")}`,
      );
      return;
    }
    const frame: PlayerInputFrame = validation.value;

    if (!this.movement.hasPlayer(client.sessionId)) {
      // Input from a client with no player entry (should not happen after
      // onJoin; guard against it) — no simulation to enqueue into.
      console.warn(
        `${LOG} PLAYER_INPUT from sessionId=${client.sessionId} with no player; ignored`,
      );
      return;
    }

    // 2) Enqueue; the simulation enforces the sequence rules.
    const result = this.movement.enqueueFrame(client.sessionId, frame);
    if (result === "rejected-sequence") {
      console.warn(
        `${LOG} non-monotonic PLAYER_INPUT from sessionId=${client.sessionId}: sequence=${frame.sequence}; ignored`,
      );
      return;
    }
    if (result === "rejected-malformed") {
      console.warn(
        `${LOG} invalid PLAYER_INPUT sequence from sessionId=${client.sessionId}: sequence=${frame.sequence}; ignored`,
      );
    }
  }
}
