import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAiChatRouter } from "./aiChatRoute.js";
import { createChatService } from "./chatService.js";
import { createConversationStore } from "./conversationStore.js";
import type { LlmClient } from "./llmClient.js";

const ORIGIN = "http://localhost:5173";

function buildServer(llm: LlmClient) {
  const service = createChatService({
    store: createConversationStore(
      { maxConversations: 4, maxTurnsPerConversation: 2, staleConversationMs: 60_000 },
      () => 0,
    ),
    llmClientFactory: () => llm,
    readApiKey: () => "test-key",
    now: () => 0,
  });
  const app = express();
  app.use(createAiChatRouter(service));
  return app;
}

function mockLlm(result: { content: string; finishReason: string | null }) {
  return {
    chat: async () => result,
  } as unknown as LlmClient;
}

describe("POST /api/ai-chat (HTTP)", () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = buildServer(mockLlm({ content: "hello from the guide", finishReason: "stop" })).listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error?: Error) => (error ? reject(error) : resolve())),
    );
  });

  async function post(
    body: string | unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; json: () => Promise<any>; headers: Headers }> {
    const response = await fetch(`${base}/api/ai-chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    return {
      status: response.status,
      json: async () => response.json(),
      headers: response.headers,
    };
  }

  it("returns 200 with {conversationId, reply} for a valid message", async () => {
    const result = await post({ message: "How do I win?" });
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toEqual({
      conversationId: expect.stringMatching(/^conv_/),
      reply: "hello from the guide",
    });
  });

  it("continues an existing conversation with its id", async () => {
    const first = await post({ message: "one" });
    const id = (await first.json()).conversationId;
    const second = await post({ conversationId: id, message: "two" });
    expect(second.status).toBe(200);
    expect((await second.json()).conversationId).toBe(id);
  });

  it("rejects malformed JSON with a bounded 400", async () => {
    const result = await post("{ not json");
    expect(result.status).toBe(400);
    const body = await result.json();
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain("not json");
  });

  it("rejects an oversized body with a bounded 413", async () => {
    const huge = JSON.stringify({ message: "x".repeat(70 * 1024) });
    const result = await post(huge);
    expect(result.status).toBe(413);
    const body = await result.json();
    expect(body.error.code).toBe("message_too_long");
    expect(JSON.stringify(body)).not.toContain("xxxxxx");
  });

  it("rejects an empty message with a bounded 400", async () => {
    const result = await post({ message: "   " });
    expect(result.status).toBe(400);
    expect((await result.json()).error.code).toBe("empty_message");
  });

  it("rejects an unknown conversationId with a bounded 404", async () => {
    const result = await post({
      conversationId: "conv_00000000-0000-4000-8000-000000000000",
      message: "hi",
    });
    expect(result.status).toBe(404);
    expect((await result.json()).error.code).toBe("unknown_conversation");
  });

  it("echoes the request Origin for cross-origin browsers", async () => {
    const result = await post({ message: "origin check" });
    expect(result.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("answers CORS preflight for the chat route", async () => {
    const response = await fetch(`${base}/api/ai-chat`, {
      method: "OPTIONS",
      headers: { origin: ORIGIN, "access-control-request-method": "POST" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("returns bounded errors for LLM failures without leaking details", async () => {
    // Swap in a failing LLM on a fresh server.
    const failingServer = buildServer(
      (() => {
        throw Object.assign(new Error("secret internal detail: sk-test-12345"), {
          code: "EINTERNAL",
        });
      }) as unknown as LlmClient,
    ).listen(0);
    await new Promise<void>((resolve) => failingServer.once("listening", resolve));
    const { port } = failingServer.address() as AddressInfo;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/ai-chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hi" }),
      });
      expect(response.status).toBe(502);
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("ai_error");
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("sk-test-12345");
      expect(serialized).not.toContain("secret internal detail");
    } finally {
      await new Promise<void>((resolve, reject) =>
        failingServer.close((error?: Error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
