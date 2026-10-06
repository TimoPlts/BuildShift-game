/**
 * NetworkClient — the Colyseus client for the canonical multiplayer game room.
 *
 * This is the SINGLE canonical client-side networking module. It:
 *  - connects to the game server (configurable URL, default ws://localhost:2567)
 *  - joins the "two-player-movement" room
 *  - exposes a clean API for the GameRuntime to drive:
 *    start(), stop(), sendInput(), send(), onStateChange(), onEvent()
 *  - provides typed send methods for weapon intents (switch, reload) and
 *    build-edit intents that use the correct message types the server listens on
 *  - tracks the local session ID
 *  - parses the synchronized RoomStateSchema into plain state for the
 *    prediction / interpolation layers, the authoritative match/round
 *    state, the authoritative building state (replicated structures), and
 *    the authoritative per-structure durability (when replicated).
 *
 * Authority contract: the client NEVER writes to room state. All state
 * mutations happen on the server; the client only reads the synced
 * RoomStateSchema, listens for combat/building/energy events, and sends
 * PlayerNetworkInput / build-intent / weapon-intent messages.
 */
import { Client } from "@colyseus/sdk";
import type {
  BuildingState,
  PlayerNetworkInput,
  StructureDurabilityState,
} from "@buildshift/protocol";
import {
  parseMatchState,
  type ParsedMatchState,
} from "./matchStateParse";
import {
  EMPTY_BUILDING_STATE,
  parseBuildingState,
  parseStructureDurabilities,
} from "./structureStateParse";
import {
  parsePlayers,
  type ParsedPlayerState,
} from "./playerStateParse";
import { resolveGameServerUrl } from "./serverUrl";

/**
 * The room name for the canonical Energy Box Fight transport. Must match the
 * server's TWO_PLAYER_MOVEMENT_ROOM constant.
 */
export const ROOM_NAME = "two-player-movement";

/**
 * The inbound message type for movement input (client → server). Must match
 * the server's TWO_PLAYER_MOVEMENT_INPUT constant.
 */
export const INPUT_MESSAGE_TYPE = "two-player:input";

/**
 * The message type for weapon switch intents (client → server). Must match
 * the server's WEAPON_SWITCH_INPUT constant ("two-player:weapon_switch").
 */
export const WEAPON_SWITCH_MESSAGE = "two-player:weapon_switch";

/**
 * The message type for weapon reload intents (client → server). Follows the
 * naming convention of WEAPON_SWITCH_MESSAGE for the two-player-movement room.
 */
export const WEAPON_RELOAD_MESSAGE = "two-player:weapon_reload";

/**
 * The event name for authoritative weapon state updates (server → client).
 * Must match the server's WSE constant ("combat:weapon_state").
 */
export const WEAPON_STATE_EVENT = "combat:weapon_state";

/**
 * The message type for build-edit intents (client → server). Must match
 * the protocol's BUILD_EDIT_EVENTS.EDIT_REQUEST constant.
 */
export const BUILD_EDIT_MESSAGE = "build:edit_request";

/**
 * Server → all: a confirmed hitscan hit was applied.
 */
export const COMBAT_HIT_EVENT = "combat:hit";

/**
 * Server → all: a player was eliminated.
 */
export const COMBAT_ELIMINATED_EVENT = "combat:eliminated";

/**
 * A narrow, structural view of the Colyseus Room that the client layer
 * consumes. Keeping it structural means unit tests can substitute a plain
 * fake room without mocking the SDK.
 */
export interface RoomLike {
  readonly roomId: string;
  readonly sessionId: string;
  readonly state: unknown;
  send: (type: string, payload?: unknown) => void;
  onStateChange: (callback: (state: unknown) => void) => void;
  onMessage: (
    type: string,
    callback: (message: unknown) => void,
  ) => unknown;
  onLeave: (callback: (code: number, reason?: string) => void) => void;
  onDrop: (callback: (code: number, reason?: string) => void) => void;
  leave: (consented?: boolean) => Promise<number>;
}

/**
 * The full parsed room state: a map of sessionId → player state plus the
 * authoritative match/round state, the authoritative building state (the
 * replicated structure collection), and the authoritative per-structure
 * durability (when the server replicates it on the wire).
 */
export interface ParsedRoomState {
  players: Record<string, ParsedPlayerState>;
  /** The authoritative match/round state for this room. */
  match: ParsedMatchState;
  /** The authoritative building state (replicated structures). */
  building: BuildingState;
  /**
   * The authoritative per-structure durability, keyed by `structureId`
   * (server-assigned). Empty when the server does not carry the durability
   * fields on the replicated structure entries — durability changes are
   * still consumed via the `build:structure_damaged` /
   * `build:structure_destroyed` events.
   */
  structureDurabilities: Record<string, StructureDurabilityState>;
}

/** Re-exported for existing consumers of the network module. */
export type { ParsedPlayerState } from "./playerStateParse";

/**
 * Options for the NetworkClient.
 */
export interface NetworkClientOptions {
  /** The game server WebSocket URL. Defaults to resolveGameServerUrl(). */
  serverUrl?: string;
  /** The room name to join. Defaults to ROOM_NAME. */
  roomName?: string;
}

/**
 * The main Colyseus client for the canonical multiplayer room.
 */
export class NetworkClient {
  private readonly serverUrl: string;
  private readonly roomName: string;
  private client: Client | null = null;
  private room: RoomLike | null = null;
  private _sessionId: string | null = null;
  private _isConnected = false;
  private _parsedState: ParsedRoomState = {
    players: {},
    match: parseMatchState({}),
    building: EMPTY_BUILDING_STATE,
    structureDurabilities: {},
  };
  private readonly stateListeners = new Set<(state: ParsedRoomState) => void>();
  private readonly connectionListeners = new Set<(connected: boolean) => void>();
  private readonly eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  private readonly messageHandlerRemovers = new Map<string, () => void>();
  private disposed = false;
  private started = false;

  public constructor(options: NetworkClientOptions = {}) {
    this.serverUrl = options.serverUrl ?? resolveGameServerUrl();
    this.roomName = options.roomName ?? ROOM_NAME;
  }

  /** The local player's Colyseus session ID (null when not connected). */
  public get sessionId(): string | null {
    return this._sessionId;
  }

  /** Whether the client is currently connected and joined to a room. */
  public get isConnected(): boolean {
    return this._isConnected;
  }

  /** The latest parsed room state. */
  public get state(): ParsedRoomState {
    return this._parsedState;
  }

  /**
   * Connect to the game server and join the room.
   * Resolves when the room is joined. Rejects on connection failure.
   * Idempotent: calling start() while already started is a no-op.
   */
  public async start(): Promise<void> {
    if (this.disposed) {
      throw new Error("NetworkClient is disposed.");
    }
    if (this.started) {
      return;
    }
    this.started = true;

    this.client = new Client(this.serverUrl);
    const sdkRoom = await this.client.joinOrCreate(this.roomName);
    this.attachRoom(sdkRoom as unknown as RoomLike);
  }

  /**
   * Disconnect: leave the room and clean up. Safe to call multiple times.
   */
  public stop(): void {
    if (!this.started || this.disposed) {
      return;
    }
    this.detachRoom();
    this.started = false;
    this._isConnected = false;
    this._sessionId = null;
    this._parsedState = {
      players: {},
      match: parseMatchState({}),
      building: EMPTY_BUILDING_STATE,
      structureDurabilities: {},
    };
    this.emitConnectionChange();
    this.emitStateChange();
  }

  /**
   * Send one PlayerNetworkInput frame to the server.
   * No-op when not connected. Returns true if the message was sent.
   */
  public sendInput(input: PlayerNetworkInput): boolean {
    return this.send(INPUT_MESSAGE_TYPE, input);
  }

  // ─── Typed weapon intent send methods ───────────────────────────────────────

  /**
   * Send a weapon switch intent to the server.
   *
   * Uses the canonical message type `"two-player:weapon_switch"` that the
   * TwoPlayerMovementRoom listens on. The payload carries the target weapon id
   * (e.g. `"assault_rifle"` or `"shotgun"`).
   *
   * No-op when not connected. Returns true if the message was sent.
   */
  public sendWeaponSwitch(weaponId: string): boolean {
    return this.send(WEAPON_SWITCH_MESSAGE, { targetWeaponId: weaponId });
  }

  /**
   * Send a weapon reload intent to the server.
   *
   * Uses the canonical message type `"two-player:weapon_reload"`. The active
   * weapon is implied by the player's authoritative weapon state on the
   * server, so no weapon id is carried in the payload.
   *
   * No-op when not connected. Returns true if the message was sent.
   */
  public sendWeaponReload(): boolean {
    return this.send(WEAPON_RELOAD_MESSAGE, {});
  }

  // ─── Typed build-edit intent send method ────────────────────────────────────

  /**
   * Send a build-edit intent to the server.
   *
   * Uses the canonical message type `"build:edit_request"` (matching the
   * protocol's `BUILD_EDIT_EVENTS.EDIT_REQUEST`). The payload carries the
   * structure id and the edit pattern to apply.
   *
   * No-op when not connected. Returns true if the message was sent.
   */
  public sendBuildEdit(structureId: string, editPattern: string): boolean {
    return this.send(BUILD_EDIT_MESSAGE, { structureId, editPattern });
  }

  /**
   * Send an arbitrary named message to the room (client → server).
   *
   * Generic outbound path for non-movement protocol messages — e.g. the
   * building layer's `build:placement_request` intents. No-op when not
   * connected. Returns true if the message was handed to the transport.
   */
  public send(type: string, payload?: unknown): boolean {
    if (!this.room || !this._isConnected) {
      return false;
    }
    try {
      this.room.send(type, payload);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Subscribe to parsed room state changes. Returns an unsubscribe function.
   */
  public onStateChange(callback: (state: ParsedRoomState) => void): () => void {
    this.stateListeners.add(callback);
    return () => {
      this.stateListeners.delete(callback);
    };
  }

  /**
   * Subscribe to connection state changes. Returns an unsubscribe function.
   */
  public onConnectionChange(
    callback: (connected: boolean) => void,
  ): () => void {
    this.connectionListeners.add(callback);
    return () => {
      this.connectionListeners.delete(callback);
    };
  }

  /**
   * Subscribe to a named server event (e.g. "combat:hit",
   * "combat:eliminated", "combat:weapon_state", "build:structure_placed",
   * "energy:update").
   * The callback is invoked with the event payload. Returns an unsubscribe
   * function.
   */
  public onEvent(
    eventName: string,
    callback: (payload: unknown) => void,
  ): () => void {
    let listeners = this.eventListeners.get(eventName);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(eventName, listeners);
    }
    listeners.add(callback);
    if (this.room) {
      this.attachMessageHandler(eventName);
    }
    return () => {
      const set = this.eventListeners.get(eventName);
      if (set) {
        set.delete(callback);
        if (set.size === 0) {
          this.eventListeners.delete(eventName);
          const remover = this.messageHandlerRemovers.get(eventName);
          if (remover) {
            remover();
            this.messageHandlerRemovers.delete(eventName);
          }
        }
      }
    };
  }

  /**
   * Tear down all resources. After dispose, the client cannot be reused.
   */
  public dispose(): void {
    this.disposed = true;
    this.stop();
    this.stateListeners.clear();
    this.connectionListeners.clear();
    this.eventListeners.clear();
    for (const remover of this.messageHandlerRemovers.values()) {
      remover();
    }
    this.messageHandlerRemovers.clear();
    this.client = null;
  }

  // --- internals -----------------------------------------------------------

  private attachRoom(room: RoomLike): void {
    this.room = room;
    this._sessionId = room.sessionId;
    this._isConnected = true;

    room.onStateChange((state) => {
      this.handleStateChange(state);
    });
    room.onLeave(() => {
      this.handleDisconnect();
    });
    room.onDrop(() => {
      this.handleDisconnect();
    });

    for (const eventName of this.eventListeners.keys()) {
      this.attachMessageHandler(eventName);
    }

    this.handleStateChange(room.state);
    this.emitConnectionChange();
    this.emitStateChange();
  }

  private detachRoom(): void {
    for (const remover of this.messageHandlerRemovers.values()) {
      remover();
    }
    this.messageHandlerRemovers.clear();
    if (this.room) {
      void this.room.leave().catch(() => {
        // Drop that already happened — ignore.
      });
      this.room = null;
    }
    this.client = null;
  }

  private attachMessageHandler(eventName: string): void {
    if (this.messageHandlerRemovers.has(eventName) || !this.room) {
      return;
    }
    const handler = this.room.onMessage(eventName, (payload) => {
      const listeners = this.eventListeners.get(eventName);
      if (listeners) {
        for (const listener of listeners) {
          listener(payload);
        }
      }
    });
    this.messageHandlerRemovers.set(eventName, () => {
      if (typeof handler === "function") {
        (handler as () => void)();
      }
    });
  }

  private handleStateChange(state: unknown): void {
    if (this.disposed) return;
    this._parsedState = parseRoomState(state);
    this.emitStateChange();
  }

  private handleDisconnect(): void {
    if (this.disposed || !this._isConnected) return;
    this._isConnected = false;
    this._sessionId = null;
    this._parsedState = {
      players: {},
      match: parseMatchState({}),
      building: EMPTY_BUILDING_STATE,
      structureDurabilities: {},
    };
    this.room = null;
    this.emitConnectionChange();
    this.emitStateChange();
  }

  private emitStateChange(): void {
    for (const listener of this.stateListeners) {
      listener(this._parsedState);
    }
  }

  private emitConnectionChange(): void {
    for (const listener of this.connectionListeners) {
      listener(this._isConnected);
    }
  }
}

/**
 * Parse the raw Colyseus room state into a plain ParsedRoomState.
 *
 * The server's RoomStateSchema carries `players` (MapSchema keyed by
 * sessionId), the authoritative match fields (`matchPhase`, `roundScore`,
 * `currentRound`, `lastRoundResult`), and the authoritative building state
 * (`structures` — the replicated structure collection, optionally with the
 * per-structure durability fields). Players are parsed by
 * {@link parsePlayers}, match fields by {@link parseMatchState}, structures
 * by {@link parseBuildingState}, and the replicated per-structure
 * durability by {@link parseStructureDurabilities}.
 */
export function parseRoomState(raw: unknown): ParsedRoomState {
  const structures =
    raw == null || typeof raw !== "object"
      ? undefined
      : (raw as Record<string, unknown>).structures;
  return {
    players: parsePlayers(raw),
    match: parseMatchState(raw),
    building: parseBuildingState(structures),
    structureDurabilities: parseStructureDurabilities(structures),
  };
}
