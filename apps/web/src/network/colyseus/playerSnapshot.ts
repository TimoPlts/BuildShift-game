/**
 * Map a raw `room.state.players` value into a validated, plain client-side
 * snapshot.
 *
 * This module is a pure, dependency-free helper: it imports **nothing** from
 * Colyseus or Babylon, so it can be unit-tested directly (see
 * `playerSnapshot.test.ts`). The server implements `state.players` as a
 * Colyseus `Map` schema keyed by player id; from the SDK that arrives as a
 * `Map`-like value, but this helper also tolerates plain objects and arrays so
 * a shape drift never crashes the client.
 *
 * The snapshot mirrors the shared `AuthoritativePlayerState` contract
 * (`@buildshift/protocol`) field-for-field and carries **no extra fields**.
 */

/**
 * A client-side, plain-object snapshot of one player's authoritative state.
 *
 * This is the *only* shape the rest of the web app (UI, and any future
 * prediction/rendering layer) may rely on. It mirrors
 * {@link AuthoritativePlayerState} field-for-field and deliberately carries
 * **no extra fields** — no velocity, health, or derived presentation values.
 *
 * NOTE: for the local player this snapshot is **network information only**.
 * The local player's presentation (Babylon mesh, local `PlayerController`) is
 * driven by the local prediction loop, never by this snapshot. Reconciling the
 * two is a later-stage concern (docs/TECHNICAL_ARCHITECTURE.md §14/§15) and is
 * intentionally **not** implemented here.
 */
export interface ClientPlayerSnapshot {
  playerId: string;
  position: { x: number; y: number; z: number };
  yaw: number;
  acknowledgedSequence: number;
}

/**
 * A plain map of `playerId` → {@link ClientPlayerSnapshot}.
 *
 * The key is the server-chosen player/session identifier — the same value the
 * server stores as each entry's `playerId`. Keeping the snapshot as an ordinary
 * `Record` (not a Colyseus `Schema`) means no part of the web app outside
 * `apps/web/src/network` ever touches `@colyseus/schema`.
 */
export type PlayerSnapshotMap = Record<string, ClientPlayerSnapshot>;

/**
 * The raw shape of the server's `room.state.players` root as delivered over the
 * wire. The server implements this as a Colyseus `Schema` keyed by player id;
 * from the SDK's perspective the value is a plain object map whose entries are
 * plain objects. We type it loosely (as `unknown`) and validate it, so this
 * module never trusts the wire shape.
 */
export type RawPlayersState = unknown;

/** True when the value is a non-null, non-array plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Returns the value when it is a finite number, otherwise `undefined`. Used to
 * pick the first present, valid coordinate across the nested- and
 * flat-position wire shapes.
 */
function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * True when the value is a non-array, iterable object — i.e. something that
 * yields `[key, value]` pairs when iterated. This matches both a native
 * `Map` **and** a Colyseus `@colyseus/schema` `MapSchema` (which `implements
 * Map` at the type level but is not `instanceof Map` at runtime, and exposes
 * `[Symbol.iterator]`/`[...it]` yielding `[key, value]` pairs). A plain
 * object is not iterable, so it is excluded.
 */
function isMapLike(value: unknown): value is Iterable<unknown> {
  return (
    isRecord(value) &&
    typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] ===
      "function"
  );
}

/** Validate one player entry; returns `null` when it is structurally invalid. */
function readPlayerEntry(key: string, raw: unknown): ClientPlayerSnapshot | null {
  if (!isRecord(raw)) {
    return null;
  }

  // playerId: must be a non-empty string. When absent/unreadable we fall back
  // to the map key (the server keys `state.players` by player id, so this is
  // the authoritative identity), but the wire `playerId` wins when present.
  const wirePlayerId = raw.playerId;
  const playerId =
    typeof wirePlayerId === "string" && wirePlayerId.length > 0
      ? wirePlayerId
      : key;

  // Position: the shared contract describes a nested `position: { x, y, z }`
  // (`AuthoritativePlayerState`), but the Stage 2B2 server wire flattens it to
  // top-level `x` / `y` / `z` on the `PlayerState` schema. Accept whichever is
  // present (nested wins when both are) so the client tolerates both shapes.
  const nestedPosition = isRecord(raw.position) ? raw.position : undefined;
  const x =
    readFiniteNumber(nestedPosition?.x) ?? readFiniteNumber(raw.x);
  const y =
    readFiniteNumber(nestedPosition?.y) ?? readFiniteNumber(raw.y);
  const z =
    readFiniteNumber(nestedPosition?.z) ?? readFiniteNumber(raw.z);
  if (x === undefined || y === undefined || z === undefined) {
    return null;
  }

  const yaw = raw.yaw;
  if (typeof yaw !== "number" || !Number.isFinite(yaw)) {
    return null;
  }

  const acknowledgedSequence = raw.acknowledgedSequence;
  if (
    typeof acknowledgedSequence !== "number" ||
    !Number.isSafeInteger(acknowledgedSequence)
  ) {
    return null;
  }

  return {
    playerId,
    position: { x, y, z },
    yaw,
    acknowledgedSequence,
  };
}

/**
 * Map a raw `room.state.players` value into a validated {@link PlayerSnapshotMap}.
 *
 * This is a pure function: it never mutates the input, never throws, and skips
 * (rather than aborting on) any structurally-invalid entry. That guarantees a
 * malformed or partially-populated state can never crash the client — the
 * remaining valid players still render in the status UI.
 *
 * @param raw the raw `room.state.players` value (a map, an array, or `undefined`).
 * @returns a plain `Record<string, ClientPlayerSnapshot>` (empty when `raw` has
 *          no valid entries).
 */
export function mapPlayersToSnapshot(raw: RawPlayersState): PlayerSnapshotMap {
  const result: PlayerSnapshotMap = {};

  if (raw == null) {
    return result;
  }

  // A Colyseus `Map` schema (or a native `Map`) yields `[key, value]` pairs
  // when iterated.
  if (isMapLike(raw)) {
    for (const item of raw) {
      // A map-like iterable yields `[key, value]` pairs. Be defensive about
      // the shape (a malformed value yields nothing).
      if (Array.isArray(item) && item.length >= 2) {
        const mapped = readPlayerEntry(String(item[0]), item[1]);
        if (mapped) {
          result[mapped.playerId] = mapped;
        }
      }
    }
    return result;
  }

  // Defensive: if the state ever arrives as an array, index by entry id.
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const mapped = readPlayerEntry("0", entry);
      if (mapped) {
        result[mapped.playerId] = mapped;
      }
    }
    return result;
  }

  if (isRecord(raw)) {
    for (const key of Object.keys(raw)) {
      const mapped = readPlayerEntry(key, raw[key]);
      if (mapped) {
        result[mapped.playerId] = mapped;
      }
    }
  }

  return result;
}

/**
 * Convenience: how many players are present in a raw `room.state.players`.
 * Thin wrapper over {@link mapPlayersToSnapshot} so callers that only care
 * about the count don't have to materialise the full snapshot comparison.
 *
 * (We do NOT read `room.state.players.length` because a Colyseus `Schema` map
 * does not expose a reliable `.length` across SDK versions — counting the
 * mapped object is the robust approach.)
 */
export function countPlayers(raw: RawPlayersState): number {
  return Object.keys(mapPlayersToSnapshot(raw)).length;
}
