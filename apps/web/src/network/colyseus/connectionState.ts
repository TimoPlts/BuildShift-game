/**
 * A small, pure state machine for the client's connection status.
 *
 * Keeping this as a standalone function (rather than logic embedded in the
 * SDK adapter) means the connection lifecycle is directly unit-testable and
 * free of any Colyseus dependency. The adapter (see `FoundationNetwork`) is
 * responsible only for *emitting* {@link ConnectionEvent}s; this module is
 * responsible for deciding what status each event produces.
 */

/** The connection statuses surfaced to the dev status UI. */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected";

/**
 * A discrete connection lifecycle event, in the order the Colyseus SDK
 * reports them:
 *
 * - `join-started`  — the client began joining the room.
 * - `connected`     — the room joined successfully (we have a room/session).
 * - `disconnected`  — the connection dropped / the room ended (including join
 *                     failures, which surface via the `roomEnd` callback).
 * - `disposed`      — the adapter was disposed locally.
 */
export type ConnectionEvent =
  | "join-started"
  | "connected"
  | "disconnected"
  | "disposed";

/**
 * Compute the next {@link ConnectionState} given the current one and the
 * event that just occurred.
 *
 * The transitions are intentionally conservative: the only way to become
 * `connected` is an explicit `connected` event, and any of the terminal
 * events (`disconnected`, `disposed`) move to `disconnected`. There is no
 * auto-reconnect — once disconnected the adapter stays disconnected until the
 * caller explicitly calls `join()` again (a later-stage concern).
 *
 * @param current the status before the event.
 * @param event the event to apply.
 * @returns the resulting status.
 */
export function computeNextConnectionState(
  current: ConnectionState,
  event: ConnectionEvent,
): ConnectionState {
  switch (event) {
    case "join-started":
      return "connecting";
    case "connected":
      return "connected";
    case "disconnected":
    case "disposed":
      return "disconnected";
    default: {
      // Unreachable (exhaustive switch); `current` documents the "no-op" case.
      void current;
      return "disconnected";
    }
  }
}
