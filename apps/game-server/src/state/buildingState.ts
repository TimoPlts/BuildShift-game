/**
 * Server-side authoritative building state (Colyseus wire schema).
 *
 * Mirrors the shared protocol contract (`@buildshift/protocol` → `building.ts`):
 * the `StructureState` per placed structure and the `BuildingState` (a map of
 * structures keyed by `structureId`).
 *
 * This schema is attached to the room state as a nested `t.ref` so Colyseus
 * automatically synchronises all placed structures to every connected client.
 *
 * Uses `@colyseus/schema` v5 decorator-free `schema()` / `t.*` factory form.
 */
import { schema, t } from "@colyseus/schema";

/**
 * Grid position of a structure's anchor cell (integer cell indices).
 * Mirrors the protocol's `GridPosition` interface.
 */
export const StructureGridSchema = schema(
  {
    /** Column index along world X. */
    x: t.number(),
    /** Layer index along world Y (0 = ground layer). */
    y: t.number(),
    /** Column index along world Z. */
    z: t.number(),
  },
  "StructureGridSchema",
);

/**
 * Authoritative state of a single placed structure.
 * Mirrors the protocol's `StructureState` interface.
 */
export const StructureStateSchema = schema(
  {
    /** Stable identity for this placed structure, assigned by the server. */
    structureId: t.string(),
    /** The structure kind ("wall" | "floor" | "ramp" | "cone"). */
    buildType: t.string(),
    /** The grid cell the structure anchors to. */
    grid: t.ref(StructureGridSchema),
    /** Cardinal rotation applied to the structure (0–3). */
    rotation: t.number(),
    /** `sessionId` of the player who placed the structure. */
    ownerId: t.string(),
    /** The placement-intent `sequence` that produced this structure. */
    createdSequence: t.number(),
  },
  "StructureStateSchema",
);

/**
 * Root building state for the room: all currently placed structures, keyed by
 * `structureId`. Colyseus syncs map additions/removals/updates to clients.
 * Mirrors the protocol's `BuildingState` interface.
 */
export const BuildingStateSchema = schema(
  {
    /** All currently placed structures, keyed by `structureId`. */
    structures: t.map(StructureStateSchema),
  },
  "BuildingStateSchema",
);

export type StructureGridSchemaInstance = InstanceType<typeof StructureGridSchema>;
export type StructureStateSchemaInstance = InstanceType<typeof StructureStateSchema>;
export type BuildingStateSchemaInstance = InstanceType<typeof BuildingStateSchema>;
