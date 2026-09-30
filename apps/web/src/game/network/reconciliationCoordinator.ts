import type { NetworkUiState } from "../../network/colyseus/foundationNetwork";
import type { PredictionHistory } from "./predictionHistory";
import type { AuthoritativeLocalSnapshot } from "./reconciliation";

/**
 * The minimal structural surface of a reconciliation engine that the
 * {@link ReconciliationCoordinator} drives. The real {@link ReconciliationEngine}
 * satisfies this (its full `ReconcileResult` return is a superset); tests inject
 * a recording fake so coordinator behaviour is unit-testable without a browser
 * or Rapier.
 */
export interface ReconcilingEngine {
  /** The highest ack this engine has recorded (monotonic, starts at -1). */
  readonly lastReconciledAck: number;
  /**
   * Reconcile one authoritative local snapshot (safe for stale/duplicate).
   * The coordinator only needs the monotonic ack from the outcome, so the
   * return type is declared minimally — the richer real result is assignable.
   */
  reconcile(snapshot: AuthoritativeLocalSnapshot): {
    readonly lastReconciledAck: number;
  };
}

/**
 * The injected seams the coordinator drives. The runtime provides the shared
 * {@link PredictionHistory}, a factory that builds a FRESH engine wired to that
 * history, and a "is a prediction batch in progress?" probe used to enforce the
 * safe batch boundary.
 */
export interface ReconciliationCoordinatorDeps {
  /** The single shared prediction history (owned by the runtime). */
  readonly history: PredictionHistory;
  /**
   * Create a fresh engine bound to the shared history. Called exactly once per
   * session transition INTO a session, so a new session always starts with a
   * clean monotonic ack (never reusing an old session's engine).
   */
  createEngine(): ReconcilingEngine;
  /** True while the two-substep prediction batch is mid-flight. */
  hasActiveBatch(): boolean;
}

/**
 * A pure, browser-independent coordinator that turns raw network UI state
 * changes into authoritative reconciliation at the safe batch boundary.
 *
 * Responsibilities:
 *  - OBSERVE (never roll back here): on each network UI-state change, track the
 *    local session id, select ONLY the local player's authoritative snapshot
 *    (`players[sessionId]` — never remote players), and COALESCE it so the
 *    latest snapshot wins.
 *  - SESSION LIFECYCLE: when session identity changes, clear the shared
 *    {@link PredictionHistory}, discard any pending snapshot, and drop the old
 *    engine. A transition into a session builds a fresh engine so its ack space
 *    starts at -1; a transition to `null` (disconnect) leaves no engine.
 *  - SAFE BOUNDARY: `reconcileAtSafeBoundary()` applies the latest pending
 *    snapshot through the engine exactly once, and ONLY when no prediction
 *    batch is in progress — so a snapshot that arrives mid-batch stays pending
 *    until the batch finishes.
 *
 * The coordinator performs NO simulation and NO network I/O itself; the
 * injected engine (which drives `PlayerController`) does the actual
 * rollback/replay. This separation is what keeps every rule here unit-testable.
 */
export class ReconciliationCoordinator {
  private engine: ReconcilingEngine | null = null;
  private activeSessionId: string | null = null;
  private pendingSnapshot: AuthoritativeLocalSnapshot | null = null;

  public constructor(private readonly deps: ReconciliationCoordinatorDeps) {}

  /** The session id the coordinator is currently reconciled against. */
  public get currentSessionId(): string | null {
    return this.activeSessionId;
  }

  /** The live engine's recorded ack, or -1 when no session is active. */
  public get lastReconciledAck(): number {
    return this.engine?.lastReconciledAck ?? -1;
  }

  /** True when a local authoritative snapshot is waiting for the safe boundary. */
  public get hasPendingSnapshot(): boolean {
    return this.pendingSnapshot !== null;
  }

  /**
   * Observe one network UI-state change. This is the network subscription
   * callback body: it tracks session identity, coalesces the LATEST local
   * snapshot, and never reconciles. Reconciliation happens only at the safe
   * batch boundary via {@link reconcileAtSafeBoundary}.
   */
  public onNetworkState(state: NetworkUiState): void {
    const sessionId = state.sessionId;

    // Session identity changed (null -> A, A -> null, or A -> B): reset all
    // reconciliation state so no old-session ack/history leaks across.
    if (sessionId !== this.activeSessionId) {
      this.handleSessionTransition(sessionId);
    }

    // Disconnected: there is no local authoritative snapshot to reconcile.
    if (sessionId === null) {
      return;
    }

    // Select ONLY the local player. `players` is keyed by player id, which the
    // server guarantees equals the client session id; any other entry is a
    // remote player and is deliberately ignored.
    const local = state.players[sessionId];
    if (local !== undefined) {
      // Coalesce: the latest local snapshot always replaces the previous one.
      this.pendingSnapshot = {
        position: {
          x: local.position.x,
          y: local.position.y,
          z: local.position.z,
        },
        yaw: local.yaw,
        acknowledgedSequence: local.acknowledgedSequence,
      };
    }
  }

  /**
   * Safe batch boundary: apply the latest pending local snapshot exactly once,
   * and only when no prediction batch is in flight. A snapshot that arrived
   * mid-batch is left pending for the next boundary call.
   */
  public reconcileAtSafeBoundary(): void {
    const engine = this.engine;
    const snapshot = this.pendingSnapshot;

    // Nothing to do: no active session/engine, or no pending snapshot.
    if (engine === null || snapshot === null) {
      return;
    }

    // Never roll back halfway through a two-substep batch. Keep it pending; the
    // caller re-invokes this once the batch has completed.
    if (this.deps.hasActiveBatch()) {
      return;
    }

    // Consume the coalesced snapshot, then let the engine decide (ignored /
    // accepted / no-checkpoint / corrected). Duplicate & stale acks are handled
    // by the engine's monotonic ack — this call site never re-derives that.
    this.pendingSnapshot = null;
    engine.reconcile(snapshot);
  }

  /**
   * Reset ALL reconciliation state for a session identity change. Clears the
   * shared history (dropping every stored checkpoint), discards any pending
   * snapshot, and rebuilds the engine — or drops it entirely when leaving for
   * a disconnected (null) session.
   */
  private handleSessionTransition(sessionId: string | null): void {
    this.deps.history.clear();
    this.pendingSnapshot = null;
    this.engine = null;
    this.activeSessionId = sessionId;

    // A transition INTO a session starts a fresh monotonic ack space.
    if (sessionId !== null) {
      this.engine = this.deps.createEngine();
    }
  }
}
