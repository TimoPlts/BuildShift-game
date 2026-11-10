/**
 * `useAiChat` — the React binding for the AI Guide conversation state.
 *
 * Thin over {@link reduceAiChat}: a `send` callback dispatches
 * `send/start`, awaits the (mockable) backend sender, then dispatches
 * `send/success` / `send/failure`. The conversation id follows the backend
 * reply, so follow-up questions stay in the same conversation until
 * `reset()` ("New conversation") is called.
 *
 * Hook-level safeguards (on top of the reducer's own guards):
 *  - a synchronous in-flight guard so a rapid double submit issues at most
 *    one network request per turn (the reducer cannot see same-frame
 *    dispatches before the second `send` runs);
 *  - a turn token, bumped by every `send` and by `reset`, so a stale
 *    completion can never write the conversation id (or an error) after a
 *    "New conversation" — a fresh question after a reset is independent.
 */
import { useCallback, useReducer, useRef } from "react";
import {
  createInitialAiChatState,
  reduceAiChat,
  type AiChatState,
} from "./aiChatState";
import { createAiChatClient, type AiChatSender } from "./aiChatClient";

export interface UseAiChatResult extends AiChatState {
  /**
   * Send a player question; a no-op when empty or while a reply is already
   * in flight.
   */
  send: (message: string) => void;
  /** Start a fresh conversation (clears messages, conversation id and error). */
  reset: () => void;
}

export function useAiChat(sender: AiChatSender = createAiChatClient()): UseAiChatResult {
  const [state, dispatch] = useReducer(reduceAiChat, undefined, createInitialAiChatState);
  const senderRef = useRef(sender);
  senderRef.current = sender;
  const conversationIdRef = useRef<string | null>(null);
  /** Synchronous guard: at most one request in flight for this hook. */
  const inFlightRef = useRef(false);
  /** Bumped by every send and by reset; a completion applies only if it still matches. */
  const turnRef = useRef(0);

  const send = useCallback((message: string) => {
    const text = message.trim();
    if (text.length === 0 || inFlightRef.current) return;
    inFlightRef.current = true;
    const turn = ++turnRef.current;

    dispatch({ type: "send/start", message: text });

    const conversationId =
      conversationIdRef.current !== null ? conversationIdRef.current : undefined;

    senderRef
      .current({ conversationId, message: text })
      .then((result) => {
        // Stale completion (a reset or newer turn happened): discard it so it
        // can never leak the old conversation id into the fresh session.
        if (turn !== turnRef.current) return;
        conversationIdRef.current = result.conversationId;
        dispatch({
          type: "send/success",
          conversationId: result.conversationId,
          reply: result.reply,
        });
      })
      .catch((error: unknown) => {
        if (turn !== turnRef.current) return;
        dispatch({
          type: "send/failure",
          error:
            error instanceof Error && error.message.length > 0
              ? error.message
              : "The AI Guide request failed. Please try again.",
        });
      })
      .finally(() => {
        if (turn === turnRef.current) inFlightRef.current = false;
      });
  }, []);

  const reset = useCallback(() => {
    // Invalidate any in-flight completion and free the in-flight guard, so a
    // fresh question is accepted immediately and starts an independent
    // conversation.
    turnRef.current += 1;
    inFlightRef.current = false;
    conversationIdRef.current = null;
    dispatch({ type: "reset" });
  }, []);

  return { ...state, send, reset };
}
