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
 * The backend returns useful bounded JSON errors (`{error: {code, message}}`);
 * never expose secrets or raw internal errors. Only this much detail text is
 * ever surfaced to the player (plain text; the panel never renders HTML).
 */
const MAX_ERROR_DETAIL_LENGTH = 200;

/**
 * Read a safe, bounded error detail from a failed response body.
 *
 * The backend contract is `{error: {code: string, message: string}}` (see the
 * game-server `aiChatRoute`); its `error.message` is surfaced, trimmed and
 * capped. As a lenient fallback, a flat string `error` / `message` field is
 * also accepted. Anything else (non-JSON, wrong shape, empty) yields `null`
 * so the caller keeps the generic fallback message. No raw internal errors
 * or secrets are ever surfaced.
 */
async function readErrorDetail(response: Response): Promise<string | null> {
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return null;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const record = data as Record<string, unknown>;
  const maybeError = record.error;
  let detail: unknown = null;
  if (typeof maybeError === "string") {
    detail = maybeError;
  } else if (
    maybeError !== null &&
    typeof maybeError === "object" &&
    !Array.isArray(maybeError) &&
    typeof (maybeError as Record<string, unknown>).message === "string"
  ) {
    detail = (maybeError as Record<string, unknown>).message;
  } else if (typeof record.message === "string") {
    detail = record.message;
  }
  if (typeof detail !== "string") return null;
  const trimmed = detail.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > MAX_ERROR_DETAIL_LENGTH
    ? trimmed.slice(0, MAX_ERROR_DETAIL_LENGTH)
    : trimmed;
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
      // Surface a safe bounded JSON error message when the backend provides
      // one; otherwise keep the useful generic fallback.
      const detail = await readErrorDetail(response);
      throw new Error(
        detail !== null
          ? `AI Guide: ${detail}`
          : `AI Guide request failed (HTTP ${response.status}). Please try again.`,
      );
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
