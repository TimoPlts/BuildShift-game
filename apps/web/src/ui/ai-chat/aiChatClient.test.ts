/**
 * AI Guide client tests — the backend is fully mocked (no network, no
 * credentials). Pins the wire contract:
 *
 *  - `POST` `{conversationId?: string, message: string}` to `/api/ai-chat`
 *  - parses `{conversationId: string, reply: string}`
 *  - every failure maps to a useful player-facing error
 */
import { describe, expect, it, vi } from "vitest";
import { createAiChatClient } from "./aiChatClient";

const ENDPOINT = "http://game.test:2567/api/ai-chat";

function mockJsonFetch(payload: unknown, init?: { ok?: boolean; status?: number }) {
  const fetchImpl = vi.fn(
    async (_url: unknown, _options?: unknown): Promise<Response> => {
      return {
        ok: init?.ok ?? true,
        status: init?.status ?? 200,
        json: async () => payload,
      } as unknown as Response;
    },
  );
  return fetchImpl;
}

function client(fetchImpl: typeof fetch) {
  return createAiChatClient({ fetchImpl, endpoint: ENDPOINT });
}

describe("createAiChatClient — request shape", () => {
  it("omits conversationId on the first message of a conversation", async () => {
    const fetchImpl = mockJsonFetch({ conversationId: "c1", reply: "Hello." });
    await client(fetchImpl)({ message: "How do I win?" });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body as string)).toEqual({
      message: "How do I win?",
    });
  });

  it("includes conversationId on follow-ups (same conversation)", async () => {
    const fetchImpl = mockJsonFetch({ conversationId: "c1", reply: "Follow-up." });
    await client(fetchImpl)({ conversationId: "c1", message: "Then what about Energy?" });

    const [, options] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(options.body as string)).toEqual({
      conversationId: "c1",
      message: "Then what about Energy?",
    });
  });

  it("trims the message before sending", async () => {
    const fetchImpl = mockJsonFetch({ conversationId: "c1", reply: "Hi." });
    await client(fetchImpl)({ message: "  What is the objective?  " });

    const [, options] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(options.body as string).message).toBe("What is the objective?");
  });

  it("refuses to send an empty or whitespace-only message", async () => {
    const fetchImpl = vi.fn();
    const send = client(fetchImpl as unknown as typeof fetch);
    await expect(send({ message: "   " })).rejects.toThrow("Write a question first.");
    expect(fetchImpl).not.toHaveBeenCalled();  });
});

describe("createAiChatClient — response handling", () => {
  it("parses {conversationId, reply}", async () => {
    const fetchImpl = mockJsonFetch({ conversationId: "abc", reply: "First to 3 round wins." });
    await expect(client(fetchImpl)({ message: "How do I win?" })).resolves.toEqual({
      conversationId: "abc",
      reply: "First to 3 round wins.",
    });
  });

  it("surfaces the backend's bounded JSON error ({error: {code, message}})", async () => {
    const fetchImpl = mockJsonFetch(
      {
        error: {
          code: "message_too_long",
          message: "Request body is too large (maximum 16384).",
        },
      },
      { ok: false, status: 413 },
    );
    await expect(client(fetchImpl)({ message: "Move?" })).rejects.toThrow(
      "AI Guide: Request body is too large (maximum 16384).",
    );
    // The error code must not leak into the player-facing message.
    await expect(client(mockJsonFetch({ error: { code: "ai_error", message: "The AI service is busy. Try again shortly." } }, { ok: false, status: 502 }))({ message: "Move?" })).rejects.toThrow(
      "AI Guide: The AI service is busy. Try again shortly.",
    );
  });

  it("caps a backend error message at the bounded length", async () => {
    const longMessage = "x".repeat(500);
    const fetchImpl = mockJsonFetch(
      { error: { code: "internal_error", message: longMessage } },
      { ok: false, status: 500 },
    );
    await expect(client(fetchImpl)({ message: "Move?" })).rejects.toThrow(
      "AI Guide: " + "x".repeat(200),
    );
  });

  it("keeps the generic fallback when the error body has the wrong shape", async () => {
    const cases: unknown[] = [
      { error: {} }, // empty object (no message)
      { error: { code: "ai_error" } }, // missing message
      { error: { code: "ai_error", message: 42 } }, // non-string message
      "not an object",
      null,
    ];
    for (const body of cases) {
      const fetchImpl = mockJsonFetch(body, { ok: false, status: 500 });
      await expect(client(fetchImpl)({ message: "Move?" })).rejects.toThrow(
        "AI Guide request failed (HTTP 500). Please try again.",
      );
    }
  });

  it("keeps the generic fallback for a non-JSON error body", async () => {
    const fetchImpl = vi.fn(
      async (_url: unknown, _options?: unknown): Promise<Response> => {
        return {
          ok: false,
          status: 503,
          json: async () => {
            throw new Error("not json");
          },
        } as unknown as Response;
      },
    );
    await expect(client(fetchImpl)({ message: "Move?" })).rejects.toThrow(
      "AI Guide request failed (HTTP 503). Please try again.",
    );
  });

  it("maps a non-JSON body to a useful error", async () => {
    const fetchImpl = vi.fn(
      async (_url: unknown, _options?: unknown): Promise<Response> => {
        return {
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("not json");
          },
        } as unknown as Response;
      },
    );
    await expect(client(fetchImpl)({ message: "Move?" })).rejects.toThrow(
      "The AI Guide returned an unreadable response. Please try again.",
    );
  });

  it("maps a payload missing conversationId/reply to a useful error", async () => {
    const fetchImpl = mockJsonFetch({ reply: "only a reply" });
    await expect(client(fetchImpl)({ message: "Move?" })).rejects.toThrow(
      "The AI Guide returned an unexpected response. Please try again.",
    );
  });

  it("maps a network failure to a useful error", async () => {
    const fetchImpl = vi.fn(
      async (_url: unknown, _options?: unknown): Promise<never> => {
        throw new Error("network down");
      },
    );
    await expect(client(fetchImpl)({ message: "Move?" })).rejects.toThrow(
      "Could not reach the AI Guide. Check your connection and try again.",
    );
  });
});
