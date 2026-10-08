/**
 * DiagnosticsSnapshot — a plain-data read-only snapshot of runtime state
 * for the developer diagnostics overlay.
 *
 * This interface defines the shape returned by {@link GameRuntime.getDiagnosticsSnapshot}.
 * It is a display-only view: no gameplay, networking, or authority logic
 * reads from this object.
 */

/**
 * A single axis-aligned position in world space.
 */
export interface DiagnosticsVec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * A flat, read-only snapshot of the game runtime's live state for
 * developer diagnostics display.
 */
export interface DiagnosticsSnapshot {
  /** Whether the local client is connected to the authoritative room. */
  connected: boolean;
  /** The local session ID (null when disconnected). */
  sessionId: string | null;
  /** The current match phase (e.g. "COUNTDOWN", "IN_PROGRESS"). */
  matchPhase: string;
  /** The current round number (0-indexed). */
  currentRound: number;
  /**
   * The predicted (client-side) local player position.
   * Updated every simulation tick by the prediction orchestrator.
   */
  predictedPos: DiagnosticsVec3;
  /**
   * The last authoritative (server-reported) local player position,
   * or null before the first reconciliation.
   */
  authoritativePos: DiagnosticsVec3 | null;
  /**
   * The distance (metres) of the last reconciliation correction,
   * or null before the first reconciliation.
   */
  lastCorrectionDistance: number | null;
  /** The currently equipped weapon type. */
  weaponType: string;
  /** Whether the local player is in build mode. */
  buildMode: boolean;
  /** The last sent input sequence number. */
  inputSequence: number;
}
