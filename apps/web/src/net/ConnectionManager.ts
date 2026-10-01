/**
 * ConnectionManager — manages the Colyseus client connection for the
 * Stage 2D two-player movement room.
 *
 * Responsibilities:
 *  - Create a `Client` pointed at the game server URL.
 *  - Join the `'two-player-movement'` room (via `joinOrCreate`).
 *  - Expose the joined `Room` instance (or `null`) for other systems.
 *  - Handle disconnection and provide a simple retry mechanism.
 *  - Emit lifecycle events (connected, disconnected) that the
 *    `MultiplayerPlayerController` observes to manage visuals.
 *
 * Authority contract: the client NEVER writes to room state. All
 * state mutations happen on the server; the client only reads the
 * synced `RoomStateSchema` and sends `MovementInput` messages.
 */
import { Client } from "@colyseus/sdk";

/**
 * A narrow, structural view of the Colyseus `Room` that the rest of the
 * networking layer consumes. Keeping it structural means unit tests can
 * substitute a plain fake room without mocking the SDK.
 */
export interface RoomLike {
  readonly sessionId: string;
  readonly state: unknown;
  send: (type: string, payload?: unknown) => void;
  onStateChange: (callback: (state: unknown) => void) => void;
  onPlayerJoin: (callback: (client: { sessionId: string }) => void) => void;
  onPlayerLeave: (callback: (client: { sessionId: string }) => void) => void;
  onLeave: (callback: (code: number, reason?: string) => void) => void;
  onDrop: (callback: (code: number, reason?: string) => void) => void;
  leave: (consented?: boolean) => Promise<number>;
}

/**
 * Lifecycle events emitted by the ConnectionManager.
 */
export type ConnectionEvent =
  | { type: "connected"; room: RoomLike }
  | { type: "disconnected"; code: number; reason?: string }
  | { type: "player-joined"; sessionId: string }
  | { type: "player-left"; sessionId: string }
  | { type: "state-changed"; state: unknown };

/**
 * A callback that receives connection lifecycle events.
 */
export type ConnectionListener = (event: ConnectionEvent) => void;

/** Options for the ConnectionManager. */
export interface ConnectionManagerOptions {
  /**
   * The game server WebSocket URL (e.g. `ws://localhost:2567`).
   */
  serverUrl: string;
  /**
   * The Colyseus room name to join. Defaults to `'two-player-movement'`.
   */
  roomName?: string;
}

/** Default room name for the Stage 2D two-player movement room. */
const DEFAULT_ROOM_NAME = "two-player-movement";

/**
 * Manages the Colyseus client connection lifecycle for the
 * two-player movement room.
 *
 * Usage:
 * ```ts
 * const cm = new ConnectionManager({ serverUrl: "ws://localhost:2567" });
 * cm.on((event) => { ... });
 * await cm.connect();
 * // ... game loop ...
 * cm.disconnect();
 * ```
 */
export class ConnectionManager {
  private readonly serverUrl: string;
  private readonly roomName: string;
  private client: Client | null = null;
  private _room: RoomLike | null = null;
  private readonly listeners = new Set<ConnectionListener>();
  private disposed = false;
  /** Tracks whether a reconnection attempt is in progress. */
  private reconnecting = false;

  public constructor(options: ConnectionManagerOptions) {
    this.serverUrl = options.serverUrl;
    this.roomName = options.roomName ?? DEFAULT_ROOM_NAME;
  }

  /**
   * The currently joined room (or `null` when disconnected).
   * Other systems (InputSender, predictor) use this to send / read state.
   */
  public get room(): RoomLike | null {
    return this._room;
  }

  /**
   * The local player's session ID (from the joined room), or `null`.
   */
  public get sessionId(): string | null {
    return this._room?.sessionId ?? null;
  }

  /**
   * Whether the connection is currently active (joined a room).
   */
  public get isConnected(): boolean {
    return this._room !== null;
  }

  /**
   * Subscribe to connection lifecycle events. Returns an unsubscribe
   * function. Multiple listeners are supported.
   */
  public on(listener: ConnectionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Connect to the game server and join the two-player movement room.
   *
   * @param token - Optional authentication token passed to the server.
   * @returns A promise that resolves when the room is joined, or rejects
   *          on connection failure.
   */
  public async connect(token?: string): Promise<void> {
    if (this.disposed) {
      throw new Error("ConnectionManager is disposed.");
    }
    if (this._room) {
      throw new Error("Already connected; call disconnect() first.");
    }

    this.client = new Client(this.serverUrl);

    // In Colyseus v0.18, the auth token is passed as the second argument
    // to join/joinOrCreate. If no token is provided, pass `undefined`.
    const sdkRoom = await this.client.joinOrCreate(
      this.roomName,
      token !== undefined ? { token } : undefined,
    );

    if (this.disposed) {
      // Disposed while the join was in flight; tear down.
      void sdkRoom.leave();
      return;
    }

    this.attachRoom(sdkRoom as unknown as RoomLike);
  }

  /**
   * Disconnect: leave the room and destroy the client.
   * Safe to call multiple times (idempotent).
   */
  public disconnect(): void {
    if (this.disposed) {
      return;
    }
    this.teardown();
    this.emit({ type: "disconnected", code: 0, reason: "local-disconnect" });
  }

  /**
   * Tear down all resources (client + room). After this call the
   * ConnectionManager cannot be reused — create a new instance.
   */
  public dispose(): void {
    this.disposed = true;
    this.teardown();
    this.listeners.clear();
  }

  // --- internals -----------------------------------------------------------

  private attachRoom(room: RoomLike): void {
    this._room = room;

    room.onStateChange((state) => {
      this.emit({ type: "state-changed", state });
    });

    room.onPlayerJoin((client) => {
      this.emit({ type: "player-joined", sessionId: client.sessionId });
    });

    room.onPlayerLeave((client) => {
      this.emit({ type: "player-left", sessionId: client.sessionId });
    });

    room.onLeave((code, reason) => {
      this.handleDisconnect(code, reason);
    });

    room.onDrop((code, reason) => {
      this.handleDisconnect(code, reason);
      // Attempt a simple reconnection (one retry).
      this.scheduleReconnect();
    });

    this.emit({ type: "connected", room });
  }

  private handleDisconnect(code: number, reason?: string): void {
    if (!this._room) {
      return;
    }
    this.teardown();
    this.emit({ type: "disconnected", code, reason });
  }

  private teardown(): void {
    if (this._room) {
      void this._room.leave().catch(() => {
        // Drop that already happened — ignore.
      });
      this._room = null;
    }
    if (this.client) {
      this.client = null;
    }
    this.reconnecting = false;
  }

  /**
   * Schedule a single reconnection attempt after a network drop.
   * Colyseus' built-in reconnection is disabled here in favour of a
   * simple manual retry so we have full control over the lifecycle.
   */
  private scheduleReconnect(): void {
    if (this.disposed || this.reconnecting) {
      return;
    }
    this.reconnecting = true;

    // Simple retry: wait 1 s then attempt to reconnect once.
    setTimeout(() => {
      this.reconnecting = false;
      if (this.disposed || this._room) {
        return;
      }
      this.client = new Client(this.serverUrl);
      this.client
        .joinOrCreate(this.roomName)
        .then((sdkRoom) => {
          if (this.disposed) {
            void sdkRoom.leave();
            return;
          }
          this.attachRoom(sdkRoom as unknown as RoomLike);
        })
        .catch(() => {
          // Reconnection failed; stay disconnected. The caller can
          // retry manually via connect().
          this.emit({
            type: "disconnected",
            code: 9999,
            reason: "reconnect-failed",
          });
        });
    }, 1000);
  }

  private emit(event: ConnectionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
