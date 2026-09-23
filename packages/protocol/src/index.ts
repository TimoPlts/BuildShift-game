/**
 * Shared network contract between client and server.
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §7.3 this package holds input schemas,
 * Colyseus state schemas, event names, and message payload types shared by
 * client and server. It must contain no Babylon, React, database, or
 * Node-only code and must remain dependency-independent.
 *
 * No protocol definitions are implemented yet — this is the scaffold where
 * input/state schemas will be added in a later stage.
 */

/** Logical game mode identifiers. */
export type GameMode = "box-fight" | "king-of-the-tower";

/**
 * Shared protocol metadata. Concrete schemas (inputs, state, events, message
 * payloads) will be added in a later stage and exported from here.
 */
export const PROTOCOL_VERSION = "0.1.0" as const;
