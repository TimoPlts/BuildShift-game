/**
 * editPreviewGeometry — pure mapping from the canonical edit model to a
 * lightweight, engine-free edit-preview descriptor.
 *
 * After the per-piece edit definitions integrated (wall 3×3 tiles, floor /
 * cone 2×2 tiles, ramp directional variants — see `@buildshift/protocol`
 * `editGrid`), this module turns a prospective {@link StructureEditState}
 * into the plain data a presentation layer needs to show *what the piece
 * would look like* if the pending edit were accepted:
 *
 *  - the per-tile result (solid / removed) and its grid position,
 *  - the tile the player currently has selected (highlight target),
 *  - the canonical ramp {@link RampGeometry} for directional variants, and
 *  - a clear **invalid** flag + reason whenever the prospective state is not
 *    a valid canonical model.
 *
 * Validity mirrors the rules the authoritative server enforces from the
 * shared canonical model (no server imports, no gameplay state):
 *
 *  - the state must validate for the build type (`validateEditState`),
 *  - a selected tile must be inside the build type's tile grid,
 *  - a floor cannot be edited to the empty grid (the last remaining tile
 *    cannot be removed — the structure must be destroyed instead),
 *  - a selected ramp variant must be a canonical {@link RampVariant}.
 *
 * Authority contract: this module is **pure**. It reads only the canonical
 * edit model, allocates fresh descriptor objects, and never mutates its
 * inputs. It does not render, does not touch the building mirror, and does
 * not decide gameplay outcomes — the server remains the sole authority on
 * whether an edit is actually applied.
 */
import {
  FLOOR_CONE_EDIT_COLS,
  FLOOR_CONE_EDIT_ROWS,
  WALL_EDIT_COLS,
  WALL_EDIT_ROWS,
  getEditTileCount,
  isRampVariant,
  validateEditState,
  generateRampGeometry,
  type RampGeometry,
  type RampVariant,
  type StructureEditState,
} from "@buildshift/protocol";

/**
 * One projected edit tile of the prospective result.
 *
 * `col`/`row` are piece-local grid coordinates in the canonical row-major
 * layout: row 0 is the *top* of a wall, and rows advance along the piece's
 * facing (world +Z) for floor/cone bases.
 */
export interface EditPreviewTile {
  /** Canonical tile index (row-major). */
  index: number;
  /** Column within the piece's tile grid. */
  col: number;
  /** Row within the piece's tile grid (0 = top for walls). */
  row: number;
  /** `true` when the tile is solid in the prospective result. */
  solid: boolean;
  /** `true` when this is the tile the player currently has selected. */
  selected: boolean;
}

/**
 * The projected shape of a directional ramp edit.
 */
export interface EditPreviewRamp {
  /** The ramp variant in the prospective (result) state. */
  variant: RampVariant;
  /** The variant the player currently has selected, or `null`. */
  selectedVariant: RampVariant | null;
  /** Canonical geometry of the prospective result. */
  geometry: RampGeometry;
  /** Canonical geometry of the selected variant (for the highlight). */
  selectedGeometry: RampGeometry | null;
}

/**
 * The full lightweight preview descriptor for one prospective piece edit.
 *
 * Engine-free: every field is plain serializable data, so the descriptor
 * round-trips through JSON and unit-tests without a scene.
 */
export interface EditPreviewGeometry {
  /** The build type the descriptor was generated for. */
  buildType: string;
  /** Projected tile results (empty for ramps and unknown build types). */
  tiles: EditPreviewTile[];
  /** Tile-grid column count (0 for ramps / unknown build types). */
  cols: number;
  /** Tile-grid row count (0 for ramps / unknown build types). */
  rows: number;
  /** Projected ramp shape, or `null` for tile-based pieces. */
  ramp: EditPreviewRamp | null;
  /** `true` when the prospective edit is not a valid canonical model. */
  invalid: boolean;
  /** Human-readable reason when {@link invalid}, else `null`. */
  invalidReason: string | null;
}

const TILE_BUILD_TYPES = ["wall", "floor", "cone"] as const;

function isTileBuildType(buildType: string): buildType is "wall" | "floor" | "cone" {
  return (TILE_BUILD_TYPES as readonly string[]).includes(buildType);
}

/** Maps a canonical tile state to per-tile descriptors (row-major). */
function tileDescriptors(
  tiles: readonly boolean[],
  cols: number,
  selectedTile: number | null,
): EditPreviewTile[] {
  const out: EditPreviewTile[] = [];
  for (let i = 0; i < tiles.length; i++) {
    out.push({
      index: i,
      col: i % cols,
      row: Math.floor(i / cols),
      solid: tiles[i],
      selected: selectedTile === i,
    });
  }
  return out;
}

/**
 * Builds the lightweight preview descriptor for one prospective piece edit.
 *
 * @param buildType   The structure build type (`wall` / `floor` / `cone` /
 *                    `ramp`; unknown types yield an invalid descriptor).
 * @param state       The canonical prospective edit state to present.
 * @param selectedTile  The tile the player currently has selected (wall 0–8,
 *                    floor/cone 0–3), or `null` when nothing is selected.
 *                    Out-of-range selections mark the preview invalid.
 * @param selectedVariant  The ramp variant the player currently has selected,
 *                    or `null`. Non-canonical variants mark the preview
 *                    invalid.
 *
 * @returns A fresh, pure-data descriptor. Never mutates `state`.
 */
export function buildEditPreviewGeometry(
  buildType: string,
  state: StructureEditState,
  selectedTile: number | null,
  selectedVariant: RampVariant | null = null,
): EditPreviewGeometry {
  // ── Malformed / unknown build type: present the default (full) piece and
  //    flag the preview invalid so the player sees a clear red signal.
  if (buildType !== "wall" && buildType !== "floor" && buildType !== "cone" && buildType !== "ramp") {
    return {
      buildType,
      tiles: [],
      cols: 0,
      rows: 0,
      ramp: null,
      invalid: true,
      invalidReason: `unknown build type: ${buildType}`,
    };
  }

  const validation = validateEditState(state, buildType);
  if (!validation.ok) {
    const cols = buildType === "wall" ? WALL_EDIT_COLS : buildType === "ramp" ? 0 : FLOOR_CONE_EDIT_COLS;
    const rows = buildType === "wall" ? WALL_EDIT_ROWS : buildType === "ramp" ? 0 : FLOOR_CONE_EDIT_ROWS;
    const defaultTiles = isTileBuildType(buildType)
      ? new Array<boolean>(getEditTileCount(buildType) as number).fill(true)
      : [];
    return {
      buildType,
      tiles: tileDescriptors(defaultTiles, cols, null),
      cols,
      rows,
      ramp:
        buildType === "ramp"
          ? {
              variant: "full",
              selectedVariant: null,
              geometry: generateRampGeometry("full"),
              selectedGeometry: null,
            }
          : null,
      invalid: true,
      invalidReason: validation.errors.join("; "),
    };
  }

  const value = validation.value;

  if (buildType === "ramp") {
    const rampState = value as { kind: "ramp"; variant: RampVariant };
    let invalid = false;
    let invalidReason: string | null = null;
    if (selectedVariant !== null && !isRampVariant(selectedVariant)) {
      invalid = true;
      invalidReason = `unknown ramp variant: ${String(selectedVariant)}`;
    }
    return {
      buildType,
      tiles: [],
      cols: 0,
      rows: 0,
      ramp: {
        variant: rampState.variant,
        selectedVariant,
        geometry: generateRampGeometry(rampState.variant),
        selectedGeometry:
          selectedVariant !== null && isRampVariant(selectedVariant)
            ? generateRampGeometry(selectedVariant)
            : null,
      },
      invalid,
      invalidReason,
    };
  }

  // ── Tile-based pieces (wall / floor / cone) ──
  const tileState = value as { kind: "wall" | "floor_cone"; tiles: boolean[] };
  const tileCount = getEditTileCount(buildType) as number;
  const cols = buildType === "wall" ? WALL_EDIT_COLS : FLOOR_CONE_EDIT_COLS;
  const rows = buildType === "wall" ? WALL_EDIT_ROWS : FLOOR_CONE_EDIT_ROWS;

  let invalid = false;
  let invalidReason: string | null = null;

  if (selectedTile !== null && (selectedTile < 0 || selectedTile >= tileCount)) {
    invalid = true;
    invalidReason = `selected tile ${selectedTile} is out of range (0–${tileCount - 1})`;
  }

  // Floor authority rule: a floor cannot be edited to the empty grid — the
  // last remaining tile cannot be removed (destroy the structure instead).
  if (buildType === "floor" && !tileState.tiles.some((t) => t)) {
    invalid = true;
    invalidReason = "a floor cannot be edited to the empty grid";
  }

  return {
    buildType,
    tiles: tileDescriptors(tileState.tiles, cols, selectedTile),
    cols,
    rows,
    ramp: null,
    invalid,
    invalidReason,
  };
}
