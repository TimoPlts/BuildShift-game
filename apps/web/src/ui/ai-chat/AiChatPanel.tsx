/**
 * `AiChatPanel` — the in-game AI Guide / How-to-Play chat.
 *
 * Players can ask about the objective, movement, building, editing, Energy
 * and winning, then ask follow-ups in the same conversation. The backend is
 * called through the injectable AI Guide client (`/api/ai-chat`); the
 * conversation id is kept while the panel/session is active, and the
 * "New conversation" button starts fresh.
 *
 * Input-focus contract (gameplay suppression seam):
 *  - focusing the chat input calls `onInputFocusChange(true)`
 *  - blurring it, closing the panel, or unmounting calls `onInputFocusChange(false)`
 * so the game never treats typed keys as gameplay controls.
 *
 * Rendering contract: every message is plain text; the panel never uses
 * `dangerouslySetInnerHTML`.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useAiChat } from "./useAiChat";
import { AiChatMessageList } from "./AiChatMessageList";
import "./ai-chat.css";

export interface AiChatPanelProps {
  /** Whether the panel is open. */
  open: boolean;
  /** Open/close the panel (close button, toggle). */
  onOpenChange: (open: boolean) => void;
  /**
   * Gameplay-input suppression seam: `true` while the chat input is focused,
   * `false` when focus leaves (blur, close, unmount).
   */
  onInputFocusChange?: (focused: boolean) => void;
}

const WELCOME_TEXT =
  "Ask me how to play: the objective, movement, building, editing, Energy, or how to win.";

export function AiChatPanel({ open, onOpenChange, onInputFocusChange }: AiChatPanelProps) {
  const { messages, conversationId, status, error, send, reset } = useAiChat();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const onInputFocusChangeRef = useRef(onInputFocusChange);
  onInputFocusChangeRef.current = onInputFocusChange;

  /** Keep the visible history scrolled to the newest line. */
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, status, error]);

  /** Safety net: releasing the panel must never leave gameplay suppressed. */
  useEffect(() => {
    return () => {
      onInputFocusChangeRef.current?.(false);
    };
  }, []);

  const handleInputFocus = useCallback(() => {
    onInputFocusChangeRef.current?.(true);
  }, []);

  const handleInputBlur = useCallback(() => {
    onInputFocusChangeRef.current?.(false);
  }, []);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (status === "loading") return;
      send(draft);
      setDraft("");
    },
    [draft, send, status],
  );

  const handleClose = useCallback(() => {
    // Closing while typing must restore normal gameplay input even though the
    // (now hidden) input element never fires a native blur.
    onInputFocusChangeRef.current?.(false);
    onOpenChange(false);
  }, [onOpenChange]);

  const handleNewConversation = useCallback(() => {
    reset();
  }, [reset]);

  return (
    <div
      className={`ai-chat${open ? "" : " ai-chat--closed"}`}
      data-conversation={conversationId ?? ""}
    >
      <button
        type="button"
        className="ai-chat__toggle"
        aria-expanded={open}
        aria-controls="ai-chat-panel"
        onClick={() => onOpenChange(!open)}
      >
        {open ? "Hide Guide" : "AI Guide"}
      </button>

      {open && (
        <section className="ai-chat__panel" id="ai-chat-panel" aria-label="AI Guide">
          <header className="ai-chat__header">
            <h2 className="ai-chat__title">AI Guide</h2>
            <div className="ai-chat__actions">
              <button
                type="button"
                className="ai-chat__new"
                onClick={handleNewConversation}
              >
                New conversation
              </button>
              <button
                type="button"
                className="ai-chat__close"
                aria-label="Close AI Guide"
                onClick={handleClose}
              >
                Close
              </button>
            </div>
          </header>

          {messages.length === 0 && status === "idle" && (
            <p className="ai-chat__welcome">{WELCOME_TEXT}</p>
          )}

          <div className="ai-chat__list" ref={(node) => { listRef.current = node; }}>
            <AiChatMessageList messages={messages} />
            {status === "loading" && (
              <p className="ai-chat__status" role="status" aria-live="polite">
                AI Guide is thinking…
              </p>
            )}
          </div>

          {status === "error" && error !== null && (
            <p className="ai-chat__error" role="alert">
              {error}
            </p>
          )}

          <form className="ai-chat__form" onSubmit={handleSubmit}>
            <input
              className="ai-chat__input"
              type="text"
              name="question"
              value={draft}
              placeholder="Ask about movement, building, Energy, winning…"
              aria-label="Ask the AI Guide"
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
            />
            <button
              type="submit"
              className="ai-chat__send"
              disabled={status === "loading" || draft.trim().length === 0}
            >
              Send
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
