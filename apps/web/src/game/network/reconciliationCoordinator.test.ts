import { describe, expect, it } from "vitest";
import type { NetworkUiState } from "../../network/colyseus/foundationNetwork";
import { PredictionHistory } from "./predictionHistory";
import type { PredictionState } from "./predictionState";
import { ReconciliationCoordinator } from "./reconciliationCoordinator";
import type { AuthoritativeLocalSnapshot } from "./reconciliation";

/** A deterministic, valid prediction state (position encodes a label). */
function state(x: number): PredictionState {
  return {
    position: { x, y: 0, z: 0 },
    verticalVelocity: 0,
    lastGrounded: true,
    jump: { jumpBufferRemaining: 0, coyoteRemaining: 0 },
    facingYaw: 0,
  };
}

/**
 * A recording fake engine. It tracks its own monotonic `lastReconciledAck`
 * (starting at -1) and records every snapshot handed to `reconcile`, so tests
 * can prove WHICH engine instance reconciled WHICH snapshot — the core of the
 * "old-session ack state is not reused" and "only the local snapshot" checks.
 */
class FakeEngine {
  static instances: FakeEngine[] = [];
  reconciled: AuthoritativeLocalSnapshot[] = [];
  private highestAck = -1;

  constructor() {
    FakeEngine.instances.push(this);
  }

  get lastReconciledAck(): number {
    return this.highestAck;
  }

  reconcile(snapshot: AuthoritativeLocalSnapshot): {
    lastReconciledAck: number;
  } {
    this.reconciled.push(snapshot);
    if (snapshot.acknowledgedSequence > this.highestAck) {
      this.highestAck = snapshot.acknowledgedSequence;
    }
    return { lastReconciledAck: this.highestAck };
  }
}

/** A minimal UI-state factory covering the fields the coordinator reads. */
function uiState(
  sessionId: string | null,
  players: NetworkUiState["players"],
): NetworkUiState {
  return {
    status: sessionId === null ? "disconnected" : "connected",
    serverUrl: "ws://test",
    roomId: "room",
    sessionId,
    playerCount: Object.keys(players).length,
    players,
    error: null,
  };
}

/** Build a coordinator whose deps are fakes the test can inspect. */
function makeCoordinator() {
  const history = new PredictionHistory();
  const coordinator = new ReconciliationCoordinator({
    history,
    createEngine: () => new FakeEngine(),
    hasActiveBatch: () => harness.activeBatch,
  });
  return { coordinator, history, harness };
}

/** Mutable harness state shared with the coordinator's `hasActiveBatch`. */
const harness = {
  activeBatch: false,
};

function freshFakeEngineRegistry(): void {
  FakeEngine.instances = [];
}

describe("ReconciliationCoordinator — session lifecycle", () => {
  it("initializes cleanly on a null -> session-A transition", () => {
    const { coordinator } = makeCoordinator();
    freshFakeEngineRegistry();

    // Start disconnected (null), then join session A.
    coordinator.onNetworkState(uiState(null, {}));
    expect(coordinator.currentSessionId).toBeNull();
    expect(coordinator.lastReconciledAck).toBe(-1);
    expect(FakeEngine.instances.length).toBe(0);

    coordinator.onNetworkState(uiState("A", {}));
    expect(coordinator.currentSessionId).toBe("A");
    // A fresh engine was created with a clean ack space.
    expect(FakeEngine.instances.length).toBe(1);
    expect(coordinator.lastReconciledAck).toBe(-1);
  });

  it("session A -> B clears history, drops the old engine, and starts a fresh ack space", () => {
    const { coordinator, history } = makeCoordinator();
    freshFakeEngineRegistry();

    coordinator.onNetworkState(uiState("A", {}));
    const engineA = FakeEngine.instances[0];
    // Advance A's ack so a reuse would be observable.
    coordinator.onNetworkState(
      uiState("A", { A: { playerId: "A", position: { x: 0, y: 0, z: 0 }, yaw: 0, acknowledgedSequence: 5 } }),
    );
    harness.activeBatch = false;
    coordinator.reconcileAtSafeBoundary();
    expect(engineA.lastReconciledAck).toBe(5);
    // Seed a checkpoint so we can prove the switch clears it.
    history.append(10, { moveX: 1, moveZ: 0, lookYaw: 0, lookPitch: 0, jump: false }, state(1));

    // Transition to session B.
    coordinator.onNetworkState(uiState("B", {}));

    expect(coordinator.currentSessionId).toBe("B");
    // Old session's history is gone.
    expect(history.size).toBe(0);
    // A fresh engine was created; the old engine is NOT reused.
    expect(FakeEngine.instances.length).toBe(2);
    const engineB = FakeEngine.instances[1];
    expect(engineB.lastReconciledAck).toBe(-1);
    // The coordinator now reports the NEW engine's (fresh) ack, not A's 5.
    expect(coordinator.lastReconciledAck).toBe(-1);
  });

  it("disconnect (session -> null) clears stale session state and leaves no engine", () => {
    const { coordinator, history } = makeCoordinator();
    freshFakeEngineRegistry();

    coordinator.onNetworkState(uiState("A", {}));
    // A still-unconfirmed checkpoint is present before the disconnect.
    history.append(3, { moveX: 1, moveZ: 0, lookYaw: 0, lookPitch: 0, jump: false }, state(1));
    expect(history.size).toBe(1);
    coordinator.onNetworkState(
      uiState("A", { A: { playerId: "A", position: { x: 0, y: 0, z: 0 }, yaw: 0, acknowledgedSequence: 3 } }),
    );
    harness.activeBatch = false;
    coordinator.reconcileAtSafeBoundary();

    // Disconnect: the coordinator clears the stale session's history.
    coordinator.onNetworkState(uiState(null, {}));
    expect(coordinator.currentSessionId).toBeNull();
    expect(coordinator.lastReconciledAck).toBe(-1);
    expect(history.size).toBe(0);
    // No engine is active while disconnected.
    expect(coordinator.hasPendingSnapshot).toBe(false);

    // Local prediction must continue while disconnected: a pending snapshot
    // cannot reconcile without an engine, so the boundary is a safe no-op.
    coordinator.reconcileAtSafeBoundary();
    expect(FakeEngine.instances.length).toBe(1); // still only A's engine existed
  });

  it("a later session after a disconnect starts with a fresh ack, not the prior session's", () => {
    const { coordinator } = makeCoordinator();
    freshFakeEngineRegistry();

    coordinator.onNetworkState(uiState("A", {}));
    coordinator.onNetworkState(
      uiState("A", { A: { playerId: "A", position: { x: 0, y: 0, z: 0 }, yaw: 0, acknowledgedSequence: 9 } }),
    );
    harness.activeBatch = false;
    coordinator.reconcileAtSafeBoundary();
    expect(FakeEngine.instances[0].lastReconciledAck).toBe(9);

    // Drop to null, then rejoin as session C.
    coordinator.onNetworkState(uiState(null, {}));
    coordinator.onNetworkState(uiState("C", {}));

    const engineC = FakeEngine.instances[FakeEngine.instances.length - 1];
    expect(engineC.lastReconciledAck).toBe(-1);
    expect(coordinator.lastReconciledAck).toBe(-1);
  });
});

describe("ReconciliationCoordinator — local snapshot selection & coalescing", () => {
  it("selects ONLY the local session's snapshot, ignoring remote players", () => {
    const { coordinator } = makeCoordinator();
    freshFakeEngineRegistry();

    coordinator.onNetworkState(uiState("A", {}));
    coordinator.onNetworkState(
      uiState("A", {
        // Remote player "R" must be ignored.
        R: { playerId: "R", position: { x: 111, y: 0, z: 0 }, yaw: 1.5, acknowledgedSequence: 7 },
        // Local player "A" is the only one that matters.
        A: { playerId: "A", position: { x: 2, y: 0, z: 0 }, yaw: 0.5, acknowledgedSequence: 2 },
      }),
    );

    expect(coordinator.hasPendingSnapshot).toBe(true);
    harness.activeBatch = false;
    coordinator.reconcileAtSafeBoundary();

    const engine = FakeEngine.instances[0];
    expect(engine.reconciled.length).toBe(1);
    // The reconciled snapshot is the LOCAL one (x:2), not the remote (x:111).
    expect(engine.reconciled[0].position.x).toBe(2);
    expect(engine.reconciled[0].acknowledgedSequence).toBe(2);
  });

  it("coalesces so only the LATEST local snapshot reconciles", () => {
    const { coordinator } = makeCoordinator();
    freshFakeEngineRegistry();

    coordinator.onNetworkState(uiState("A", {}));
    // Two snapshots arrive before the safe boundary.
    coordinator.onNetworkState(
      uiState("A", { A: { playerId: "A", position: { x: 1, y: 0, z: 0 }, yaw: 0, acknowledgedSequence: 1 } }),
    );
    coordinator.onNetworkState(
      uiState("A", { A: { playerId: "A", position: { x: 9, y: 0, z: 0 }, yaw: 0, acknowledgedSequence: 2 } }),
    );

    harness.activeBatch = false;
    coordinator.reconcileAtSafeBoundary();

    const engine = FakeEngine.instances[0];
    // Exactly one reconcile (coalesced), and it carries the LATEST snapshot.
    expect(engine.reconciled.length).toBe(1);
    expect(engine.reconciled[0].position.x).toBe(9);
    expect(engine.reconciled[0].acknowledgedSequence).toBe(2);
  });

  it("does not reconcile a remote player when only remote snapshots are present", () => {
    const { coordinator } = makeCoordinator();
    freshFakeEngineRegistry();

    coordinator.onNetworkState(uiState("A", {}));
    // Only a remote player is present; the local entry is missing.
    coordinator.onNetworkState(
      uiState("A", { R: { playerId: "R", position: { x: 3, y: 0, z: 0 }, yaw: 0, acknowledgedSequence: 4 } }),
    );

    // No local snapshot was coalesced, so nothing is pending.
    expect(coordinator.hasPendingSnapshot).toBe(false);
    harness.activeBatch = false;
    coordinator.reconcileAtSafeBoundary();
    expect(FakeEngine.instances[0].reconciled.length).toBe(0);
  });
});

describe("ReconciliationCoordinator — safe batch boundary", () => {
  it("keeps a snapshot pending while a batch is active, then reconciles once idle", () => {
    const { coordinator } = makeCoordinator();
    freshFakeEngineRegistry();

    coordinator.onNetworkState(uiState("A", {}));
    coordinator.onNetworkState(
      uiState("A", { A: { playerId: "A", position: { x: 4, y: 0, z: 0 }, yaw: 0, acknowledgedSequence: 4 } }),
    );

    // Substep A is in flight: snapshot must stay pending, no reconcile.
    harness.activeBatch = true;
    coordinator.reconcileAtSafeBoundary();
    expect(coordinator.hasPendingSnapshot).toBe(true);
    expect(FakeEngine.instances[0].reconciled.length).toBe(0);

    // Batch finished; the next boundary reconciles exactly once.
    harness.activeBatch = false;
    coordinator.reconcileAtSafeBoundary();
    expect(FakeEngine.instances[0].reconciled.length).toBe(1);
    expect(coordinator.hasPendingSnapshot).toBe(false);

    // Re-invoking with nothing pending is a no-op.
    coordinator.reconcileAtSafeBoundary();
    expect(FakeEngine.instances[0].reconciled.length).toBe(1);
  });

  it("never reconciles while a batch is active, even across repeated boundary calls", () => {
    const { coordinator } = makeCoordinator();
    freshFakeEngineRegistry();

    coordinator.onNetworkState(uiState("A", {}));
    coordinator.onNetworkState(
      uiState("A", { A: { playerId: "A", position: { x: 5, y: 0, z: 0 }, yaw: 0, acknowledgedSequence: 5 } }),
    );

    harness.activeBatch = true;
    coordinator.reconcileAtSafeBoundary();
    coordinator.reconcileAtSafeBoundary();
    coordinator.reconcileAtSafeBoundary();

    expect(FakeEngine.instances[0].reconciled.length).toBe(0);
    expect(coordinator.hasPendingSnapshot).toBe(true);
  });
});

describe("ReconciliationCoordinator — engine handles stale/duplicate acks", () => {
  it("re-observing a stale (already-advanced) local snapshot still coalesces to the engine", () => {
    const { coordinator } = makeCoordinator();
    freshFakeEngineRegistry();

    coordinator.onNetworkState(uiState("A", {}));
    coordinator.onNetworkState(
      uiState("A", { A: { playerId: "A", position: { x: 0, y: 0, z: 0 }, yaw: 0, acknowledgedSequence: 5 } }),
    );
    harness.activeBatch = false;
    coordinator.reconcileAtSafeBoundary();

    // The coordinator defers duplicate/stale handling to the engine: the
    // pending snapshot is always coalesced to the engine for its decision.
    coordinator.onNetworkState(
      uiState("A", { A: { playerId: "A", position: { x: 0, y: 0, z: 0 }, yaw: 0, acknowledgedSequence: 5 } }),
    );
    harness.activeBatch = false;
    coordinator.reconcileAtSafeBoundary();

    // Two snapshots reached the engine (the engine's monotonic ack ignores the
    // duplicate) — the coordinator itself does no ack bookkeeping.
    expect(FakeEngine.instances[0].reconciled.length).toBe(2);
    expect(coordinator.lastReconciledAck).toBe(5);
  });
});
