/**
 * Chat service for `POST /api/ai-chat`.
 *
 * Responsibilities:
 *  - validate the (untrusted) browser request: shape, message bounds,
 *    conversation-id bounds;
 *  - resolve or create the server-owned conversation (bounded store);
 *  - call the LLM with the retained system prompt + bounded history;
 *  - accept model output ONLY when `finish_reason === "stop"` and the
 *    assistant content is nonempty;
 *  - store the complete user/assistant pair atomically — a failed request
 *    never mutates the conversation;
 *  - map every failure to a bounded, useful `ChatError` that never exposes
 *    secrets or raw upstream/internal errors.
 */
import type { Conversation, ConversationStore } from "./conversationStore.js";
import { createConversationStore } from "./conversationStore.js";
import type { LlmClient } from "./llmClient.js";
import { createLlmClient } from "./llmClient.js";
import { AI_CHAT } from "./limits.js";
import { BUILD_SHIFT_SYSTEM_PROMPT } from "./systemPrompt.js";

export type ChatErrorCode =
  /** Body is not a JSON object / missing or non-string `message`. */
  | "invalid_request"
  /** `message` is empty or whitespace-only. */
  | "empty_message"
  /** `message` exceeds the maximum length. */
  | "message_too_long"
  /** Unknown `conversationId` (never created here, or already evicted). */
  | "unknown_conversation"
  /** The conversation store is full and no stale conversation is free. */
  | "too_many_conversations"
  /** `VIVES_LLM_API_KEY` is not configured on the server. */
  | "ai_not_configured"
  /** The upstream LLM request timed out. */
  | "ai_timeout"
  /** The upstream LLM request failed (transport, HTTP, or API error). */
  | "ai_error"
  /** The model returned an incomplete response (`finish_reason !== "stop"`
   *  or empty assistant content). */
  | "ai_incomplete_response";

export interface ChatErrorDetails {
  readonly code: ChatErrorCode;
  readonly message: string;
  readonly statusCode: number;
}

/** A bounded, safe-to-expose chat failure. */
export class ChatError extends Error implements ChatErrorDetails {
  constructor(
    readonly code: ChatErrorCode,
    readonly message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "ChatError";
  }
}

/** The raw (untrusted) request body. */
export interface ChatRequestBody {
  readonly conversationId?: string;
  readonly message: string;
}

export interface ChatResponse {
  readonly conversationId: string;
  readonly reply: string;
}

export interface ChatServiceOptions {
  readonly store?: ConversationStore;
  /** LLM client factory (called per request, after key validation). */
  readonly llmClientFactory?: (apiKey: string) => LlmClient;
  /** Read the API key; defaults to `process.env.VIVES_LLM_API_KEY`. */
  readonly readApiKey?: () => string | undefined;
  /** Clock; defaults to `Date.now`. */
  readonly now?: () => number;
}

export type ChatService = (
  body: unknown,
) => Promise<ChatResponse>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(code: ChatErrorCode, message: string, statusCode: number): never {
  throw new ChatError(code, message, statusCode);
}

/**
 * Create the chat service. With no options it wires the real bounded store
 * and the OpenAI-compatible school LLM client; tests inject a store with
 * small limits and a mock LLM client.
 */
export function createChatService(options: ChatServiceOptions = {}): ChatService {
  const store = options.store ?? createConversationStore();
  const readApiKey = options.readApiKey ?? (() => process.env.VIVES_LLM_API_KEY);
  const now = options.now ?? Date.now;
  const llmClientFactory =
    options.llmClientFactory ?? ((apiKey: string) => createLlmClient({ apiKey }));

  return async function chat(body: unknown): Promise<ChatResponse> {
    // ── Request validation (browser input is untrusted) ────────────────────
    if (!isPlainObject(body)) {
      fail(
        "invalid_request",
        "Request body must be a JSON object with a \"message\" string.",
        400,
      );
    }
    const { conversationId, message } = body;
    if (typeof message !== "string") {
      fail("invalid_request", "\"message\" must be a string.", 400);
    }
    if (message.trim().length === 0) {
      fail("empty_message", "\"message\" must not be empty.", 400);
    }
    if (message.length > AI_CHAT.maxMessageLength) {
      fail(
        "message_too_long",
        `"message" is too long (maximum ${AI_CHAT.maxMessageLength} characters).`,
        400,
      );
    }
    if (conversationId !== undefined && typeof conversationId !== "string") {
      fail("invalid_request", "\"conversationId\" must be a string when provided.", 400);
    }
    if (
      typeof conversationId === "string" &&
      (conversationId.length === 0 || conversationId.length > 128)
    ) {
      fail("invalid_request", "\"conversationId\" is outside the allowed length.", 400);
    }

    const timestamp = now();
    store.cleanupStale(timestamp);

    // ── Conversation resolution (server owns conversation state) ──────────
    // New conversations are created only after a successful exchange, so a
    // failed request never occupies a conversation slot.
    let conversation: Conversation | undefined;
    if (typeof conversationId === "string") {
      conversation = store.get(conversationId);
      if (conversation === undefined) {
        fail(
          "unknown_conversation",
          "Unknown or expired conversationId; start a new conversation by omitting it.",
          404,
        );
      }
    }

    // ── Key validation (key comes only from the server environment) ───────
    const apiKey = readApiKey()?.trim();
    if (apiKey === undefined || apiKey.length === 0) {
      fail(
        "ai_not_configured",
        "AI chat is not configured on this server. Ask the host to set VIVES_LLM_API_KEY.",
        503,
      );
    }

    // ── Upstream request (no retries; bounded timeout) ────────────────────
    const history = conversation?.messages ?? [];
    const llm = llmClientFactory(apiKey);
    let result;
    try {
      result = await llm.chat([
        { role: "system", content: BUILD_SHIFT_SYSTEM_PROMPT },
        ...history,
        { role: "user", content: message },
      ]);
    } catch (error) {
      if (isTimeoutError(error)) {
        fail(
          "ai_timeout",
          `The AI service took too long to respond (${AI_CHAT.requestTimeoutMs} ms limit). Please try again.`,
          504,
        );
      }
      fail(
        "ai_error",
        "The AI service is unavailable right now. Please try again in a moment.",
        502,
      );
    }

    // ── Output validation (incomplete responses are rejected, not stored) ─
    if (result.finishReason !== "stop") {
      fail(
        "ai_incomplete_response",
        "The AI response was incomplete; nothing was recorded. Please try again.",
        502,
      );
    }
    const reply = result.content;
    if (reply.length === 0) {
      fail(
        "ai_incomplete_response",
        "The AI response was empty; nothing was recorded. Please try again.",
        502,
      );
    }

    // ── Atomic persistence: only complete, successful exchanges are stored ─
    if (conversation === undefined) {
      // First message of a new conversation: claim a slot, then store the
      // pair, so the store never holds conversations without a completed turn.
      if (store.size >= store.capacity) {
        fail(
          "too_many_conversations",
          "Too many active AI conversations right now. Try again shortly, or continue an existing conversation.",
          503,
        );
      }
      conversation = store.create(timestamp);
    }
    if (!store.appendPair(conversation.id, message, reply, timestamp)) {
      fail("unknown_conversation", "Conversation state changed; please retry.", 404);
    }

    return { conversationId: conversation.id, reply };
  };
}

/**
 * Classify upstream failures as timeouts. Handles the OpenAI SDK's timeout
 * error (`APIError` with code `ETIMEDOUT` / no HTTP status) as well as any
 * error whose name or message identifies a timeout.
 */
function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return true;
    }
    // OpenAI SDK `APIError` exposes `.code === "ETIMEDOUT"` on timeout.
    const code = (error as { code?: unknown }).code;
    if (code === "ETIMEDOUT" || code === "ECONNABORTED") {
      return true;
    }
    if (/timeout|timed out/i.test(error.message)) {
      return true;
    }
  }
  return false;
}
