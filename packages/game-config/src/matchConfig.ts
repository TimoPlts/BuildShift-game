/**
 * Match-window configuration constants.
 *
 * `ROUND_DURATION_SECONDS` and `ANTI_STALL_TIMEOUT_SECONDS` were REMOVED in
 * the round-preparation batch: an active fight has NO round timer and NO
 * anti-stall resolution — a round ends on elimination only (the
 * disconnect-grace forfeit remains as the explicit player-leaving
 * exception). The pre-fight build preparation duration lives in
 * `boxFightPreparation.ts` (`BOX_FIGHT_PREPARATION`).
 *
 * The protocol package (`@buildshift/protocol` → `matchLifecycle.ts`)
 * owns the *shapes* of the lifecycle contract (`RoundEndResult`,
 * `MatchEndResult`, `RematchRequest`, and `MATCH_LIFECYCLE_EVENTS`);
 * this package owns the concrete *timing values* those shapes are driven
 * by.
 */

/**
 * Rematch acceptance window, in seconds.
 *
 * After a match ends (`MATCH_ENDED`), a `RematchRequest` is only accepted
 * if sent within this many seconds of the match-end timestamp. After the
 * window expires, the room returns to an idle state and new players must
 * join fresh.
 *
 * Balance: 30 seconds gives both players enough time to read the result
 * and decide, while preventing an abandoned room from lingering indefinitely.
 */
export const REMATCH_WINDOW_SECONDS = 30;
