/**
 * preparationPresentation — pure, framework-free mapping from the
 * authoritative match-lifecycle view into the **preparation-phase** UI state
 * the shell renders before every fight.
 *
 * The gameplay contract this presents (agreed for the round-preparation
 * batch):
 *
 *  - `MatchPhase.COUNTDOWN` **is** the build-preparation phase: each player is
 *    restricted to their own build-grid row while temporary barriers hold.
 *  - the preparation countdown (the server's authoritative countdown value —
 *    8 seconds under `BOX_FIGHT_PREPARATION`) is the ONLY clock a player
 *    ever sees; an in-progress fight has no round timer at all.
 *  - the room-level `preparationActive` flag is true only while both players
 *    are present and the preparation countdown is actually running, so a
 *    half-filled room presents "waiting for opponent" instead.
 *  - when the countdown reaches zero the barriers vanish simultaneously, the
 *    arena opens (prebuilt structures survive) and the fight runs until an
 *    authoritative elimination (or a leaving/forfeit) ends the round.
 *
 * This module owns **presentation only**: it never invents a duration, never
 * starts a timer, and derives nothing but the labels/visibility rules above
 * from the authoritative values it is handed. The authoritative duration,
 * zone geometry and gate logic live server-side (and in the shared
 * `boxFightPreparation` config); the UI never duplicates them.
 *
 * The source type is intentionally a *minimal structural* view of the
 * lifecycle data (all preparation fields optional) so the shell compiles and
 * degrades gracefully before the parser/runtime layer carries the new
 * replicated fields, and picks them up automatically once it does.
 */
import { RoundState } from "@buildshift/protocol";

/** Compact label for the build-preparation phase. */
export const PREPARATION_PHASE_LABEL = "BUILD PHASE";
/** Compact label shown while the room is not ready to start preparation. */
export const WAITING_PHASE_LABEL = "WAITING FOR OPPONENT";
/** Compact label for a pre-round countdown the server did not mark as preparation. */
export const READY_PHASE_LABEL = "GET READY";
/** Status shown for the moment the countdown is exhausted but play has not begun. */
export const PREPARATION_OPENING_LABEL = "ARENA OPENING";
/** Short cue flashed when the barriers drop and the fight begins. */
export const FIGHT_CUE_LABEL = "FIGHT";

/** The server's preparation-side vocabulary (empty before assignment). */
export type PreparationSide = "negative" | "positive";

/**
 * The minimal authoritative input the preparation UI needs. Every field is
 * read structurally from the normalized lifecycle view; the preparation
 * fields are optional so a pre-integration view still compiles.
 */
export interface PreparationUiSource {
  /** Whether the runtime is joined to a room. */
  connected?: boolean;
  /** The canonical lifecycle phase (COUNTDOWN == build preparation). */
  roundState: RoundState;
  /** The authoritative countdown seconds remaining (0 when not counting). */
  countdownRemainingSeconds: number;
  /** Whether the authoritative preparation phase is running for this room. */
  preparationActive?: boolean;
  /** The local player's assigned preparation side, empty before assignment. */
  preparationSide?: string | null;
  /** The 1-based current round number, when the caller has one. */
  currentRound?: number;
}

/**
 * The presentation moments the preparation banner can render:
 *
 *  - `idle`      — nothing to present (in play, between rounds, disconnected).
 *  - `waiting`   — the room is in the pre-fight phase but preparation has not
 *                  started (both players must be present).
 *  - `preparing` — the authoritative preparation countdown is running.
 *  - `ready`     — a pre-round countdown the server did not flag as
 *                  preparation (graceful fallback for a pre-integration
 *                  server / a countdown before the assignment exists).
 */
export type PreparationUiMode = "idle" | "waiting" | "preparing" | "ready";

/** The derived preparation-banner presentation state. */
export interface PreparationUiState {
  /** The active presentation mode. */
  mode: PreparationUiMode;
  /** Whole authoritative seconds remaining (0 unless a countdown is running). */
  remainingSeconds: number;
  /** Readable assigned-row hint, or `null` when no side is assigned. */
  sideHint: string | null;
  /** The 1-based round number being prepared for (0 when unknown). */
  roundNumber: number;
}

/** The idle state (nothing presented). */
export const NO_PREPARATION: PreparationUiState = {
  mode: "idle",
  remainingSeconds: 0,
  sideHint: null,
  roundNumber: 0,
};

/**
 * Turn the server's `preparationSide` string into a readable, geometry-neutral
 * hint for the assigned outermost build-grid row. Unknown / unassigned values
 * yield `null` so the banner never shows a guessed side.
 */
export function preparationSideHint(
  side: string | null | undefined,
): string | null {
  const normalized = typeof side === "string" ? side.trim().toLowerCase() : "";
  switch (normalized) {
    case "negative":
      return "YOUR BUILD ROW: -X END";
    case "positive":
      return "YOUR BUILD ROW: +X END";
    default:
      return null;
  }
}

/** Clamp an authoritative seconds value to a finite, non-negative integer. */
function wholeSeconds(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

/**
 * Derive the preparation-banner state from the authoritative lifecycle view.
 *
 * Total and side-effect free: any missing/unknown field degrades to the
 * least-claiming presentation (never a fake clock, never an invented side).
 */
export function derivePreparationUi(
  source: PreparationUiSource | null | undefined,
): PreparationUiState {
  if (source == null || source.connected === false) {
    return NO_PREPARATION;
  }

  // Preparation only exists in the pre-fight (COUNTDOWN) phase.
  if (source.roundState !== RoundState.COUNTDOWN) {
    return NO_PREPARATION;
  }

  const remainingSeconds = wholeSeconds(source.countdownRemainingSeconds);
  const roundNumber =
    typeof source.currentRound === "number" &&
    Number.isFinite(source.currentRound) &&
    source.currentRound > 0
      ? Math.floor(source.currentRound)
      : 0;

  // Authoritative preparation running: show the (only) clock plus the side hint.
  if (source.preparationActive === true) {
    return {
      mode: "preparing",
      remainingSeconds,
      sideHint: preparationSideHint(source.preparationSide),
      roundNumber,
    };
  }

  // A countdown that is not flagged as preparation: in a fresh room this means
  // the match is not full yet; mid-match it is a plain pre-round intro.
  if (roundNumber > 0) {
    return { ...NO_PREPARATION, mode: "ready", remainingSeconds, roundNumber };
  }

  return { ...NO_PREPARATION, mode: "waiting", roundNumber };
}
