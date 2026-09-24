/**
 * Map a raw `room.state.players` value into a validated, plain client-side
 * snapshot.
 *
 * This module is a pure, dependency-free helper: it imports **nothing** from
 * Colyseus or Babylon, so it can be unit-tested directly (see
 * `playerSnapshot.test.ts`). The server implements `state.players` as a
 * Colyseus `Map` schema keyed by player id; from the SDK that arrives as a
 * `Map`-like value, but this helper also tolerates plain objects so a shape
 * drift never crashes the client.
 *
 * Every PLAYER ENTRY is validated against the accepted
 * {@link AuthoritativePlayerState} contract exactly. We deliberately do NOT
 * synthesise a `playerId` or fall back to historical/obsolete wire shapes —
 * a non-conforming entry is treated as invalid and skipped so schema drift
 * stays visible instead of being silently corrected client-side.
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

/** True when the value is a finite number (rejects NaN/Infinity/non-numbers). */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

/**
 * Validate one player entry against the accepted {@link AuthoritativePlayerState}
 * contract; returns `null` when it does not conform.
 *
 * @param key the map key this entry was stored under. The server guarantees
 *        `state.players` key === `player.playerId` === client `sessionId`, so
 *        the wire `playerId` MUST equal the key. A mismatch is schema drift and
 *        the entry is rejected rather than silently repaired.
 */
function readPlayerEntry(key: string, raw: unknown): ClientPlayerSnapshot | null {
  if (!isRecord(raw)) {
    return null;
  }

  // playerId: a non-empty string that matches the map key exactly. We do NOT
  // synthesise a missing/invalid `playerId` from the key — that would hide
  // contract drift. A mismatch (or a non-string/empty value) is invalid.
  const playerId = raw.playerId;
  if (typeof playerId !== "string" || playerId.length === 0) {
    return null;
  }
  if (playerId !== key) {
    return null;
  }

  // position: must be a nested object with finite x/y/z (the accepted
  // contract shape). No flat x/y/z fallback.
  const position = raw.position;
  if (!isRecord(position)) {
    return null;
  }
  const x = position.x;
  const y = position.y;
  const z = position.z;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
    return null;
  }

  // yaw: finite number.
  const yaw = raw.yaw;
  if (!isFiniteNumber(yaw)) {
    return null;
  }

  // acknowledgedSequence: -1 = no input processed yet; otherwise a valid
  // non-negative input sequence. So it must be a safe integer >= -1 (rejects
  // -2, -50, fractions, NaN, Infinity, ...).
  const acknowledgedSequence = raw.acknowledgedSequence;
  if (
    typeof acknowledgedSequence !== "number" ||
    !Number.isSafeInteger(acknowledgedSequence) ||
    acknowledgedSequence < -1
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
 * @param raw the raw `room.state.players` value (a map-like iterable or a
 *        plain keyed object, or `undefined`).
 * @returns a plain `Record<string, ClientPlayerSnapshot>` (empty when `raw` has
 *          no valid entries).
 */
export function mapPlayersToSnapshot(raw: RawPlayersState): PlayerSnapshotMap {
  const result: PlayerSnapshotMap = {};

  if (raw == null) {
    return result;
  }

  // A Colyseus `Map` schema (or a native `Map`) yields `[key, value]` pairs
  // when iterated. Each pair's key is the player/session id.
  if (isMapLike(raw)) {
    for (const item of raw) {
      // A map-like iterable yields `[key, value]` pairs. Be defensive about
      // the shape (a malformed pair yields nothing).
      if (Array.isArray(item) && item.length >= 2) {
        const key = String(item[0]);
        const mapped = readPlayerEntry(key, item[1]);
        if (mapped) {
          result[key] = mapped;
        }
      }
    }
    return result;
  }

  // A plain keyed object (used by pure unit tests; the real wire shape is the
  // map-like form above).
  if (isRecord(raw)) {
    for (const key of Object.keys(raw)) {
      const mapped = readPlayerEntry(key, raw[key]);
      if (mapped) {
        result[key] = mapped;
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
