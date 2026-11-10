import { describe, expect, it } from "vitest";

import { createConversationStore } from "./conversationStore.js";

const STALE_MS = 60_000;

describe("conversationStore", () => {
  it("creates conversations with unique, well-formed ids", () => {
    const store = createConversationStore();
    const a = store.create(0);
    const b = store.create(1);
    expect(a.id).toMatch(/^conv_[0-9a-f-]{36}$/);
    expect(b.id).toMatch(/^conv_[0-9a-f-]{36}$/);
    expect(a.id).not.toBe(b.id);
    expect(store.size).toBe(2);
  });

  it("keeps only complete user/assistant pairs, in order", () => {
    const store = createConversationStore();
    const conversation = store.create(0);
    expect(store.appendPair(conversation.id, "u1", "a1", 1)).toBe(true);
    expect(store.appendPair(conversation.id, "u2", "a2", 2)).toBe(true);
    expect(store.get(conversation.id)?.messages).toEqual([
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
    ]);
  });

  it("returns false (and stores nothing) for unknown conversation ids", () => {
    const store = createConversationStore();
    const before = store.size;
    expect(store.appendPair("conv_does-not-exist", "u", "a", 0)).toBe(false);
    expect(store.size).toBe(before);
  });

  it("bounds history to maxTurnsPerConversation pairs, dropping oldest first", () => {
    const store = createConversationStore(
      { maxConversations: 4, maxTurnsPerConversation: 2, staleConversationMs: STALE_MS },
      () => 0,
    );
    const conversation = store.create();
    for (let i = 0; i < 5; i++) {
      store.appendPair(conversation.id, `u${i}`, `a${i}`);
    }
    const messages = store.get(conversation.id)?.messages ?? [];
    expect(messages).toEqual([
      { role: "user", content: "u3" },
      { role: "assistant", content: "a3" },
      { role: "user", content: "u4" },
      { role: "assistant", content: "a4" },
    ]);
  });

  it("caps the number of retained conversations and evicts the least recently active", () => {
    const store = createConversationStore(
      { maxConversations: 2, maxTurnsPerConversation: 4, staleConversationMs: STALE_MS },
      () => 0,
    );
    const a = store.create(0);
    store.appendPair(a.id, "u", "a", 10); // lastActiveAt 10
    const b = store.create(0); // lastActiveAt 0
    const c = store.create(0); // store full → evict b (oldest activity)
    expect(store.size).toBe(2);
    expect(store.get(b.id)).toBeUndefined();
    expect(store.get(a.id)).toBeDefined();
    expect(store.get(c.id)).toBeDefined();
  });

  it("removes stale conversations on cleanup but keeps active ones", () => {
    const store = createConversationStore(
      { maxConversations: 8, maxTurnsPerConversation: 4, staleConversationMs: STALE_MS },
      () => 0,
    );
    const stale = store.create(0);
    store.appendPair(stale.id, "u", "a", 1_000); // active at t=1000
    const fresh = store.create(0);
    store.appendPair(fresh.id, "u", "a", 59_000); // active at t=59000

    const removed = store.cleanupStale(59_000); // stale threshold reached at t>=60000?
    // 59000 - 1000 = 58000 < 60000 → nothing stale yet.
    expect(removed).toEqual([]);

    const removedLater = store.cleanupStale(61_000);
    expect(removedLater).toEqual([stale.id]);
    expect(store.get(stale.id)).toBeUndefined();
    expect(store.get(fresh.id)).toBeDefined();
  });

  it("create() frees stale conversations before evicting fresh ones", () => {
    const store = createConversationStore(
      { maxConversations: 1, maxTurnsPerConversation: 4, staleConversationMs: STALE_MS },
      () => 0,
    );
    const stale = store.create(0);
    store.appendPair(stale.id, "u", "a", 0); // still active at t=0
    // At t=60000 the only conversation is stale → create reuses the slot
    // without evicting a live conversation.
    const next = store.create(60_000);
    expect(store.get(stale.id)).toBeUndefined();
    expect(next.id).not.toBe(stale.id);
    expect(store.size).toBe(1);
  });
});
