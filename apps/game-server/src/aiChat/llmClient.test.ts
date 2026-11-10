import { afterEach, describe, expect, it } from "vitest";

import { createLlmClient } from "./llmClient.js";
import { AI_CHAT } from "./limits.js";

interface CapturedRequest {
  url: string;
  body: Record<string, any>;
  authorization: string | null;
}

/** Replace global fetch with a stub; returns captured calls + restore fn. */
function stubFetch(handler: (request: CapturedRequest) => Response) {
  const calls: CapturedRequest[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    const rawHeaders = init?.headers;
    const authorization =
      rawHeaders instanceof Headers
        ? rawHeaders.get("authorization")
        : ((rawHeaders as Record<string, string> | undefined)?.Authorization ??
          (rawHeaders as Record<string, string> | undefined)?.authorization ??
          null);
    const request: CapturedRequest = { url, body, authorization };
    calls.push(request);
    return handler(request);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function completionResponse(content: string, finishReason: string) {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: AI_CHAT.llmModel,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

describe("createLlmClient (OpenAI-compatible SDK wiring, fetch stubbed)", () => {
  it("posts to the school gateway with the agreed model/params", async () => {
    const stub = stubFetch(() => completionResponse("reply", "stop"));
    try {
      const client = createLlmClient({ apiKey: "injected-key" });
      const result = await client.chat([
        { role: "system", content: "SYS" },
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
        { role: "user", content: "again" },
      ]);

      expect(stub.calls).toHaveLength(1);
      expect(stub.calls[0].url).toBe(`${AI_CHAT.llmBaseUrl}/chat/completions`);
      const body = stub.calls[0].body;
      expect(body.model).toBe(AI_CHAT.llmModel);
      expect(body.max_tokens).toBe(AI_CHAT.maxTokens);
      expect(body.reasoning_effort).toBe(AI_CHAT.reasoningEffort);
      expect(body.messages).toEqual([
        { role: "system", content: "SYS" },
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
        { role: "user", content: "again" },
      ]);
      expect(result).toEqual({ content: "reply", finishReason: "stop" });
    } finally {
      stub.restore();
    }
  });

  it("uses only the explicitly provided API key, never OPENAI_API_KEY", async () => {
    process.env.OPENAI_API_KEY = "env-var-key-must-not-be-used";
    const stub = stubFetch(() => completionResponse("reply", "stop"));
    try {
      const client = createLlmClient({ apiKey: "injected-key" });
      await client.chat([{ role: "user", content: "hi" }]);
      expect(stub.calls[0].authorization).toBe("Bearer injected-key");
    } finally {
      stub.restore();
    }
  });

  it("falls back to VIVES_LLM_API_KEY when no key is injected", async () => {
    process.env.VIVES_LLM_API_KEY = "vives-key";
    delete process.env.OPENAI_API_KEY;
    const stub = stubFetch(() => completionResponse("reply", "stop"));
    try {
      const client = createLlmClient();
      await client.chat([{ role: "user", content: "hi" }]);
      expect(stub.calls[0].authorization).toBe("Bearer vives-key");
    } finally {
      delete process.env.VIVES_LLM_API_KEY;
      stub.restore();
    }
  });

  it("surfaces HTTP errors without automatic retries", async () => {
    const stub = stubFetch(() =>
      new Response(
        JSON.stringify({ error: { message: "upstream is down" } }),
        { status: 500, headers: { "content-type": "application/json" } },
      ),
    );
    try {
      const client = createLlmClient({ apiKey: "injected-key" });
      await expect(client.chat([{ role: "user", content: "hi" }])).rejects.toMatchObject({
        status: 500,
      });
      // maxRetries: 0 → exactly one network attempt.
      expect(stub.calls).toHaveLength(1);
    } finally {
      stub.restore();
    }
  });
});
