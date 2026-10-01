/**
 * Shared network event identifiers.
 *
 * @deprecated This is a compatibility re-export. The canonical event names and
 * combat payloads now live in `packages/protocol/src/events/index.ts`
 * (the combat milestone consolidated all event identifiers into the `events/`
 * module). Import `EVENTS` and `EventName` from `@buildshift/protocol` (or from
 * `./events/index.js`) instead of from this path.
 */
export { EVENTS, type EventName } from "../events/index.js";
