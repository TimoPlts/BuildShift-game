/**
 * Stage 2B2 foundational room — now MINIMALLY STATEFUL.
 *
 * This is the single `foundation` room. Stage 2A made it stateless to prove
 * the Colyseus lifecycle; Stage 2B2 gives it the minimal authoritative
 * `players` state (see `state/foundationState.ts`) and wires the accepted
 * Stage 2B1 input contract (`EVENTS.PLAYER_INPUT` + `validatePlayerInputFrame`
 * from `@buildshift/protocol`) to real server-side handling.
 *
 * What this room does (Stage 2B2 scope):
 *  - maintains `state.players` keyed by Colyseus client `sessionId`;
 *  - on join: creates the player entry at the documented neutral bootstrap
 *    spawn with `acknowledgedSequence = -1` (none processed) and `yaw = 0`;
 *  - on leave: removes the player entry;
 *  - on `EVENTS.PLAYER_INPUT`: validates the frame (protocol structural check,
 *    then a server semantic check) and, for a valid monotonic frame, advances
 *    `acknowledgedSequence` and updates `yaw`.
 *
 * What this room deliberately does NOT do (later stages):
 *  - authoritative movement integration / physics (Rapier) — Stage 2C;
 *  - combat, building, teams, ranking, energy, etc. — game-mode stages.
 *
 * In particular, movement input (`moveX`/`moveZ`) is ACKNOWLEDGED and
 * recorded as the accepted sequence, but it does NOT yet move the player —
 * position stays at the neutral spawn until authoritative movement lands in
 * Stage 2C. `yaw` (a rendering concern with no physics coupling) IS updated
 * immediately so the wire state is observably reactive to input.
 */
import { Room, type Client } from "@colyseus/core";

import {
  EVENTS,
  validatePlayerInputFrame,
  type PlayerInputFrame,
} from "@buildshift/protocol";

import {
  FoundationRoomState,
  NEUTRAL_SPAWN,
  NO_SEQUENCE_ACKNOWLEDGED,
  PlayerState,
} from "../state/foundationState.js";
import type {
  FoundationRoomStateInstance,
  PlayersMap,
} from "../state/foundationState.js";

/**
 * Log prefix kept stable from Stage 2A so existing log-based assertions
 * (and the entry-point startup logs) remain consistent.
 */
const LOG = "[buildshift:foundation]";

export class FoundationRoom extends Room {
  /**
   * Room state instance. Because the base `Room` constructor installs an
   * accessor for `state` (whose setter wires the schema serializer), this
   * field initializer is what gets captured and serialized — a class field is
   * the canonical Colyseus v0.18 pattern for a stateful room.
   *
   * Access via the typed `players` getter below; the raw `this.state` (base
   * type `object`) is never used directly.
   */
  state = new FoundationRoomState();

  /**
   * Typed access to the `players` collection on the room state.
   */
  private get players(): PlayersMap {
    return (this.state as FoundationRoomStateInstance).players;
  }

  /**
   * Invoked by the matchmaker once, after the room has been instantiated
   * and before any client joins.
   *
   * Registers the wildcard message handler — in Colyseus v0.18 `onMessage`
   * is a method that BINDS a handler (not an overridable lifecycle hook), so
   * the wiring lives here.
   */
  onCreate(): void {
    console.log(`${LOG} room created (roomId=${this.roomId})`);

    // Stage 2B2 defines exactly one inbound message type
    // (`EVENTS.PLAYER_INPUT`); the wildcard lets the room grow further types
    // later without re-wiring.
    this.onMessage("*", (client, type, message) => {
      this.routeMessage(client, type, message);
    });
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
    // Unknown message type: no defined semantics in Stage 2B2 → ignore.
    console.warn(
      `${LOG} ignoring unknown message type "${String(type)}" from sessionId=${client.sessionId}`,
    );
  }

  /**
   * Invoked on the server whenever a new client joins this room. Creates the
   * player's authoritative entry (transport bootstrap only — see file header).
   */
  onJoin(client: Client): void {
    this.createPlayer(client);
    console.log(
      `${LOG} client joined (sessionId=${client.sessionId}, clients=${this.clients.length})`,
    );
  }

  /**
   * Invoked on the server whenever a client leaves this room. The client is
   * already removed from `this.clients` before this hook runs.
   */
  onLeave(client: Client, code?: number): void {
    if (this.players.has(client.sessionId)) {
      this.players.delete(client.sessionId);
    }
    console.log(
      `${LOG} client left (sessionId=${client.sessionId}, code=${code ?? "n/a"}, clients=${this.clients.length})`,
    );
  }

  /**
   * Invoked on the server when the room is disposed (all clients have left
   * and autoDispose kicks in, or the server is shutting down).
   */
  onDispose(): void {
    console.log(`${LOG} room disposed (roomId=${this.roomId})`);
  }

  /**
   * Create and register the authoritative entry for a newly-joined client.
   *
   * Idempotent: if an entry for this `sessionId` already exists it is left
   * untouched (defensive against a double-join on the same session, which the
   * transport should not produce, but which must not corrupt state).
   */
  private createPlayer(client: Client): void {
    if (this.players.has(client.sessionId)) {
      return;
    }
    const player = new PlayerState();
    player.playerId = client.sessionId;
    player.x = NEUTRAL_SPAWN.x;
    player.y = NEUTRAL_SPAWN.y;
    player.z = NEUTRAL_SPAWN.z;
    player.yaw = 0;
    player.acknowledgedSequence = NO_SEQUENCE_ACKNOWLEDGED;
    this.players.set(client.sessionId, player);
  }

  /**
   * Stage 2B2 input handling for one `PLAYER_INPUT` frame.
   *
   * Two-stage validation, per the accepted contract:
   *  1. PROTOCOL (structural): `validatePlayerInputFrame` — pure, never throws,
   *     returns a `ProtocolValidation`. If malformed, we log and take NO state
   *     mutation (no throw propagates to the transport).
   *  2. SERVER (semantic): the frame's `sequence` must be STRICTLY GREATER than
   *     the player's current `acknowledgedSequence`. Duplicate or
   *     out-of-order (lower) sequences are ignored, not an error.
   *
   * On success we advance `acknowledgedSequence` to the frame's sequence and
   * update `yaw` to the frame's `lookYaw`. Movement (`moveX`/`moveZ`) is
   * intentionally NOT integrated here — authoritative movement is Stage 2C.
   */
  private handlePlayerInput(client: Client, message: unknown): void {
    const player = this.players.get(client.sessionId);
    if (!player) {
      // Input from a client with no player entry (should not happen after
      // onJoin; guard against it) — no state to mutate.
      console.warn(
        `${LOG} PLAYER_INPUT from sessionId=${client.sessionId} with no player entry; ignored`,
      );
      return;
    }

    // 1) Protocol / structural validation.
    const validation = validatePlayerInputFrame(message);
    if (!validation.ok) {
      console.warn(
        `${LOG} malformed PLAYER_INPUT from sessionId=${client.sessionId}: ${validation.errors.join("; ")}`,
      );
      return;
    }
    const frame: PlayerInputFrame = validation.value;

    // 2) Server / semantic validation: strict monotonic sequence.
    if (frame.sequence <= player.acknowledgedSequence) {
      // Duplicate (==) or stale (<). Ignored by design; not an error.
      console.warn(
        `${LOG} out-of-order PLAYER_INPUT from sessionId=${client.sessionId}: sequence=${frame.sequence} <= acknowledged=${player.acknowledgedSequence}; ignored`,
      );
      return;
    }

    // Accepted: advance acknowledgement and update the rendering-facing yaw.
    player.acknowledgedSequence = frame.sequence;
    player.yaw = frame.lookYaw;
  }
}
