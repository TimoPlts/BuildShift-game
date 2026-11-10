/**
 * Rendering tests for the AI Guide panel.
 *
 * The project's test toolchain runs vitest in a node environment without a
 * DOM testing library, so tests render components to static markup (SSR) and
 * assert on the resulting HTML — mirroring the existing overlay/HUD test
 * style. Conversation/error/loading state-machine behaviour is covered in
 * `aiChatState.test.ts` and `aiChatClient.test.ts` (mocked backend).
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AiChatPanel } from "./AiChatPanel";
import { AiChatMessageList } from "./AiChatMessageList";
import { MAX_VISIBLE_MESSAGES, type AiChatMessage } from "./aiChatState";

function renderPanel(overrides: Partial<Parameters<typeof AiChatPanel>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(AiChatPanel, {
      open: true,
      onOpenChange: () => {},
      onInputFocusChange: () => {},
      ...overrides,
    }),
  );
}

function makeMessages(count: number): AiChatMessage[] {
  const messages: AiChatMessage[] = [];
  for (let i = 1; i <= count; i += 1) {
    messages.push({ id: i * 2 - 1, role: "player", text: `Question ${i}` });
    messages.push({ id: i * 2, role: "assistant", text: `Answer ${i}` });
  }
  return messages;
}

describe("AiChatPanel — structure and accessibility", () => {
  it("renders the guide section, welcome, and send form when open", () => {
    const html = renderPanel();
    expect(html).toContain("id=\"ai-chat-panel\"");
    expect(html).toContain("aria-label=\"AI Guide\"");
    expect(html).toContain("AI Guide");
    expect(html).toContain(
      "Ask me how to play: the objective, movement, building, editing, Energy, or how to win.",
    );
    expect(html).toContain('aria-label="Ask the AI Guide"');
    expect(html).toContain(">Send<");
  });

  it("renders the toggle with the expanded state and panel controls", () => {
    const openHtml = renderPanel({ open: true });
    const closedHtml = renderPanel({ open: false });
    expect(openHtml).toContain('aria-expanded="true"');
    expect(openHtml).toContain("New conversation");
    expect(openHtml).toContain('aria-label="Close AI Guide"');
    expect(closedHtml).toContain('aria-expanded="false"');
    expect(closedHtml).not.toContain("id=\"ai-chat-panel\"");
  });

  it("never renders replies as raw HTML (no dangerouslySetInnerHTML anywhere)", () => {
    const html = renderToStaticMarkup(
      createElement(AiChatMessageList, {
        messages: [
          {
            id: 1,
            role: "assistant",
            text: "WASD <script>alert(1)</script> & moves.",
          },
        ],
      }),
    );
    // The reply text must be escaped, not injected as markup.
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&amp; moves.");
  });
});

describe("AiChatMessageList — bounded visible history", () => {
    const messageCount = (markup: string) =>
      (markup.match(/ai-chat__message--(player|assistant)/g) ?? []).length;

  it("renders at most MAX_VISIBLE_MESSAGES most-recent lines", () => {
    const all = makeMessages(MAX_VISIBLE_MESSAGES / 2 + 25); // 90 lines
    const html = renderToStaticMarkup(
      createElement(AiChatMessageList, { messages: all }),
    );
    expect(messageCount(html)).toBe(MAX_VISIBLE_MESSAGES);
    // Oldest lines are gone, newest remain.
    expect(html).not.toContain("Question 1");
    expect(html).not.toContain("Answer 1");
    expect(html).toContain("Answer 45");
  });

  it("renders every line when under the bound", () => {
    const all = makeMessages(3); // 6 lines
    const html = renderToStaticMarkup(
      createElement(AiChatMessageList, { messages: all }),
    );
    expect(messageCount(html)).toBe(6);
    expect(html).toContain("Question 1");
    expect(html).toContain("Answer 3");
  });

  it("marks player and assistant lines distinctly as plain text", () => {
    const html = renderToStaticMarkup(
      createElement(AiChatMessageList, {
        messages: [
          { id: 1, role: "player", text: "How do I win?" },
          { id: 2, role: "assistant", text: "First to 3 round wins." },
        ],
      }),
    );
    expect(html).toContain("ai-chat__message--player");
    expect(html).toContain("ai-chat__message--assistant");
    expect(html).toContain("How do I win?");
    expect(html).toContain("First to 3 round wins.");
  });
});
