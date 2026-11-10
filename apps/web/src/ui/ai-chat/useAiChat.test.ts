/**
 * Hook regression tests for `useAiChat` against a real React render tree.
 *
 * Locks down the two QA findings that the pure reducer alone cannot express:
 *
 *  - D2 — a rapid double submit (same frame, before any state flush) issues
 *    at most ONE backend request, thanks to the synchronous hook-level
 *    in-flight guard;
 *  - D1 — a "New conversation" (reset) while a reply is in flight invalidates
 *    the stale completion: it can neither overwrite the conversation id nor
 *    surface an error, and the next question starts an INDEPENDENT
 *    conversation (no `conversationId` sent).
 *
 * The backend is fully mocked (controllable per-request promises; no network,
 * no credentials). The default vitest environment is node; this file opts
 * into happy-dom for the DOM render, mirroring `useMatchPresentation.test.ts`.
 */
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Opt in to React's act() environment for this file (React 18).
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
import { createElement, useEffect, useRef } from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { useAiChat, type UseAiChatResult } from "./useAiChat";
import type { AiChatRequest, AiChatResponse, AiChatSender } from "./aiChatClient";

/**
 * A sender whose requests stay in flight until the test settles them, one by
 * one, addressed by request index (so a stale in-flight request can be
 * completed after a newer one).
 */
function controllableSender() {
  const calls: AiChatRequest[] = [];
  const resolvers = new Map<
    number,
    { resolve: (value: AiChatResponse) => void; reject: (reason: Error) => void }
  >();
  const sender: AiChatSender = (request) => {
    const index = calls.length;
    calls.push(request);
    return new Promise<AiChatResponse>((resolve, reject) => {
      resolvers.set(index, { resolve, reject });
    });
  };
  return {
    calls,
    sender,
    resolveCall: (index: number, value: AiChatResponse) => {
      resolvers.get(index)?.resolve(value);
    },
    rejectCall: (index: number, reason: Error) => {
      resolvers.get(index)?.reject(reason);
    },
  };
}

function Harness({
  sender,
  onResult,
}: {
  sender: AiChatSender;
  onResult: (result: UseAiChatResult) => void;
}) {
  const result = useAiChat(sender);
  const latestRef = useRef(onResult);
  latestRef.current = onResult;
  useEffect(() => {
    latestRef.current(result);
  });
  return null;
}

function mountSender(sender: AiChatSender) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latest: UseAiChatResult;
  act(() => {
    root.render(
      createElement(Harness, {
        sender,
        onResult: (r) => {
          latest = r;
        },
      }),
    );
  });
  return {
    get latest() {
      return latest;
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("useAiChat — duplicate submission (D2)", () => {
  let backend: ReturnType<typeof controllableSender>;
  let app: ReturnType<typeof mountSender>;

  beforeEach(() => {
    backend = controllableSender();
    app = mountSender(backend.sender);
  });

  afterEach(() => {
    app.unmount();
  });

  it("a same-frame double submit issues at most one request and one reply", async () => {
    act(() => {
      app.latest.send("What is the objective?");
      app.latest.send("What is the objective?");
      app.latest.send("What is the objective?");
    });

    // The synchronous hook guard fires before the first render flush.
    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0].message).toBe("What is the objective?");
    // Only the first player message is shown; status is loading.
    expect(app.latest.messages).toHaveLength(1);
    expect(app.latest.status).toBe("loading");

    await act(async () => {
      backend.resolveCall(0, { conversationId: "c1", reply: "First to 3 wins." });
    });

    expect(backend.calls).toHaveLength(1);
    expect(app.latest.messages).toHaveLength(2);
    expect(app.latest.messages[1].text).toBe("First to 3 wins.");
    expect(app.latest.status).toBe("idle");
    expect(app.latest.conversationId).toBe("c1");
  });

  it("releases the in-flight guard after completion so the next question sends", async () => {
    act(() => {
      app.latest.send("First question?");
    });
    await act(async () => {
      backend.resolveCall(0, { conversationId: "c1", reply: "One." });
    });
    expect(app.latest.status).toBe("idle");

    act(() => {
      app.latest.send("Second question?");
    });
    expect(backend.calls).toHaveLength(2);
    expect(backend.calls[1].conversationId).toBe("c1"); // follow-up, same conversation
    await act(async () => {
      backend.resolveCall(1, { conversationId: "c1", reply: "Two." });
    });
    expect(app.latest.messages).toHaveLength(4);
  });

  it("releases the in-flight guard after a failure so the player can retry", async () => {
    act(() => {
      app.latest.send("Question?");
    });
    await act(async () => {
      backend.rejectCall(0, new Error("AI Guide request failed (HTTP 500). Please try again."));
    });
    expect(app.latest.status).toBe("error");

    act(() => {
      app.latest.send("Question?");
    });
    expect(backend.calls).toHaveLength(2);
    // A failed turn never adopted a conversation id, so the retry starts
    // without one (the backend creates a fresh conversation).
    expect(backend.calls[1].conversationId).toBeUndefined();
    await act(async () => {
      backend.resolveCall(1, { conversationId: "c1", reply: "Recovered." });
    });
    expect(app.latest.status).toBe("idle");
    expect(app.latest.messages).toHaveLength(3);
    expect(app.latest.conversationId).toBe("c1");
  });
});

describe("useAiChat — reset while a reply is in flight (D1)", () => {
  let backend: ReturnType<typeof controllableSender>;
  let app: ReturnType<typeof mountSender>;

  beforeEach(() => {
    backend = controllableSender();
    app = mountSender(backend.sender);
  });

  afterEach(() => {
    app.unmount();
  });

  it("a stale completion after reset cannot overwrite the conversation id", async () => {
    act(() => {
      app.latest.send("Old question?");
    });
    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0].conversationId).toBeUndefined();

    // "New conversation" while the old reply is still in flight.
    act(() => {
      app.latest.reset();
    });
    expect(app.latest.messages).toEqual([]);
    expect(app.latest.status).toBe("idle");
    expect(app.latest.conversationId).toBeNull();

    // The stale success arrives: it must be discarded entirely.
    await act(async () => {
      backend.resolveCall(0, { conversationId: "old-c1", reply: "Stale reply." });
    });
    expect(app.latest.messages).toEqual([]);
    expect(app.latest.status).toBe("idle");
    expect(app.latest.conversationId).toBeNull();
    expect(app.latest.error).toBeNull();
  });

  it("a fresh question after reset is an independent conversation (no stale id sent)", async () => {
    act(() => {
      app.latest.send("Old question?");
    });
    act(() => {
      app.latest.reset();
    });

    // The player immediately asks a fresh question: it must be accepted
    // (in-flight guard released by reset) without the stale conversation id.
    act(() => {
      app.latest.send("Fresh question?");
    });
    expect(backend.calls).toHaveLength(2);
    expect(backend.calls[1].conversationId).toBeUndefined();
    expect(backend.calls[1].message).toBe("Fresh question?");

    await act(async () => {
      backend.resolveCall(1, { conversationId: "new-c2", reply: "Fresh answer." });
    });
    expect(app.latest.conversationId).toBe("new-c2");

    // The stale completion of the reset turn lands AFTER the fresh reply:
    // it must not clobber the new conversation id or append a message.
    await act(async () => {
      backend.resolveCall(0, { conversationId: "old-c1", reply: "Stale reply." });
    });
    expect(app.latest.conversationId).toBe("new-c2");
    expect(app.latest.messages.map((m) => m.text)).toEqual([
      "Fresh question?",
      "Fresh answer.",
    ]);

    // The follow-up continues the NEW conversation.
    act(() => {
      app.latest.send("Follow-up?");
    });
    expect(backend.calls).toHaveLength(3);
    expect(backend.calls[2].conversationId).toBe("new-c2");
  });

  it("a stale failure after reset does not surface an error", async () => {
    act(() => {
      app.latest.send("Old question?");
    });
    act(() => {
      app.latest.reset();
    });
    await act(async () => {
      backend.rejectCall(0, new Error("AI Guide request failed (HTTP 500). Please try again."));
    });
    expect(app.latest.status).toBe("idle");
    expect(app.latest.error).toBeNull();
    expect(app.latest.messages).toEqual([]);
  });

  it("reset while idle clears an established conversation and the next send is fresh", async () => {
    act(() => {
      app.latest.send("Question?");
    });
    await act(async () => {
      backend.resolveCall(0, { conversationId: "c1", reply: "Answer." });
    });
    expect(app.latest.conversationId).toBe("c1");

    act(() => {
      app.latest.reset();
    });
    expect(app.latest.messages).toEqual([]);
    expect(app.latest.conversationId).toBeNull();

    act(() => {
      app.latest.send("Again?");
    });
    expect(backend.calls).toHaveLength(2);
    expect(backend.calls[1].conversationId).toBeUndefined();
  });
});
