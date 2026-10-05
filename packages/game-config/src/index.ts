/**
 * Centralized gameplay configuration.
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §7.5, shared balance values (movement,
 * energy, weapons, modes, networking) will live in this package so they are
 * not scattered across the codebase.
 */
export { PLAYER_MOVEMENT, VERTICAL_MOVEMENT } from "./movement.js";
export { JUMP_INPUT_TIMING, PLAYER_PHYSICS } from "./physics.js";
export {
  PLAYER_COLLIDER,
  PLAYER_COLLIDER_HALF_TOTAL_HEIGHT,
  PLAYER_COLLIDER_TOTAL_HEIGHT,
  PLAYER_CHARACTER_CONTROLLER,
  PHYSICS_TIMING,
} from "./character.js";
export { ARENA_COLLIDERS, PLAYER_SPAWN } from "./arena.js";
export type { ArenaCollider } from "./arena.js";

export {
  SHOTGUN,
  ASSAULT_RIFLE,
  BLASTER,
  WEAPONS,
  getWeaponById,
  MAX_HEALTH,
  MAX_SHIELD,
  PLAYER,
} from "./weapons.js";
export type { WeaponConfig, WeaponKind } from "./weapons.js";

// ───── Energy Box Fight weapons (pellet shotgun + weapon roster) ─────
export {
  ENERGY_WEAPON_IDS,
  isEnergyWeaponId,
  ENERGY_SHOTGUN,
  ENERGY_WEAPONS,
  getEnergyWeaponById,
  type EnergyWeaponId,
  type EnergyWeaponConfig,
} from "./energyWeapons.js";

// ───── 1v1 Energy Box Fight weapon roster (authoritative shotgun + assault rifle) ─────
export {
  SHOTGUN_WEAPON_ID,
  ASSAULT_RIFLE_WEAPON_ID,
  ENERGY_FIGHT_WEAPON_IDS,
  isEnergyFightWeaponId,
  SHOTGUN_WEAPON,
  ASSAULT_RIFLE_WEAPON,
  ENERGY_FIGHT_WEAPONS,
  getEnergyFightWeaponById,
  type EnergyFightWeaponId,
  type EnergyFightWeaponBase,
  type ShotgunWeaponDefinition,
  type AssaultRifleWeaponDefinition,
  type EnergyFightWeaponDefinition,
} from "./shotgunWeapon.js";

// ───── 1v1 Energy Box Fight T1: weapon balance + build-edit config ─────
export {
  weapons,
  getWeaponConfig,
  buildEdits,
  isBuildEditAllowedForStructure,
  type EnergyBoxFightWeaponBase,
  type ShotgunWeaponConfig,
  type AssaultRifleWeaponConfig,
  type EnergyBoxFightWeaponConfig,
} from "./energyBoxFightConfig.js";

// ───── Match / round configuration (1v1 match loop) ─────
export {
  WIN_ROUNDS,
  ROUNDS_TO_WIN,
  ROUND_COUNTDOWN_SECONDS,
  ROUND_RESET_DELAY_SECONDS,
} from "./match.js";

// ───── Timed-match and anti-stall configuration ─────
export {
  ROUND_DURATION_SECONDS,
  ANTI_STALL_TIMEOUT_SECONDS,
  REMATCH_WINDOW_SECONDS,
} from "./matchConfig.js";

// ───── Building configuration (server-authoritative multiplayer building) ─────
export {
  BUILD_GRID,
  BUILD_RANGE,
  BUILD_RATE,
  BUILD_STRUCTURE_KEYS,
  STRUCTURES,
  getStructureConfig,
  type BuildStructureKey,
  type StructureConfig,
} from "./building.js";

// ───── Energy economy & structure durability configuration ─────
export {
  ENERGY,
  STRUCTURE_DURABILITY_KEYS,
  STRUCTURE_DURABILITY,
  getStructureDurability,
  type StructureDurabilityKey,
} from "./energy.js";

export const GAME_CONFIG_VERSION = "0.1.0" as const;
