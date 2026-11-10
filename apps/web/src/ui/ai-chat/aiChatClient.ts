/**
 * AI Guide HTTP client — the only module that talks to the backend.
 *
 * Contract (mocked in tests; the real endpoint is provided by the game
 * backend, which alone holds any model credentials):
 *
 *  - request:  `POST {conversationId?: string, message: string}`
 *  - response: `{conversationId: string, reply: string}`
 *
 * `conversationId` is omitted on the first message of a conversation and
 * echoed back on every follow-up so the backend can keep the context.
 * No secret ever reaches the browser.
 */
import { aiChatEndpoint } from "./aiChatOrigin";

/** One AI Guide request. */
export interface AiChatRequest {
  /** Present on follow-up messages; omitted for a fresh conversation. */
  conversationId?: string;
  /** The player's question (trimmed before sending). */
  message: string;
}

/** One AI Guide response. */
export interface AiChatResponse {
  /** The conversation to keep for follow-ups. */
  conversationId: string;
  /** The assistant's plain-text reply. */
  reply: string;
}

/** Injectable transport, so tests can mock the backend entirely. */
export type AiChatSender = (request: AiChatRequest) => Promise<AiChatResponse>;

export interface AiChatClientOptions {
  /** Override the transport (tests). Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Override the full endpoint URL (tests). Defaults to the derived origin. */
  endpoint?: string;
}

/**
 * Create an AI Guide sender bound to a transport and endpoint.
 *
 * Errors are always mapped to a useful, player-facing message — the caller
 * shows them verbatim in the panel.
 */
export function createAiChatClient(options: AiChatClientOptions = {}): AiChatSender {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? aiChatEndpoint();

  return async (request: AiChatRequest): Promise<AiChatResponse> => {
    const message = request.message.trim();
    if (message.length === 0) {
      throw new Error("Write a question first.");
    }

    // `conversationId` is optional: only included on follow-up turns.
    const body =
      request.conversationId !== undefined && request.conversationId !== ""
        ? { conversationId: request.conversationId, message }
        : { message };

    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error(
        "Could not reach the AI Guide. Check your connection and try again.",
      );
    }

    if (!response.ok) {
      throw new Error(`AI Guide request failed (HTTP ${response.status}). Please try again.`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("The AI Guide returned an unreadable response. Please try again.");
    }

    const data = payload as { conversationId?: unknown; reply?: unknown } | null;
    if (
      data === null ||
      typeof data !== "object" ||
      typeof data.conversationId !== "string" ||
      typeof data.reply !== "string"
    ) {
      throw new Error("The AI Guide returned an unexpected response. Please try again.");
    }
    return { conversationId: data.conversationId, reply: data.reply };
  };
}

/** The default sender, derived from the game-server URL configuration. */
export const defaultAiChatClient = createAiChatClient();
