/**
 * AI Guide conversation state machine — covers follow-up conversation ids,
 * error handling, "New conversation", and the bounded visible history.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_VISIBLE_MESSAGES,
  createInitialAiChatState,
  reduceAiChat,
  type AiChatState,
} from "./aiChatState";

describe("reduceAiChat — conversation lifecycle", () => {
  it("starts with no messages, no conversation id, and idle status", () => {
    const state = createInitialAiChatState();
    expect(state.messages).toEqual([]);
    expect(state.conversationId).toBeNull();
    expect(state.status).toBe("idle");
    expect(state.error).toBeNull();
  });

  it("records the player question and goes loading on send/start", () => {
    const state = reduceAiChat(createInitialAiChatState(), {
      type: "send/start",
      message: "How do I move?",
    });
    expect(state.messages).toEqual([
      { id: 1, role: "player", text: "How do I move?" },
    ]);
    expect(state.status).toBe("loading");
    expect(state.conversationId).toBeNull();
  });

  it("adopts the backend conversation id on success so the next turn is a follow-up", () => {
    let state: AiChatState = reduceAiChat(createInitialAiChatState(), {
      type: "send/start",
      message: "How do I move?",
    });
    state = reduceAiChat(state, {
      type: "send/success",
      conversationId: "conv-42",
      reply: "WASD moves you.",
    });
    expect(state.conversationId).toBe("conv-42");
    expect(state.status).toBe("idle");
    expect(state.messages).toEqual([
      { id: 1, role: "player", text: "How do I move?" },
      { id: 2, role: "assistant", text: "WASD moves you." },
    ]);
  });

  it("keeps the same conversation id across follow-up turns", () => {
    let state: AiChatState = createInitialAiChatState();
    state = reduceAiChat(state, { type: "send/start", message: "Q1" });
    state = reduceAiChat(state, {
      type: "send/success",
      conversationId: "conv-7",
      reply: "A1",
    });
    state = reduceAiChat(state, { type: "send/start", message: "Q2" });
    state = reduceAiChat(state, {
      type: "send/success",
      conversationId: "conv-7",
      reply: "A2",
    });
    expect(state.conversationId).toBe("conv-7");
    expect(state.messages.map((m) => m.role)).toEqual([
      "player",
      "assistant",
      "player",
      "assistant",
    ]);
  });

  it("resets everything on 'New conversation' (including the conversation id)", () => {
    let state: AiChatState = createInitialAiChatState();
    state = reduceAiChat(state, { type: "send/start", message: "Q1" });
    state = reduceAiChat(state, {
      type: "send/success",
      conversationId: "conv-7",
      reply: "A1",
    });
    state = reduceAiChat(state, { type: "reset" });
    expect(state).toEqual(createInitialAiChatState());
  });
});

describe("reduceAiChat — errors and in-flight guards", () => {
  it("records the player-facing error text on failure and keeps the question", () => {
    let state: AiChatState = reduceAiChat(createInitialAiChatState(), {
      type: "send/start",
      message: "How do I win?",
    });
    state = reduceAiChat(state, {
      type: "send/failure",
      error: "AI Guide request failed (HTTP 500). Please try again.",
    });
    expect(state.status).toBe("error");
    expect(state.error).toBe("AI Guide request failed (HTTP 500). Please try again.");
    // The question stays visible; the assistant never answered.
    expect(state.messages).toEqual([
      { id: 1, role: "player", text: "How do I win?" },
    ]);
    expect(state.conversationId).toBeNull();
  });

  it("a later success clears the error state", () => {
    let state: AiChatState = reduceAiChat(createInitialAiChatState(), {
      type: "send/start",
      message: "Q",
    });
    state = reduceAiChat(state, { type: "send/failure", error: "boom" });
    state = reduceAiChat(state, { type: "send/start", message: "Q retry" });
    state = reduceAiChat(state, {
      type: "send/success",
      conversationId: "c",
      reply: "A",
    });
    expect(state.status).toBe("idle");
    expect(state.error).toBeNull();
  });

  it("ignores a second send while a reply is in flight", () => {
    let state: AiChatState = reduceAiChat(createInitialAiChatState(), {
      type: "send/start",
      message: "Q1",
    });
    const during = reduceAiChat(state, { type: "send/start", message: "Q2" });
    expect(during).toBe(state);
  });

  it("ignores stale success/failure actions when not loading", () => {
    const state = createInitialAiChatState();
    expect(
      reduceAiChat(state, { type: "send/success", conversationId: "c", reply: "A" }),
    ).toBe(state);
    expect(reduceAiChat(state, { type: "send/failure", error: "boom" })).toBe(state);
  });
});

describe("reduceAiChat — bounded visible history", () => {
  it("keeps only the newest MAX_VISIBLE_MESSAGES lines", () => {
    let state: AiChatState = createInitialAiChatState();
    const total = MAX_VISIBLE_MESSAGES + 15;
    for (let i = 1; i <= total; i += 1) {
      state = reduceAiChat(state, { type: "send/start", message: `Q${i}` });
      state = reduceAiChat(state, {
        type: "send/success",
        conversationId: "c",
        reply: `A${i}`,
      });
    }
    expect(state.messages).toHaveLength(MAX_VISIBLE_MESSAGES);
    // Oldest lines dropped, newest kept, order preserved. Messages are kept in
    // player/assistant pairs, so the cap drops whole pairs at the start.
    const keptPairs = MAX_VISIBLE_MESSAGES / 2;
    const firstText = state.messages[0].text;
    const lastText = state.messages[state.messages.length - 1].text;
    expect(firstText).toBe(`Q${total - keptPairs + 1}`);
    expect(lastText).toBe(`A${total}`);
    // The conversation itself is unaffected by the display cap.
    expect(state.conversationId).toBe("c");
  });
});
