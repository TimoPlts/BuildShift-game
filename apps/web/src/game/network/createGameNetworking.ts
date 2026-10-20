/**
 * createGameNetworking — the production factory that wires the canonical
 * game networking stack used by the GameRuntime.
 *
 * This is the SINGLE place the GameRuntime obtains its network objects. By
 * centralising the wiring here (instead of four inline `new` calls scattered in
 * the GameRuntime constructor), the production path is guaranteed to construct
 * EXACTLY ONE canonical network client ({@link NetworkClient}) plus the one
 * {@link InputBatcher}, {@link PredictionOrchestrator} and
 * {@link RemotePlayerManager} that ride on that single client.
 *
 * Extracting this wiring into a factory is also what makes the "single
 * canonical client" contract directly testable WITHOUT instantiating the full
 * Babylon-Engine / Rapier-WASM-backed GameRuntime. The test exercises this
 * same factory the production runtime uses, so it guards against a future
 * second client creeping into the production wiring.
 */
import {
  NetworkClient,
  type NetworkClientOptions,
} from "./NetworkClient";
import { InputBatcher } from "./inputBatcher";
import { PredictionOrchestrator } from "./predictionOrchestrator";
import { RemotePlayerManager } from "./RemotePlayerManager";

/**
 * The canonical game networking stack owned by the GameRuntime.
 *
 * `client` is the single network client through which ALL local input (fire /
 * movement) is sent to the server and through which ALL authoritative state
 * (health, position, ...) is received. The other members are the send/receive
 * helpers bound to that one client — none of them owns a separate connection.
 */
export interface GameNetworking {
  /** The single canonical network client ({@link NetworkClient}). */
  readonly client: NetworkClient;
  /** Sequenced input batcher that pushes PlayerNetworkInput frames to the client. */
  readonly inputBatcher: InputBatcher;
  /** Local prediction / reconciliation orchestrator for the local player. */
  readonly predictionOrchestrator: PredictionOrchestrator;
  /** Interpolation buffer for the remote player. */
  readonly remotePlayerManager: RemotePlayerManager;
}

/**
 * Construct the canonical game networking stack.
 *
 * Creates exactly ONE {@link NetworkClient} and the single
 * {@link InputBatcher} / {@link PredictionOrchestrator} /
 * {@link RemotePlayerManager} that operate on it. The production
 * {@link GameRuntime} calls this factory (with no options) to obtain its
 * networking, which is what guarantees a single canonical client in the
 * production path.
 *
 * @param options optional pass-through options for the canonical client
 *        (e.g. a non-default server URL / room name).
 */
export function createGameNetworking(
  options?: NetworkClientOptions,
): GameNetworking {
  // Exactly ONE canonical network client. This is the single source of the
  // client instance for the whole runtime — no other code path constructs a
  // second one.
  const client = new NetworkClient(options);
  const inputBatcher = new InputBatcher();
  const predictionOrchestrator = new PredictionOrchestrator();
  client.onStateChange((state) => predictionOrchestrator.setBuildingState(state.building));
  const remotePlayerManager = new RemotePlayerManager();
  // The existing ?devdiag=1 browser suite may inspect the live canonical
  // objects without opening a second connection or retaining them after the
  // runtime is disposed. WeakRef keeps this diagnostic hook non-owning.
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("devdiag") === "1") {
    (window as unknown as Record<string, unknown>).__buildshiftNetworking = {
      client: new WeakRef(client),
      inputBatcher: new WeakRef(inputBatcher),
    };
  }
  return {
    client,
    inputBatcher,
    predictionOrchestrator,
    remotePlayerManager,
  };
}
