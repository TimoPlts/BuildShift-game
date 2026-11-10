/**
 * Integration test: the AI chat route is served on the SAME origin as the
 * Colyseus game server (via `attachExpressApp`), and both work side by side.
 *
 * No real LLM call is made — a stub chat service is injected through
 * `createServer`'s dependency hooks.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@colyseus/sdk";

import { TWO_PLAYER_MOVEMENT_ROOM } from "../src/rooms/TwoPlayerMovementRoom.js";
import { createServer, startServer, shutdownServer, type GameServer } from "../src/server.js";

describe("game server + /api/ai-chat on one origin", () => {
  let server: GameServer;
  let port: number;

  beforeAll(async () => {
    const stub = async (body: unknown): Promise<{ conversationId: string; reply: string }> => {
      const message = (body as { message?: unknown })?.message;
      if (typeof message !== "string" || message.trim().length === 0) {
        const error = Object.assign(new Error("bad request"), {
          code: "invalid_request",
          statusCode: 400,
        });
        throw error;
      }
      return { conversationId: "conv_fixed", reply: `echo: ${message}` };
    };
    const created = createServer({}, { aiChatService: stub });
    const started = await startServer(0, created);
    server = started.server;
    port = started.port;
  });

  afterAll(async () => {
    await shutdownServer(server);
  });

  it("answers POST /api/ai-chat over HTTP on the game-server port", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/ai-chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "how do I build?" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      conversationId: "conv_fixed",
      reply: "echo: how do I build?",
    });
  });

  it("returns the stub's bounded error over HTTP", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/ai-chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "" }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_request");
  });

  it("still serves the Colyseus WebSocket gameplay endpoint on the same origin", async () => {
    const client = new Client(`http://127.0.0.1:${port}`);
    const room = await client.joinOrCreate(TWO_PLAYER_MOVEMENT_ROOM, []);
    try {
      // Joining successfully proves the WS transport survived the
      // attachExpressApp rewiring of the shared HTTP server.
      expect(room.sessionId).toBeTruthy();
      // The room state is present (a Colyseus schema object).
      expect(room.state).toBeTruthy();
    } finally {
      await room.leave();
    }
  }, 15000);

  it("rejects GET on the chat route (POST-only)", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/ai-chat`);
    // Express returns 404 for unhandled method/path combinations on this
    // route; any non-2xx/3xx is acceptable — the key property is that no
    // chat payload is produced.
    expect([404, 405]).toContain(response.status);
    const text = await response.text();
    expect(text).not.toContain("conversationId");
  });
});
