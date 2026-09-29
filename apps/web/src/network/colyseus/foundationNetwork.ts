import {
  EVENTS,
  ROOMS,
  validatePlayerInputFrame,
  type PlayerInputFrame,
} from "@buildshift/protocol";
import {
  computeNextConnectionState,
  type ConnectionEvent,
  type ConnectionState,
} from "./connectionState";
import {
  mapPlayersToSnapshot,
  type PlayerSnapshotMap,
} from "./playerSnapshot";

/**
 * A minimal, structural view of a joined Colyseus room.
 *
 * The adapter only ever talks to this narrow surface, which is exactly what
 * the real `@colyseus/sdk` `Room` provides (see `Room.d.ts`: `roomId`,
 * `sessionId`, `state`, `reconnection`, `onStateChange`, `onLeave`, `onDrop`,
 * `send`, `leave`). Keeping it structural means the whole adapter is
 * unit-testable with a hand-rolled fake room and **no** mock framework — and
 * the module has no runtime dependency on `@colyseus/sdk`.
 */
export interface RoomLike {
  readonly roomId: string;
  readonly sessionId: string;
  readonly state: unknown;
  reconnection: { enabled: boolean };
  onStateChange: (callback: (state: unknown) => void) => unknown;
  onLeave: (callback: (code: number, reason?: string) => void) => unknown;
  onDrop: (callback: (code: number, reason?: string) => void) => unknown;
  send: (type: string, payload?: unknown) => void;
  leave: (consented?: boolean) => Promise<number>;
}

/** Creates a joined room for the given room name. */
export type RoomJoiner = (roomName: string) => Promise<RoomLike>;

/** A stable, immutable view of the network for the dev status UI. */
export interface NetworkUiState {
  status: ConnectionState;
  serverUrl: string;
  roomId: string | null;
  sessionId: string | null;
  playerCount: number;
  players: PlayerSnapshotMap;
  error: string | null;
}

/** Options for constructing a {@link FoundationNetwork}. */
export interface FoundationNetworkOptions {
  serverUrl: string;
  joinRoom: RoomJoiner;
}

const LOG_PREFIX = "[buildshift:network]";

/**
 * The browser-side networking adapter for the Stage 2 foundation room.
 *
 * Responsibilities (Stage 2B2):
 *  - connect to the game server and join `ROOMS.FOUNDATION` once. Auto
 *    reconnect is deliberately disabled (the SDK re-enables it by default).
 *  - track and expose a small, immutable {@link NetworkUiState} that the dev
 *    status UI observes (status, room/session ids, player count, players,
 *    error) via a plain subscribe/getSnapshot pair — no Colyseus types leak
 *    into the UI.
 *  - maintain a plain client-side snapshot of `room.state.players`
 *    (network information **only**). It is never fed back into local
 *    prediction or the local `PlayerController`; reconciling the local player
 *    with its authoritative state is a later stage.
 *  - expose `sendPlayerInput(frame)`, which validates a frame and emits it via
 *    the shared `EVENTS.PLAYER_INPUT`. Live WASD→frame wiring is a later stage
 *    and is intentionally **not** implemented here.
 *
 * This class has **no** dependency on the concrete `@colyseus/sdk` `Client`;
 * it is handed a `joinRoom` seam. The real-client factory lives in
 * `createFoundationNetwork.ts`.
 */
export class FoundationNetwork {
  private readonly serverUrl: string;
  private readonly joinRoom: RoomJoiner;

  private room: RoomLike | null = null;
  private status: ConnectionState = "disconnected";
  private error: string | null = null;
  private players: PlayerSnapshotMap = {};
  private started = false;
  private disposed = false;
  /** Cached, referentially-stable UI snapshot; rebuilt only when data changes. */
  private uiSnapshot: NetworkUiState;
  private readonly listeners = new Set<() => void>();

  public constructor(options: FoundationNetworkOptions) {
    this.serverUrl = options.serverUrl;
    this.joinRoom = options.joinRoom;
    this.uiSnapshot = this.buildUiSnapshot();
  }

  /**
   * Begin connecting and join the foundation room. Idempotent: calling it more
   * than once is a no-op. A failure to connect (e.g. the server is not
   * running) never throws to the caller — it is surfaced as an error in the
   * UI state so the rest of the game keeps running.
   */
  public start(): void {
    if (this.started || this.disposed) {
      return;
    }
    this.started = true;
    this.applyEvent("join-started");

    this.joinRoom(ROOMS.FOUNDATION)
      .then((room) => {
        if (this.disposed) {
          // Disposed while the join was in flight: tear it down and stop.
          void room.leave();
          return;
        }
        this.attachRoom(room);
      })
      .catch((error: unknown) => {
        if (this.disposed) {
          return;
        }
        console.warn(`${LOG_PREFIX} failed to join ${ROOMS.FOUNDATION}:`, error);
        this.error = describeError(error);
        this.applyEvent("disconnected");
      });
  }

  /**
   * Send one validated {@link PlayerInputFrame} to the server via the shared
   * `EVENTS.PLAYER_INPUT` event.
   *
   * This is the *send API only* — it does not read the live keyboard state.
   * Wiring WASD/jump into frames is a later stage.
   *
   * @returns `true` when the frame was sent, `false` when it was rejected
   *          (malformed frame, or no active connection).
   */
  public sendPlayerInput(frame: PlayerInputFrame): boolean {
    const validation = validatePlayerInputFrame(frame);
    if (!validation.ok) {
      console.warn(
        `${LOG_PREFIX} sendPlayerInput rejected malformed frame:`,
        validation.errors,
      );
      return false;
    }
    if (this.status !== "connected" || this.room === null) {
      console.warn(
        `${LOG_PREFIX} sendPlayerInput called while not connected (no-op)`,
      );
      return false;
    }
    this.room.send(EVENTS.PLAYER_INPUT, validation.value);
    return true;
  }

  /**
   * Tear down the connection and stop observing. Safe to call multiple times.
   * After dispose, {@link start} is a no-op.
   */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const room = this.room;
    this.room = null;
    if (room) {
      void room.leave().catch(() => {
        // A drop that has already happened (network went away) — ignore.
      });
    }
    this.applyEvent("disposed");
    this.listeners.clear();
  }

  /**
   * Subscribe to UI-state changes. Returns an unsubscribe function. This is
   * the stable "subscribe" half of the pair used by React's
   * `useSyncExternalStore` (see `createFoundationNetwork.ts` / the status
   * badge). It only ever calls the listener after the snapshot has actually
   * changed.
   */
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Return the current, referentially-stable UI snapshot. The same object is
   * returned until the network data changes, which is the contract
   * `useSyncExternalStore` requires to avoid redundant re-renders.
   */
  public getUiState(): NetworkUiState {
    return this.uiSnapshot;
  }

  // --- internals -----------------------------------------------------------

  /**
   * Wire up a freshly joined room: disable auto-reconnect, observe state
   * changes, capture the initial state, and move to `connected`.
   */
  private attachRoom(room: RoomLike): void {
    this.room = room;
    // The SDK enables reconnection by default; the Stage 2B2 spec requires no
    // auto-reconnect, so turn it off explicitly on this room.
    room.reconnection.enabled = false;

    room.onStateChange((state) => this.handleStateChange(state));
    room.onLeave((code, reason) => this.handleDisconnect(code, reason));
    room.onDrop((code, reason) => this.handleDisconnect(code, reason));

    // The initial state is already present on the joined room; capture it now
    // so the UI is correct from the first frame, and keep observing updates.
    this.handleStateChange(room.state);

    this.error = null;
    this.applyEvent("connected");
  }

  private handleStateChange(state: unknown): void {
    // Once disposed the adapter no longer processes room events; a stray state
    // change (e.g. a drop racing the clean leave) must not re-emit.
    if (this.disposed) {
      return;
    }
    // Contract: `room.state.players` is the players root (a map keyed by
    // player/session id). Tolerate an empty/undefined root defensively.
    const playersRoot = (state as { players?: unknown } | null)?.players;
    this.setPlayers(mapPlayersToSnapshot(playersRoot));
  }

  private handleDisconnect(code: number, reason?: string): void {
    if (this.disposed) {
      return;
    }
    this.room = null;
    this.error = describeDisconnect(code, reason);
    this.setPlayers({});
    this.applyEvent("disconnected");
  }

  private setPlayers(next: PlayerSnapshotMap): void {
    if (samePlayers(this.players, next)) {
      return;
    }
    this.players = next;
    this.emitChange();
  }

  /**
   * Apply a lifecycle event to the connection status. Every event either moves
   * the status or carries new data (e.g. a disconnect's error string), so we
   * always rebuild and emit. The pure {@link computeNextConnectionState} does
   * the status math; this method just stores it and publishes.
   */
  private applyEvent(event: ConnectionEvent): void {
    this.status = computeNextConnectionState(this.status, event);
    this.emitChange();
  }

  private buildUiSnapshot(): NetworkUiState {
    return {
      status: this.status,
      serverUrl: this.serverUrl,
      roomId: this.room?.roomId ?? null,
      sessionId: this.room?.sessionId ?? null,
      playerCount: Object.keys(this.players).length,
      players: this.players,
      error: this.error,
    };
  }

  private emitChange(): void {
    this.uiSnapshot = this.buildUiSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/** A human-readable description of a join/connect failure. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** A human-readable description of a disconnect/drop event. */
function describeDisconnect(code: number, reason?: string): string {
  const base = `disconnected (code=${code})`;
  return reason ? `${base}: ${reason}` : base;
}

/**
 * Shallow structural comparison of two player snapshots. The snapshot objects
 * are plain (no nested identity beyond `position`), so a key-by-key field
 * compare is sufficient and cheap.
 */
function samePlayers(
  a: PlayerSnapshotMap,
  b: PlayerSnapshotMap,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    const pa = a[key];
    const pb = b[key];
    if (!pb) {
      return false;
    }
    if (
      pa.playerId !== pb.playerId ||
      pa.position.x !== pb.position.x ||
      pa.position.y !== pb.position.y ||
      pa.position.z !== pb.position.z ||
      pa.yaw !== pb.yaw ||
      pa.acknowledgedSequence !== pb.acknowledgedSequence
    ) {
      return false;
    }
  }
  return true;
}
