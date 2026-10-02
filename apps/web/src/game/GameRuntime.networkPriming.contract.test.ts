/**
 * RETIRED: This contract test verified that GameRuntime primes the
 * ReconciliationCoordinator with the FoundationNetwork's current UI state.
 *
 * The FoundationNetwork-based prediction/reconciliation path has been
 * retired in favour of the canonical game/network/ path. The priming
 * contract no longer applies.
 */
import { describe, it } from "vitest";

describe("GameRuntime — network state priming contract (RETIRED)", () => {
  it.skip("subscribes to the page-lifetime network for future state changes", () => {
    // The old FoundationNetwork path is retired.
  });

  it.skip("feeds the current UI state into the coordinator at least twice", () => {
    // The old ReconciliationCoordinator priming path is retired.
  });

  it.skip("primes the coordinator AFTER the subscription is registered", () => {
    // The old ReconciliationCoordinator priming path is retired.
  });
});
