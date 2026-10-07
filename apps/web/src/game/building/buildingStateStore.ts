/**
 * buildingStateStore — the client's mirror of the authoritative building
 * state, plus the local set of *pending* placement intents.
 *
 * Authority contract (docs/TECHNICAL_ARCHITECTURE.md §9/§24): the server
 * owns build existence. This store only *consumes* replicated data:
 *
 *  - `applyReplicatedState` replaces the mirror with the structures the
 *    server has synchronized in the room state (the full authoritative
 *    truth — no local writes ever add to it).
 *  - `addPending` / `confirmPlacement` / `rejectPlacement` track the
 *    client's own in-flight placement intents ("fast preview + quick
 *    authoritative confirmation"): an intent the player submitted but that
 *    the server has not yet confirmed or rejected is *pending*, not
 *    authoritative.
 *
 * The store never creates structures on its own authority: pending entries
 * are intent data only, and they are always removed once the server answers
 * (placed → replaced by the authoritative structure; rejected → dropped).
 * Rendering layers (a later task) read this state; nothing here touches
 * Babylon.
 */
import {
  isBuildType,
  isGridRotation,
  type BuildingState,
  type BuildRejectionReason,
  type GridPosition,
  type GridRotation,
  type StructurePlacementIntent,
  type StructurePlacedEvent,
  type StructureRejectedEvent,
  type StructureState,
} from "@buildshift/protocol";
import type { OccupiedStructure } from "./placementPreview";

const REJECTION_REASONS: readonly BuildRejectionReason[] = [
  "unknown_build_type",
  "invalid_grid",
  "out_of_range",
  "overlap",
  "rate_limited",
  "unaffordable",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSafeInt(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field];
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

/**
 * Defensively parses one replicated structure entry. Returns `null` for
 * malformed data so a single corrupt entry can never poison the mirror.
 */
export function parseStructureEntry(raw: unknown): StructureState | null {
  if (!isRecord(raw)) {
    return null;
  }
  const structureId = typeof raw.structureId === "string" ? raw.structureId : "";
  const ownerId = typeof raw.ownerId === "string" ? raw.ownerId : "";
  if (structureId === "" || ownerId === "") {
    return null;
  }
  if (!isBuildType(raw.buildType)) {
    return null;
  }
  const createdSequence = readSafeInt(raw, "createdSequence");
  if (createdSequence === undefined) {
    return null;
  }
  if (!isGridRotation(raw.rotation)) {
    return null;
  }
  const gridRaw = raw.grid;
  if (!isRecord(gridRaw)) {
    return null;
  }
  const grid: Partial<GridPosition> = {};
  for (const field of ["x", "y", "z"] as const) {
    const value = readSafeInt(gridRaw, field);
    if (value === undefined) {
      return null;
    }
    grid[field] = value;
  }
  if ((grid.y ?? -1) < 0) {
    return null;
  }
  return {
    structureId,
    buildType: raw.buildType,
    grid: { x: grid.x!, y: grid.y!, z: grid.z! },
    rotation: raw.rotation as GridRotation,
    ownerId,
    createdSequence,
  };
}

/**
 * Defensively parses a `StructureRejectedEvent` payload from the wire.
 * Returns `null` when the payload is not a well-formed rejection event.
 */
export function parseStructureRejectedEvent(
  raw: unknown,
): StructureRejectedEvent | null {
  if (!isRecord(raw)) {
    return null;
  }
  const sequence = readSafeInt(raw, "sequence");
  if (sequence === undefined || sequence < 0) {
    return null;
  }
  if (
    typeof raw.reason !== "string" ||
    !(REJECTION_REASONS as readonly string[]).includes(raw.reason)
  ) {
    return null;
  }
  return { sequence, reason: raw.reason as BuildRejectionReason };
}

/**
 * The client-side building state store: an authoritative structure mirror
 * fed by replicated room state, plus the local pending-intent set.
 */
export class BuildingStateStore {
  /** Authoritative structures, keyed by `structureId` (server-assigned). */
  private readonly structures = new Map<string, StructureState>();
  /**
   * Placement intents the local player submitted that the server has not
   * yet answered, keyed by the intent `sequence`.
   */
  private readonly pending = new Map<number, StructurePlacementIntent>();

  /**
   * Replaces the authoritative mirror with the replicated room state.
   * Full replacement (not a merge) — the replicated state is the complete
   * server truth, so nothing local can survive a state sync by accident.
   */
  public applyReplicatedState(structures: Record<string, StructureState>): void {
    this.structures.clear();
    for (const [structureId, structure] of Object.entries(structures)) {
      this.structures.set(structureId, structure);
    }
  }

  /**
   * Registers a placement intent as pending (optimistic, intent-only).
   * Called the moment the client submits `build:placement_request`.
   */
  public addPending(intent: StructurePlacementIntent): void {
    this.pending.set(intent.sequence, intent);
  }

  /**
   * Confirms a placement: the server authoritatively created the structure.
   * Drops the matching pending intent (by `createdSequence`) and inserts the
   * authoritative structure. A malformed event is ignored.
   */
  public confirmPlacement(event: StructurePlacedEvent): void {
    if (event?.structure?.structureId === undefined) {
      return;
    }
    const structure = event.structure;
    this.pending.delete(structure.createdSequence);
    this.structures.set(structure.structureId, structure);
  }

  /**
   * Handles a rejection: drops the matching pending intent (by `sequence`).
   * A malformed event is ignored.
   */
  public rejectPlacement(event: StructureRejectedEvent): void {
    if (!Number.isSafeInteger(event?.sequence)) {
      return;
    }
    this.pending.delete(event.sequence);
  }

  /** The authoritative structure mirror (server truth only — no pending). */
  public getAuthoritativeStructures(): ReadonlyMap<string, StructureState> {
    return this.structures;
  }

  /** A plain `BuildingState` view of the authoritative mirror. */
  public getBuildingState(): BuildingState {
    const structures: Record<string, StructureState> = {};
    for (const [structureId, structure] of this.structures) {
      structures[structureId] = structure;
    }
    return { structures };
  }

  /** The pending placement intents (in submission order is not guaranteed). */
  public getPendingIntents(): readonly StructurePlacementIntent[] {
    return [...this.pending.values()];
  }

  /**
   * Every structure that occupies grid cells — authoritative structures
   * plus pending intents — for the placement preview's occupancy check.
   */
  public getOccupiedStructures(): OccupiedStructure[] {
    const occupied: OccupiedStructure[] = [];
    for (const structure of this.structures.values()) {
      occupied.push({ buildType: structure.buildType, grid: structure.grid });
    }
    for (const intent of this.pending.values()) {
      occupied.push({ buildType: intent.buildType, grid: intent.grid });
    }
    return occupied;
  }

  /** Number of authoritative structures currently mirrored. */
  public get structureCount(): number {
    return this.structures.size;
  }

  /** Number of in-flight (unconfirmed) placement intents. */
  public get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Drops all pending intents without touching the authoritative mirror.
   * Used when the connection drops so a stale intent can never be
   * misattributed to a later session.
   */
  public clearPending(): void {
    this.pending.clear();
  }

  /**
   * Full reset (reconnect / round reset): drops the authoritative mirror and
   * all pending intents. The next replicated state sync re-populates the
   * mirror with the server truth.
   */
  public reset(): void {
    this.structures.clear();
    this.pending.clear();
  }
}
