import { Client, type Room as SdkRoom } from "@colyseus/sdk";
import {
  FoundationNetwork,
  type FoundationNetworkOptions,
  type RoomLike,
} from "./colyseus/foundationNetwork";
import { resolveGameServerUrl } from "./colyseus/serverUrl";

/**
 * Build the real, browser-facing networking stack.
 *
 * This is the only module in the network layer that imports `@colyseus/sdk`
 * directly. It does two things:
 *
 *  1. Constructs a Colyseus `Client` pointed at the resolved game-server URL
 *     (see {@link resolveGameServerUrl}: `VITE_GAME_SERVER_URL` or the
 *     `ws://localhost:2567` dev fallback).
 *  2. Hands that client to the framework-agnostic {@link FoundationNetwork}
 *     adapter through the `joinRoom` seam, so every bit of state-tracking,
 *     snapshotting, and send logic stays in the testable, SDK-free adapter.
 *
 * The returned {@link FoundationNetwork} has **not** connected yet — the
 * caller starts it (see `GameRuntime`) and disposes it with the runtime.
 *
 * @param serverUrl override the resolved server URL (useful in tests / config).
 * @returns a ready-to-`start()` network adapter.
 */
export function createFoundationNetwork(
  serverUrl: string = resolveGameServerUrl(),
): FoundationNetwork {
  const client = new Client(serverUrl);

  const options: FoundationNetworkOptions = {
    serverUrl,
    // The SDK `Room` structurally satisfies `RoomLike` (see Room.d.ts:
    // roomId, sessionId, state, reconnection, onStateChange, onLeave, onDrop,
    // send, leave). We keep the structural interface in the adapter so it can
    // be exercised with a plain fake room in tests.
    joinRoom: (roomName: string) =>
      client
        .joinOrCreate(roomName)
        .then((room: SdkRoom) => room as RoomLike),
  };

  return new FoundationNetwork(options);
}
