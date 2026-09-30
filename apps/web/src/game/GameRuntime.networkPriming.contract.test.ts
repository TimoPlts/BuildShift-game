import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Stage 2C2B-4B contract: `GameRuntime` must PRIME the reconciliation
 * coordinator with the network's CURRENT UI state immediately after
 * registering its subscription.
 *
 * `FoundationNetwork.subscribe` only fires on FUTURE changes. The Foundation
 * network is page-lifetime and may already be connected / in a session before
 * the runtime is constructed; without an initial feed, that already-active
 * session would be missed until the next state change.
 *
 * `GameRuntime` cannot be instantiated in the node test environment (it pulls
 * in Babylon + Rapier WASM), so this test pins the wiring by inspecting the
 * source: the coordinator must be fed `getUiState()` both inside the
 * subscription callback AND once standalone after the subscription is
 * registered (the prime).
 */
describe("GameRuntime — network state priming contract", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./GameRuntime.ts", import.meta.url)),
    "utf8",
  );

  it("subscribes to the page-lifetime network for future state changes", () => {
    expect(source).toMatch(/foundationNetwork\s*\.\s*subscribe\(/);
  });

  it("feeds the current UI state into the coordinator at least twice", () => {
    // Once inside the subscribe callback, once as the standalone prime.
    const calls =
      source.match(/reconciliationCoordinator\s*\.\s*onNetworkState\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("primes the coordinator AFTER the subscription is registered", () => {
    const subscribeIndex = source.indexOf("foundationNetwork.subscribe(");
    expect(subscribeIndex).toBeGreaterThanOrEqual(0);

    // The standalone prime (the LAST onNetworkState call in the source) must
    // appear after the subscribe registration — it is the initial feed that
    // runs once, outside the subscription callback.
    const lastCallIndex = source.lastIndexOf(
      "reconciliationCoordinator.onNetworkState(",
    );
    expect(lastCallIndex).toBeGreaterThan(subscribeIndex);
  });
});
