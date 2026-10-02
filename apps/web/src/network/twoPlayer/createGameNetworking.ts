/**
 * createGameNetworking — the production factory that wires the canonical
 * two-player networking stack used by the {@link GameRuntime}.
 *
 * This is the SINGLE place the GameRuntime obtains its network objects. By
 * centralising the wiring here (instead of four inline `new` calls scattered in
 * the GameRuntime constructor), the production path is guaranteed to construct
 * EXACTLY ONE canonical network client ({@link TwoPlayerClient}) plus the one
 * {@link InputSender}, {@link LocalPlayerPrediction} and
 * {@link RemotePlayerInterpolation} that ride on that single client.
 *
 * Extracting this wiring into a factory is also what makes the "single
 * canonical client" contract directly testable WITHOUT instantiating the full
 * Babylon-Engine / Rapier-WASM-backed GameRuntime (see
 * `apps/web/src/game/GameRuntime.singleClient.contract.test.ts`). The test
 * exercises this same factory the production runtime uses, so it guards against
 * a future second client creeping into the production wiring.
 */
import { TwoPlayerClient, type TwoPlayerClientOptions } from "./TwoPlayerClient";
import { InputSender } from "./InputSender";
import { LocalPlayerPrediction } from "./LocalPlayerPrediction";
import { RemotePlayerInterpolation } from "./RemotePlayerInterpolation";

/**
 * The canonical two-player networking stack owned by the GameRuntime.
 *
 * `client` is the single network client through which ALL local input (fire /
 * movement) is sent to the server and through which ALL authoritative state
 * (health, position, ...) is received. The other members are the send/receive
 * helpers bound to that one client — none of them owns a separate connection.
 */
export interface GameNetworking {
  /** The single canonical network client ({@link TwoPlayerClient}). */
  readonly client: TwoPlayerClient;
  /** Sequenced input sender that pushes PlayerNetworkInput frames to the client. */
  readonly inputSender: InputSender;
  /** Local prediction / reconciliation for the local player. */
  readonly localPrediction: LocalPlayerPrediction;
  /** Interpolation buffer for the remote player. */
  readonly remoteInterpolation: RemotePlayerInterpolation;
}

/**
 * Construct the canonical two-player networking stack.
 *
 * Creates exactly ONE {@link TwoPlayerClient} and the single
 * {@link InputSender} / {@link LocalPlayerPrediction} /
 * {@link RemotePlayerInterpolation} that operate on it. The production
 * {@link GameRuntime} calls this factory (with no options) to obtain its
 * networking, which is what guarantees a single canonical client in the
 * production path.
 *
 * @param options optional pass-through options for the canonical client
 *        (e.g. a non-default server URL / room name).
 */
export function createGameNetworking(
  options?: TwoPlayerClientOptions,
): GameNetworking {
  // Exactly ONE canonical network client. This is the single source of the
  // client instance for the whole runtime — no other code path constructs a
  // second one.
  const client = new TwoPlayerClient(options);
  const inputSender = new InputSender();
  const localPrediction = new LocalPlayerPrediction();
  const remoteInterpolation = new RemotePlayerInterpolation();
  return { client, inputSender, localPrediction, remoteInterpolation };
}
