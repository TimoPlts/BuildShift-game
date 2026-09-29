import { describe, expect, it, vi } from "vitest";
import { EVENTS, ROOMS } from "@buildshift/protocol";
import { FoundationNetwork, type RoomLike } from "./foundationNetwork";

/** A hand-rolled fake room — no mock framework, no `@colyseus/sdk`. */
function createFakeRoom(overrides: Partial<RoomLike> = {}) {
  const sent: Array<{ type: string; payload?: unknown }> = [];
  let stateCb: ((state: unknown) => void) | null = null;
  let leaveCb: ((code: number, reason?: string) => void) | null = null;
  let dropCb: ((code: number, reason?: string) => void) | null = null;
  const leave = vi.fn().mockResolvedValue(130);

  const room: RoomLike = {
    roomId: "room-1",
    sessionId: "session-1",
    state: { players: {} },
    reconnection: { enabled: true },
    onStateChange: (cb: (state: unknown) => void) => {
      stateCb = cb;
    },
    onLeave: (cb: (code: number, reason?: string) => void) => {
      leaveCb = cb;
    },
    onDrop: (cb: (code: number, reason?: string) => void) => {
      dropCb = cb;
    },
    send: (type: string, payload?: unknown) => {
      sent.push({ type, payload });
    },
    leave,
    ...overrides,
  };

  // Fire helpers read the *current* callback so a late-wired listener is hit.
  const fireStateChange = (state: unknown) => stateCb?.(state);
  const fireLeave = (code: number, reason?: string) => leaveCb?.(code, reason);
  const fireDrop = (code: number, reason?: string) => dropCb?.(code, reason);

  return { room, sent, fireStateChange, fireLeave, fireDrop, leave };
}

/** Flush pending microtasks so `joinRoom` promises settle. */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

function validFrame(sequence = 1) {
  return {
    sequence,
    moveX: 0,
    moveZ: 1,
    lookYaw: 0,
    lookPitch: 0,
    jump: false,
  };
}

describe("FoundationNetwork", () => {
  it("connects on start and exposes room/session ids + connected status", async () => {
    const { room } = createFakeRoom();
    let joinedName: string | null = null;
    const network = new FoundationNetwork({
      serverUrl: "ws://localhost:2567",
      joinRoom: (name) => {
        joinedName = name;
        return Promise.resolve(room);
      },
    });

    network.start();
    await flush();

    expect(joinedName).toBe(ROOMS.FOUNDATION);
    // Auto-reconnect is explicitly disabled per spec.
    expect(room.reconnection.enabled).toBe(false);

    const ui = network.getUiState();
    expect(ui.status).toBe("connected");
    expect(ui.roomId).toBe("room-1");
    expect(ui.sessionId).toBe("session-1");
    expect(ui.serverUrl).toBe("ws://localhost:2567");
    expect(ui.playerCount).toBe(0);
    expect(ui.error).toBe(null);
  });

  it("is idempotent: a second start() does not rejoin", async () => {
    const { room } = createFakeRoom();
    const joinRoom = vi.fn().mockResolvedValue(room);
    const network = new FoundationNetwork({ serverUrl: "ws://x", joinRoom });

    network.start();
    await flush();
    network.start();
    await flush();

    expect(joinRoom).toHaveBeenCalledTimes(1);
  });

  it("observes player count changes via state updates", async () => {
    const { room, fireStateChange } = createFakeRoom();
    const network = new FoundationNetwork({
      serverUrl: "ws://x",
      joinRoom: () => Promise.resolve(room),
    });
    network.start();
    await flush();
    expect(network.getUiState().playerCount).toBe(0);

    // A second player joins → observed as a new entry in state.players.
    fireStateChange({
      players: {
        "session-1": {
          playerId: "session-1",
          position: { x: 0, y: 0, z: 0 },
          yaw: 0,
          acknowledgedSequence: 0,
        },
        "session-2": {
          playerId: "session-2",
          position: { x: 1, y: 0, z: 1 },
          yaw: 0.5,
          acknowledgedSequence: 3,
        },
      },
    });

    const ui = network.getUiState();
    expect(ui.playerCount).toBe(2);
    expect(Object.keys(ui.players).sort()).toEqual(["session-1", "session-2"]);
    expect(ui.players["session-2"].position).toEqual({ x: 1, y: 0, z: 1 });
  });

  it("observes a player leaving via a reduced state", async () => {
    const { room, fireStateChange } = createFakeRoom();
    const network = new FoundationNetwork({
      serverUrl: "ws://x",
      joinRoom: () => Promise.resolve(room),
    });
    network.start();
    await flush();

    const two = {
      players: {
        a: { playerId: "a", position: { x: 0, y: 0, z: 0 }, yaw: 0, acknowledgedSequence: 0 },
        b: { playerId: "b", position: { x: 0, y: 0, z: 0 }, yaw: 0, acknowledgedSequence: 0 },
      },
    };
    fireStateChange(two);
    expect(network.getUiState().playerCount).toBe(2);

    // Player b leaves → only a remains.
    fireStateChange({ players: { a: two.players.a } });
    const ui = network.getUiState();
    expect(ui.playerCount).toBe(1);
    expect(Object.keys(ui.players)).toEqual(["a"]);
  });

  it("surfaces a join failure as an error and stays disconnected (never throws)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const network = new FoundationNetwork({
      serverUrl: "ws://x",
      joinRoom: () => Promise.reject(new Error("boom")),
    });

    expect(() => network.start()).not.toThrow();
    await flush();

    const ui = network.getUiState();
    expect(ui.status).toBe("disconnected");
    expect(ui.roomId).toBe(null);
    expect(ui.sessionId).toBe(null);
    expect(ui.error).toBe("boom");
    warn.mockRestore();
  });

  it("moves to disconnected with a reason when the room drops", async () => {
    const { room, fireDrop } = createFakeRoom();
    const network = new FoundationNetwork({
      serverUrl: "ws://x",
      joinRoom: () => Promise.resolve(room),
    });
    network.start();
    await flush();
    expect(network.getUiState().status).toBe("connected");

    fireDrop(1006, "abnormal");
    const ui = network.getUiState();
    expect(ui.status).toBe("disconnected");
    expect(ui.error).toContain("1006");
    expect(ui.error).toContain("abnormal");
    expect(ui.playerCount).toBe(0);
  });

  it("sendPlayerInput sends via the shared PLAYER_INPUT event and returns true", async () => {
    const { room, sent } = createFakeRoom();
    const network = new FoundationNetwork({
      serverUrl: "ws://x",
      joinRoom: () => Promise.resolve(room),
    });
    network.start();
    await flush();

    const result = network.sendPlayerInput(validFrame(42));
    expect(result).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe(EVENTS.PLAYER_INPUT);
    expect(sent[0].payload).toEqual(validFrame(42));
  });

  it("sendPlayerInput rejects a malformed frame (false, no send)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { room, sent } = createFakeRoom();
    const network = new FoundationNetwork({
      serverUrl: "ws://x",
      joinRoom: () => Promise.resolve(room),
    });
    network.start();
    await flush();

    // moveZ out of the [-1, 1] range → invalid.
    const malformed = { ...validFrame(1), moveZ: 5 };
    const result = network.sendPlayerInput(malformed);
    expect(result).toBe(false);
    expect(sent).toHaveLength(0);
    warn.mockRestore();
  });

  it("sendPlayerInput returns false and does not send when not connected", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { room, sent } = createFakeRoom();
    const network = new FoundationNetwork({
      serverUrl: "ws://x",
      joinRoom: () => Promise.resolve(room),
    });

    // Never started → not connected.
    expect(network.sendPlayerInput(validFrame(1))).toBe(false);
    expect(sent).toHaveLength(0);
    warn.mockRestore();
  });

  it("dispose() leaves the room, disposes the adapter, and stops emitting", async () => {
    const { room, leave, fireStateChange } = createFakeRoom();
    const network = new FoundationNetwork({
      serverUrl: "ws://x",
      joinRoom: () => Promise.resolve(room),
    });
    network.start();
    await flush();
    expect(network.getUiState().status).toBe("connected");

    const listener = vi.fn();
    const unsubscribe = network.subscribe(listener);

    network.dispose();
    expect(leave).toHaveBeenCalledOnce();
    expect(network.getUiState().status).toBe("disconnected");
    // dispose() emitted the `disposed` event at least once.
    expect(listener).toHaveBeenCalled();

    // After dispose, a stray state change must NOT emit.
    listener.mockClear();
    fireStateChange({ players: { a: { playerId: "a", position: { x: 0, y: 0, z: 0 }, yaw: 0, acknowledgedSequence: 0 } } });
    expect(listener).not.toHaveBeenCalled();

    // start() after dispose is a no-op.
    network.start();
    await flush();
    expect(leave).toHaveBeenCalledOnce();

    unsubscribe();
  });
});
