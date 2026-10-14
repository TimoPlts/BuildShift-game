/**
 * Ramp collision from canonical edit state.
 *
 * Thin adapter over the ONE canonical structure geometry
 * (`structureCuboids` in `@buildshift/game-config`), which the renderer,
 * preview, movement collision, prediction and hitscan all consume. It no
 * longer defines a ramp shape of its own: a ramp is RAMP_STEPS step columns
 * over its two-cell span rising one full layer, and `half_left` /
 * `half_right` keep the climber's left / right half of the WIDTH.
 */
import { structureCuboids } from "@buildshift/game-config";
import type { RampVariant } from "@buildshift/protocol";

export interface RampCollisionCuboid {
  center: { x: number; y: number; z: number };
  halfExtents: { x: number; y: number; z: number };
}

/** The canonical collision cuboids of a ramp variant (see module doc). */
export function rampCollisionCuboids(
  grid: { x: number; y: number; z: number },
  rotation: number,
  variant: RampVariant,
): RampCollisionCuboid[] {
  return structureCuboids({ buildType: "ramp", grid, rotation, editGrid: { kind: "ramp", variant } });
}
