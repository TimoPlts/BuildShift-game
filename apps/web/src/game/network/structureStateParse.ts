/**
 * structureStateParse — client-side parsing of the replicated building
 * state off the raw Colyseus room state.
 *
 * The server synchronizes the authoritative structure collection as the
 * room state's `structures` field (a `MapSchema` keyed by `structureId`,
 * which the client SDK surfaces as either an iterable of `[key, value]`
 * pairs or a plain object). This module parses that raw value into a plain,
 * validated {@link BuildingState} the GameRuntime can consume — mirroring
 * the defensive style of {@link parseMatchState} and the `parsePlayers`
 * path in `NetworkClient`.
 *
 * Energy economy extension: the authoritative per-structure durability
 * (`maxDurability` / `currentDurability`, see `@buildshift/protocol`
 * `StructureDurabilityState`) is parsed from the same replicated entries
 * when the server carries it on the wire. Durability is a *superset* read:
 * entries without the fields are ignored here, so parsing stays forward-
 * and backward-compatible with servers that do not yet replicate it.
 *
 * Authority contract: this parser only *reads* replicated data. It never
 * invents or mutates structures; malformed entries are dropped so a single
 * corrupt entry can never poison the client's structure mirror.
 */
import type {
  BuildingState,
  GridPosition,
  GridRotation,
  StructureDurabilityState,
  StructureState,
} from "@buildshift/protocol";
import { isBuildType, isGridRotation, isBuildEditType, STRUCTURE_DURABILITY_LIMITS } from "@buildshift/protocol";

/**
 * The empty building state — used before the first room-state sync and
 * after a disconnect. Frozen because it is shared by reference.
 */
export const EMPTY_BUILDING_STATE: Readonly<BuildingState> = Object.freeze({
  structures: Object.freeze({}),
}) as BuildingState;

/**
 * The empty replicated durability map — used when the server does not carry
 * per-structure durability on the wire (the common case until the server
 * syncs durability fields). Frozen because it is shared by reference.
 */
export const EMPTY_STRUCTURE_DURABILITIES: Readonly<Record<string, StructureDurabilityState>> =
  Object.freeze({}) as Record<string, StructureDurabilityState>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSafeInt(
  record: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = record[field];
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

/**
 * Defensively parses one replicated structure entry into a
 * {@link StructureState}. Returns `null` when the entry is missing any
 * required field or carries an out-of-vocabulary value.
 */
export function parseStructureState(raw: unknown): StructureState | null {
  if (!isRecord(raw)) {
    return null;
  }
  const structureId =
    typeof raw.structureId === "string" ? raw.structureId : "";
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
  const gx = readSafeInt(gridRaw, "x");
  const gy = readSafeInt(gridRaw, "y");
  const gz = readSafeInt(gridRaw, "z");
  if (gx === undefined || gy === undefined || gz === undefined) {
    return null;
  }
  if (gy < 0) {
    return null;
  }
  const grid: GridPosition = { x: gx, y: gy, z: gz };
  const openings: StructureState["openings"] =
    raw.editType === "door" ? [{ pattern: "door_top" }] :
    raw.editType === "window" ? [{ pattern: "window_center" }] :
    raw.editType === "half_bottom" ? [{ pattern: "half_bottom" }] : [];
  return {
    structureId,
    buildType: raw.buildType,
    grid,
    rotation: raw.rotation as GridRotation,
    ownerId,
    createdSequence,
    ...(raw.editType === "" || isBuildEditType(raw.editType) ? { editType: raw.editType } : {}),
    ...(typeof raw.editType === "string" ? { openings } : {}),
  };
}

/**
 * Defensively parses the replicated durability fields of one structure
 * entry into a {@link StructureDurabilityState}.
 *
 * Returns `null` when the entry is not a record, lacks both durability
 * fields, or carries an out-of-protocol-bounds value
 * ({@link STRUCTURE_DURABILITY_LIMITS} / `currentDurability >
 * maxDurability`). Servers that do not replicate durability simply yield
 * `null` for every entry.
 */
export function parseStructureDurability(
  raw: unknown,
): StructureDurabilityState | null {
  if (!isRecord(raw)) {
    return null;
  }
  const maxRaw = raw.maxDurability;
  const currentRaw = raw.currentDurability;
  if (typeof maxRaw !== "number" || typeof currentRaw !== "number") {
    return null;
  }
  if (!Number.isFinite(maxRaw) || !Number.isFinite(currentRaw)) {
    return null;
  }
  if (maxRaw < STRUCTURE_DURABILITY_LIMITS.min) {
    return null;
  }
  if (maxRaw > STRUCTURE_DURABILITY_LIMITS.max) {
    return null;
  }
  if (currentRaw < STRUCTURE_DURABILITY_LIMITS.min) {
    return null;
  }
  if (currentRaw > maxRaw) {
    return null;
  }
  return { maxDurability: maxRaw, currentDurability: currentRaw };
}

/**
 * Parses the raw room-state `structures` collection into the authoritative
 * per-structure durability map.
 *
 * Accepts either shape the Colyseus client SDK may surface for a
 * `MapSchema` (same as {@link parseBuildingState}):
 *  - an iterable of `[key, value]` pairs (the schema's own iterator), or
 *  - a plain `Record<string, unknown>`.
 *
 * Entries without valid replicated durability fields are skipped, so the
 * result is empty (not corrupt) when the server does not carry durability.
 */
export function parseStructureDurabilities(
  raw: unknown,
): Record<string, StructureDurabilityState> {
  const result: Record<string, StructureDurabilityState> = {};

  if (raw == null || typeof raw !== "object") {
    return result;
  }

  if (
    typeof (raw as { [Symbol.iterator]?: unknown })[Symbol.iterator] ===
    "function"
  ) {
    for (const item of raw as Iterable<unknown>) {
      if (Array.isArray(item) && item.length >= 2) {
        const key = String(item[0]);
        const parsed = parseStructureDurability(item[1]);
        if (parsed) {
          result[key] = parsed;
        }
      }
    }
    return result;
  }

  for (const key of Object.keys(raw as Record<string, unknown>)) {
    const parsed = parseStructureDurability(
      (raw as Record<string, unknown>)[key],
    );
    if (parsed) {
      result[key] = parsed;
    }
  }

  return result;
}

/**
 * Parses the raw room-state `structures` collection into a plain
 * {@link BuildingState}.
 *
 * Accepts either shape the Colyseus client SDK may surface for a
 * `MapSchema`:
 *  - an iterable of `[key, value]` pairs (the schema's own iterator), or
 *  - a plain `Record<string, unknown>`.
 *
 * Malformed entries are dropped; a missing / non-object `structures`
 * value yields the empty building state.
 */
export function parseBuildingState(raw: unknown): BuildingState {
  const structures: Record<string, StructureState> = {};

  if (raw == null || typeof raw !== "object") {
    return { structures };
  }

  if (
    typeof (raw as { [Symbol.iterator]?: unknown })[Symbol.iterator] ===
    "function"
  ) {
    for (const item of raw as Iterable<unknown>) {
      if (Array.isArray(item) && item.length >= 2) {
        const key = String(item[0]);
        const parsed = parseStructureState(item[1]);
        if (parsed) {
          structures[key] = parsed;
        }
      }
    }
    return { structures };
  }

  for (const key of Object.keys(raw as Record<string, unknown>)) {
    const parsed = parseStructureState(
      (raw as Record<string, unknown>)[key],
    );
    if (parsed) {
      structures[key] = parsed;
    }
  }

  return { structures };
}
