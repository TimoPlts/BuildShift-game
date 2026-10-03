/**
 * playerStateParse — client-side parsing of the replicated player
 * collection off the raw Colyseus room state.
 *
 * The server's RoomStateSchema carries `players` as a `MapSchema` keyed by
 * sessionId. From the client SDK this arrives either as an iterable of
 * `[key, value]` pairs (the schema's own iterator) or as a plain object.
 * This module normalises both shapes into a plain `sessionId →
 * ParsedPlayerState` record with defensive per-field validation — mirroring
 * the style of {@link parseMatchState} / {@link parseBuildingState}.
 *
 * Authority contract: this parser only *reads* replicated data; it never
 * invents player state. Malformed entries are dropped.
 */
import type { PlayerNetworkState } from "@buildshift/protocol";

/**
 * A plain, validated player state parsed from the RoomStateSchema.
 * Extends the movement state with the combat fields carried on the wire.
 */
export interface ParsedPlayerState extends PlayerNetworkState {
  /** Authoritative current health (from the server schema). */
  health: number;
  /** Authoritative current shield. */
  shield: number;
  /** Authoritative current energy. */
  energy: number;
  /** Authoritative current magazine ammo. */
  ammo: number;
  /** Highest input sequence at which this player last fired (-1 = never). */
  lastFireSequence: number;
  /** Whether the player is eliminated. */
  isEliminated: boolean;
}

/**
 * Parse the `players` collection of the raw room state into a plain record.
 */
export function parsePlayers(
  raw: unknown,
): Record<string, ParsedPlayerState> {
  const result: Record<string, ParsedPlayerState> = {};

  if (raw == null || typeof raw !== "object") {
    return result;
  }

  const playersRoot = (raw as { players?: unknown }).players;
  if (playersRoot == null) {
    return result;
  }

  if (
    typeof (playersRoot as { [Symbol.iterator]?: unknown })[Symbol.iterator] ===
    "function"
  ) {
    for (const item of playersRoot as Iterable<unknown>) {
      if (Array.isArray(item) && item.length >= 2) {
        const key = String(item[0]);
        const parsed = parsePlayerEntry(item[1]);
        if (parsed) {
          result[key] = parsed;
        }
      }
    }
    return result;
  }

  if (typeof playersRoot === "object" && !Array.isArray(playersRoot)) {
    for (const key of Object.keys(playersRoot)) {
      const parsed = parsePlayerEntry(
        (playersRoot as Record<string, unknown>)[key],
      );
      if (parsed) {
        result[key] = parsed;
      }
    }
  }

  return result;
}

/**
 * Parse one player entry from the schema into a ParsedPlayerState.
 *
 * The server's PlayerStateSchema carries x, y, z, yaw, velocityY,
 * grounded, lastProcessedSequence, health, shield, energy, ammo,
 * lastFireSequence, alive, isEliminated.
 */
export function parsePlayerEntry(raw: unknown): ParsedPlayerState | null {
  if (raw == null || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const x = r.x;
  const y = r.y;
  const z = r.z;
  const yaw = r.yaw;
  const velocityY = r.velocityY;

  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof z !== "number" ||
    typeof yaw !== "number" ||
    typeof velocityY !== "number"
  ) {
    return null;
  }

  const sequence =
    typeof r.lastProcessedSequence === "number"
      ? (r.lastProcessedSequence as number)
      : -1;

  const health = typeof r.health === "number" ? r.health : 100;
  const shield = typeof r.shield === "number" ? r.shield : 0;
  const energy = typeof r.energy === "number" ? r.energy : 0;
  const ammo = typeof r.ammo === "number" ? r.ammo : 0;
  const lastFireSequence =
    typeof r.lastFireSequence === "number" ? r.lastFireSequence : -1;
  const isEliminated = r.isEliminated === true;

  return {
    x,
    y,
    z,
    vx: 0,
    vy: velocityY,
    vz: 0,
    sequence,
    yaw,
    pitch: 0,
    health,
    shield,
    energy,
    ammo,
    lastFireSequence,
    isEliminated,
  };
}
