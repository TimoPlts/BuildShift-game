/**
 * @deprecated This module has been consolidated into
 * `apps/web/src/network/twoPlayer/`. Use {@link TwoPlayerClient} from
 * `@/network/twoPlayer` instead.
 *
 * The old `ConnectionManager` provided Colyseus connection lifecycle
 * management. That responsibility is now handled by `TwoPlayerClient`,
 * which additionally parses room state and exposes a stable
 * `onStateChange` / `onConnectionChange` API.
 */
export {};
