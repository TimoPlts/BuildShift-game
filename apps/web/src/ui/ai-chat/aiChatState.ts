/**
 * AI Guide conversation state — a pure, testable state machine shared by the
 * React hook (`useAiChat`) and the panel. Keeping the logic here means the
 * send/follow-up/error/new-conversation behaviour is fully unit-testable
 * without a DOM.
 *
 * Replies are always plain strings: the panel renders them as text and never
 * uses `dangerouslySetInnerHTML`.
 */

/** Only this many messages are ever rendered (bounded visible history). */
export const MAX_VISIBLE_MESSAGES = 40;

/** One rendered chat line. */
export interface AiChatMessage {
  id: number;
  role: "player" | "assistant";
  text: string;
}

/** The panel's activity state. */
export type AiChatStatus = "idle" | "loading" | "error";

export interface AiChatState {
  /** The conversation so far (already capped at {@link MAX_VISIBLE_MESSAGES}). */
  messages: AiChatMessage[];
  /**
   * The backend conversation id, kept for the lifetime of the panel/session.
   * `null` until the first reply arrives (or after "New conversation").
   */
  conversationId: string | null;
  status: AiChatStatus;
  /** Player-facing error text while `status === "error"`. */
  error: string | null;
  nextMessageId: number;
}

export type AiChatAction =
  | { type: "send/start"; message: string }
  | { type: "send/success"; conversationId: string; reply: string }
  | { type: "send/failure"; error: string }
  | { type: "reset" };

export function createInitialAiChatState(): AiChatState {
  return {
    messages: [],
    conversationId: null,
    status: "idle",
    error: null,
    nextMessageId: 1,
  };
}

function appendCapped(
  messages: AiChatMessage[],
  message: AiChatMessage,
): AiChatMessage[] {
  const next = [...messages, message];
  return next.length > MAX_VISIBLE_MESSAGES
    ? next.slice(next.length - MAX_VISIBLE_MESSAGES)
    : next;
}

export function reduceAiChat(state: AiChatState, action: AiChatAction): AiChatState {
  switch (action.type) {
    case "send/start": {
      // One in-flight request at a time: ignore new sends while loading.
      if (state.status === "loading") return state;
      const message: AiChatMessage = {
        id: state.nextMessageId,
        role: "player",
        text: action.message,
      };
      return {
        ...state,
        messages: appendCapped(state.messages, message),
        status: "loading",
        error: null,
        nextMessageId: state.nextMessageId + 1,
      };
    }
    case "send/success": {
      if (state.status !== "loading") return state;
      const message: AiChatMessage = {
        id: state.nextMessageId,
        role: "assistant",
        text: action.reply,
      };
      return {
        ...state,
        messages: appendCapped(state.messages, message),
        // The backend owns the conversation id; adopt (or confirm) it so the
        // next question is a follow-up of the same conversation.
        conversationId: action.conversationId,
        status: "idle",
        error: null,
        nextMessageId: state.nextMessageId + 1,
      };
    }
    case "send/failure": {
      if (state.status !== "loading") return state;
      return { ...state, status: "error", error: action.error };
    }
    case "reset": {
      return createInitialAiChatState();
    }
  }
}
