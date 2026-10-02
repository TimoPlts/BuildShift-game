import {
  PLAYER_NETWORK_INPUT_LIMITS,
  type PlayerNetworkInput,
} from "./playerNetworkInput.js";

import type { ProtocolValidation } from "./validatePlayerInputFrame.js";

/** Narrow guard for a plain (non-array) object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a number field, returning `undefined` when it is not a number. */
function readNumber(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field];
  return typeof value === "number" ? value : undefined;
}

/** A short, loggable description of an unexpected value's type. */
function typeOf(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

/**
 * Validates the **shape** of an incoming {@link PlayerNetworkInput}.
 *
 * Scope (protocol-level, structural only):
 * - the input is a plain object,
 * - `sequence` is a non-negative **safe** integer (within JavaScript's
 *   safe-integer range, so distinct identities never lose numeric precision),
 * - `moveX` / `moveZ` are finite numbers within `[-1, 1]`,
 * - `lookYaw` / `lookPitch` are finite numbers (radians); `lookPitch` is also
 *   bounded to `[-π, π]`,
 * - `jump`, `sprint`, `crouch`, `primaryFire`, `secondaryFire` are booleans.
 *
 * This is **not** anti-cheat or game-rule validation. Authoritative
 * semantic / rate validation (e.g. is this sequence monotonic for this player,
 * is the move vector plausible, input rate limiting) belongs to the
 * game server.
 */
export function validatePlayerNetworkInput(
  input: unknown,
): ProtocolValidation<PlayerNetworkInput> {
  if (!isRecord(input)) {
    return { ok: false, errors: [`input must be a plain object, got ${typeOf(input)}`] };
  }

  const errors: string[] = [];

  // --- sequence: non-negative safe integer ---------------------------------
  const sequence = readNumber(input, "sequence");
  if (sequence === undefined) {
    errors.push(`sequence: expected a number, got ${typeOf(input.sequence)}`);
  } else if (
    !Number.isSafeInteger(sequence) ||
    sequence < PLAYER_NETWORK_INPUT_LIMITS.sequenceMin
  ) {
    errors.push(
      `sequence: must be a safe integer >= ${PLAYER_NETWORK_INPUT_LIMITS.sequenceMin}, got ${sequence}`,
    );
  }

  // --- movement axes: finite, within [-1, 1] --------------------------------
  const movementLimits =
    `${PLAYER_NETWORK_INPUT_LIMITS.movementMin}..${PLAYER_NETWORK_INPUT_LIMITS.movementMax}`;
  for (const field of ["moveX", "moveZ"] as const) {
    const value = readNumber(input, field);
    if (value === undefined) {
      errors.push(`${field}: expected a number, got ${typeOf(input[field])}`);
    } else if (!Number.isFinite(value)) {
      errors.push(`${field}: must be finite, got ${value}`);
    } else if (
      value < PLAYER_NETWORK_INPUT_LIMITS.movementMin ||
      value > PLAYER_NETWORK_INPUT_LIMITS.movementMax
    ) {
      errors.push(`${field}: must be within [${movementLimits}], got ${value}`);
    }
  }

  // --- lookYaw: finite (unbounded) ------------------------------------------
  const lookYaw = readNumber(input, "lookYaw");
  if (lookYaw === undefined) {
    errors.push(`lookYaw: expected a number, got ${typeOf(input.lookYaw)}`);
  } else if (!Number.isFinite(lookYaw)) {
    errors.push(`lookYaw: must be finite, got ${lookYaw}`);
  }

  // --- lookPitch: finite, within [-π, π] ------------------------------------
  const lookPitch = readNumber(input, "lookPitch");
  if (lookPitch === undefined) {
    errors.push(`lookPitch: expected a number, got ${typeOf(input.lookPitch)}`);
  } else if (!Number.isFinite(lookPitch)) {
    errors.push(`lookPitch: must be finite, got ${lookPitch}`);
  } else if (
    lookPitch < PLAYER_NETWORK_INPUT_LIMITS.pitchMin ||
    lookPitch > PLAYER_NETWORK_INPUT_LIMITS.pitchMax
  ) {
    errors.push(
      `lookPitch: must be within [${PLAYER_NETWORK_INPUT_LIMITS.pitchMin}, ${PLAYER_NETWORK_INPUT_LIMITS.pitchMax}] radians, got ${lookPitch}`,
    );
  }

  // --- boolean intent flags -------------------------------------------------
  const booleanFields = ["jump", "sprint", "crouch", "primaryFire", "secondaryFire"] as const;
  for (const field of booleanFields) {
    if (typeof input[field] !== "boolean") {
      errors.push(`${field}: expected a boolean, got ${typeOf(input[field])}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Every field validated; construct the typed input safely.
  return {
    ok: true,
    value: {
      sequence: input.sequence as number,
      moveX: input.moveX as number,
      moveZ: input.moveZ as number,
      lookYaw: input.lookYaw as number,
      lookPitch: input.lookPitch as number,
      jump: input.jump as boolean,
      sprint: input.sprint as boolean,
      crouch: input.crouch as boolean,
      primaryFire: input.primaryFire as boolean,
      secondaryFire: input.secondaryFire as boolean,
    },
  };
}
