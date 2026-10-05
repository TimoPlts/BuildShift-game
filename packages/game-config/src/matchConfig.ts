/**
 * Timed-match and anti-stall configuration constants.
 *
 * Shared timing values that drive the authoritative round timer, the
 * deterministic anti-stall timeout resolution, and the rematch window.
 * Both the authoritative server (`apps/game-server`) and the client
 * (`apps/web`) import these constants so they agree on the exact
 * round duration, anti-stall threshold, and rematch acceptance window.
 *
 * The protocol package (`@buildshift/protocol` → `matchLifecycle.ts`)
 * owns the *shapes* of the lifecycle contract (`RoundTimerState`,
 * `AntiStallState`, `RoundEndResult`, `MatchEndResult`, `RematchRequest`,
 * and `MATCH_LIFECYCLE_EVENTS`); this package owns the concrete *timing
 * values* those shapes are driven by.
 */

/**
 * Duration of a single round before it times out, in seconds.
 *
 * While the round is in the `PLAYING` phase, the server counts down from
 * this value. When the timer reaches zero, the round ends with
 * `RoundEndReason = "time_expired"` and the player with the higher health
 * wins (or it is a draw resolved by deterministic tie-break).
 *
 * Balance: 90 seconds gives enough time for building and combat while
 * preventing indefinite stalling by both players simultaneously.
 */
export const ROUND_DURATION_SECONDS = 90;

/**
 * Anti-stall inactivity threshold, in seconds.
 *
 * If a player has produced no meaningful input (movement, build, or fire)
 * for this continuous duration during the `PLAYING` phase, the server
 * resolves the round immediately in favor of the other player with
 * `RoundEndReason = "anti_stall_timeout"`.
 *
 * This prevents one player from indefinitely stalling a round by doing
 * nothing while the other waits. The check is deterministic: the server
 * tracks per-player `inactiveMs` and compares against
 * `ANTI_STALL_TIMEOUT_SECONDS * 1000` each tick.
 *
 * Balance: 30 seconds is long enough to cover brief tactical pauses
 * (reloading, repositioning, watching enemy build) while being short
 * enough to prevent deliberate stall abuse.
 */
export const ANTI_STALL_TIMEOUT_SECONDS = 30;

/**
 * Rematch acceptance window, in seconds.
 *
 * After a match ends (`MATCH_OVER`), a `RematchRequest` is only accepted
 * if sent within this many seconds of the match-end timestamp. After the
 * window expires, the room returns to an idle state and new players must
 * join fresh.
 *
 * Balance: 30 seconds gives both players enough time to read the result
 * and decide, while preventing an abandoned room from lingering indefinitely.
 */
export const REMATCH_WINDOW_SECONDS = 30;
