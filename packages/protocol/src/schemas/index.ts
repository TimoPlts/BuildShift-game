/**
 * Barrel export for the Colyseus wire schemas and movement input types.
 *
 * These are the shared wire types for the Stage 2D two-player movement
 * room. Both the authoritative server (`apps/game-server`) and the client
 * (`apps/web`) import from here so they agree on the exact schema shape.
 */
export {
  PlayerStateSchema,
  type PlayerStateSchemaInstance,
} from "./playerStateSchema.js";

export { type MovementInput } from "./movementInput.js";

export {
  RoomStateSchema,
  type RoomStateSchemaInstance,
} from "./roomStateSchema.js";
