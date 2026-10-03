import { schema, t } from "@colyseus/schema";
import { BUILD_GRID, type StructureConfig } from "@buildshift/game-config";

/**
 * Server-side authoritative building state (Colyseus wire schema).
 *
 * Mirrors the shared protocol contract (`@buildshift/protocol`): the per-
 * structure authoritative state (`StructureStateSchema`) and the map of all
 * placed structures (`BuildingStateSchema`). This schema is attached to the
 * room state as a nested `t.ref` so Colyseus automatically synchronises
 * placements, structure durability (health) changes, and destructions to
 * every connected client.
 *
 * Uses `@colyseus/schema` v5 decorator-free `schema()` / `t.*` factory form.
 */

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
 * Authoritative state of a single placed structure, synced to every client.
 *
 * In addition to the placement metadata, each structure carries its
 * durability — the structure's health. Weapons reduce `currentDurability` by
 * their damage on each authoritative hit; when it reaches 0 the structure is
 * destroyed and removed from `BuildingStateSchema` (and from the physics
 * world) so it disappears for every client.
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
    /**
     * Maximum durability (max health) the structure starts with, determined
     * by its build type. The structure is fully intact at this value.
     */
    maxDurability: t.number(),
    /**
     * Current remaining durability (current health). Decreases by the
     * weapon's damage on each authoritative hit; a value of 0 means the
     * structure has been destroyed and must be removed for all clients.
     */
    currentDurability: t.number(),
  },
  "StructureStateSchema",
);

/**
 * Root building state for the room: all currently placed structures, keyed by
 * `structureId`. Colyseus syncs map additions, updates, and removals to all
 * clients, so a destroyed structure is removed for every client automatically.
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

/**
 * Axis-aligned footprint extents (in grid cells) for a structure after
 * rotation. Rotations 1 and 3 swap the X/Z extents; 0 and 2 keep them.
 */
export function es(c: StructureConfig, rot: number) {
  const w = c.footprint[0], d = c.footprint[2];
  return rot === 1 || rot === 3 ? { xs: d, zs: w } : { xs: w, zs: d };
}

/**
 * Whether a structure anchored at grid cell `g` fits within the fixed arena
 * build bounds. The build volume is a symmetric -14..14 cell span on X/Z and
 * the ground layer up to layer 10 on Y.
 */
export function ib(g: { x: number; y: number; z: number }, c: StructureConfig, rot: number): boolean {
  const h = c.footprint[1], { xs, zs } = es(c, rot);
  return g.x >= -14 && g.x + xs - 1 <= 14 && g.z >= -14 && g.z + zs - 1 <= 14 && g.y >= BUILD_GRID.groundLayer && g.y + h - 1 <= 10;
}

/**
 * The set of grid-cell keys occupied by a structure anchored at `g`. Used for
 * authoritative overlap checks and for freeing the occupied cells when a
 * structure is destroyed.
 */
export function oc(g: { x: number; y: number; z: number }, c: StructureConfig, rot: number): Set<string> {
  const s = new Set<string>(), h = c.footprint[1], { xs, zs } = es(c, rot);
  for (let a = 0; a < xs; a++) for (let b = 0; b < h; b++) for (let d = 0; d < zs; d++) s.add((g.x + a) + "," + (g.y + b) + "," + (g.z + d));
  return s;
}

/**
 * World-space collider centre and half-extents for a structure anchored at
 * `g`. Used to add/remove the structure's static collision body in the
 * physics world.
 */
export function wc(g: { x: number; y: number; z: number }, c: StructureConfig, rot: number) {
  const h = c.footprint[1], { xs, zs } = es(c, rot), cs = BUILD_GRID.cellSize, lh = BUILD_GRID.layerHeight;
  return { ctr: { x: (g.x * 2 + xs - 1) / 2 * cs, y: g.y * lh + h * lh / 2, z: (g.z * 2 + zs - 1) / 2 * cs }, he: { x: xs * cs / 2, y: h * lh / 2, z: zs * cs / 2 } };
}
