/**
 * EnergyRuntimeConsumer — wires the client's Energy economy mirrors into
 * the production network/runtime path used by the GameRuntime.
 *
 * This is the single consumption point for the server-authoritative Energy
 * economy and structure durability/removal state in the production client:
 *
 *  - room-state syncs (the replicated `energy` field per player, the
 *    replicated structure collection, and the replicated per-structure
 *    durability when the server carries it), and
 *  - the authoritative `energy:update` / `build:structure_damaged` /
 *    `build:structure_destroyed` events.
 *
 * Authority contract (docs/TECHNICAL_ARCHITECTURE.md §9/§26/§28): every
 * decision stays server-authoritative. This consumer only *reads* the
 * server's truth (via the defensive parsers in energyStateParse) and
 * mirrors it locally. The one local mutation it performs — removing a
 * destroyed structure from the building mirror on `structure_destroyed` —
 * applies the server's authoritative removal through the building system's
 * own full-replacement consumption path, so the destroyed build disappears
 * for this client immediately instead of waiting for the next state patch
 * (the following sync confirms the same removal).
 *
 * The narrow structural interfaces (EnergyNetworkLike,
 * EnergyBuildingSystemLike) keep this module directly unit-testable with
 * plain fakes, mirroring the BuildingNetworkLike convention.
 */
import {
  ENERGY_EVENTS,
  type BuildingState,
  type StructureState,
} from "@buildshift/protocol";
import type { ParsedRoomState } from "../network";
import { EnergyTracker } from "./energyTracker";
import { StructureDurabilityTracker } from "./structureDurabilityTracker";
import {
  parseEnergyUpdateEvent,
  parseStructureDamageEvent,
  parseStructureDestroyedEvent,
} from "./energyStateParse";

/** The narrow network surface the consumer needs (NetworkLike). */
export interface EnergyNetworkLike {
  /** The local session id (null when not connected). */
  readonly sessionId: string | null;
  /** Subscribe to a named server event; returns an unsubscribe function. */
  onEvent: (
    name: string,
    callback: (payload: unknown) => void,
  ) => () => void;
}

/** The narrow building-system surface for authoritative removal. */
export interface EnergyBuildingSystemLike {
  /** The authoritative structure mirror. */
  readonly store: {
    getBuildingState: () => BuildingState;
  };
  /** Consumes the replicated building state (full replacement). */
  applyReplicatedBuilding: (building: BuildingState) => void;
}

/**
 * The production consumer of the authoritative Energy economy and
 * structure durability/removal state.
 */
export class EnergyRuntimeConsumer {
  /** The mirrored authoritative per-player energy. */
  public readonly energyTracker: EnergyTracker;
  /** The mirrored authoritative structure durability / destruction state. */
  public readonly structureDurabilityTracker: StructureDurabilityTracker;

  private readonly network: EnergyNetworkLike;
  private readonly building: EnergyBuildingSystemLike;
  private readonly unsubscribes: Array<() => void> = [];
  private disposed = false;

  public constructor(
    network: EnergyNetworkLike,
    building: EnergyBuildingSystemLike,
  ) {
    this.network = network;
    this.building = building;
    this.energyTracker = new EnergyTracker();
    this.structureDurabilityTracker = new StructureDurabilityTracker();
    this.unsubscribes.push(
      network.onEvent(ENERGY_EVENTS.ENERGY_UPDATE, (payload) =>
        this.handleEnergyUpdateEvent(payload),
      ),
    );
    this.unsubscribes.push(
      network.onEvent(ENERGY_EVENTS.STRUCTURE_DAMAGED, (payload) =>
        this.handleStructureDamageEvent(payload),
      ),
    );
    this.unsubscribes.push(
      network.onEvent(ENERGY_EVENTS.STRUCTURE_DESTROYED, (payload) =>
        this.handleStructureDestroyedEvent(payload),
      ),
    );
  }

  /**
   * Consumes the authoritative energy and structure durability/removal
   * state from a parsed room-state sync. Called by the GameRuntime on
   * every state change.
   */
  public onRoomState(state: ParsedRoomState): void {
    if (this.disposed) {
      return;
    }
    this.applyReplicatedEnergy(state.players);
    this.applyReplicatedDurability(
      state.building,
      state.structureDurabilities,
    );
  }

  /**
   * The mirrored authoritative energy of the local player (for HUD
   * display), or undefined when the session is unknown.
   */
  public get localEnergy(): number | undefined {
    const sid = this.network.sessionId;
    return sid === null ? undefined : this.energyTracker.getEnergy(sid);
  }

  /** Whether the local player can afford to place a structure of buildType. */
  public canAffordLocalStructure(buildType: string): boolean {
    const sid = this.network.sessionId;
    return sid === null
      ? false
      : this.energyTracker.canAffordStructure(sid, buildType);
  }

  /** Full reset (reconnect / round reset): drops both mirrors. */
  public reset(): void {
    this.energyTracker.reset();
    this.structureDurabilityTracker.reset();
  }

  /** Unsubscribes from server events. Safe to call multiple times. */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }
    this.unsubscribes.length = 0;
  }

  // ── internals ─────────────────────────────────────────────────────────

  private applyReplicatedEnergy(
    players: ParsedRoomState["players"],
  ): void {
    const energies: Record<string, number> = {};
    for (const [playerId, player] of Object.entries(players)) {
      energies[playerId] = player.energy;
    }
    this.energyTracker.applyReplicatedEnergy(energies);
  }

  private applyReplicatedDurability(
    building: BuildingState,
    durabilities: ParsedRoomState["structureDurabilities"],
  ): void {
    const structures: Record<string, string> = {};
    for (const [structureId, structure] of Object.entries(
      building.structures,
    )) {
      structures[structureId] = structure.buildType;
    }
    this.structureDurabilityTracker.applyReplicated(structures, durabilities);
  }

  private handleEnergyUpdateEvent(payload: unknown): void {
    if (this.disposed) {
      return;
    }
    const event = parseEnergyUpdateEvent(payload);
    if (event !== null) {
      this.energyTracker.applyEnergyUpdate(event);
    }
  }

  private handleStructureDamageEvent(payload: unknown): void {
    if (this.disposed) {
      return;
    }
    const event = parseStructureDamageEvent(payload);
    if (event !== null) {
      this.structureDurabilityTracker.applyDamage(event);
    }
  }

  private handleStructureDestroyedEvent(payload: unknown): void {
    if (this.disposed) {
      return;
    }
    const event = parseStructureDestroyedEvent(payload);
    if (event === null) {
      return;
    }
    this.structureDurabilityTracker.applyDestroyed(event.structureId);
    this.removeDestroyedStructureFromMirror(event.structureId);
  }

  /**
   * Applies the server's authoritative removal of a destroyed structure to
   * the client's building mirror through the building system's existing
   * full-replacement consumption path. A no-op when the mirror does not
   * list the structure.
   */
  private removeDestroyedStructureFromMirror(structureId: string): void {
    const building = this.building.store.getBuildingState();
    if (building.structures[structureId] === undefined) {
      return;
    }
    const rest: Record<string, StructureState> = {};
    for (const [id, structure] of Object.entries(building.structures)) {
      if (id !== structureId) {
        rest[id] = structure;
      }
    }
    this.building.applyReplicatedBuilding({ structures: rest });
  }
}
