/**
 * Public entry point for the client Energy economy consumption layer.
 *
 * This is the single place the GameRuntime imports the Energy economy
 * consumption from — the same "import from the barrel, never reach into
 * individual files" boundary convention used by `./network` and
 * `./building`.
 *
 * The layer CONSUMES server-authoritative state only:
 *
 *  - {@link EnergyTracker} — the mirrored authoritative per-player energy,
 *    fed by the replicated room state (`energy` field) and the
 *    `energy:update` events,
 *  - {@link StructureDurabilityTracker} — the mirrored authoritative
 *    structure durability / destruction state, fed by the replicated
 *    structure collection, the `build:structure_damaged` events, and the
 *    `build:structure_destroyed` events,
 *  - {@link EnergyRuntimeConsumer} — the production wiring that consumes
 *    the parsed room-state syncs and the authoritative energy events in
 *    the GameRuntime's networking/runtime path,
 *  - {@link parseEnergyUpdateEvent} / {@link parseStructureDamageEvent} /
 *    {@link parseStructureDestroyedEvent} — defensive wire parsers for the
 *    energy event payloads (malformed events are dropped, never trusted).
 *
 * Nothing in this module is ever authoritative: all decisions (energy
 * deductions, durability damage, destruction) are made by the server; these
 * mirrors exist so the HUD and the local build-affordability check can read
 * the exact server truth (docs/TECHNICAL_ARCHITECTURE.md §9/§26/§28).
 */

export {
  parseEnergyUpdateEvent,
  parseStructureDamageEvent,
  parseStructureDestroyedEvent,
} from "./energyStateParse";

export { EnergyTracker } from "./energyTracker";

export { StructureDurabilityTracker } from "./structureDurabilityTracker";

export {
  EnergyRuntimeConsumer,
  type EnergyNetworkLike,
  type EnergyBuildingSystemLike,
} from "./energyRuntimeConsumer";
