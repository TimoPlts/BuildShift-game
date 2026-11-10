/**
 * Bounded in-memory conversation store for the AI chat endpoint.
 *
 * The server owns conversation state entirely: the browser is untrusted and
 * only ever sends a conversation id (or nothing). Only successful, complete
 * user/assistant message pairs are ever stored — a failed upstream request
 * leaves the conversation exactly as it was.
 *
 * Bounds (see `limits.ts`):
 *  - at most `maxConversations` retained conversations;
 *  - at most `maxTurnsPerConversation` user/assistant pairs per conversation
 *    (oldest pairs are dropped first);
 *  - conversations idle for longer than `staleConversationMs` are removed
 *    opportunistically ("simple stale cleanup" on each request).
 */
import { randomUUID } from "node:crypto";

import { AI_CHAT } from "./limits.js";

/** A single stored chat message. */
export interface StoredMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/** A server-owned conversation with bounded retained history. */
export interface Conversation {
  readonly id: string;
  /** Retained history: strictly alternating user/assistant pairs. */
  readonly messages: StoredMessage[];
  readonly createdAt: number;
  lastActiveAt: number;
}

export interface ConversationStoreLimits {
  readonly maxConversations: number;
  readonly maxTurnsPerConversation: number;
  readonly staleConversationMs: number;
}

export interface ConversationStore {
  /** Number of currently retained conversations. */
  readonly size: number;
  /** Maximum number of retained conversations (configuration bound). */
  readonly capacity: number;
  /** Look up a conversation by id; `undefined` when unknown or evicted. */
  get(id: string): Conversation | undefined;
  /**
   * Create a new empty conversation. Stale conversations are cleaned first;
   * when the store is still at capacity (full of fresh conversations) the
   * least recently active conversation is evicted to make room.
   */
  create(now?: number): Conversation;
  /**
   * Atomically append one complete user/assistant pair after a successful
   * exchange. Returns `false` when the conversation id is unknown. Older
   * pairs beyond the turn bound are dropped first.
   */
  appendPair(
    id: string,
    userMessage: string,
    assistantMessage: string,
    now?: number,
  ): boolean;
  /** Remove conversations idle for at least `staleConversationMs`; returns removed ids. */
  cleanupStale(now?: number): string[];
}

const DEFAULT_LIMITS: ConversationStoreLimits = {
  maxConversations: AI_CHAT.maxConversations,
  maxTurnsPerConversation: AI_CHAT.maxTurnsPerConversation,
  staleConversationMs: AI_CHAT.staleConversationMs,
};

/**
 * Create the bounded in-memory conversation store.
 *
 * `now` is injectable (defaults to `Date.now`) so tests can drive time
 * deterministically without waiting.
 */
export function createConversationStore(
  limits: Partial<ConversationStoreLimits> = {},
  now: () => number = Date.now,
): ConversationStore {
  const { maxConversations, maxTurnsPerConversation, staleConversationMs } = {
    ...DEFAULT_LIMITS,
    ...limits,
  };
  const maxMessages = 2 * maxTurnsPerConversation;

  const conversations = new Map<string, Conversation>();

  function cleanupStale(timestamp: number): string[] {
    const removed: string[] = [];
    for (const [id, conversation] of conversations) {
      if (timestamp - conversation.lastActiveAt >= staleConversationMs) {
        conversations.delete(id);
        removed.push(id);
      }
    }
    return removed;
  }

  function oldestActive(): Conversation | undefined {
    let oldest: Conversation | undefined;
    for (const conversation of conversations.values()) {
      if (
        oldest === undefined ||
        conversation.lastActiveAt < oldest.lastActiveAt ||
        (conversation.lastActiveAt === oldest.lastActiveAt &&
          conversation.id < oldest.id)
      ) {
        oldest = conversation;
      }
    }
    return oldest;
  }

  const store: ConversationStore = {
    get size(): number {
      return conversations.size;
    },

    get capacity(): number {
      return maxConversations;
    },

    get(id: string): Conversation | undefined {
      return conversations.get(id);
    },

    create(timestamp = now()): Conversation {
      cleanupStale(timestamp);
      while (conversations.size >= maxConversations) {
        const evicted = oldestActive();
        if (evicted === undefined) {
          break;
        }
        conversations.delete(evicted.id);
      }
      const conversation: Conversation = {
        id: `conv_${randomUUID()}`,
        messages: [],
        createdAt: timestamp,
        lastActiveAt: timestamp,
      };
      conversations.set(conversation.id, conversation);
      return conversation;
    },

    appendPair(
      id: string,
      userMessage: string,
      assistantMessage: string,
      timestamp = now(),
    ): boolean {
      const conversation = conversations.get(id);
      if (conversation === undefined) {
        return false;
      }
      while (conversation.messages.length + 2 > maxMessages) {
        // Drop the oldest complete pair (a user message followed by its
        // assistant reply), preserving strict user/assistant alternation.
        conversation.messages.splice(0, 2);
      }
      conversation.messages.push(
        { role: "user", content: userMessage },
        { role: "assistant", content: assistantMessage },
      );
      conversation.lastActiveAt = timestamp;
      return true;
    },

    cleanupStale(timestamp = now()): string[] {
      return cleanupStale(timestamp);
    },
  };

  return store;
}
