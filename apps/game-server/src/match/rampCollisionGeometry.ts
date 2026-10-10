/**
 * Task 14 — ramp collision from canonical edit state.
 *
 * Derives the ramp's collision cuboid from the directional variant (full /
 * flipped / half_left / half_right / turn_left / turn_right) using the same
 * canonical geometry as the renderer. The rendered ramp is a box with height
 * `layerHeight * 0.6`; the collision matches this shape so the ramp remains
 * walkable. The unedited ramp keeps its full-cell `wc` collider; only edited
 * ramps use this geometry.
 */
import { BUILD_GRID } from "@buildshift/game-config";
import { generateRampGeometry, type RampVariant } from "@buildshift/protocol";

export interface RampCollisionCuboid {
  center: { x: number; y: number; z: number };
  halfExtents: { x: number; y: number; z: number };
}

/** The rendered ramp's height as a fraction of the layer height. */
const RAMP_HEIGHT_FRACTION = 0.6;

/**
 * Generates the ramp's collision cuboid from the directional variant.
 *
 * The ramp's footprint is [2, 1, 1] (two cells along the span axis). The
 * variant determines which portion of the span is present:
 *  - `full` / `flipped` / `turn_left` / `turn_right`: both cells (span = 2)
 *  - `half_left`: the "left" cell (span = 1)
 *  - `half_right`: the "right" cell (span = 1)
 *
 * The height matches the renderer's reduced-height box (layerHeight * 0.6),
 * keeping the ramp walkable.
 *
 * Returns a single-element array with the collision cuboid, or an empty
 * array if the variant is invalid.
 */
export function rampCollisionCuboids(
  grid: { x: number; y: number; z: number },
  rotation: number,
  variant: RampVariant,
): RampCollisionCuboid[] {
  const geo = generateRampGeometry(variant);

  const cs = BUILD_GRID.cellSize;
  const lh = BUILD_GRID.layerHeight;
  const rampH = lh * RAMP_HEIGHT_FRACTION;
  const halfY = rampH / 2;
  const cy = grid.y * lh + halfY;

  const isFull = geo.spanFraction >= 1.0;

  // Determine the offset along the span axis (0 = first cell, 1 = second cell,
  // 0.5 = centred on both cells).
  let spanOffset: number;
  if (isFull) {
    spanOffset = 0.5;
  } else {
    // For half variants, "left" = !reversed, "right" = reversed.
    // Rotations 0/2: span in X. Rotations 1/3: span in Z.
    // Under 180° rotations (2 and 3), the local "left" flips to the world
    // max end, so the cell offset inverts.
    const isLeft = !geo.reversed;
    const leftStartsAtMin = rotation === 0 || rotation === 1;
    spanOffset = isLeft === leftStartsAtMin ? 0 : 1;
  }

  const halfSpan = isFull ? cs : cs / 2;

  if (rotation === 0 || rotation === 2) {
    // Span in X
    return [
      {
        center: {
          x: (grid.x + spanOffset) * cs,
          y: cy,
          z: grid.z * cs,
        },
        halfExtents: { x: halfSpan, y: halfY, z: cs / 2 },
      },
    ];
  } else {
    // Span in Z
    return [
      {
        center: {
          x: grid.x * cs,
          y: cy,
          z: (grid.z + spanOffset) * cs,
        },
        halfExtents: { x: cs / 2, y: halfY, z: halfSpan },
      },
    ];
  }
}
