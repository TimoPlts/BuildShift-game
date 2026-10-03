/**
 * energyStateParse — client-side parsing of the authoritative Energy economy
 * event payloads off the wire.
 *
 * The server (the sole authority on energy and structure durability,
 * docs/TECHNICAL_ARCHITECTURE.md §9) broadcasts the `ENERGY_EVENTS` payloads
 * defined by `@buildshift/protocol` → `energy.ts`. This module parses those
 * raw payloads into plain, validated protocol types — mirroring the defensive
 * style of {@link parseMatchState}, {@link parseBuildingState}, and
 * {@link parsePlayerEntry}.
 *
 * Authority contract: this parser only *reads* authoritative event data. It
 * never invents energy or durability; malformed payloads are dropped so a
 * single corrupt event can never poison the client's energy / durability
 * mirrors.
 */
import {
  ENERGY_LIMITS,
  STRUCTURE_DURABILITY_LIMITS,
  isWeaponId,
  type EnergyUpdateEvent,
  type StructureDamageEvent,
  type StructureDestroyedEvent,
} from "@buildshift/protocol";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFiniteNumber(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Defensively parses an {@link ENERGY_EVENTS.ENERGY_UPDATE} payload.
 *
 * Returns `null` when the payload is missing required fields or carries an
 * out-of-protocol-bounds energy value (the protocol safety ceiling
 * {@link ENERGY_LIMITS} rejects any broadcast above it).
 */
export function parseEnergyUpdateEvent(raw: unknown): EnergyUpdateEvent | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (!isNonEmptyString(raw.playerId)) {
    return null;
  }
  const energy = readFiniteNumber(raw, "energy");
  if (energy === undefined) {
    return null;
  }
  if (energy < ENERGY_LIMITS.min || energy > ENERGY_LIMITS.max) {
    return null;
  }
  return { playerId: raw.playerId, energy };
}

/**
 * Defensively parses an {@link ENERGY_EVENTS.STRUCTURE_DAMAGED} payload.
 *
 * Returns `null` when the payload is malformed: a missing structure id, a
 * non-positive `damage`, an out-of-bounds `remainingDurability`, or an
 * unknown weapon id.
 */
export function parseStructureDamageEvent(raw: unknown): StructureDamageEvent | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (!isNonEmptyString(raw.structureId)) {
    return null;
  }
  const damage = readFiniteNumber(raw, "damage");
  if (damage === undefined || damage <= 0) {
    return null;
  }
  const remainingDurability = readFiniteNumber(raw, "remainingDurability");
  if (remainingDurability === undefined) {
    return null;
  }
  if (
    remainingDurability < STRUCTURE_DURABILITY_LIMITS.min ||
    remainingDurability > STRUCTURE_DURABILITY_LIMITS.max
  ) {
    return null;
  }
  if (!isNonEmptyString(raw.sourcePlayerId)) {
    return null;
  }
  if (!isWeaponId(raw.sourceWeaponId)) {
    return null;
  }
  return {
    structureId: raw.structureId,
    damage,
    remainingDurability,
    sourcePlayerId: raw.sourcePlayerId,
    sourceWeaponId: raw.sourceWeaponId,
  };
}

/**
 * Defensively parses an {@link ENERGY_EVENTS.STRUCTURE_DESTROYED} payload.
 *
 * Returns `null` when the payload is missing the destroyed structure id, the
 * destroyer's session id, or carries an unknown weapon id.
 */
export function parseStructureDestroyedEvent(raw: unknown): StructureDestroyedEvent | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (!isNonEmptyString(raw.structureId)) {
    return null;
  }
  if (!isNonEmptyString(raw.destroyedByPlayerId)) {
    return null;
  }
  if (!isWeaponId(raw.destroyedByWeaponId)) {
    return null;
  }
  return {
    structureId: raw.structureId,
    destroyedByPlayerId: raw.destroyedByPlayerId,
    destroyedByWeaponId: raw.destroyedByWeaponId,
  };
}
