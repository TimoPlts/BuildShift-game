import { createFoundationNetwork } from "./createFoundationNetwork";
import type { FoundationNetwork } from "./colyseus/foundationNetwork";

/**
 * The single, page-lifetime {@link FoundationNetwork} instance for the app.
 *
 * Rationale: the game client lives for the browser page's lifetime, so the
 * network connection is a page-level resource — it is **not** owned by a React
 * component (which would risk re-connect on remount / under StrictMode) and is
 * **not** owned by `GameRuntime` (the game's movement/prediction loop must keep
 * working even when the server is unreachable). React components only *observe*
 * this instance through `subscribe`/`getUiState` (see `NetworkStatusBadge`).
 *
 * {@link getFoundationNetwork} creates the instance on first use and starts it
 * (idempotently). Calling it again always returns the same instance.
 */
let instance: FoundationNetwork | null = null;

/**
 * Get (creating + starting on first call) the shared network instance.
 *
 * @returns the shared {@link FoundationNetwork} for the page.
 */
export function getFoundationNetwork(): FoundationNetwork {
  if (instance === null) {
    instance = createFoundationNetwork();
    instance.start();
  }
  return instance;
}
