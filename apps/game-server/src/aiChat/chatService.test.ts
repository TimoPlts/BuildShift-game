import { describe, expect, it } from "vitest";

import { createChatService, ChatError } from "./chatService.js";
import { createConversationStore } from "./conversationStore.js";
import type { LlmChatMessage, LlmChatResult, LlmClient } from "./llmClient.js";
import { AI_CHAT } from "./limits.js";
import { BUILD_SHIFT_SYSTEM_PROMPT } from "./systemPrompt.js";

/** Mock LLM: records every request, returns a canned result or throws. */
function mockLlm(
  behavior:
    | { result?: LlmChatResult; error?: unknown; perCall?: (index: number) => LlmChatResult },
) {
  const calls: LlmChatMessage[][] = [];
  const client: LlmClient = {
    async chat(messages: readonly LlmChatMessage[]): Promise<LlmChatResult> {
      calls.push([...messages] as LlmChatMessage[]);
      if (behavior.error !== undefined) {
        throw behavior.error;
      }
      if (behavior.perCall !== undefined) {
        return behavior.perCall(calls.length - 1);
      }
      return behavior.result ?? { content: "mock reply", finishReason: "stop" };
    },
  };
  return { client, calls };
}

function makeService(overrides: {
  llm?: LlmClient;
  /** Omit to use the default "test-key"; pass a value (even undefined) to override. */
  apiKey?: string;
  limits?: { maxConversations?: number; maxTurnsPerConversation?: number; staleConversationMs?: number };
  store?: ReturnType<typeof createConversationStore>;
} = {}) {
  const store = overrides.store ?? createConversationStore(
    overrides.limits ?? {
      maxConversations: 4,
      maxTurnsPerConversation: 2,
      staleConversationMs: 60_000,
    },
    () => 0,
  );
  const service = createChatService({
    store,
    llmClientFactory: () =>
      overrides.llm ??
      mockLlm({ result: { content: "mock reply", finishReason: "stop" } }).client,
    readApiKey: () => ("apiKey" in overrides ? overrides.apiKey : "test-key"),
    now: () => 0,
  });
  return { service, store };
}

async function expectChatError(
  promise: Promise<unknown>,
  code: string,
  statusCode: number,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ChatError);
    const chatError = error as ChatError;
    expect(chatError.code).toBe(code);
    expect(chatError.statusCode).toBe(statusCode);
    expect(chatError.message.length).toBeGreaterThan(0);
    // Errors are bounded and never leak secrets.
    expect(chatError.message).not.toContain("test-key");
    return;
  }
  throw new Error(`expected ChatError(${code}) but the call succeeded`);
}

describe("chatService", () => {
  describe("request validation", () => {
    it("rejects non-object bodies", async () => {
      const { service } = makeService();
      await expectChatError(service("hello"), "invalid_request", 400);
      await expectChatError(service(null), "invalid_request", 400);
      await expectChatError(service([1, 2]), "invalid_request", 400);
    });

    it("rejects missing, non-string, or non-string conversationId", async () => {
      const { service } = makeService();
      await expectChatError(service({}), "invalid_request", 400);
      await expectChatError(service({ message: 42 }), "invalid_request", 400);
      await expectChatError(
        service({ message: "hi", conversationId: 7 }),
        "invalid_request",
        400,
      );
      await expectChatError(
        service({ message: "hi", conversationId: "" }),
        "invalid_request",
        400,
      );
    });

    it("rejects empty and whitespace-only messages", async () => {
      const { service } = makeService();
      await expectChatError(service({ message: "" }), "empty_message", 400);
      await expectChatError(service({ message: "   \n\t " }), "empty_message", 400);
    });

    it("rejects oversized messages", async () => {
      const { service, store } = makeService();
      const oversized = "x".repeat(AI_CHAT.maxMessageLength + 1);
      await expectChatError(service({ message: oversized }), "message_too_long", 400);
      expect(store.size).toBe(0); // validation failure must not create a conversation
    });

    it("rejects unknown conversation ids with 404", async () => {
      const { service } = makeService();
      await expectChatError(
        service({ conversationId: "conv_00000000-0000-0000-0000-000000000000", message: "hi" }),
        "unknown_conversation",
        404,
      );
    });
  });

  describe("success path", () => {
    it("returns the conversation id and reply, and stores the complete pair", async () => {
      const { service, store } = makeService();
      const result = await service({ message: "how do I win?" });
      expect(result).toMatchObject({ conversationId: expect.stringMatching(/^conv_/), reply: "mock reply" });
      const conversation = store.get(result.conversationId);
      expect(conversation?.messages).toEqual([
        { role: "user", content: "how do I win?" },
        { role: "assistant", content: "mock reply" },
      ]);
    });

    it("sends the retained system prompt plus bounded history plus the new message", async () => {
      const { service, store } = makeService();
      const first = await service({ message: "first" });
      const llm = mockLlm({ result: { content: "second reply", finishReason: "stop" } });
      const service2 = createChatService({
        store,
        llmClientFactory: () => llm.client,
        readApiKey: () => "test-key",
        now: () => 0,
      });
      const second = await service2({ conversationId: first.conversationId, message: "second" });

      expect(llm.calls).toHaveLength(1);
      expect(llm.calls[0]).toEqual([
        { role: "system", content: BUILD_SHIFT_SYSTEM_PROMPT },
        { role: "user", content: "first" },
        { role: "assistant", content: "mock reply" },
        { role: "user", content: "second" },
      ]);
      expect(second.conversationId).toBe(first.conversationId);
    });

    it("keeps separate conversations isolated", async () => {
      const { service, store } = makeService();
      const a = await service({ message: "from A" });
      const llm = mockLlm({ result: { content: "B reply", finishReason: "stop" } });
      const service2 = createChatService({
        store,
        llmClientFactory: () => llm.client,
        readApiKey: () => "test-key",
        now: () => 0,
      });
      const b = await service2({ message: "from B" });

      expect(b.conversationId).not.toBe(a.conversationId);
      // B's request must not contain A's history.
      expect(llm.calls[0]).toEqual([
        { role: "system", content: BUILD_SHIFT_SYSTEM_PROMPT },
        { role: "user", content: "from B" },
      ]);
      // A's conversation is unchanged by B's turn.
      expect(store.get(a.conversationId)?.messages).toHaveLength(2);
      expect(store.get(b.conversationId)?.messages).toHaveLength(2);
    });

    it("bounds history sent to the LLM to the configured turns", async () => {
      const { service, store } = makeService({
        limits: { maxTurnsPerConversation: 2 },
      });
      const first = await service({ message: "one" });
      const llm = mockLlm({
        perCall: (index) => ({ content: `reply ${index + 1}`, finishReason: "stop" }),
      });
      const service2 = createChatService({
        store,
        llmClientFactory: () => llm.client,
        readApiKey: () => "test-key",
        now: () => 0,
      });
      await service2({ conversationId: first.conversationId, message: "two" });
      await service2({ conversationId: first.conversationId, message: "three" });
      await service2({ conversationId: first.conversationId, message: "four" });

      // After the 4th turn only the two most recent pairs fit in history:
      // turns 2 ("two") and 3 ("three") plus the new "four" message.
      expect(llm.calls).toHaveLength(3);
      expect(llm.calls[2]).toEqual([
        { role: "system", content: BUILD_SHIFT_SYSTEM_PROMPT },
        { role: "user", content: "two" },
        { role: "assistant", content: "reply 1" },
        { role: "user", content: "three" },
        { role: "assistant", content: "reply 2" },
        { role: "user", content: "four" },
      ]);
    });
  });

  describe("failure atomicity", () => {
    it("stores nothing when the LLM errors", async () => {
      const llm = mockLlm({ error: Object.assign(new Error("boom"), { code: "EINTERNAL" }) });
      const { service, store } = makeService({ llm: llm.client });
      await expectChatError(service({ message: "hi" }), "ai_error", 502);
      expect(store.size).toBe(0);
      expect(llm.calls).toHaveLength(1); // no automatic retry
    });

    it("stores nothing on timeout and reports a timeout error", async () => {
      const llm = mockLlm({
        error: Object.assign(new Error("Request timed out."), {
          name: "APIError",
          code: "ETIMEDOUT",
        }),
      });
      const { service, store } = makeService({ llm: llm.client });
      await expectChatError(service({ message: "hi" }), "ai_timeout", 504);
      expect(store.size).toBe(0);
    });

    it("stores nothing for incomplete responses (finish_reason or empty content)", async () => {
      const llmTruncated = mockLlm({ result: { content: "", finishReason: "length" } });
      const { service, store } = makeService({ llm: llmTruncated.client });
      await expectChatError(service({ message: "hi" }), "ai_incomplete_response", 502);
      expect(store.size).toBe(0);

      const llmEmpty = mockLlm({ result: { content: "", finishReason: "stop" } });
      const { service: serviceEmpty } = makeService({ llm: llmEmpty.client });
      await expectChatError(serviceEmpty({ message: "hi" }), "ai_incomplete_response", 502);
      expect(store.size).toBe(0);
    });

    it("does not persist a partial turn before a later failure in the same conversation", async () => {
      const llm = mockLlm({
        perCall: (index) =>
          index === 0
            ? { content: "ok", finishReason: "stop" }
            : (() => {
                throw Object.assign(new Error("boom"), { code: "EINTERNAL" });
              })(),
      });
      const { service, store } = makeService({ llm: llm.client });
      const first = await service({ message: "one" });
      await expectChatError(
        service({ conversationId: first.conversationId, message: "two" }),
        "ai_error",
        502,
      );
      // Conversation still holds exactly the one successful pair.
      expect(store.get(first.conversationId)?.messages).toEqual([
        { role: "user", content: "one" },
        { role: "assistant", content: "ok" },
      ]);
    });
  });

  describe("configuration and capacity", () => {
    it("fails cleanly when the API key is missing or blank", async () => {
      const llm = mockLlm({});
      const { service } = makeService({ llm: llm.client, apiKey: undefined });
      await expectChatError(service({ message: "hi" }), "ai_not_configured", 503);
      expect(llm.calls).toHaveLength(0); // the LLM is never contacted

      const { service: blank } = makeService({ llm: llm.client, apiKey: "   " });
      await expectChatError(blank({ message: "hi" }), "ai_not_configured", 503);
    });

    it("rejects new conversations when the store is full of fresh ones", async () => {
      const store = createConversationStore(
        { maxConversations: 1, maxTurnsPerConversation: 2, staleConversationMs: 60_000 },
        () => 0,
      );
      const { service } = makeService({ store });
      const first = await service({ message: "one" });
      // The single slot is occupied by a fresh conversation.
      await expectChatError(
        service({ message: "two" }),
        "too_many_conversations",
        503,
      );
      // The first conversation is still usable.
      const again = await service({ conversationId: first.conversationId, message: "more" });
      expect(again.conversationId).toBe(first.conversationId);
    });
  });
});
