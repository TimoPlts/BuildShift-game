/**
 * Shared network contract between client and server.
 *
 * Per docs/TECHNICAL_ARCHITECTURE.md §7.3 this package holds input schemas,
 * Colyseus state schemas, event names, and message payload types shared by
 * client and server. It must contain no Babylon, React, database, or
 * Node-only code and must remain dependency-light (only `@colyseus/schema`
 * for the Schema base classes).
 *
 * Stage 2B1 introduced the first concrete contract: the authoritative
 * movement-input frame (`PlayerInputFrame` + structural validator), the
 * minimal authoritative player state (`AuthoritativePlayerState`), and the
 * room / event identifiers.
 *
 * Stage 2D introduces the Colyseus `Schema` wire types for the two-player
 * movement room: `PlayerStateSchema`, `RoomStateSchema`, and the
 * `MovementInput` message interface.
 *
 * Stage 2D (consolidated) introduces the canonical two-player multiplayer
 * movement contract: `PlayerNetworkInput`, `PlayerNetworkState`,
 * `GameStateSchema`, and the `GAME_MODES` / `GameModeId` identifiers.
 *
 * The canonical hitscan combat milestone adds the full combat contract:
 * the `PlayerInput` per-tick input payload (with a `0`/`1` `primaryFire`
 * edge), the combat `EVENTS` (`HIT` / `ELIMINATED` / `HEALTH_UPDATE` /
 * `FIRE_REJECTED`) with the `HitResultEvent` / `PlayerEliminatedEvent` /
 * `HealthUpdateEvent` / `FireRejectedEvent` payloads and the legacy
 * `HitEventPayload`, the shared `WeaponId` vocabulary, and the authoritative
 * `health` / `shield` / `energy` / `ammo` / `lastFireSequence` /
 * `isEliminated` fields on `PlayerStateSchema`.
 *
 * The building milestone adds the transport-neutral, server-authoritative
 * building contract: the `BuildType` vocabulary (wall / floor / ramp / cone),
 * the grid-snapped `StructurePlacementIntent`, the authoritative
 * `StructureState` / `BuildingState`, the `BUILD_EVENTS` identifiers, and the
 * structural `validateStructurePlacementIntent` guard.
 *
 * The Energy economy milestone adds the shared Energy limits, regeneration,
 * per-build cost contract, structure durability state, and the
 * `ENERGY_EVENTS` / `StructureDamageEvent` / `StructureDestroyedEvent`
 * payloads along with pure deterministic helpers
 * (`computeEnergyAfterRegeneration`, `canAffordBuild`,
 * `computeEnergyAfterBuild`, `applyStructureDamage`,
 * `isStructureDestroyed`).
 *
 * The 1v1 Energy Box Fight milestone adds the first slice of the shotgun /
 * weapon-switching / reloading / build-editing contract: the
 * `WeaponSwitch` / `StartReload` client→server messages, the
 * `currentWeapon` + per-weapon `weapons` state on `PlayerStateSchema` /
 * `AuthoritativePlayerState` (and the `WeaponAmmoStateSchema` wire schema),
 * the `BuildEdit` / `BuildEditResult` messages with the structure `openings`
 * vocabulary, and the shared pellet-spread helpers in `@buildshift/simulation`.
 *
 * The 1v1 Energy Box Fight T1 slice adds, *additively*:
 *  - the player-addressed weapon-switch / reload *request* messages
 *    (`WeaponSwitchRequest` / `ReloadRequest`) and the server→client
 *    `WeaponState` payload;
 *  - the first server-authoritative *cell-based* build-editing request
 *    (`BuildEditRequest`, `cellIndex` 0–8, `action` = `"remove"`) alongside
 *    the existing pattern-based `BuildEdit`.
 */

export { PROTOCOL_VERSION } from "./version.js";

export {
  PLAYER_INPUT_LIMITS,
  type PlayerInputFrame,
} from "./inputs/playerInputFrame.js";

export {
  type PlayerNetworkInput,
  PLAYER_NETWORK_INPUT_LIMITS,
} from "./inputs/playerNetworkInput.js";

export { type PlayerInput } from "./inputs/playerInput.js";

export {
  type ProtocolValidation,
  validatePlayerInputFrame,
} from "./inputs/validatePlayerInputFrame.js";

export {
  validatePlayerNetworkInput,
} from "./inputs/validatePlayerNetworkInput.js";

export {
  PlayerPositionSemantic,
  type AuthoritativePlayerState,
  type WeaponAmmoState,
} from "./state/playerState.js";

export { ROOMS, type RoomType } from "./rooms/rooms.js";

// ─────── Weapon vocabulary (canonical hitscan combat) ───────
export {
  WEAPON_IDS,
  isWeaponId,
  type WeaponId,
} from "./weapons.js";

// ─────── Event identifiers + combat payloads (single source of truth) ───────
export {
  EVENTS,
  type EventName,
  type HitPoint,
  type HitResultEvent,
  type PlayerEliminatedEvent,
  type FireRejectionReason,
  type FireRejectedEvent,
  type HealthUpdateEvent,
  type HitEventPayload,
} from "./events/index.js";

// ─────── Stage 2D: Colyseus wire schemas ───────

export {
  PlayerStateSchema,
  type PlayerStateSchemaInstance,
  type MovementInput,
  RoomStateSchema,
  type RoomStateSchemaInstance,
  WeaponAmmoStateSchema,
  type WeaponAmmoStateSchemaInstance,
} from "./schemas/index.js";

// ─────── Stage 2D (consolidated): canonical movement contract ───────

export {
  type PlayerNetworkState,
} from "./schemas/playerNetworkState.js";

export {
  type GameStateSchema,
} from "./schemas/gameStateSchema.js";

export {
  GAME_MODES,
  GAME_MODE_IDS,
  type GameModeId,
} from "./gameModes.js";

// ─────── Match / round protocol (1v1 match loop) ───────

export {
  MatchPhase,
  type RoundResult,
  RoundResultSchema,
  type RoundResultSchemaInstance,
  RoundScoreSchema,
  type RoundScoreSchemaInstance,
} from "./match.js";

// ─────── Round / match lifecycle state protocol ───────

export {
  RoundState,
  type MatchState,
  type RoundResetPayload,
  GameState,
  type CountdownState,
  type RoundScore,
  type MatchResult,
  FIRST_TO_N,
} from "./round-state.js";

// ─────── Building contract (server-authoritative multiplayer building) ───────

export {
  BUILD_TYPES,
  isBuildType,
  type BuildType,
  GRID_ROTATIONS,
  isGridRotation,
  type GridRotation,
  type GridPosition,
  type StructurePlacementIntent,
  STRUCTURE_PLACEMENT_INTENT_LIMITS,
  type StructureState,
  type BuildingState,
  OPENING_PATTERNS,
  isStructureOpeningPattern,
  type StructureOpeningPattern,
  type StructureOpening,
  BUILD_EVENTS,
  type BuildEventName,
  type BuildRejectionReason,
  type StructurePlacedEvent,
  type StructureRejectedEvent,
  validateStructurePlacementIntent,
} from "./building.js";

// ─────── Energy economy & structure durability contract ───────

export {
  ENERGY_LIMITS,
  type EnergyState,
  STRUCTURE_DURABILITY_LIMITS,
  type StructureDurabilityState,
  ENERGY_EVENTS,
  type EnergyEventName,
  type EnergyUpdateEvent,
  type StructureDamageEvent,
  type StructureDestroyedEvent,
  type BuildEnergyCost,
  computeEnergyAfterRegeneration,
  canAffordBuild,
  computeEnergyAfterBuild,
  applyStructureDamage,
  isStructureDestroyed,
} from "./energy.js";

// ─────── Energy Box Fight: weapon switch + reload messages ───────

export {
  type WeaponSwitch,
  type StartReload,
} from "./messages/weaponMessages.js";

// ─────── Energy Box Fight T1: weapon-switch / reload requests + weapon state ───────

export {
  type WeaponSwitchRequest,
  type ReloadRequest,
  type WeaponState,
} from "./messages/weaponRequestMessages.js";

// ─────── Energy Box Fight: server-authoritative build editing ───────

export {
  BUILD_EDIT_EVENTS,
  type BuildEditEventName,
  type BuildEdit,
  type BuildEditResult,
  BUILD_CELL_INDEX_MIN,
  BUILD_CELL_INDEX_MAX,
  BUILD_CELL_INDEX_LIMITS,
  isBuildCellIndex,
  type BuildCellIndex,
  type BuildEditAction,
  type BuildEditRequest,
} from "./messages/buildEditMessages.js";

/** Logical game mode identifiers (legacy union type, kept for compat). */
export type GameMode = "box-fight" | "king-of-the-tower";
