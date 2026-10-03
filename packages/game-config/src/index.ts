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

// ───── Match / round configuration (1v1 match loop) ─────
export {
  WIN_ROUNDS,
  ROUNDS_TO_WIN,
  ROUND_COUNTDOWN_SECONDS,
  ROUND_RESET_DELAY_SECONDS,
} from "./match.js";

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
