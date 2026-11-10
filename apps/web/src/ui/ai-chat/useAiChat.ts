/**
 * `useAiChat` — the React binding for the AI Guide conversation state.
 *
 * Thin over {@link reduceAiChat}: a `send` callback dispatches
 * `send/start`, awaits the (mockable) backend sender, then dispatches
 * `send/success` / `send/failure`. The conversation id follows the backend
 * reply, so follow-up questions stay in the same conversation until
 * `reset()` ("New conversation") is called.
 */
import { useCallback, useReducer, useRef } from "react";
import {
  createInitialAiChatState,
  reduceAiChat,
  type AiChatState,
} from "./aiChatState";
import { createAiChatClient, type AiChatSender } from "./aiChatClient";

export interface UseAiChatResult extends AiChatState {
  /** Send a player question; a no-op when empty or while a reply is in flight. */
  send: (message: string) => void;
  /** Start a fresh conversation (clears messages, conversation id and error). */
  reset: () => void;
}

export function useAiChat(sender: AiChatSender = createAiChatClient()): UseAiChatResult {
  const [state, dispatch] = useReducer(reduceAiChat, undefined, createInitialAiChatState);
  const senderRef = useRef(sender);
  senderRef.current = sender;
  const conversationIdRef = useRef<string | null>(null);

  const send = useCallback((message: string) => {
    const text = message.trim();
    if (text.length === 0) return;

    dispatch({ type: "send/start", message: text });

    const conversationId =
      conversationIdRef.current !== null ? conversationIdRef.current : undefined;

    senderRef
      .current({ conversationId, message: text })
      .then((result) => {
        conversationIdRef.current = result.conversationId;
        dispatch({
          type: "send/success",
          conversationId: result.conversationId,
          reply: result.reply,
        });
      })
      .catch((error: unknown) => {
        dispatch({
          type: "send/failure",
          error:
            error instanceof Error && error.message.length > 0
              ? error.message
              : "The AI Guide request failed. Please try again.",
        });
      });
  }, []);

  const reset = useCallback(() => {
    conversationIdRef.current = null;
    dispatch({ type: "reset" });
  }, []);

  return { ...state, send, reset };
}
