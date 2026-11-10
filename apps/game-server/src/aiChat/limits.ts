/**
 * Bounded configuration for the AI chat endpoint (`POST /api/ai-chat`).
 *
 * Every limit here is a hard server-side bound: the browser may send anything,
 * but the server only ever accepts requests inside these bounds, stores only
 * successful complete user/assistant turns, and keeps only a bounded number
 * of conversations in memory.
 */
export const AI_CHAT = {
  /** Route path (mounted directly on the game-server HTTP origin). */
  route: "/api/ai-chat",

  /** Maximum length (characters) of a single user message. */
  maxMessageLength: 2_000,

  /**
   * Maximum number of retained user/assistant *pairs* per conversation.
   * Older pairs are dropped oldest-first once the history exceeds this.
   */
  maxTurnsPerConversation: 8,

  /** Maximum number of simultaneously retained conversations. */
  maxConversations: 128,

  /**
   * Conversations inactive for longer than this are eligible for cleanup.
   * Cleanup runs opportunistically on each request; when the store is full of
   * fresh conversations, new conversation creation is rejected instead of
   * evicting live ones.
   */
  staleConversationMs: 30 * 60 * 1_000,

  /** Upstream LLM request timeout, in milliseconds. */
  requestTimeoutMs: 60_000,

  /** OpenAI-compatible base URL of the school LLM gateway. */
  llmBaseUrl: "https://api.llm.mechatronics.be/v1",

  /** Model name requested from the gateway. */
  llmModel: "qwen3.8-27b",

  /** Maximum assistant tokens requested per reply. */
  maxTokens: 2_048,

  /** Reasoning effort requested per reply. */
  reasoningEffort: "low" as const,

  /** Hard cap on the JSON request body size. */
  jsonBodyLimit: "64kb",
} as const;
