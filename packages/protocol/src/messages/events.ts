/**
 * Shared network event identifiers.
 *
 * A single source of truth so the client and server reference the same event
 * name rather than independently inventing magic strings.
 *
 * Only the events required by the *current* Stage 2 foundation are declared:
 * the authoritative movement-input event. Authoritative state is delivered by
 * Colyseus' built-in state synchronisation (the future `Schema` broadcast), not
 * by a bespoke event, so there is no "state" event to define here. No combat /
 * build / game-mode events are pre-declared.
 */
export const EVENTS = {
  /**
   * Client → server: a single {@link PlayerInputFrame} (movement intent) for
   * the player's current simulation tick.
   */
  PLAYER_INPUT: "player:input",
} as const;

/** A valid network event identifier. */
export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
