/**
 * StructureDurabilityTracker — the client's mirror of the authoritative
 * structure durability and removal state.
 *
 * Authority contract (docs/TECHNICAL_ARCHITECTURE.md §9/§28): the server is
 * the sole authority on structure health and existence. This tracker only
 * *consumes* authoritative values from three production paths:
 *
 *  - the replicated structure collection (room-state sync) — when the server
 *    replicates per-structure durability it is consumed verbatim; structures
 *    the server removed disappear from the mirror,
 *  - the authoritative `build:structure_damaged` events
 *    ({@link ENERGY_EVENTS.STRUCTURE_DAMAGED}), and
 *  - the authoritative `build:structure_destroyed` events
 *    ({@link ENERGY_EVENTS.STRUCTURE_DESTROYED}) — the structure is marked
 *    destroyed and its durability entry removed for this client.
 *
 * The deterministic helpers from `@buildshift/protocol`
 * ({@link isStructureDestroyed}) and the shared `@buildshift/game-config`
 * per-build-type maximum durability drive the mirror, so the client can
 * never drift from the server's durability rules.
 */
import {
  isStructureDestroyed,
  type StructureDamageEvent,
  type StructureDurabilityState,
} from "@buildshift/protocol";
import { getStructureDurability } from "@buildshift/game-config";

/**
 * The client-side mirror of the authoritative structure durability and
 * destruction state.
 */
export class StructureDurabilityTracker {
  /**
   * Authoritative durability per structure, keyed by `structureId`
   * (server-assigned).
   */
  private readonly durability = new Map<string, StructureDurabilityState>();
  /**
   * Structures the server authoritatively destroyed but that have not yet
   * been confirmed removed by a replicated state sync (the destroy event
   * arrives before the map-removal patch in some orderings).
   */
  private readonly destroyed = new Set<string>();

  /**
   * Consumes the replicated structure collection from a room-state sync.
   *
   * Semantics:
   *  - structures still present on the server keep (or gain) their
   *    replicated durability when the server provides it; a structure with
   *    no known durability yet is initialised to its shared game-config
   *    maximum (the deterministic spawn condition — structures start at
   *    full durability),
   *  - structures the server removed lose their durability entry (the
   *    replicated collection is the complete server truth),
   *  - destroyed ids are retained until a sync confirms the removal (an
   *    older sync that still lists the destroyed structure must not
   *    resurrect it), then dropped.
   *
   * @param structures one entry per replicated structure: `structureId` →
   *        its build type (used for the config-derived durability default).
   * @param replicatedDurabilities per-structure durability replicated by the
   *        server, when present (may be empty).
   */
  public applyReplicated(
    structures: Readonly<Record<string, string>>,
    replicatedDurabilities: Readonly<Record<string, StructureDurabilityState>>,
  ): void {
    const present = new Set(Object.keys(structures));

    // Confirm removals: a destroyed id the server no longer replicates is
    // gone for good — drop it from the pending-destroyed set.
    for (const id of [...this.destroyed]) {
      if (!present.has(id)) {
        this.destroyed.delete(id);
      }
    }

    for (const [structureId, buildType] of Object.entries(structures)) {
      // A structure the server already destroyed must not regain durability
      // from a stale (pre-destruction) state patch.
      if (this.destroyed.has(structureId)) {
        continue;
      }
      const replicated = replicatedDurabilities[structureId];
      if (replicated) {
        this.durability.set(structureId, replicated);
        continue;
      }
      if (this.durability.has(structureId)) {
        // Keep the event-derived value: the server has not (yet) replicated
        // the durability field for this structure.
        continue;
      }
      const maxDurability = getStructureDurability(buildType);
      if (maxDurability !== undefined) {
        this.durability.set(structureId, {
          maxDurability,
          currentDurability: maxDurability,
        });
      }
    }

    // Drop durability entries for structures the server removed.
    for (const id of [...this.durability.keys()]) {
      if (!present.has(id)) {
        this.durability.delete(id);
      }
    }
  }

  /**
   * Consumes an authoritative `build:structure_damaged` event.
   *
   * The event carries the exact remaining durability after the hit, so it
   * is applied as a direct set. When no maximum is known yet (the event
   * arrived before any state sync) the remaining value is used as a
   * conservative maximum — never a value the server did not state.
   * When the remaining durability is 0 the structure is additionally marked
   * destroyed (the separate `structure_destroyed` event is the primary
   * removal signal; this keeps the mirror consistent if only the damage
   * event is observed).
   *
   * A structure already known to be destroyed ignores late damage events —
   * destruction is final on the server.
   */
  public applyDamage(event: StructureDamageEvent): void {
    if (this.destroyed.has(event.structureId)) {
      return;
    }
    const existing = this.durability.get(event.structureId);
    const maxDurability = existing
      ? existing.maxDurability
      : event.remainingDurability;
    const currentDurability = Math.min(
      event.remainingDurability,
      maxDurability,
    );
    this.durability.set(event.structureId, {
      maxDurability,
      currentDurability,
    });
    if (isStructureDestroyed(currentDurability)) {
      this.applyDestroyed(event.structureId);
    }
  }

  /**
   * Consumes an authoritative `build:structure_destroyed` event: the
   * structure is marked destroyed and its durability entry is removed for
   * this client.
   */
  public applyDestroyed(structureId: string): void {
    if (structureId.length === 0) {
      return;
    }
    this.destroyed.add(structureId);
    this.durability.delete(structureId);
  }

  /** Whether the structure is known to be destroyed by the server. */
  public isDestroyed(structureId: string): boolean {
    return this.destroyed.has(structureId);
  }

  /**
   * The structure's authoritative durability, or `null` when unknown (the
   * structure is not replicated / not yet known to this client).
   */
  public getDurability(structureId: string): StructureDurabilityState | null {
    return this.durability.get(structureId) ?? null;
  }

  /** Number of structures with mirrored durability. */
  public get structureCount(): number {
    return this.durability.size;
  }

  /** The structure ids pending removal confirmation (defensive/debug view). */
  public get pendingDestroyedIds(): readonly string[] {
    return [...this.destroyed];
  }

  /**
   * Full reset (reconnect / round reset): drops the durability mirror and
   * the pending-destroyed set. The next replicated state sync re-populates
   * the mirror from server truth.
   */
  public reset(): void {
    this.durability.clear();
    this.destroyed.clear();
  }
}
