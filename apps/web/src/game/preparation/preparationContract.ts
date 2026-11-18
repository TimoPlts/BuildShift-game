/** Canonical preparation rules shared by client prediction and server authority. */
export {
  BOX_FIGHT_PREPARATION,
  getPreparationZone,
  clampToPreparationZone,
  isGridAllowedDuringPreparation,
} from "@buildshift/game-config";
export type { PreparationSide, PreparationZone } from "@buildshift/game-config";
