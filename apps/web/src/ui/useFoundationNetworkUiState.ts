import { useCallback, useSyncExternalStore } from "react";
import type { NetworkUiState } from "../network";
import { getFoundationNetwork } from "../network/networkInstance";

/**
 * Subscribe the current component to the shared {@link FoundationNetwork} UI
 * state.
 *
 * Built on React's `useSyncExternalStore`: the network's `subscribe` is a
 * stable, idempotent listener setter and its `getUiState` returns the same
 * referentially-stable object until something actually changes, so the badge
 * only re-renders on real state transitions (connect / player count change /
 * disconnect) — never on every render or on unrelated game frames.
 *
 * This hook **never starts or stops** the connection; the network is a
 * page-lifetime singleton (see `network/networkInstance.ts`) and the hook only
 * observes it.
 */
export function useFoundationNetworkUiState(): NetworkUiState {
  const network = getFoundationNetwork();
  // `network` is a page-lifetime singleton, so these closures are
  // referentially stable across renders (React requires stable subscribe /
  // getSnapshot references). Wrapping in arrows preserves the instance `this`
  // that the bare method references would lose.
  const subscribe = useCallback((listener: () => void) => network.subscribe(listener), [network]);
  const getSnapshot = useCallback(() => network.getUiState(), [network]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
