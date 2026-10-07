/**
 * Contract + pure helpers for the authoritative 1v1 Energy Box Fight room
 * ({@link BoxFightRoom}): event identifiers, the local structural types for
 * the Energy Box Fight weapon / build-edit payloads, the weapon-slot state
 * factories, and the defensive message parsers.
 *
 * The protocol barrel re-exports *different* `WeaponState` / `BuildEditResult`
 * types (from `weaponRequestMessages.js` / `buildEditMessages.js`) under the
 * same names as the Energy Box Fight ones in `energyBoxFightMessages.js`, so
 * the Energy Box Fight shapes are mirrored locally here (structurally
 * identical) instead of imported.
 */
import {
  PLAYER_NETWORK_INPUT_LIMITS as PIL,
  isWeaponType,
  type WeaponType,
  type Vec3,
} from "@buildshift/protocol";
import { weapons } from "@buildshift/game-config";
import type { StructureStateSchemaInstance } from "../state/buildingState.js";

/** Colyseus room name for the 1v1 Energy Box Fight mode. */
export const BOX_FIGHT_ROOM = "box-fight";
/** Client → server: per-tick movement input frame. */
export const BOX_FIGHT_INPUT = "box-fight:input";
/** Client → server: a `SwitchWeaponRequest` payload. */
export const BOX_FIGHT_SWITCH_WEAPON = "box-fight:switch_weapon";
/** Client → server: a `ReloadRequest` payload. */
export const BOX_FIGHT_RELOAD = "box-fight:reload";
/** Client → server: a `FireRequest` payload. */
export const BOX_FIGHT_FIRE = "box-fight:fire";
/** Client → server: a `BuildEditCommand` payload. */
export const BOX_FIGHT_BUILD_EDIT = "box-fight:build_edit";

/** Server → client broadcast event identifiers. */
export const BOX_FIGHT_EVENTS = {
  /** Server → all: a `WeaponStateUpdate` payload. */
  WEAPON_STATE: "box-fight:weapon_state",
  /** Server → shooter: the `FireResult` for an approved shot. */
  FIRE_RESULT: "box-fight:fire_result",
  /** Server → all: authoritative structure state after an applied build edit. */
  STRUCTURE_UPDATE: "box-fight:structure_update",
  /** Server → all: the `BuildEditResult` for a build-edit command. */
  BUILD_EDIT_RESULT: "box-fight:build_edit_result",
} as const;

/**
 * Authoritative per-weapon state. Structurally identical to the protocol's
 * Energy Box Fight `WeaponState` (`messages/energyBoxFightMessages.js`).
 */
export interface BoxFightWeaponState {
  /** The type of weapon this state describes. */
  weaponType: WeaponType;
  /** Rounds currently loaded in the magazine. */
  currentAmmo: number;
  /** Maximum rounds the magazine holds. */
  maxAmmo: number;
  /** Whether the weapon is currently in the middle of a reload. */
  isReloading: boolean;
  /** Reload progress in `[0, 1]` (meaningful only while reloading). */
  reloadProgress: number;
}

/**
 * Server → client: build-edit result. Structurally identical to the
 * protocol's Energy Box Fight `BuildEditResult`.
 */
export interface BoxFightBuildEditResult {
  /** Whether the server applied the edit successfully. */
  success: boolean;
  /** A human-readable reason when the edit was rejected. */
  reason?: string;
  /** The structure that was the target of the edit. */
  structureId: string;
}

/** Plain-data snapshot of an authoritative structure after a build edit. */
export interface BoxFightStructureSnapshot {
  structureId: string;
  buildType: string;
  grid: { x: number; y: number; z: number };
  rotation: number;
  ownerId: string;
  createdSequence: number;
  /** The applied build edit (`""` = none). */
  editType: string;
}

/** Server → client: structure-update payload after an applied build edit. */
export interface BoxFightStructureUpdatePayload {
  structureId: string;
  editType: string;
  structure: BoxFightStructureSnapshot;
}

/** Authoritative runtime state of one weapon held by a player. */
export interface WeaponSlot {
  weaponType: WeaponType;
  currentAmmo: number;
  maxAmmo: number;
  isReloading: boolean;
  reloadProgress: number;
  /** Sim-seconds of the last approved shot, or `null` if none yet. */
  lastShotAt: number | null;
}

/** Full authoritative weapon loadout of one player. */
export interface PlayerWeapons {
  /** The weapon the player currently has active. */
  active: WeaponType;
  /** Per-weapon state, keyed by weapon type. */
  slots: Record<WeaponType, WeaponSlot>;
}

/** Default (starting) active weapon. */
export const DEFAULT_WEAPON: WeaponType = "assault_rifle";

/**
 * Hitscan stop distance per weapon (metres). The Energy Box Fight balance
 * record carries no range; these match the Energy Box Fight weapon roster
 * (20 m shotgun / 60 m assault rifle).
 */
export const WEAPON_RANGES: Readonly<Record<WeaponType, number>> = {
  assault_rifle: 60,
  shotgun: 20,
};

/** Target collision-sphere radius for players (metres). */
export const PLAYER_TARGET_RADIUS = 0.4;
/** Target collision-sphere radius for structures (metres). */
export const STRUCTURE_TARGET_RADIUS = 0.5;

/**
 * Create a fresh weapon slot at full magazine for the given weapon type.
 * Ammo + magazine size come from the shared Energy Box Fight balance record.
 */
export function makeWeaponSlot(weaponType: WeaponType): WeaponSlot {
  const cfg = weapons[weaponType];
  return {
    weaponType,
    currentAmmo: cfg.magazineSize,
    maxAmmo: cfg.magazineSize,
    isReloading: false,
    reloadProgress: 0,
    lastShotAt: null,
  };
}

/** Default loadout: both weapons at full magazine, assault rifle active. */
export function makePlayerWeapons(): PlayerWeapons {
  return {
    active: DEFAULT_WEAPON,
    slots: {
      assault_rifle: makeWeaponSlot("assault_rifle"),
      shotgun: makeWeaponSlot("shotgun"),
    },
  };
}

/** Project a runtime weapon slot onto the wire `WeaponState` shape. */
export function toWeaponState(slot: WeaponSlot): BoxFightWeaponState {
  return {
    weaponType: slot.weaponType,
    currentAmmo: slot.currentAmmo,
    maxAmmo: slot.maxAmmo,
    isReloading: slot.isReloading,
    reloadProgress: slot.isReloading ? slot.reloadProgress : 0,
  };
}

/**
 * Rotate `aim` around the world +Y up axis by `angleRad` (same yaw
 * convention as the shared pellet-spread helpers: positive rotates toward
 * +X). A pure rotation — the output keeps the input's magnitude.
 */
export function perturbDirection(aim: Readonly<Vec3>, angleRad: number): Vec3 {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return { x: aim.x * cos - aim.z * sin, y: aim.y, z: aim.x * sin + aim.z * cos };
}

/** Convert degrees to radians. */
export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Plain-data snapshot of an authoritative structure (carries `editType`). */
export function structureSnapshot(s: StructureStateSchemaInstance): BoxFightStructureSnapshot {
  return {
    structureId: s.structureId,
    buildType: s.buildType,
    grid: { x: s.grid.x, y: s.grid.y, z: s.grid.z },
    rotation: s.rotation,
    ownerId: s.ownerId,
    createdSequence: s.createdSequence,
    editType: s.editType,
  };
}

/** A buffered per-tick movement input frame. */
export interface InputFrame {
  sequence: number;
  moveX: number;
  moveZ: number;
  lookYaw: number;
  lookPitch: number;
  jump: boolean;
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

function num(m: unknown, a: number, b: number): number {
  return typeof m === "number" && Number.isFinite(m) ? clamp(m, a, b) : 0;
}

/** Defensively parse a movement input frame; `null` when malformed. */
export function parseInputFrame(m: unknown): InputFrame | null {
  if (!m || typeof m !== "object") return null;
  const r = m as Record<string, unknown>;
  const s = r.sequence;
  if (typeof s !== "number" || !Number.isFinite(s)) return null;
  return {
    sequence: s,
    moveX: num(r.moveX, PIL.movementMin, PIL.movementMax),
    moveZ: num(r.moveZ, PIL.movementMin, PIL.movementMax),
    lookYaw: num(r.lookYaw, -Math.PI, Math.PI),
    lookPitch: num(r.lookPitch, PIL.pitchMin, PIL.pitchMax),
    jump: r.jump === true,
  };
}

/**
 * Defensively parse a `FireRequest` payload. Validates the weapon-type
 * vocabulary and the aim direction (finite, non-degenerate 3-vector,
 * normalised to unit length). `null` when malformed.
 */
export function parseFireRequest(
  m: unknown,
): { weaponType: WeaponType; aimDirection: Vec3 } | null {
  if (!m || typeof m !== "object") return null;
  const r = m as Record<string, unknown>;
  const weaponType = r.weaponType;
  if (!isWeaponType(weaponType)) return null;
  const d = r.aimDirection;
  if (!d || typeof d !== "object") return null;
  const dv = d as Record<string, unknown>;
  const x = dv.x, y = dv.y, z = dv.z;
  if (
    typeof x !== "number" || typeof y !== "number" || typeof z !== "number" ||
    !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)
  ) {
    return null;
  }
  const len = Math.hypot(x, y, z);
  if (len < 1e-9) return null;
  return { weaponType, aimDirection: { x: x / len, y: y / len, z: z / len } };
}
