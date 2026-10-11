/**
 * editTileSelection — presentation-only crosshair → tile mapping for the
 * piece-edit interaction.
 *
 * Given the structure the aim ray already selected ({@link
 * selectTargetStructure}'s AABB / range convention) and the same aim ray,
 * this pure function maps the crosshair to the *canonical* tile (or ramp
 * half-cell) under it:
 *
 *  - **wall** — the 3×3 grid projected on the panel face
 *    (row 0 = top; col 0 = the −X edge of the unrotated piece),
 *  - **floor / cone** — the 2×2 grid on the base footprint
 *    (row 0 = −Z edge; col 0 = −X edge),
 *  - **ramp** — which of the two half-cells is aimed
 *    (the default ramp rises from the −X end, so "left" = −X half).
 *
 * The mapping is done in the piece's *unrotated local frame* (grid anchor at
 * the origin), exactly the frame {@link editTileLayout} uses for the
 * projected-grid presentation — so the tile the crosshair selects is always
 * the tile the presentation highlights. The selectable volume is the same
 * world AABB the aim selection and the server collider use
 * ({@link structureAabb}), so the tile under the crosshair is only ever
 * offered for a piece the crosshair actually selects.
 *
 * Authority contract: this module only *reads* structure pose data and the
 * aim ray. It never mutates the building mirror, never sends network
 * messages, and never decides edit legality — the server remains the sole
 * authority on whether a tile edit is applied.
 */
import { BUILD_GRID, getStructureConfig } from "@buildshift/game-config";
import type { BuildType, GridPosition, GridRotation } from "@buildshift/protocol";
import {
  rayAabbDistance,
  structureAabb,
  type Vec3Like,
} from "./structureSelection";

/** The canonical target under the crosshair for one piece. */
export type EditTileAimResult =
  /** A tile of the piece's tile grid (wall 0–8, floor/cone 0–3). */
  | { kind: "tile"; tileIndex: number }
  /** A ramp half-cell (drives the directional variant selection). */
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

/** Cardinal rotation → Y-axis radians (same table as the renderers). */
function rotationToYAxis(rotation: GridRotation): number {
  const steps = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
  return steps[rotation] ?? 0;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Maps the aim ray to the canonical tile (or ramp half-cell) under the
 * crosshair for the given structure, or `null` when the ray does not enter
 * the structure's selectable AABB within `maxRange` (nothing to select).
 *
 * Pure: reads only the structure pose and the aim ray.
 */
export function aimEditTile(
  input: EditTileAimInput,
): EditTileAimResult | null {
  const { buildType, grid, rotation } = input.structure;
  const { aimOrigin, aimDirection, maxRange } = input;

  // Same selectable volume the aim selection (and the server collider) use.
  const { ctr, he } = structureAabb(buildType, grid, rotation);
  const t = rayAabbDistance(aimOrigin, aimDirection, ctr, he, maxRange);
  if (t === null) {
    return null;
  }

  // World entry point of the ray on the piece's near face.
  const px = aimOrigin.x + aimDirection.x * t;
  const py = aimOrigin.y + aimDirection.y * t;
  const pz = aimOrigin.z + aimDirection.z * t;

  // Piece-local frame: grid anchor at the origin (the renderers pose their
  // geometry exactly here), unrotated.
  const cs = BUILD_GRID.cellSize;
  const lh = BUILD_GRID.layerHeight;
  const rx = px - grid.x * cs;
  const ry = py - grid.y * lh;
  const rz = pz - grid.z * cs;

  const theta = rotationToYAxis(rotation);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  // Inverse Y-rotation back into the unrotated piece frame.
  const lx = rx * cosT - rz * sinT;
  const lz = rx * sinT + rz * cosT;

  const footprint = getStructureConfig(buildType)?.footprint ?? [1, 1, 1];
  const w = footprint[0] * cs;
  const h = footprint[1] * lh;

  switch (buildType) {
    case "wall": {
      // 3×3 on the panel face: col 0 = −X edge, row 0 = top (the piece-local
      // y spans [0, h] above the anchor, matching editTileLayout).
      const col = clampInt(Math.floor((lx + w / 2) / (w / 3)), 0, 2);
      const row = clampInt(Math.floor((h - ry) / (h / 3)), 0, 2);
      return { kind: "tile", tileIndex: row * 3 + col };
    }
    case "floor":
    case "cone": {
      // 2×2 on the base footprint: col 0 = −X half, row 0 = −Z edge
      // (matching editTileLayout).
      const col = lx < 0 ? 0 : 1;
      const row = lz < 0 ? 0 : 1;
      return { kind: "tile", tileIndex: row * 2 + col };
    }
    case "ramp": {
      // The two half-cells split at the anchor's X (the default ramp rises
      // from the −X end toward the +X end).
      return { kind: "ramp_half", side: lx < 0 ? "left" : "right" };
    }
    default:
      return null;
  }
}
