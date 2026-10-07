/**
 * structureImpactPosition — derives a *presentation* world position for a
 * structure from the client's replicated building state.
 *
 * Presentation-only: this module answers "where on screen should the
 * build-impact spark appear for structure X?" by reading the authoritative
 * structure mirror (fed by replicated room state) and mapping the structure's
 * anchor grid cell to a world-space point. It never invents structure state,
 * never mutates the mirror, and is pure (no Babylon, no network) so it can be
 * unit-tested against plain `BuildingState` values.
 *
 * The returned point is the horizontal centre of the anchor cell raised to
 * roughly the structure's mid-height (half the footprint height in layers),
 * so the spark reads as landing *on* the build rather than at its base.
 */
import type { BuildingState, StructureState } from "@buildshift/protocol";
import { getStructureConfig, BUILD_GRID } from "@buildshift/game-config";
import { gridToWorldAnchor } from "../building/gridSnap";

/** A plain world-space point (metres, Y-up). */
export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Resolves the world-space presentation position for `structureId` from a
 * replicated {@link BuildingState}.
 *
 * Returns `null` when the structure is not present in the mirror (e.g. the
 * damage event raced ahead of the structure's state sync, or it was already
 * removed) — callers should simply skip the presentation in that case rather
 * than fall back to a made-up location.
 */
export function resolveStructureImpactPosition(
  building: BuildingState,
  structureId: string,
): WorldPoint | null {
  const structure: StructureState | undefined = building.structures[structureId];
  if (!structure) {
    return null;
  }

  const anchor = gridToWorldAnchor(structure.grid);
  const footprintHeightLayers =
    getStructureConfig(structure.buildType)?.footprint[1] ?? 1;
  // Raise to the structure's mid-height: half of its footprint height in
  // metres, measured from the anchor cell's base centre.
  const midHeightOffset = (footprintHeightLayers * BUILD_GRID.layerHeight) / 2;

  return {
    x: anchor.x,
    y: anchor.y + midHeightOffset,
    z: anchor.z,
  };
}
