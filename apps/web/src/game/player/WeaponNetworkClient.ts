/**
 * WeaponNetworkClient — the canonical client-side bridge between local
 * weapon input intents and the authoritative Energy Box Fight room's
 * NetworkClient.
 *
 * Responsibilities:
 *  - Consumes weapon input edges (switch, reload, fire) from the
 *    {@link InputManager} latches via {@link WeaponInputFrame}.
 *  - Sends typed weapon intents through the {@link NetworkClient} using the
 *    correct message types that the server's TwoPlayerMovementRoom listens on.
 *  - Consumes authoritative weapon-state updates from the server and feeds
 *    them into the {@link WeaponPrediction} for reconciliation.
 *  - Exposes the local predicted weapon state for HUD binding.
 *
 * Boundedness:
 *  - The {@link WeaponPrediction} is the sole owner of local weapon state.
 *    All reconciliation is a hard snap (no interpolation), so the local
 *    prediction can never diverge from the server by more than one
 *    authoritative update interval.
 *  - Authoritative updates are validated with the protocol's `isWeaponId`
 *    guard before reconciliation. A malformed server event (invalid weapon
 *    id, missing fields) is silently discarded rather than corrupting the
 *    local prediction state.
 *
 * This class does NOT create a separate network connection — it operates
 * entirely on the canonical {@link NetworkClient} instance that the
 * GameRuntime already owns.
 *
 * Integration with the GameRuntime:
 * ```ts
 * // The GameRuntime creates the network stack via createGameNetworking().
 * const networkClient = networking.client;
 * const wnc = new WeaponNetworkClient(networkClient);
 *
 * // Per render frame:
 * wnc.tick(dtMs);
 * const frame = inputManager.consumeWeaponInputFrame();
 * const fireResult = wnc.processWeaponInput(frame);
 *
 * // For HUD:
 * const state = wnc.localState;
 *
 * // On connection / match reset:
 * wnc.reset();
 *
 * // On teardown:
 * wnc.dispose();
 * ```
 */
import type { NetworkClient } from "../network/NetworkClient";
import { WEAPON_STATE_EVENT } from "../network/NetworkClient";
import {
  WeaponPrediction,
  type LocalWeaponState,
  type FirePredictionResult,
  type SwitchPredictionResult,
  type ReloadPredictionResult,
} from "./WeaponPrediction";
import type { StructureOpeningPattern, WeaponId } from "@buildshift/protocol";
import { isWeaponId } from "@buildshift/protocol";
import type { WeaponInputFrame } from "../input/InputManager";

/**
 * The canonical client-side weapon network bridge.
 *
 * Usage:
 * ```ts
 * const wnc = new WeaponNetworkClient(networkClient);
 * // Per frame:
 * wnc.tick(dtMs);
 * wnc.processWeaponInput(inputManager.consumeWeaponInputFrame());
 * // For HUD:
 * const state = wnc.localState;
 * // On connection / reset:
 * wnc.reset();
 * // On teardown:
 * wnc.dispose();
 * ```
 */
export class WeaponNetworkClient {
  private readonly networkClient: NetworkClient;
  private readonly prediction: WeaponPrediction;
  private readonly unsubscribeWeaponState: () => void;
  private disposed = false;

  /**
   * @param networkClient The canonical network client (same instance the
   *        GameRuntime uses for all multiplayer communication).
   */
  public constructor(networkClient: NetworkClient) {
    this.networkClient = networkClient;
    this.prediction = new WeaponPrediction();

    // Subscribe to the server's authoritative weapon-state updates.
    // The server sends this via "combat:weapon_state" after weapon switch,
    // reload completion, or any authoritative weapon state change.
    this.unsubscribeWeaponState = this.networkClient.onEvent(
      WEAPON_STATE_EVENT,
      (payload) => {
        this.handleWeaponStateUpdate(payload);
      },
    );
  }

  // ─── Public API ────────────────────────────────────────────────────────

  /**
   * The current locally-predicted weapon state (for HUD binding).
   */
  public get localState(): LocalWeaponState {
    return this.prediction.getLocalState();
  }

  /**
   * Whether the weapon network client is connected to the server.
   * Reflects the {@link NetworkClient} connection state.
   */
  public get isConnected(): boolean {
    return this.networkClient.isConnected;
  }

  /**
   * Advance the local prediction timers by the given elapsed time.
   * Called once per render frame.
   */
  public tick(deltaMs: number): void {
    if (this.disposed) return;
    this.prediction.tick(deltaMs);
  }

  /**
   * Process one frame of weapon input.
   *
   * Consumes the latched input edges and:
   *  - Switches the active weapon (and sends the switch intent to the server)
   *  - Starts a reload (and sends the reload intent)
   *  - Attempts a fire (optimistic prediction; the fire intent rides in the
   *    movement input frame's `primaryFire` field — no separate message)
   *
   * @param input The weapon input frame obtained from
   *        {@link InputManager.consumeWeaponInputFrame}.
   * @returns The fire prediction result for the current frame (if the fire
   *          gate passed). The caller can use this to drive local effects
   *          (muzzle flash, sound, etc.) before the server confirms.
   */
  public processWeaponInput(
    input: WeaponInputFrame,
  ): FirePredictionResult | null {
    if (this.disposed) return null;

    // ── Weapon switch (key 1 → assault rifle) ──
    if (input.weaponSlot1Pressed) {
      this.requestWeaponSwitch("assault_rifle");
    }

    // ── Weapon switch (key 2 → shotgun) ──
    if (input.weaponSlot2Pressed) {
      this.requestWeaponSwitch("shotgun");
    }

    // ── Reload (key R) ──
    if (input.reloadPressed) {
      this.requestReload();
    }

    // ── Fire ──
    // Fire is carried in the movement input frame's `primaryFire` field.
    // The local prediction here is for immediate feedback (HUD ammo counter,
    // muzzle flash). The actual fire validation on the server uses the
    // `primaryFire` flag in the input frame + the shared `canFire` gate.
    if (input.firePressed || input.isFiring) {
      return this.prediction.tryFire();
    }

    return null;
  }

  /**
   * Request a weapon switch to the given weapon id.
   *
   * Applies the local prediction immediately (optimistic switch) and sends
   * the intent to the server. The server validates and, on success,
   * broadcasts the authoritative weapon state which is reconciled via
   * {@link handleWeaponStateUpdate}.
   */
  public requestWeaponSwitch(weaponId: WeaponId): SwitchPredictionResult {
    const result = this.prediction.switchWeapon(weaponId);
    if (result.switched && result.targetWeaponId) {
      // Send to the server using the canonical message type.
      this.networkClient.sendWeaponSwitch(result.targetWeaponId);
    }
    return result;
  }

  /**
   * Request a reload of the active weapon.
   *
   * Applies the local prediction (starts the reload timer) and sends the
   * reload intent to the server.
   */
  public requestReload(): ReloadPredictionResult {
    const result = this.prediction.startReload();
    if (result.started) {
      this.networkClient.sendWeaponReload();
    }
    return result;
  }

  /**
   * Request a build edit on a placed structure.
   *
   * Sends the edit intent to the server. The server validates ownership,
   * structure existence, and edit legality, then broadcasts the result.
   */
  public requestBuildEdit(
    structureId: string,
    editPattern: StructureOpeningPattern,
  ): boolean {
    return this.networkClient.sendBuildEdit(structureId, editPattern);
  }

  /**
   * Reset the local prediction to the canonical initial state.
   * Called on reconnection or match/round reset.
   */
  public reset(): void {
    this.prediction.reset();
  }

  /**
   * Tear down: unsubscribe from network events.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeWeaponState();
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  /**
   * Handle an authoritative weapon-state update from the server.
   *
   * The server sends this via the `"combat:weapon_state"` event with a
   * `WeaponState` payload: `{ weaponId, ammoInMag, ammoReserve, reloading,
   * reloadRemainingMs }`. The state is validated with the protocol's
   * `isWeaponId` guard before being fed into the prediction for a hard snap
   * (bounded reconciliation). A malformed payload (invalid weapon id,
   * missing fields) is silently discarded so it can never corrupt the
   * local prediction state.
   */
  private handleWeaponStateUpdate(payload: unknown): void {
    if (this.disposed) return;
    if (payload == null || typeof payload !== "object") return;

    const p = payload as Record<string, unknown>;

    // Validate the weapon id using the protocol's canonical guard.
    // This ensures only "shotgun" or "assault_rifle" can reach the
    // prediction state — any other string (including "blaster" or an
    // arbitrary value) is rejected.
    const weaponId = p.weaponId;
    if (typeof weaponId !== "string" || !isWeaponId(weaponId)) return;

    const ammoInMag = typeof p.ammoInMag === "number" ? p.ammoInMag : 0;
    const ammoReserve = typeof p.ammoReserve === "number" ? p.ammoReserve : 0;
    const reloading = p.reloading === true;
    const reloadRemainingMs =
      typeof p.reloadRemainingMs === "number" ? p.reloadRemainingMs : 0;

    this.prediction.reconcile({
      weaponId,
      ammoInMag,
      ammoReserve,
      reloading,
      reloadRemainingMs,
    });
  }
}
