/**
 * BuildHud — a presentation-only HUD overlay for the BuildShift building
 * system.
 *
 * Displays:
 *  - Build mode active indicator (with the `B` toggle keybind when off)
 *  - Currently selected build type (wall / floor / ramp / cone), each with
 *    its number-key hint (1-4)
 *  - Resource cost of the selected structure
 *  - Build type selection guidance (row of selectable items)
 *  - Placement validity indicator (green dot = valid, red dot = invalid)
 *  - Current grid coordinates
 *  - A contextual control hint row (rotate / place-or-aim / exit)
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
 * The number-key hint for each build type. Mirrors `BUILD_TYPE_KEYS` in the
 * building input controller (1=wall, 2=floor, 3=ramp, 4=cone) so the HUD
 * never advertises a key the controller does not bind.
 */
const BUILD_TYPE_KEY_HINTS: Record<BuildType, string> = {
  wall: "1",
  floor: "2",
  ramp: "3",
  cone: "4",
};

/**
 * Contextual placement hint for the bottom control row: what the player
 * should do next with the left-click intent, depending on the live
 * placement-preview state.
 */
function placementHint(placementValid: boolean | null): string {
  if (placementValid === true) return "Left click place";
  if (placementValid === false) return "Aim at a valid surface";
  return "Aim to preview";
}

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
      <div className="build-hud build-hud--inactive">
        <span className="build-hud__mode-label">BUILD MODE OFF</span>
        <span className="build-hud__toggle-hint">
          Press <kbd>B</kbd> to build
        </span>
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
            aria-label={`${BUILD_TYPE_LABELS[type]} (key ${BUILD_TYPE_KEY_HINTS[type]})`}
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
            <span className="build-hud__type-key" aria-hidden="true">
              {BUILD_TYPE_KEY_HINTS[type]}
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

      {/* ── Contextual control hint (rotate / place-or-aim / exit) ── */}
      <div className="build-hud__hint">
        <span>
          <kbd>Q</kbd>/<kbd>E</kbd> rotate
        </span>
        <span aria-hidden="true">·</span>
        <span>{placementHint(placementValid)}</span>
        <span aria-hidden="true">·</span>
        <span>
          <kbd>B</kbd> exit
        </span>
      </div>
    </div>
  );
}
