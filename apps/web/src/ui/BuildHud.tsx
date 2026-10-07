/**
 * BuildHud — a presentation-only HUD overlay for the BuildShift building
 * system.
 *
 * Displays:
 *  - Build mode active indicator
 *  - Currently selected build type (wall / floor / ramp / cone)
 *  - Resource cost of the selected structure
 *  - Build type selection guidance (row of selectable items)
 *  - Placement validity indicator (green dot = valid, red dot = invalid)
 *  - Current grid coordinates
 *
 * This component is purely presentational. All data is supplied via
 * explicit props; the component performs no networking, no runtime
 * queries, and no side effects beyond rendering.
 *
 * The caller is responsible for tracking build mode state, the selected
 * build type, the current grid-snapped position, and placement validity,
 * then passing them as props.
 */

import {
  BUILD_TYPES,
  type BuildType,
  type GridPosition,
} from "@buildshift/protocol";
import { getStructureConfig } from "@buildshift/game-config";

/**
 * Explicit props for the build HUD.
 *
 * All values represent the **local player's** build-mode state.
 */
export interface BuildHudProps {
  /** Whether the local player is currently in build mode. */
  inBuildMode: boolean;
  /** The currently selected build type. */
  selectedBuildType: BuildType;
  /**
   * Whether the current grid-snapped placement is valid.
   * `null` when no placement preview is active (e.g. player is not aiming
   * at a buildable surface).
   */
  placementValid: boolean | null;
  /** The current grid-snapped position of the placement preview. */
  gridPosition: GridPosition | null;
}

/** Human-readable display names for each build type. */
const BUILD_TYPE_LABELS: Record<BuildType, string> = {
  wall: "Wall",
  floor: "Floor",
  ramp: "Ramp",
  cone: "Cone",
};

/** Small icon glyphs for each build type (text-based, no assets needed). */
const BUILD_TYPE_ICONS: Record<BuildType, string> = {
  wall: "▮",
  floor: "▬",
  ramp: "◢",
  cone: "▲",
};

/**
 * A presentation-only building HUD overlay.
 *
 * Renders a fixed-position overlay at the bottom-center of the viewport
 * showing the selected build type, its cost, a row of build-type selectors,
 * and a placement validity indicator.
 *
 * Example usage:
 * ```tsx
 * <BuildHud
 *   inBuildMode={true}
 *   selectedBuildType="wall"
 *   placementValid={true}
 *   gridPosition={{ x: 3, y: 0, z: 2 }}
 * />
 * ```
 */
export function BuildHud(props: BuildHudProps): JSX.Element {
  const {
    inBuildMode,
    selectedBuildType,
    placementValid,
    gridPosition,
  } = props;

  if (!inBuildMode) {
    return (
      <div className="build-hud build-hud--inactive" aria-hidden="true">
        <span className="build-hud__mode-label">BUILD MODE OFF</span>
      </div>
    );
  }

  const structureConfig = getStructureConfig(selectedBuildType);
  const cost = structureConfig?.cost ?? 0;

  return (
    <div className="build-hud" aria-live="polite">
      {/* ── Mode + selection row ── */}
      <div className="build-hud__top-row">
        <span className="build-hud__mode-label build-hud__mode-label--active">
          BUILD MODE
        </span>
        <span className="build-hud__selected">
          {BUILD_TYPE_ICONS[selectedBuildType]}{" "}
          {BUILD_TYPE_LABELS[selectedBuildType]}
          <span className="build-hud__cost">({cost})</span>
        </span>
      </div>

      {/* ── Build type selector row ── */}
      <div
        className="build-hud__types"
        role="listbox"
        aria-label="Build type selection"
      >
        {BUILD_TYPES.map((type) => (
          <div
            key={type}
            role="option"
            aria-selected={type === selectedBuildType}
            className={`build-hud__type ${
              type === selectedBuildType
                ? "build-hud__type--selected"
                : ""
            }`}
          >
            <span className="build-hud__type-icon" aria-hidden="true">
              {BUILD_TYPE_ICONS[type]}
            </span>
            <span className="build-hud__type-label">
              {BUILD_TYPE_LABELS[type]}
            </span>
          </div>
        ))}
      </div>

      {/* ── Placement validity + grid position ── */}
      <div className="build-hud__bottom-row">
        {placementValid !== null && (
          <span
            className={`build-hud__validity ${
              placementValid
                ? "build-hud__validity--valid"
                : "build-hud__validity--invalid"
            }`}
          >
            {placementValid ? "● VALID" : "● INVALID"}
          </span>
        )}
        {gridPosition && (
          <span className="build-hud__grid">
            ({gridPosition.x}, {gridPosition.y}, {gridPosition.z})
          </span>
        )}
      </div>
    </div>
  );
}
