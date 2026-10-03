/**
 * Ambient module declaration for `@buildshift/protocol`.
 *
 * The simulation package's build config (`tsconfig.build.json`) clears all
 * path-mappings (`"paths": {}`) and uses `NodeNext` module resolution. Because
 * `@buildshift/protocol` is not listed in this package's `package.json`
 * `dependencies` (it is a peer-level workspace package resolved via the monorepo
 * path aliases at dev-time), this ambient declaration ensures the build compiler
 * can resolve the types without a physical `node_modules` link.
 *
 * At runtime the module is resolved through the pnpm workspace link.
 */
declare module "@buildshift/protocol" {
  /**
   * Authoritative game-state vocabulary for the round/match lifecycle.
   */
  export enum GameState {
    /** Pre-round countdown; players are locked in. */
    COUNTDOWN = "COUNTDOWN",
    /** Active round; players can move, aim, and fire. */
    PLAYING = "PLAYING",
    /** Round completed; score updated. */
    ROUND_END = "ROUND_END",
    /** Match complete; a player reached FIRST_TO_N. */
    MATCH_END = "MATCH_END",
  }

  /**
   * Countdown timer state carried during the COUNTDOWN phase.
   */
  export interface CountdownState {
    /** Remaining countdown time in milliseconds. */
    remainingMs: number;
  }

  /**
   * Cumulative round-win scores for both players and the current
   * round number.
   */
  export interface RoundScore {
    /** 1-based round number currently in progress. */
    roundNumber: number;
    /** Total rounds won by player A. */
    playerAScore: number;
    /** Total rounds won by player B. */
    playerBScore: number;
  }

  /**
   * Final result of a completed match.
   */
  export interface MatchResult {
    /** Colyseus `sessionId` (or logical id) of the winning player. */
    winningPlayerId: string;
    /** Final scores at the end of the match. */
    finalScores: RoundScore;
  }

  /**
   * Number of rounds a player must win to take the match.
   */
  export const FIRST_TO_N: 3;
}
