/**
 * OpenAI-compatible LLM client for the AI chat endpoint.
 *
 * Uses the official `openai` JavaScript SDK pointed at the school's
 * OpenAI-compatible gateway (`AI_CHAT.llmBaseUrl`) with
 * `maxRetries: 0` (no automatic retries) and a bounded request timeout.
 * The API key is read ONLY from `process.env.VIVES_LLM_API_KEY` (or from the
 * value explicitly injected for tests); it is never logged, echoed, or
 * included in error responses.
 *
 * The narrow `LlmClient` interface lets the chat service and the tests
 * swap in a mock without any real network access.
 */
import OpenAI from "openai";

import { AI_CHAT } from "./limits.js";

export interface LlmChatResult {
  /** Raw assistant content (may be empty for an incomplete response). */
  readonly content: string;
  /** Upstream `finish_reason` verbatim (`"stop"`, `"length"`, ... or null). */
  readonly finishReason: string | null;
}

/** A message sent to the LLM (system prompt, or retained history entries). */
export interface LlmChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/** Minimal async chat interface; the chat service depends on this only. */
export interface LlmClient {
  chat(messages: readonly LlmChatMessage[]): Promise<LlmChatResult>;
}

export interface CreateLlmClientOptions {
  /** API key; defaults to `process.env.VIVES_LLM_API_KEY`. */
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly maxTokens?: number;
}

/**
 * Build a production `LlmClient` backed by the OpenAI SDK.
 *
 * Construction is cheap and performs no network I/O; the key is only
 * validated on the first request, so the game server can boot without the
 * key configured (requests then fail with a clean "not configured" error).
 */
export function createLlmClient(options: CreateLlmClientOptions = {}): LlmClient {
  const baseUrl = options.baseUrl ?? AI_CHAT.llmBaseUrl;
  const model = options.model ?? AI_CHAT.llmModel;
  const timeoutMs = options.timeoutMs ?? AI_CHAT.requestTimeoutMs;
  const maxTokens = options.maxTokens ?? AI_CHAT.maxTokens;

  const client = new OpenAI({
    apiKey: options.apiKey ?? process.env.VIVES_LLM_API_KEY,
    baseURL: baseUrl,
    maxRetries: 0,
    timeout: timeoutMs,
  });

  return {
    async chat(messages: readonly LlmChatMessage[]): Promise<LlmChatResult> {
      const completion = await client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        reasoning_effort: AI_CHAT.reasoningEffort,
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      });
      const choice = completion.choices[0];
      return {
        content: choice?.message?.content ?? "",
        finishReason: choice?.finish_reason ?? null,
      };
    },
  };
}
