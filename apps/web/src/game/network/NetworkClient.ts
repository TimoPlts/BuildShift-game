/**
 * NetworkClient — the Colyseus network client for the first server-authoritative
 * combat milestone.
 *
 * It wraps a Colyseus {@link Client} and exposes a small, browser-friendly
 * surface the `GameRuntime` drives each frame:
 *
 *  - {@link connect} joins the authoritative `'combat'` room and stores the
 *    local client id from the join response;
 *  - {@link sendInput} sends one {@link PlayerInput} frame per tick;
 *  - {@link onRemoteStateUpdate} subscribes to the synced {@link RoomStateSchema};
 *  - {@link onEvent} subscribes to named server events
 *    (HIT / ELIMINATED / HEALTH_UPDATE);
 *  - {@link disconnect} leaves the room and drops the socket.
 *
 * Authority contract: the client NEVER writes to room state. It only sends
 * input intents and reads the authoritative state + events the server
 * broadcasts. The sender's identity is implicit — Colyseus hands the server
 * the sender's `client.sessionId`, so the local player is always addressed by
 * its own client id without the payload needing to carry it.
 */
import { Client } from "@colyseus/sdk";
import type {
  PlayerInput,
  RoomStateSchemaInstance,
} from "@buildshift/protocol";

/**
 * The Colyseus room type the combat client joins. Must match the room type the
 * authoritative combat server registers. (The server task owns the concrete
 * `CombatRoom`; this is the stable client-side identifier.)
 */
export const COMBAT_ROOM_TYPE = "combat";

/**
 * The inbound message name carrying one {@link PlayerInput} frame
 * (client → server, per tick). Must match the server's combat input handler.
 */
export const COMBAT_INPUT_MESSAGE = "input";

/**
 * A narrow structural view of the Colyseus `Room` the network layer consumes.
 * Keeping it structural (instead of surfacing the SDK's full `Room` type)
 * means the client layer stays testable with a plain fake room and the SDK's
 * evolving internal types never leak into the game's public API. Every member
 * here is a subset of the real SDK `Room` surface, so casting the joined room
 * to this shape is safe.
 */
export interface CombatRoomLike {
  readonly roomId: string;
  readonly sessionId: string;
  readonly state: unknown;
  send: (type: string, message?: unknown) => void;
  /**
   * Subscribe to authoritative state patches. Returns a "remove" handle
   * (the bound callback) that, when invoked, unsubscribes the listener.
   */
  onStateChange: (callback: (state: unknown) => void) => () => void;
  /**
   * Subscribe to a named message/event. Returns a "remove" handle that, when
   * invoked, unsubscribes the listener.
   */
  onMessage: (
    type: string,
    callback: (message: unknown, client?: unknown) => void,
  ) => () => void;
  leave: (consented?: boolean) => Promise<number>;
}

/**
 * NetworkClient — the browser-side Colyseus client for the combat room.
 *
 * Usage:
 * ```ts
 * const network = new NetworkClient();
 * network.onRemoteStateUpdate((state) => { ... });
 * network.onEvent(EVENTS.HIT, (payload) => { ... });
 * await network.connect("ws://localhost:2567");
 * // ... game loop ...
 * network.sendInput({ sequence, moveX, moveZ, lookYaw, lookPitch, jump, primaryFire });
 * network.disconnect();
 * ```
 */
export class NetworkClient {
  private room: CombatRoomLike | null = null;
  private _localClientId: string | null = null;
  private disposed = false;

  /** State listeners, invoked with the synced {@link RoomStateSchemaInstance}. */
  private readonly stateListeners = new Set<(state: RoomStateSchemaInstance) => void>();
  /** Named-event listeners, keyed by event name. */
  private readonly eventListeners = new Map<
    string,
    Set<(payload: unknown) => void>
  >();

  /** SDK state-change "remove" handle (unsubscribes on disconnect). */
  private stateHandler: (() => void) | null = null;
  /** SDK per-event "remove" handles, keyed by event name. */
  private readonly messageHandlers = new Map<string, () => void>();

  /** The local client's Colyseus session id (null when not connected). */
  public get localClientId(): string | null {
    return this._localClientId;
  }

  /** True while joined to a combat room. */
  public get isConnected(): boolean {
    return this.room !== null;
  }

  /**
   * Connect to the authoritative combat server and join the `'combat'` room.
   *
   * Resolves once the room is joined; the local client id is stored from the
   * join response (`room.sessionId`). Idempotent: calling `connect` while
   * already connected is a no-op.
   */
  public async connect(url: string): Promise<void> {
    if (this.disposed) {
      throw new Error("NetworkClient is disconnected/disposed.");
    }
    if (this.room) {
      return;
    }

    const client = new Client(url);
    const sdkRoom = await client.joinOrCreate(COMBAT_ROOM_TYPE);
    this.attachRoom(sdkRoom as unknown as CombatRoomLike);
  }

  /**
   * Send one {@link PlayerInput} frame to the authoritative server.
   *
   * The sender is identified by its Colyseus session id (the server's
   * `onMessage` handler receives the sender's `client.sessionId`), so this is
   * effectively "sent with the local clientId" without the payload needing to
   * carry it. No-op when not connected.
   */
  public sendInput(input: PlayerInput): void {
    if (!this.room) {
      return;
    }
    try {
      this.room.send(COMBAT_INPUT_MESSAGE, input);
    } catch {
      // A transient socket teardown can throw; swallow so a bad frame never
      // crashes the render loop.
    }
  }

  /**
   * Subscribe to authoritative room-state schema changes. The callback is
   * invoked with the synced {@link RoomStateSchema} instance on every patch,
   * and (if already connected) once immediately with the current state.
   * Returns an unsubscribe function.
   */
  public onRemoteStateUpdate(
    callback: (state: RoomStateSchemaInstance) => void,
  ): () => void {
    this.stateListeners.add(callback);
    if (this.room) {
      // Late subscriber — replay the current state so the world is not blank.
      callback(this.room.state as RoomStateSchemaInstance);
    }
    return () => {
      this.stateListeners.delete(callback);
    };
  }

  /**
   * Subscribe to a named server event (e.g. `EVENTS.HIT`, `EVENTS.ELIMINATED`,
   * `EVENTS.HEALTH_UPDATE`). The callback is invoked with the event payload.
   * Returns an unsubscribe function.
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
      // Connected already — register the SDK handler now.
      this.attachMessageHandler(eventName);
    }
    return () => {
      const set = this.eventListeners.get(eventName);
      if (!set) {
        return;
      }
      set.delete(callback);
      if (set.size === 0) {
        this.eventListeners.delete(eventName);
      }
    };
  }

  /**
   * Leave the room and disconnect. Safe to call multiple times. After this the
   * client cannot be reused (the socket is dropped); create a fresh instance
   * to reconnect.
   */
  public disconnect(): void {
    if (this.disposed) {
      return;
    }
    this.detachRoom();
    this.room = null;
    this._localClientId = null;
    this.disposed = true;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private attachRoom(room: CombatRoomLike): void {
    this.room = room;
    this._localClientId = room.sessionId;

    this.stateHandler = room.onStateChange((state) => {
      this.handleStateChange(state);
    });

    // Register any events subscribed before the room was joined.
    for (const eventName of this.eventListeners.keys()) {
      this.attachMessageHandler(eventName);
    }

    // Replay the initial state to any state listeners (covers the subscribe-
    // before-connect case; onRemoteStateUpdate replays the post-connect case).
    this.handleStateChange(room.state);
  }

  /**
   * Register (at most once) the SDK handler for a named event, fanning its
   * payloads out to that event's local listeners.
   */
  private attachMessageHandler(eventName: string): void {
    if (this.messageHandlers.has(eventName) || !this.room) {
      return;
    }
    const handler = this.room.onMessage(eventName, (payload) => {
      this.dispatchEvent(eventName, payload);
    });
    this.messageHandlers.set(eventName, handler);
  }

  private handleStateChange(state: unknown): void {
    if (this.disposed) {
      return;
    }
    const typed = state as RoomStateSchemaInstance;
    for (const listener of this.stateListeners) {
      listener(typed);
    }
  }

  private dispatchEvent(eventName: string, payload: unknown): void {
    const listeners = this.eventListeners.get(eventName);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener(payload);
    }
  }

  /** Unsubscribe SDK handlers and best-effort leave the room. */
  private detachRoom(): void {
    if (this.stateHandler) {
      this.stateHandler();
      this.stateHandler = null;
    }
    for (const [eventName, handler] of this.messageHandlers) {
      handler();
      this.messageHandlers.delete(eventName);
    }
    if (this.room) {
      // Best-effort leave; the socket may already be gone.
      void this.room.leave().catch(() => undefined);
    }
    this.room = null;
  }
}
