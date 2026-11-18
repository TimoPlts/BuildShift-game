/**
 * Arena environment — perimeter architecture and ceiling detail for the
 * clean BuildShift Box Fight room.
 *
 * Purely presentational: every mesh created here is non-pickable and
 * non-collidable. No authoritative bounds, spawn coordinates, collision
 * bodies, placement rules, or camera behaviour are touched — dimensions are
 * DERIVED from the shared `ARENA_COLLIDERS` ground entry and the shared
 * `arenaDecorations` shell so the architecture always frames the real
 * playable room.
 *
 * All decoration lives at the room PERIMETER and CEILING — mounted flush
 * on the inner face of the shell walls (outside the ±12.8 m buildable
 * volume) or under the ceiling slab (above every legal build height). The
 * floor of the playable centre stays completely empty:
 *  - Burgundy lower wall-section bands (`arena-env-band-{n,s,e,w}`).
 *  - Burgundy pilasters (`arena-env-pilaster-{side}-{i}`) framing each wall.
 *  - A brass crown line (`arena-env-crown-{n,s,e,w}`) just below the ceiling.
 *  - Brass ceiling beams (`arena-env-beam-{i}`) under the ceiling slab.
 *
 * What was REMOVED (user requirement — the enclosed clean room replaces the
 * outdoor playground backdrop): exterior pylons, distant monoliths, floor
 * inlay bands, the centre floor ring, and the pylon banners. Nothing
 * decorative remains on or near the floor inside the build volume.
 *
 * Performance: 20 static meshes; materials are shared through the
 * `arenaDecorations` ensure-material helpers. No per-frame work, no textures.
 */
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { ARENA_COLLIDERS } from "@buildshift/game-config";
import {
  ceilingHeight,
  ensureSectionMaterial,
  ensureTrimMaterial,
  shellWallHeight,
} from "../arenaDecorations";

/** Stable id of the ground collider from which we derive the arena boundary. */
const GROUND_ID = "foundation-ground";

/** Half of the shell wall thickness (`SHELL_THICKNESS / 2` in decorations) —
 *  the distance from a wall's centre line to its inner face. */
const WALL_FACE_INSET = 0.15;

// --- Burgundy lower wall bands -----------------------------------------------

const BAND_HEIGHT = 3.6;
/** Thickness (metres) the band stands proud of the wall's inner face. */
const BAND_PROUD = 0.1;
/** Corner inset so adjacent walls' bands do not overlap at the corners. */
const BAND_CORNER_INSET = 0.8;

// --- Burgundy pilasters --------------------------------------------------------

const PILASTER_WIDTH = 1.0;
const PILASTER_PROUD = 0.16;
/** Pilaster positions along each wall, as a fraction of the wall span. */
const PILASTER_FRACTIONS = [0.25, 0.75] as const;

// --- Brass crown line -----------------------------------------------------------

const CROWN_HEIGHT = 0.14;
const CROWN_PROUD = 0.08;
/** Gap between the crown line and the ceiling underside. */
const CROWN_BELOW_CEILING = 0.18;

// --- Brass ceiling beams ----------------------------------------------------------

const BEAM_COUNT = 4;
const BEAM_HEIGHT = 0.3;
const BEAM_DEPTH = 0.5;

/** One side of the room, described for perimeter-mounted decoration. */
interface WallFrame {
  id: "n" | "s" | "e" | "w";
  /** True when the wall runs along X (north/south), false when along Z. */
  alongX: boolean;
  /** Centre-line coordinate of the wall on its fixed axis. */
  fixed: number;
  /** Half span of the wall along its running axis. */
  span: number;
  /** +1 when the room interior is at greater coordinates on the fixed axis. */
  inward: 1 | -1;
}

/**
 * Adds the perimeter-architecture layer to the scene. Safe to call before
 * or after `setupArenaDecorations` — shared materials are created on demand
 * with identical parameters, so module order does not matter.
 */
export function setupArenaEnvironment(scene: Scene): void {
  const ground = ARENA_COLLIDERS.find((c) => c.id === GROUND_ID);
  if (!ground) {
    throw new Error(
      `ARENA_COLLIDERS missing "${GROUND_ID}" — cannot derive arena boundary`,
    );
  }
  const [gx, , gz] = ground.position;
  const [hx, , hz] = ground.halfExtents;

  const wallHeight = shellWallHeight();
  const ceilingY = ceilingHeight();

  const sectionMaterial = ensureSectionMaterial(scene);
  const trimMaterial = ensureTrimMaterial(scene);

  const walls: WallFrame[] = [
    { id: "n", alongX: true, fixed: gz - hz, span: hx, inward: 1 },
    { id: "s", alongX: true, fixed: gz + hz, span: hx, inward: -1 },
    { id: "e", alongX: false, fixed: gx + hx, span: hz, inward: -1 },
    { id: "w", alongX: false, fixed: gx - hx, span: hz, inward: 1 },
  ];

  for (const wall of walls) {
    // Coordinate of a decoration centre standing `proud` metres proud of the
    // wall's inner face, pushed into the room.
    const faceCentre = (proud: number): number =>
      wall.fixed + wall.inward * (WALL_FACE_INSET + proud / 2);

    // Burgundy lower band flush on the wall's inner face.
    const bandLength = wall.span * 2 - BAND_CORNER_INSET * 2;
    placeOnWall(
      scene,
      `arena-env-band-${wall.id}`,
      sectionMaterial,
      wall,
      faceCentre(BAND_PROUD),
      0,
      BAND_HEIGHT / 2,
      bandLength,
      BAND_HEIGHT,
      BAND_PROUD,
    );

    // Pilasters framing the wall, full wall height.
    for (const [i, fraction] of PILASTER_FRACTIONS.entries()) {
      const along = -wall.span + fraction * wall.span * 2;
      placeOnWall(
        scene,
        `arena-env-pilaster-${wall.id}-${i}`,
        sectionMaterial,
        wall,
        faceCentre(PILASTER_PROUD),
        along,
        wallHeight / 2,
        PILASTER_WIDTH,
        wallHeight,
        PILASTER_PROUD,
      );
    }

    // Brass crown line just below the ceiling.
    const crownLength = wall.span * 2 - 0.2;
    placeOnWall(
      scene,
      `arena-env-crown-${wall.id}`,
      trimMaterial,
      wall,
      faceCentre(CROWN_PROUD),
      0,
      ceilingY - CROWN_BELOW_CEILING - CROWN_HEIGHT / 2,
      crownLength,
      CROWN_HEIGHT,
      CROWN_PROUD,
    );
  }

  // Brass ceiling beams spanning the room along X, evenly spaced in Z.
  for (let i = 0; i < BEAM_COUNT; i += 1) {
    const z = gz + ((i + 0.5) / BEAM_COUNT - 0.5) * hz * 2;
    createBox(
      scene,
      `arena-env-beam-${i}`,
      trimMaterial,
      new Vector3(gx, ceilingY - BEAM_HEIGHT / 2, z),
      hx * 2,
      BEAM_HEIGHT,
      BEAM_DEPTH,
    );
  }
}

// --- Internal builders --------------------------------------------------------

/**
 * Places a perimeter decoration flush against one wall: `fixedCoord` is the
 * decoration's centre on the wall's fixed axis, `along` its offset from the
 * wall centre along the wall, `length` its size running along the wall and
 * `proud` its thickness standing into the room.
 */
function placeOnWall(
  scene: Scene,
  name: string,
  material: StandardMaterial,
  wall: WallFrame,
  fixedCoord: number,
  along: number,
  y: number,
  length: number,
  height: number,
  proud: number,
): void {
  const position = wall.alongX
    ? new Vector3(along, y, fixedCoord)
    : new Vector3(fixedCoord, y, along);
  const dims: [number, number, number] = wall.alongX
    ? [length, height, proud]
    : [proud, height, length];
  createBox(scene, name, material, position, ...dims);
}

/** Creates a box mesh marked non-pickable and non-collidable. */
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
