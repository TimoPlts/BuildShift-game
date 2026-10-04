/**
 * Barrel export for the Colyseus wire schemas, movement input types, and
 * the canonical plain-TypeScript network state contracts.
 *
 * These are the shared wire types for the Stage 2D two-player movement
 * room. Both the authoritative server (`apps/game-server`) and the client
 * (`apps/web`) import from here so they agree on the exact schema shape.
 */
export {
  PlayerStateSchema,
  type PlayerStateSchemaInstance,
} from "./playerStateSchema.js";

export {
  WeaponAmmoStateSchema,
  type WeaponAmmoStateSchemaInstance,
} from "./weaponAmmoSchema.js";

export { type MovementInput } from "./movementInput.js";

export {
  RoomStateSchema,
  type RoomStateSchemaInstance,
} from "./roomStateSchema.js";

// ───── Canonical plain-TypeScript network contracts ─────

export { type PlayerNetworkState } from "./playerNetworkState.js";

export { type GameStateSchema } from "./gameStateSchema.js";
