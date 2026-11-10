/**
 * `AiChatMessageList` — the bounded, plain-text message view of the AI Guide.
 *
 * Renders at most {@link MAX_VISIBLE_MESSAGES} most recent lines (bounded
 * visible history) as plain text nodes — replies are never parsed as HTML,
 * so there is no `dangerouslySetInnerHTML` path anywhere in the panel.
 */
import { MAX_VISIBLE_MESSAGES, type AiChatMessage } from "./aiChatState";

export interface AiChatMessageListProps {
  messages: AiChatMessage[];
}

export function AiChatMessageList({ messages }: AiChatMessageListProps) {
  const visible =
    messages.length > MAX_VISIBLE_MESSAGES
      ? messages.slice(messages.length - MAX_VISIBLE_MESSAGES)
      : messages;

  return (
    <ul className="ai-chat__messages" aria-label="Conversation">
      {visible.map((message) => (
        <li
          key={message.id}
          className={`ai-chat__message ai-chat__message--${message.role}`}
        >
          <span className="ai-chat__message-role">
            {message.role === "player" ? "You" : "AI Guide"}
          </span>
          <span className="ai-chat__message-text">{message.text}</span>
        </li>
      ))}
    </ul>
  );
}
