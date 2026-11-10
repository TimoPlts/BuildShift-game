/**
 * Arena environment V2 — outer containment architecture, floor design and
 * stylized distant backdrop for the BuildShift Box Fight arena.
 *
 * Purely presentational: every mesh created here is non-pickable and
 * non-collidable. No authoritative bounds, spawn coordinates, collision
 * bodies, placement rules, or camera behaviour are touched — dimensions are
 * DERIVED from the shared `ARENA_COLLIDERS` ground entry and the shared build
 * grid so the environment always frames the real playable arena.
 *
 * What it adds on top of the V1 arena decorations:
 *  - Four boundary pylons (`arena-env-pylon-{n,s,e,w}`) at the four wall
 *    ends, taller than the shell, with accent caps
 *    (`arena-env-pylon-cap-{n,s,e,w}`) — a designed containment silhouette.
 *  - Thin accent inlay bands (`arena-env-inlay-{n,s,e,w}`) just inside each
 *    shell wall so the playable boundary reads on the floor, not just on
 *    the wall caps.
 *  - A square accent floor ring (`arena-env-center-ring-{n,s,e,w}`) framing
 *    the central feature box's footprint — floor design that keeps the
 *    centre open.
 *  - A ring of 8 stylized backdrop monoliths (`arena-env-monolith-{i}`)
 *    well outside the playable bounds; the scene's EXP2 fog fades them
 *    into the horizon haze for depth.
 *  - Four original BuildShift banners (`arena-env-banner-{n,s,e,w}`) —
 *    thin accent-lit panels on the inner face of each boundary pylon.
 *
 * Performance: 28 static meshes, 2 brand-new materials (pylon, backdrop)
 * plus reuse of the shared accent-glow material. No per-frame work, no
 * unbounded allocations, no textures.
 */
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { ARENA_COLLIDERS, BUILD_BOUNDS, BUILD_GRID } from "@buildshift/game-config";
import { ARENA_PALETTE } from "../arena";

/** Stable id of the ground collider from which we derive the arena boundary. */
const GROUND_ID = "foundation-ground";

/** Top of the V1 play-field plate (matches `PLATE_HEIGHT` in arenaDecorations). */
const PLATE_TOP = 0.02;

// --- Pylons ---------------------------------------------------------------

const PYLON_SIZE = 2.4;
/** Pylons clear the shell by a visible margin so the corners read tall. */
const PYLON_OVER_CLEARANCE = 1.5;
const PYLON_CAP_HEIGHT = 0.15;

// --- Boundary inlays --------------------------------------------------------

/** Inset from the ground edge so the band sits on the floor inside the wall. */
const INLAY_INSET = 0.25;
const INLAY_WIDTH = 0.3;
const INLAY_HEIGHT = 0.03;

// --- Center floor ring ------------------------------------------------------

/** Gap between the center-box footprint and the ring band. */
const RING_GAP = 0.6;
const RING_WIDTH = 0.24;
const RING_HEIGHT = 0.02;

// --- Distant backdrop --------------------------------------------------------

/** Ring radius for the monoliths — well beyond the 15 m playable half-extent. */
const MONOLITH_RING_RADIUS = 50;
/** Half size of a monolith's square footprint. */
const MONOLITH_HALF = 3.5;
/** Deterministic silhouette heights (metres) for the 8 monoliths. */
const MONOLITH_HEIGHTS = [22, 12, 30, 9, 16, 10, 26, 14] as const;

// --- Banners -----------------------------------------------------------------

const BANNER_WIDTH = 1.5;
const BANNER_HEIGHT = 4.0;
const BANNER_DEPTH = 0.06;
/** Vertical centre of each banner on its pylon (near the top, below the cap). */
const BANNER_Y = 9.5;

/**
 * Adds the arena environment V2 layer to the scene. Safe to call on a scene
 * that already has (or will later get) the V1 decorations; the accent-glow
 * material is created on demand so module order does not matter.
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

  // Same clearance rule the V1 shell uses, so the pylons frame it exactly.
  const shellHeight =
    (BUILD_BOUNDS.maxLayer - BUILD_BOUNDS.minLayer + 1) *
      BUILD_GRID.layerHeight +
      1.0;
  const pylonHeight = shellHeight + PYLON_OVER_CLEARANCE;

  // --- Materials (two new; accent glow reused from V1 when present) ----------

  const pylonMaterial = new StandardMaterial("arena-env-pylon-material", scene);
  pylonMaterial.diffuseColor = new Color3(0.22, 0.3, 0.42);
  pylonMaterial.specularColor = new Color3(0.03, 0.04, 0.06);

  const backdropMaterial = new StandardMaterial(
    "arena-env-backdrop-material",
    scene,
  );
  backdropMaterial.diffuseColor = new Color3(0.42, 0.53, 0.66);
  backdropMaterial.specularColor = new Color3(0, 0, 0);

  const accentGlow = ensureAccentGlowMaterial(scene);

  // --- Corner pylons + accent caps --------------------------------------------

  createPyloins(scene, pylonMaterial, accentGlow, gx, gz, hx, hz, pylonHeight);
  createInlays(scene, accentGlow, gx, gz, hx, hz);
  createCenterRing(scene, accentGlow, gx, gz);
  createMonoliths(scene, backdropMaterial, gx, gz);
  createBanners(scene, accentGlow, gx, gz, hx, hz, pylonHeight);
}

// --- Internal builders --------------------------------------------------------

function cornerPosition(
  id: "n" | "s" | "e" | "w",
  gx: number,
  gz: number,
  hx: number,
  hz: number,
): { x: number; z: number } {
  switch (id) {
    case "n":
      return { x: gx, z: gz - hz };
    case "s":
      return { x: gx, z: gz + hz };
    case "e":
      return { x: gx + hx, z: gz };
    case "w":
      return { x: gx - hx, z: gz };
  }
}

/**
 * Four pylons with accent caps at the four wall ends (north/south/east/west,
 * matching the V1 shell wall names) — the boundary framing points where a
 * competitive arena reads its entrance axes.
 */
function createPyloins(
  scene: Scene,
  pylonMaterial: StandardMaterial,
  accentGlow: StandardMaterial,
  gx: number,
  gz: number,
  hx: number,
  hz: number,
  pylonHeight: number,
): void {
  for (const id of ["n", "s", "e", "w"] as const) {
    const { x, z } = cornerPosition(id, gx, gz, hx, hz);
    createBox(
      scene,
      `arena-env-pylon-${id}`,
      pylonMaterial,
      new Vector3(x, pylonHeight / 2, z),
      PYLON_SIZE,
      pylonHeight,
      PYLON_SIZE,
    );
    createBox(
      scene,
      `arena-env-pylon-cap-${id}`,
      accentGlow,
      new Vector3(x, pylonHeight + PYLON_CAP_HEIGHT / 2, z),
      PYLON_SIZE,
      PYLON_CAP_HEIGHT,
      PYLON_SIZE,
    );
  }
}

/** Thin accent bands just inside each shell wall — floor boundary framing. */
function createInlays(
  scene: Scene,
  accentGlow: StandardMaterial,
  gx: number,
  gz: number,
  hx: number,
  hz: number,
): void {
  const y = PLATE_TOP + INLAY_HEIGHT / 2;
  const inner = INLAY_INSET;
  createBox(
    scene,
    "arena-env-inlay-n",
    accentGlow,
    new Vector3(gx, y, gz - hz + inner),
    hx * 2 - inner * 2,
    INLAY_HEIGHT,
    INLAY_WIDTH,
  );
  createBox(
    scene,
    "arena-env-inlay-s",
    accentGlow,
    new Vector3(gx, y, gz + hz - inner),
    hx * 2 - inner * 2,
    INLAY_HEIGHT,
    INLAY_WIDTH,
  );
  createBox(
    scene,
    "arena-env-inlay-e",
    accentGlow,
    new Vector3(gx + hx - inner, y, gz),
    INLAY_WIDTH,
    INLAY_HEIGHT,
    hz * 2 - inner * 2,
  );
  createBox(
    scene,
    "arena-env-inlay-w",
    accentGlow,
    new Vector3(gx - hx + inner, y, gz),
    INLAY_WIDTH,
    INLAY_HEIGHT,
    hz * 2 - inner * 2,
  );
}

/**
 * A square accent ring framing the central feature box's footprint.
 * Center box footprint (from ARENA_COLLIDERS) is 2.5 × 2.5 m centred on the
 * ground centre; the ring sits `RING_GAP` outside it on the floor.
 */
function createCenterRing(
  scene: Scene,
  accentGlow: StandardMaterial,
  gx: number,
  gz: number,
): void {
  const centerBox = ARENA_COLLIDERS.find((c) => c.id === "center-box");
  if (!centerBox) {
    throw new Error(`ARENA_COLLIDERS missing "center-box" — cannot frame it`);
  }
  const half = centerBox.halfExtents[0] + RING_GAP;
  const y = PLATE_TOP + RING_HEIGHT / 2;
  const span = half * 2;
  createBox(
    scene,
    "arena-env-center-ring-n",
    accentGlow,
    new Vector3(gx, y, gz - half),
    span,
    RING_HEIGHT,
    RING_WIDTH,
  );
  createBox(
    scene,
    "arena-env-center-ring-s",
    accentGlow,
    new Vector3(gx, y, gz + half),
    span,
    RING_HEIGHT,
    RING_WIDTH,
  );
  createBox(
    scene,
    "arena-env-center-ring-e",
    accentGlow,
    new Vector3(gx + half, y, gz),
    RING_WIDTH,
    RING_HEIGHT,
    span,
  );
  createBox(
    scene,
    "arena-env-center-ring-w",
    accentGlow,
    new Vector3(gx - half, y, gz),
    RING_WIDTH,
    RING_HEIGHT,
    span,
  );
}

/**
 * Eight stylized monoliths on a ring well outside the playable bounds.
 * Deterministic heights give an original skyline silhouette; the scene's
 * EXP2 fog fades them into the horizon haze for depth.
 */
function createMonoliths(
  scene: Scene,
  backdropMaterial: StandardMaterial,
  gx: number,
  gz: number,
): void {
  for (let i = 0; i < MONOLITH_HEIGHTS.length; i += 1) {
    const angle = (i / MONOLITH_HEIGHTS.length) * Math.PI * 2;
    const x = gx + Math.cos(angle) * MONOLITH_RING_RADIUS;
    const z = gz + Math.sin(angle) * MONOLITH_RING_RADIUS;
    const h = MONOLITH_HEIGHTS[i];
    createBox(
      scene,
      `arena-env-monolith-${i}`,
      backdropMaterial,
      new Vector3(x, h / 2, z),
      MONOLITH_HALF * 2,
      h,
      MONOLITH_HALF * 2,
    );
  }
}

/**
 * Thin accent-lit banner panels on the inner face of each pylon, pointing
 * toward the arena centre. Original BuildShift trim — no external assets.
 */
function createBanners(
  scene: Scene,
  accentGlow: StandardMaterial,
  gx: number,
  gz: number,
  hx: number,
  hz: number,
  pylonHeight: number,
): void {
  for (const id of ["n", "s", "e", "w"] as const) {
    const { x, z } = cornerPosition(id, gx, gz, hx, hz);
    // Shift the banner off the pylon's inner face toward the arena centre.
    const inward = PYLON_SIZE / 2 - BANNER_DEPTH / 2 + 0.02;
    const dx = Math.sign(gx - x) || 0;
    const dz = Math.sign(gz - z) || 0;
    createBox(
      scene,
      `arena-env-banner-${id}`,
      accentGlow,
      new Vector3(
        x + dx * inward,
        Math.min(BANNER_Y, pylonHeight - 1.0),
        z + dz * inward,
      ),
      BANNER_WIDTH,
      BANNER_HEIGHT,
      BANNER_DEPTH,
    );
  }
}

/**
 * Creates (or reuses) the shared accent-glow material so this module works
 * standalone, with identical parameters to the V1 decoration's version.
 */
export function ensureAccentGlowMaterial(scene: Scene): StandardMaterial {
  const existing = scene.getMaterialByName("arena-accent-glow-material");
  if (existing instanceof StandardMaterial) {
    return existing;
  }
  const material = new StandardMaterial("arena-accent-glow-material", scene);
  material.diffuseColor = ARENA_PALETTE.accentColor;
  material.emissiveColor = ARENA_PALETTE.accentColor.clone().scale(0.45);
  material.specularColor = new Color3(0.1, 0.12, 0.15);
  return material;
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
): Mesh {
  const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
  mesh.position = position;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  return mesh;
}
