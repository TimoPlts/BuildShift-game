/**
 * editTileSelection — presentation-only crosshair → tile mapping for the
 * piece-edit interaction.
 *
 * Given the structure the aim ray already selected ({@link
 * selectTargetStructure}'s AABB / range convention) and the same aim ray,
 * this pure function maps the crosshair to the *canonical* tile (or ramp
 * width half) under it, using the canonical edit-surface sampling of
 * `editDragSelection` (wall 3×3 on the panel plane, floor/cone 2×2, ramp
 * `half_left` / `half_right` by the canonical half geometry).
 *
 * Authority contract: this module only *reads* structure pose data and the
 * aim ray. It never mutates the building mirror, never sends network
 * messages, and never decides edit legality — the server remains the sole
 * authority on whether a tile edit is applied.
 */
import type { BuildType, GridPosition, GridRotation } from "@buildshift/protocol";
import type { Vec3Like } from "./structureSelection";
import { editGridSize, sampleEditSurface, sampleTile } from "./editDragSelection";

/** The canonical target under the crosshair for one piece. */
export type EditTileAimResult =
  /** A tile of the piece's tile grid (wall 0–8, floor/cone 0–3). */
  | { kind: "tile"; tileIndex: number }
  /** A ramp width half (drives the `half_left` / `half_right` selection). */
  | { kind: "ramp_half"; side: "left" | "right" };

/** Everything the tile hit-test needs for one frame. */
export interface EditTileAimInput {
  /** The selected structure's pose (the aim ray already hit its AABB). */
  structure: Pick<
    StructurePick,
    "buildType" | "grid" | "rotation"
  >;
  /** World-space aim ray origin (the camera position). */
  aimOrigin: Vec3Like;
  /** Normalized world-space aim direction. */
  aimDirection: Vec3Like;
  /** Maximum selection range in metres (the shared edit range). */
  maxRange: number;
}

/** The structure fields the hit-test reads (a {@link StructureState} slice). */
interface StructurePick {
  buildType: BuildType;
  grid: GridPosition;
  rotation: GridRotation;
}

/**
 * Maps the aim ray to the canonical tile (or ramp width half) under the
 * crosshair for the given structure, or `null` when the crosshair is not on
 * the piece's edit surface within `maxRange`.
 *
 * Pure: a thin wrapper over {@link sampleEditSurface}, so the tile the
 * crosshair highlights is always the tile a press or drag would change.
 */
export function aimEditTile(
  input: EditTileAimInput,
): EditTileAimResult | null {
  const sample = sampleEditSurface(input.structure, input.aimOrigin, input.aimDirection, input.maxRange);
  if (sample === null) return null;
  if (sample.kind === "ramp") return { kind: "ramp_half", side: sample.side };
  const size = editGridSize(input.structure.buildType);
  if (size === null) return null;
  const tile = sampleTile(sample, size);
  return tile === null ? null : { kind: "tile", tileIndex: tile };
}
