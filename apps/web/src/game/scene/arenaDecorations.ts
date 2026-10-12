/**
 * Independent decorative arena geometry module for the BuildShift Box Fight
 * 1v1 arena.
 *
 * The arena is a compact, symmetrical original BuildShift space built at the
 * validated build scale (the shared `BUILD_GRID` / `BUILD_BOUNDS` lattice):
 *
 *  - A raised play-field plate (`arena-playfield-plate`) sized exactly to
 *    the build-volume span, so the plate edge reads as the build-area
 *    boundary on the floor.
 *  - A floor grid (`arena-grid-line-x-{i}` / `arena-grid-line-z-{i}`)
 *    marking the real build-cell
 *    boundaries derived from `BUILD_GRID` / `BUILD_BOUNDS` — boundary lines
 *    that would fall outside the arena shell are omitted — so the floor
 *    shows where structures actually snap.
 *  - Four solid, tall perimeter walls (`arena-shell-n/s/e/w`) forming the
 *    indestructible arena shell, with bright accent cap strips
 *    (`arena-shell-cap-n/s/e/w`) marking the boundary. The shell is tall
 *    enough to clear every build layer with margin (several levels of
 *    vertical clearance).
 *  - Mirrored spawn markers for the 1v1: a pad (`arena-spawn-pad`) and low
 *    start-line bar (`arena-spawn-bar`) at the shared `PLAYER_SPAWN`, plus
 *    their mirror (`arena-spawn-pad-mirror` / `arena-spawn-bar-mirror`) on
 *    the opposite side.
 *
 * All boundary dimensions are derived from the shared `ARENA_COLLIDERS`
 * ground entry and the shared build grid — never duplicated or modified.
 * The spawn markers derive from the shared `PLAYER_SPAWN`.
 *
 * This module does NOT create or alter any gameplay geometry, spawn
 * positions, collision bodies, or networking state.
 */
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import {
  ARENA_COLLIDERS,
  BUILD_BOUNDS,
  BUILD_GRID,
  PLAYER_SPAWN,
} from "@buildshift/game-config";
import { ARENA_PALETTE } from "./arena";

/** Stable id of the ground collider from which we derive the arena boundary. */
const GROUND_ID = "foundation-ground";

/** Thickness (metres) of each shell wall — solid, not a thin sheet. */
const SHELL_THICKNESS = 0.3;

/**
 * Vertical clearance (metres) above the top build layer that the shell must
 * provide — several build levels of clearance plus a visible margin.
 */
const SHELL_CLEARANCE = 1.0;

/** Height (metres) of the accent cap strip sitting on top of each wall. */
const SHELL_CAP_HEIGHT = 0.1;

/** Width (metres) of a floor grid line. */
const GRID_LINE_WIDTH = 0.12;

/** Height (metres) of a floor grid line. */
const GRID_LINE_HEIGHT = 0.02;

/** Width (metres) of the play-field plate inset ring around the plate. */
const PLATE_HEIGHT = 0.02;

/** Diameter (metres) of each spawn pad. */
const PAD_DIAMETER = 2.4;

/** Height (metres) of each spawn pad. */
const PAD_HEIGHT = 0.04;

/** Width (metres) of each low start-line bar. */
const BAR_WIDTH = 3.2;

/** Height (metres) of each start-line bar. */
const BAR_HEIGHT = 0.6;

/** Depth (metres) of each start-line bar. */
const BAR_DEPTH = 0.12;

/**
 * Distance (metres) behind a spawn point (away from the arena centre) where
 * that side's start-line bar sits.
 */
const BAR_OFFSET = 1.6;

/**
 * The world-space positions of the build-cell boundary lines along one axis,
 * clipped to the arena interior.
 *
 * Cell `i` covers `[i*cellSize, (i+1)*cellSize)` in world space (the same
 * half-open convention `worldToGridPosition` uses), so the boundaries of the
 * buildable cells `minX..maxX` sit at `i*cellSize` for `i = minX..maxX+1`.
 * Boundary lines that would fall outside the arena ground are omitted so the
 * visible grid never runs past the shell.
 */
function buildGridLines(halfExtent: number): number[] {
  const { cellSize } = BUILD_GRID;
  const lines: number[] = [];
  for (let i = BUILD_BOUNDS.minX; i <= BUILD_BOUNDS.maxX + 1; i += 1) {
    const p = i * cellSize;
    if (Math.abs(p) < halfExtent) {
      lines.push(p);
    }
  }
  return lines;
}

/**
 * Adds decorative, non-interactive 1v1 arena geometry to the scene:
 *  - A raised play-field plate sized to the build-volume span.
 *  - Floor grid lines marking the real build-cell boundaries.
 *  - Four tall perimeter shell walls + accent cap strips (the indestructible
 *    boundary).
 *  - Mirrored spawn pads and start-line bars for the two 1v1 spawn sides.
 *
 * All meshes are non-pickable and non-collidable. Dimensions are derived from
 * the shared `ARENA_COLLIDERS` ground entry and the shared build grid so they
 * always match the gameplay arena without duplicating or modifying it.
 */
export function setupArenaDecorations(scene: Scene): void {
  const ground = ARENA_COLLIDERS.find((c) => c.id === GROUND_ID);
  if (!ground) {
    throw new Error(
      `ARENA_COLLIDERS missing "${GROUND_ID}" — cannot derive arena boundary`,
    );
  }

  const [gx, , gz] = ground.position;
  const [hx, , hz] = ground.halfExtents;

  // The build volume's world span on each axis (5 cells × 5.12 m = 25.6 m).
  const buildSpanX =
    (BUILD_BOUNDS.maxX - BUILD_BOUNDS.minX + 1) * BUILD_GRID.cellSize;
  const buildSpanZ =
    (BUILD_BOUNDS.maxZ - BUILD_BOUNDS.minZ + 1) * BUILD_GRID.cellSize;

  // The shell clears every build layer plus a visible margin — several
  // levels of vertical clearance.
  const shellHeight =
    (BUILD_BOUNDS.maxLayer - BUILD_BOUNDS.minLayer + 1) *
      BUILD_GRID.layerHeight +
    SHELL_CLEARANCE;

  // --- Materials -------------------------------------------------------

  // Play-field plate: lighter slate — the intentional competition floor.
  const plateMaterial = new StandardMaterial("arena-plate-material", scene);
  plateMaterial.diffuseColor = ARENA_PALETTE.playFieldColor;
  plateMaterial.specularColor = new Color3(0.03, 0.04, 0.06);

  // Shell: solid dark navy — the indestructible boundary.
  const shellMaterial = new StandardMaterial("arena-shell-material", scene);
  shellMaterial.diffuseColor = ARENA_PALETTE.wallColor;
  shellMaterial.specularColor = new Color3(0.02, 0.03, 0.05);

  // Floor grid: a step lighter than the plate so the build lattice reads on
  // the floor.
  const gridMaterial = new StandardMaterial("arena-grid-material", scene);
  gridMaterial.diffuseColor = ARENA_PALETTE.gridColor;
  gridMaterial.specularColor = new Color3(0.02, 0.03, 0.05);

  // Accent glow: shared by the shell caps and spawn markers — one bright
  // cyan material keeps the identity consistent and the material count low.
  const accentGlowMaterial = new StandardMaterial(
    "arena-accent-glow-material",
    scene,
  );
  accentGlowMaterial.diffuseColor = ARENA_PALETTE.accentColor;
  accentGlowMaterial.emissiveColor = ARENA_PALETTE.accentColor
    .clone()
    .scale(0.45);
  accentGlowMaterial.specularColor = new Color3(0.1, 0.12, 0.15);

  // --- Play-field plate (build-area boundary) ---------------------------

  createBox(
    scene,
    "arena-playfield-plate",
    plateMaterial,
    new Vector3(gx, PLATE_HEIGHT / 2, gz),
    buildSpanX,
    PLATE_HEIGHT,
    buildSpanZ,
  );

  // --- Floor grid (real build-cell boundaries) ---------------------------

  const xLines = buildGridLines(hx);
  const zLines = buildGridLines(hz);
  const gridY = PLATE_HEIGHT + GRID_LINE_HEIGHT / 2;

  xLines.forEach((p, i) => {
    createBox(
      scene,
      `arena-grid-line-x-${i}`,
      gridMaterial,
      new Vector3(gx, gridY, gz + p),
      xLines[xLines.length - 1] - xLines[0],
      GRID_LINE_HEIGHT,
      GRID_LINE_WIDTH,
    );
  });

  zLines.forEach((p, i) => {
    createBox(
      scene,
      `arena-grid-line-z-${i}`,
      gridMaterial,
      new Vector3(gx + p, gridY, gz),
      GRID_LINE_WIDTH,
      GRID_LINE_HEIGHT,
      zLines[zLines.length - 1] - zLines[0],
    );
  });

  // --- Indestructible shell (4 walls + accent caps) ----------------------

  createBox(
    scene,
    "arena-shell-n",
    shellMaterial,
    new Vector3(gx, shellHeight / 2, gz - hz),
    hx * 2,
    shellHeight,
    SHELL_THICKNESS,
  );
  createBox(
    scene,
    "arena-shell-cap-n",
    accentGlowMaterial,
    new Vector3(gx, shellHeight + SHELL_CAP_HEIGHT / 2, gz - hz),
    hx * 2,
    SHELL_CAP_HEIGHT,
    SHELL_THICKNESS,
  );

  createBox(
    scene,
    "arena-shell-s",
    shellMaterial,
    new Vector3(gx, shellHeight / 2, gz + hz),
    hx * 2,
    shellHeight,
    SHELL_THICKNESS,
  );
  createBox(
    scene,
    "arena-shell-cap-s",
    accentGlowMaterial,
    new Vector3(gx, shellHeight + SHELL_CAP_HEIGHT / 2, gz + hz),
    hx * 2,
    SHELL_CAP_HEIGHT,
    SHELL_THICKNESS,
  );

  createBox(
    scene,
    "arena-shell-e",
    shellMaterial,
    new Vector3(gx + hx, shellHeight / 2, gz),
    SHELL_THICKNESS,
    shellHeight,
    hz * 2,
  );
  createBox(
    scene,
    "arena-shell-cap-e",
    accentGlowMaterial,
    new Vector3(gx + hx, shellHeight + SHELL_CAP_HEIGHT / 2, gz),
    SHELL_THICKNESS,
    SHELL_CAP_HEIGHT,
    hz * 2,
  );

  createBox(
    scene,
    "arena-shell-w",
    shellMaterial,
    new Vector3(gx - hx, shellHeight / 2, gz),
    SHELL_THICKNESS,
    shellHeight,
    hz * 2,
  );
  createBox(
    scene,
    "arena-shell-cap-w",
    accentGlowMaterial,
    new Vector3(gx - hx, shellHeight + SHELL_CAP_HEIGHT / 2, gz),
    SHELL_THICKNESS,
    SHELL_CAP_HEIGHT,
    hz * 2,
  );

  // --- Mirrored 1v1 spawn markers ----------------------------------------

  createSpawnMarkers(scene, "arena-spawn-pad", "arena-spawn-bar", gz, {
    x: PLAYER_SPAWN.x,
    z: PLAYER_SPAWN.z,
  });

  // The mirror spawn is the shared spawn reflected across the arena centre.
  createSpawnMarkers(scene, "arena-spawn-pad-mirror", "arena-spawn-bar-mirror", gz, {
    x: gx * 2 - PLAYER_SPAWN.x,
    z: gz * 2 - PLAYER_SPAWN.z,
  });
}

/**
 * Creates the flat glowing spawn pad and the low start-line bar for one
 * spawn side, both non-pickable and non-collidable. The bar sits behind the
 * pad, away from the arena centre, so each side reads as a spawn side from
 * across the arena.
 */
function createSpawnMarkers(
  scene: Scene,
  padName: string,
  barName: string,
  arenaCz: number,
  spawn: { x: number; z: number },
): void {
  // Flat glowing pad resting on the play-field plate.
  const pad = MeshBuilder.CreateCylinder(
    padName,
    { diameter: PAD_DIAMETER, height: PAD_HEIGHT, tessellation: 24 },
    scene,
  );
  pad.position = new Vector3(
    spawn.x,
    PLATE_HEIGHT + PAD_HEIGHT / 2,
    spawn.z,
  );
  pad.material = scene.getMaterialByName("arena-accent-glow-material");
  pad.isPickable = false;
  pad.checkCollisions = false;

  // Low start-line bar just behind the pad (away from the arena centre).
  const awayFromCentre = spawn.z >= arenaCz ? 1 : -1;
  const bar = MeshBuilder.CreateBox(
    barName,
    { width: BAR_WIDTH, height: BAR_HEIGHT, depth: BAR_DEPTH },
    scene,
  );
  bar.position = new Vector3(
    spawn.x,
    BAR_HEIGHT / 2,
    spawn.z + awayFromCentre * BAR_OFFSET,
  );
  bar.material = scene.getMaterialByName("arena-accent-glow-material");
  bar.isPickable = false;
  bar.checkCollisions = false;
}

/**
 * Creates a box-shaped decorative mesh, marked non-pickable and
 * non-collidable.
 */
function createBox(
  scene: Scene,
  name: string,
  material: StandardMaterial,
  position: Vector3,
  width: number,
  height: number,
  depth: number,
): void {
  const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
  mesh.position = position;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
}
