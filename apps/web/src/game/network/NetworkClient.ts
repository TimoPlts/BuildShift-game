/**
 * NetworkClient — the Colyseus client for the canonical multiplayer game room.
 *
 * The SINGLE canonical client-side networking module. Connects to the game
 * server, joins the "two-player-movement" room, and exposes a clean API for
 * the GameRuntime: start(), stop(), sendInput(), send(), onStateChange(),
 * onEvent(). Provides typed send methods for weapon intents (switch, reload)
 * and build-edit intents using the correct message types the server listens on.
 *
 * Authority contract: the client NEVER writes to room state. All state
 * mutations happen on the server; the client only reads the synced
 * RoomStateSchema, listens for events, and sends input/weapon/build messages.
 */
import { Client } from "@colyseus/sdk";
import type {
  BuildingState,
  PlayerNetworkInput,
  StructureDurabilityState,
  StructureOpeningPattern,
  WeaponId,
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
import { REMATCH_REQUEST_MESSAGE } from "./matchEvents";

export const ROOM_NAME = "two-player-movement";
export const INPUT_MESSAGE_TYPE = "two-player:input";
export const WEAPON_SWITCH_MESSAGE = "two-player:weapon_switch";
export const WEAPON_RELOAD_MESSAGE = "two-player:weapon_reload";
export const WEAPON_STATE_EVENT = "combat:weapon_state";
export const BUILD_EDIT_MESSAGE = "build:edit_request";
export const COMBAT_HIT_EVENT = "combat:hit";
export const COMBAT_ELIMINATED_EVENT = "combat:eliminated";

/** Structural view of the Colyseus Room for test substitution. */
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
  onError: (callback: (code: number, reason?: string) => void) => void;
  leave: (consented?: boolean) => Promise<number>;
}

export interface ParsedRoomState {
  players: Record<string, ParsedPlayerState>;
  match: ParsedMatchState;
  building: BuildingState;
  structureDurabilities: Record<string, StructureDurabilityState>;
}

export type { ParsedPlayerState } from "./playerStateParse";

export interface NetworkClientOptions {
  serverUrl?: string;
  roomName?: string;
}

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
  private startPromise: Promise<void> | null = null;

  public constructor(options: NetworkClientOptions = {}) {
    this.serverUrl = options.serverUrl ?? resolveGameServerUrl();
    this.roomName = options.roomName ?? ROOM_NAME;
  }

  public get sessionId(): string | null {
    return this._sessionId;
  }

  public get isConnected(): boolean {
    return this._isConnected;
  }

  public get state(): ParsedRoomState {
    return this._parsedState;
  }

  public async start(): Promise<void> {
    if (this.disposed) throw new Error("NetworkClient is disposed.");
    if (this.started) return this.startPromise ?? Promise.resolve();
    this.started = true;
    const client = new Client(this.serverUrl);
    this.client = client;
    this.startPromise = client
      .joinOrCreate(this.roomName)
      .then((sdkRoom) => {
        // A React teardown can happen while the Colyseus matchmake/join is
        // still pending. Never attach that late room to an already-stopped
        // runtime; leave it instead so it cannot become an orphan socket.
        if (this.disposed || !this.started || this.client !== client) {
          void sdkRoom.leave().catch(() => {});
          return;
        }
        this.attachRoom(sdkRoom as unknown as RoomLike);
      })
      .catch((error: unknown) => {
        console.error(
          `NetworkClient: joinOrCreate("${this.roomName}") failed at ${this.serverUrl}.`,
          error,
        );
        if (this.client === client) {
          this.client = null;
          this.started = false;
        }
        throw error;
      });
    return this.startPromise;
  }

  public stop(): void {
    if (!this.started || this.disposed) return;
    this.detachRoom();
    this.started = false;
    this.startPromise = null;
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
   * Send one PlayerNetworkInput frame to the server. This is the typed send
   * path for **fire**: the `primaryFire` field carries the fire intent,
   * synchronized with movement so the server validates fire via `fireGate`.
   */
  public sendInput(input: PlayerNetworkInput): boolean {
    return this.send(INPUT_MESSAGE_TYPE, input);
  }

  /**
   * Send a weapon switch intent. Uses "two-player:weapon_switch" with
   * `{ targetWeaponId }` matching the protocol's `WeaponSwitch` interface.
   */
  public sendWeaponSwitch(weaponId: WeaponId): boolean {
    return this.send(WEAPON_SWITCH_MESSAGE, { targetWeaponId: weaponId });
  }

  /**
   * Send a weapon reload intent. Uses "two-player:weapon_reload". The active
   * weapon is implied by the server's authoritative weapon state.
   */
  public sendWeaponReload(): boolean {
    return this.send(WEAPON_RELOAD_MESSAGE, {});
  }

  /**
   * Send a build-edit intent. Uses "build:edit_request" with
   * `{ structureId, editPattern }` matching the protocol's `BuildEdit`.
   */
  public sendBuildEdit(
    structureId: string,
    editPattern: StructureOpeningPattern,
  ): boolean {
    return this.send(BUILD_EDIT_MESSAGE, { structureId, editPattern });
  }

  /** Send one canonical mutual-rematch vote without leaving the current room. */
  public sendRematchRequest(): boolean {
    return this.send(REMATCH_REQUEST_MESSAGE, {});
  }

  public send(type: string, payload?: unknown): boolean {
    if (!this.room || !this._isConnected) return false;
    try {
      this.room.send(type, payload);
      return true;
    } catch {
      return false;
    }
  }

  public onStateChange(callback: (state: ParsedRoomState) => void): () => void {
    this.stateListeners.add(callback);
    return () => { this.stateListeners.delete(callback); };
  }

  public onConnectionChange(
    callback: (connected: boolean) => void,
  ): () => void {
    this.connectionListeners.add(callback);
    return () => { this.connectionListeners.delete(callback); };
  }

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
    if (this.room) this.attachMessageHandler(eventName);
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

  public dispose(): void {
    this.stop();
    this.disposed = true;
    this.stateListeners.clear();
    this.connectionListeners.clear();
    this.eventListeners.clear();
    for (const remover of this.messageHandlerRemovers.values()) remover();
    this.messageHandlerRemovers.clear();
    this.client = null;
  }

  // --- internals -----------------------------------------------------------

  private attachRoom(room: RoomLike): void {
    this.room = room;
    this._sessionId = room.sessionId;
    this._isConnected = true;
    room.onStateChange((state) => { this.handleStateChange(state); });
    room.onError((code, reason) => {
      console.error(
        `NetworkClient: room ${room.roomId} connection error (${code})${reason ? `: ${reason}` : ""}.`,
      );
    });
    room.onLeave(() => { this.handleDisconnect(); });
    room.onDrop(() => { this.handleDisconnect(); });
    for (const eventName of this.eventListeners.keys()) {
      this.attachMessageHandler(eventName);
    }
    this.handleStateChange(room.state);
    this.emitConnectionChange();
    this.emitStateChange();
  }

  private detachRoom(): void {
    for (const remover of this.messageHandlerRemovers.values()) remover();
    this.messageHandlerRemovers.clear();
    if (this.room) {
      void this.room.leave().catch(() => {});
      this.room = null;
    }
    this.client = null;
  }

  private attachMessageHandler(eventName: string): void {
    if (this.messageHandlerRemovers.has(eventName) || !this.room) return;
    const handler = this.room.onMessage(eventName, (payload) => {
      const listeners = this.eventListeners.get(eventName);
      if (listeners) {
        for (const listener of listeners) listener(payload);
      }
    });
    this.messageHandlerRemovers.set(eventName, () => {
      if (typeof handler === "function") (handler as () => void)();
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
    for (const listener of this.stateListeners) listener(this._parsedState);
  }

  private emitConnectionChange(): void {
    for (const listener of this.connectionListeners) listener(this._isConnected);
  }
}

/**
 * Parse the raw Colyseus room state into a plain ParsedRoomState.
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
