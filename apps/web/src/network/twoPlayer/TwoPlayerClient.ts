/**
 * TwoPlayerClient — the Colyseus client for the Stage 2D two-player
 * movement room.
 *
 * This is the canonical client-side networking module for the multiplayer
 * movement system. It:
 *  - connects to the game server (configurable URL, default ws://localhost:2567)
 *  - joins the "two-player-movement" room
 *  - exposes a clean API for the GameRuntime to drive:
 *    start(), stop(), sendInput(), onStateChange(), onEvent()
 *  - tracks the local session ID
 *  - parses the synchronized RoomStateSchema into plain player state
 *    objects (extended with combat fields) for the prediction and
 *    interpolation layers
 *
 * Authority contract: the client NEVER writes to room state. All state
 * mutations happen on the server; the client only reads the synced
 * RoomStateSchema, listens for combat events, and sends PlayerNetworkInput
 * messages.
 */
import { Client } from "@colyseus/sdk";
import type {
  PlayerNetworkInput,
  PlayerNetworkState,
} from "@buildshift/protocol";
import { resolveGameServerUrl } from "../colyseus/serverUrl";

/**
 * The room name for the two-player movement room. Must match the server's
 * TWO_PLAYER_MOVEMENT_ROOM constant.
 */
export const TWO_PLAYER_ROOM_NAME = "two-player-movement";

/**
 * The inbound message type for movement input (client → server). Must match
 * the server's TWO_PLAYER_MOVEMENT_INPUT constant.
 */
export const MOVEMENT_INPUT_TYPE = "two-player:input";

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
 * The full parsed room state: a map of sessionId → player state.
 */
export interface ParsedRoomState {
  players: Record<string, ParsedPlayerState>;
}

/**
 * A plain, validated player state parsed from the RoomStateSchema.
 * Extends the movement state with the combat fields carried on the wire.
 */
export interface ParsedPlayerState extends PlayerNetworkState {
  /** Authoritative current health (from the server schema). */
  health: number;
  /** Authoritative current shield. */
  shield: number;
  /** Authoritative current energy. */
  energy: number;
  /** Authoritative current magazine ammo. */
  ammo: number;
  /** Highest input sequence at which this player last fired (-1 = never). */
  lastFireSequence: number;
  /** Whether the player is eliminated. */
  isEliminated: boolean;
}

/**
 * Options for the TwoPlayerClient.
 */
export interface TwoPlayerClientOptions {
  /** The game server WebSocket URL. Defaults to resolveGameServerUrl(). */
  serverUrl?: string;
  /** The room name to join. Defaults to TWO_PLAYER_ROOM_NAME. */
  roomName?: string;
}

/**
 * The main Colyseus client for the two-player movement room.
 */
export class TwoPlayerClient {
  private readonly serverUrl: string;
  private readonly roomName: string;
  private client: Client | null = null;
  private room: RoomLike | null = null;
  private _sessionId: string | null = null;
  private _isConnected = false;
  private _parsedState: ParsedRoomState = { players: {} };
  private readonly stateListeners = new Set<(state: ParsedRoomState) => void>();
  private readonly connectionListeners = new Set<(connected: boolean) => void>();
  private readonly eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  private readonly messageHandlerRemovers = new Map<string, () => void>();
  private disposed = false;
  private started = false;

  public constructor(options: TwoPlayerClientOptions = {}) {
    this.serverUrl = options.serverUrl ?? resolveGameServerUrl();
    this.roomName = options.roomName ?? TWO_PLAYER_ROOM_NAME;
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
   * Connect to the game server and join the two-player movement room.
   * Resolves when the room is joined. Rejects on connection failure.
   * Idempotent: calling start() while already started is a no-op.
   */
  public async start(): Promise<void> {
    if (this.disposed) {
      throw new Error("TwoPlayerClient is disposed.");
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
    this._parsedState = { players: {} };
    this.emitConnectionChange();
    this.emitStateChange();
  }

  /**
   * Send one PlayerNetworkInput frame to the server.
   * No-op when not connected. Returns true if the message was sent.
   */
  public sendInput(input: PlayerNetworkInput): boolean {
    if (!this.room || !this._isConnected) {
      return false;
    }
    try {
      this.room.send(MOVEMENT_INPUT_TYPE, input);
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
   * Subscribe to a named server event (e.g. "combat:hit", "combat:eliminated").
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
    this._parsedState = { players: {} };
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
 * The server uses a RoomStateSchema with a `players` MapSchema keyed by
 * sessionId. From the client SDK, this arrives as a schema object whose
 * `players` property is a MapSchema (iterable as [key, value] pairs).
 */
export function parseRoomState(raw: unknown): ParsedRoomState {
  const result: ParsedRoomState = { players: {} };

  if (raw == null || typeof raw !== "object") {
    return result;
  }

  const playersRoot = (raw as { players?: unknown }).players;
  if (playersRoot == null) {
    return result;
  }

  if (
    typeof (playersRoot as { [Symbol.iterator]?: unknown })[Symbol.iterator] ===
    "function"
  ) {
    for (const item of playersRoot as Iterable<unknown>) {
      if (Array.isArray(item) && item.length >= 2) {
        const key = String(item[0]);
        const parsed = parsePlayerEntry(item[1]);
        if (parsed) {
          result.players[key] = parsed;
        }
      }
    }
    return result;
  }

  if (typeof playersRoot === "object" && !Array.isArray(playersRoot)) {
    for (const key of Object.keys(playersRoot)) {
      const parsed = parsePlayerEntry(
        (playersRoot as Record<string, unknown>)[key],
      );
      if (parsed) {
        result.players[key] = parsed;
      }
    }
  }

  return result;
}

/**
 * Parse one player entry from the schema into a ParsedPlayerState.
 *
 * The server's PlayerStateSchema carries x, y, z, yaw, velocityY,
 * grounded, lastProcessedSequence, health, shield, energy, ammo,
 * lastFireSequence, alive, isEliminated.
 */
function parsePlayerEntry(raw: unknown): ParsedPlayerState | null {
  if (raw == null || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const x = r.x;
  const y = r.y;
  const z = r.z;
  const yaw = r.yaw;
  const velocityY = r.velocityY;

  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof z !== "number" ||
    typeof yaw !== "number" ||
    typeof velocityY !== "number"
  ) {
    return null;
  }

  const sequence =
    typeof r.lastProcessedSequence === "number"
      ? (r.lastProcessedSequence as number)
      : -1;

  const health = typeof r.health === "number" ? r.health : 100;
  const shield = typeof r.shield === "number" ? r.shield : 0;
  const energy = typeof r.energy === "number" ? r.energy : 0;
  const ammo = typeof r.ammo === "number" ? r.ammo : 0;
  const lastFireSequence =
    typeof r.lastFireSequence === "number" ? r.lastFireSequence : -1;
  const isEliminated = r.isEliminated === true;

  return {
    x,
    y,
    z,
    vx: 0,
    vy: velocityY,
    vz: 0,
    sequence,
    yaw,
    pitch: 0,
    health,
    shield,
    energy,
    ammo,
    lastFireSequence,
    isEliminated,
  };
}
