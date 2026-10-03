/**
 * EnergyTracker — the client's mirror of the authoritative player energy
 * economy.
 *
 * Authority contract (docs/TECHNICAL_ARCHITECTURE.md §9/§26): the server is
 * the sole writer of energy. This tracker only *consumes* authoritative
 * values from two production paths:
 *
 *  - the replicated room state (`PlayerStateSchema.energy` per player,
 *    parsed by the canonical network layer), and
 *  - the authoritative `energy:update` events
 *    ({@link ENERGY_EVENTS.ENERGY_UPDATE}).
 *
 * Consumers (the HUD and the local build-affordability check) read the
 * mirrored value; nothing here ever modifies energy on the client's own
 * authority. The shared, deterministic `canAffordBuild` helper from
 * `@buildshift/protocol` together with the shared `@buildshift/game-config`
 * structure cost values drive the affordability answer, so client and server
 * can never drift on the energy-cost rule.
 */
import {
  ENERGY_LIMITS,
  canAffordBuild,
  type EnergyUpdateEvent,
} from "@buildshift/protocol";
import { ENERGY, getStructureConfig } from "@buildshift/game-config";

/**
 * The client-side mirror of the authoritative per-player energy.
 */
export class EnergyTracker {
  /** Authoritative energy per player, keyed by Colyseus `sessionId`. */
  private readonly energies = new Map<string, number>();

  /**
   * Consumes the authoritative energy from a replicated room-state sync.
   *
   * Full replacement (not a merge): the replicated player collection is the
   * complete server truth, mirroring the semantics of the building state
   * store and the player parse path. `energ` entries are clamped into the
   * valid protocol range.
   *
   * @param energies authoritative energy per player, keyed by `sessionId`
   *        (typically derived from the parsed room state's players).
   */
  public applyReplicatedEnergy(
    energies: Readonly<Record<string, number>>,
  ): void {
    this.energies.clear();
    for (const [playerId, energy] of Object.entries(energies)) {
      this.energies.set(playerId, clampEnergy(energy));
    }
  }

  /**
   * Consumes an authoritative `energy:update` event. The event carries the
   * exact authoritative energy after the change, so it is applied as a
   * direct set (clamped into the valid protocol range).
   */
  public applyEnergyUpdate(event: EnergyUpdateEvent): void {
    this.energies.set(event.playerId, clampEnergy(event.energy));
  }

  /** The authoritative energy of a player, or `undefined` when unknown. */
  public getEnergy(playerId: string): number | undefined {
    return this.energies.get(playerId);
  }

  /** Whether the tracker has an authoritative energy value for the player. */
  public hasEnergy(playerId: string): boolean {
    return this.energies.has(playerId);
  }

  /**
   * Whether a player can afford to place one structure of `buildType`.
   *
   * Uses the shared deterministic `canAffordBuild` helper against the
   * player's authoritative energy and the shared game-config energy cost
   * (`StructureConfig.cost` *is* the energy cost). Returns `false` when the
   * player is unknown or the build type has no configuration — the client
   * never assumes affordability on its own authority.
   */
  public canAffordStructure(playerId: string, buildType: string): boolean {
    const energy = this.energies.get(playerId);
    if (energy === undefined) {
      return false;
    }
    const config = getStructureConfig(buildType);
    if (!config) {
      return false;
    }
    return canAffordBuild(energy, config.cost);
  }

  /** Number of players with a mirrored authoritative energy value. */
  public get playerCount(): number {
    return this.energies.size;
  }

  /**
   * Full reset (reconnect / round reset): drops every mirrored energy value.
   * The next replicated state sync re-populates the mirror from server truth.
   */
  public reset(): void {
    this.energies.clear();
  }
}

/**
 * Clamps an energy value into the valid range
 * `[ENERGY_LIMITS.min, ENERGY.maxEnergy]`.
 *
 * Non-finite values fall back to the protocol floor — a corrupt wire value
 * can never put a player into "negative energy" or above the pool ceiling.
 */
function clampEnergy(value: number): number {
  if (!Number.isFinite(value)) {
    return ENERGY_LIMITS.min;
  }
  return Math.min(Math.max(value, ENERGY_LIMITS.min), ENERGY.maxEnergy);
}
