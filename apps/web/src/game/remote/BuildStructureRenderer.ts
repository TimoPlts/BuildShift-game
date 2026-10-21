/**
 * BuildStructureRenderer — presentation-only Babylon.js mesh manager for
 * server-authoritative multiplayer building.
 *
 * Responsibilities:
 *  - Show a grid-snapped placement preview (semi-transparent ghost mesh) at
 *    a given grid cell, coloured green (valid) or red (invalid). The ghost
 *    eases smoothly toward each new snapped cell, a low-opacity ground
 *    marker keeps the snapped grid cell legible, and the invalid state
 *    pulses faster/wider plus a short opacity blink on the valid→invalid
 *    transition for clear rejected-placement feedback.
 *  - Render authoritative structures replicated from the server
 *    (`StructureState` / `BuildingState`) as solid meshes in the scene.
 *    Permanent structures use presentation visuals (outer frame + inset
 *    panels on walls, a thin framed platform for floors, a continuous
 *    inclined plate for ramps, and a smooth pyramid for cones) that hide
 *    the canonical collision steps while staying exactly aligned with the
 *    authoritative `structureCuboids` footprint and openings.
 *  - Play the original BuildShift construction presentation when a
 *    structure is authoritatively accepted: a short, transparent,
 *    lightweight build-up (semi-transparent shell solidifying to full
 *    opacity) plus a scale-in pop and a brief emissive confirmation glow.
 *    The durability tint and hit flashes remain readable while it plays.
 *  - Tint structure meshes to reflect their authoritative durability
 *    (damage) state using a non-linear curve, with a brief white+emissive
 *    flash on each hit and a deterministic warning pulse when nearly broken.
 *  - Play a destruction impact flash and fade-out when a structure is
 *    authoritatively removed.
 *  - Smoothly transition half-wall edit shapes.
 *  - Highlight the structure currently aimed for a build edit, and show a
 *    semi-transparent half-wall result preview before the edit is confirmed.
 *  - Clean up all meshes on dispose.
 *
 * This module is **presentation-only**: it reads from `@buildshift/game-config`
 * (shared grid / structure tuning) and `@buildshift/protocol` (structure state
 * types) to position and size meshes. It never mutates game state, never
 * sends network messages, and never performs client-side authority checks.
 *
 * Visuals derive exclusively from the canonical replicated structure state
 * and the public renderer API. Temporary Babylon resources are reused and
 * cleaned up via the scene render observer lifecycle.
 *
 * Usage:
 * ```ts
 * const renderer = new BuildStructureRenderer(scene);
 * renderer.showPreview("wall", { x: 3, y: 0, z: 2 }, 1, true);
 * renderer.syncStructures(buildingState);
 * renderer.updateStructureDurability("abc-123", { maxDurability: 200, currentDurability: 150 });
 * // ...
 * renderer.dispose();
 * ```
 */

import type { Scene, Observer } from "@babylonjs/core";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BUILD_GRID, getStructureConfig, structureCuboids, wallEdgeCenter } from "@buildshift/game-config";
import type {
  BuildType,
  GridPosition,
  GridRotation,
  StructureState,
  BuildingState,
  StructureDurabilityState,
  StructureEditState,
} from "@buildshift/protocol";
import {
  createConstructionEffects,
  createDestructionEffects,
  triggerHitFlash,
  composeVisualInto,
  createComposedVisual,
  NEARLY_BROKEN_THRESHOLD,
  WARNING_PULSE_FREQ,
  WARNING_PULSE_STRENGTH,
  type StructureEffects,
} from "./buildPresentation/structureEffects";
import {
  animationProgress,
  createAnimation,
  type AnimationState,
} from "./buildPresentation/animations";

// ─── Grid → World conversion ───────────────────────────────────────────────

function gridToWorld(grid: GridPosition): Vector3 {
  return new Vector3(
    grid.x * BUILD_GRID.cellSize,
    grid.y * BUILD_GRID.layerHeight,
    grid.z * BUILD_GRID.cellSize,
  );
}

function getFootprintWorldDims(buildType: BuildType): [number, number, number] {
  const config = getStructureConfig(buildType);
  if (!config) {
    return [BUILD_GRID.cellSize, BUILD_GRID.layerHeight, BUILD_GRID.cellSize];
  }
  const [fx, fy, fz] = config.footprint;
  return [
    fx * BUILD_GRID.cellSize,
    fy * BUILD_GRID.layerHeight,
    fz * BUILD_GRID.cellSize,
  ];
}

/** Compute the effective rendered height for a build type (used for Y-centering). */
function getEffectiveHeight(buildType: BuildType): number {
  const [, h] = getFootprintWorldDims(buildType);
  if (buildType === "floor") return 0.15;
  return h;
}

function rotationToYAxis(rotation: GridRotation): number {
  const steps = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
  return steps[rotation] ?? 0;
}

// ─── Color lerp helper ─────────────────────────────────────────────────────

function lerpColor(a: Color3, b: Color3, t: number): Color3 {
  const ct = Math.max(0, Math.min(1, t));
  return new Color3(
    a.r + (b.r - a.r) * ct,
    a.g + (b.g - a.g) * ct,
    a.b + (b.b - a.b) * ct,
  );
}

// ─── Visual geometry (presentation-only) ──────────────────────────────────
//
// The *rendered* structure is a visual reinterpretation of the canonical
// authoritative geometry (`structureCuboids`):
//  - wall  → visually thin edge panel: an outer frame plus recessed inset
//    panels (no giant cube); edited walls render one inset panel per
//    retained canonical 3×3 tile, so openings match exactly.
//  - floor → a thin framed platform: full-height edge trims around a
//    slightly lower deck, so the platform edge reads clearly; edited
//    floors render only the retained canonical quadrants.
//  - ramp  → a single continuous inclined plate that hides the canonical
//    16 collision steps while spanning exactly the canonical 1×1 tile
//    footprint (run, rise, width and turn of every variant).
//  - cone  → a smooth pyramid (one per retained canonical quadrant when
//    edited) that hides the canonical stepped levels.
//
// Collision, hitscan and movement keep using `structureCuboids` untouched;
// these visuals never add or remove volume the authoritative state lacks.

/** An axis-aligned visual box in world space. */
interface VisualBox {
  center: [number, number, number];
  size: [number, number, number];
}

/** A square-basis pyramid visual in world space (apex above the base centre). */
interface VisualPyramid {
  center: [number, number, number];
  diameter: number;
  depth: number;
  height: number;
}

/** The canonical inputs a structure visual derives from (never mutated). */
interface VisualInput {
  buildType: BuildType;
  grid: GridPosition;
  rotation: GridRotation;
  editGrid?: StructureEditState;
}

/** Canonical wall panel thickness — the collision panel's FULL depth
 * (`cs * 0.075` in `structureCuboids` is the half extent). The visual frame
 * matches it so the outer envelope is exactly the canonical one. */
const WALL_FRAME_THICKNESS = BUILD_GRID.cellSize * 0.15;
/** Inset wall panels are recessed: half the frame thickness. */
const WALL_INSET_THICKNESS = WALL_FRAME_THICKNESS / 2;
/** Canonical floor top surface height. */
const FLOOR_TOP_HEIGHT = 0.15;

/**
 * Visual boxes for a wall: the outer frame plus recessed inset panels when
 * the wall is whole, or one recessed panel per retained canonical tile when
 * it is edited (centred on the same tile the collision volume uses).
 */
function wallVisualBoxes(input: VisualInput): VisualBox[] {
  const cs = BUILD_GRID.cellSize;
  const lh = BUILD_GRID.layerHeight;
  const y = input.grid.y * lh;
  const { x, z } = wallEdgeCenter(input.grid, input.rotation);
  const alongX = input.rotation === 0 || input.rotation === 2;
  const tiles =
    input.editGrid?.kind === "wall" && input.editGrid.tiles.length === 9
      ? input.editGrid.tiles
      : Array<boolean>(9).fill(true);

  // A box described by its along-wall offset/size and its lateral thickness.
  const boxAt = (
    cx: number,
    cz: number,
    cy: number,
    widthU: number,
    height: number,
    thicknessV: number,
  ): VisualBox =>
    alongX
      ? { center: [cx, cy, cz], size: [widthU, height, thicknessV] }
      : { center: [cx, cy, cz], size: [thicknessV, height, widthU] };

  if (tiles.every(Boolean)) {
    const postW = cs * 0.09;
    const railH = lh * 0.1;
    const gap = cs * 0.05;
    const panelW = (cs - 2 * postW - gap) / 2;
    const panelH = lh - 2 * railH;
    const boxes: VisualBox[] = [
      // Outer frame: a post at each end of the panel edge plus a top and
      // bottom rail spanning the full edge.
      boxAt(x + (alongX ? cs / 2 - postW / 2 : 0), z + (alongX ? 0 : cs / 2 - postW / 2), y + lh / 2, postW, lh, WALL_FRAME_THICKNESS),
      boxAt(x - (alongX ? cs / 2 - postW / 2 : 0), z - (alongX ? 0 : cs / 2 - postW / 2), y + lh / 2, postW, lh, WALL_FRAME_THICKNESS),
      boxAt(x, z, y + railH / 2, cs, railH, WALL_FRAME_THICKNESS),
      boxAt(x, z, y + lh - railH / 2, cs, railH, WALL_FRAME_THICKNESS),
    ];
    // Two recessed inset panels fill the framed opening.
    for (const side of [-1, 1]) {
      const offset = side * (panelW / 2 + gap / 2);
      boxes.push(
        boxAt(x + (alongX ? offset : 0), z + (alongX ? 0 : offset), y + lh / 2, panelW, panelH, WALL_INSET_THICKNESS),
      );
    }
    return boxes;
  }

  // Edited wall: one recessed panel per retained canonical tile. The tile
  // centres come from `structureCuboids` (one-hot edit grid) so the visual
  // openings can never drift from the collision openings.
  const boxes: VisualBox[] = [];
  for (let i = 0; i < 9; i++) {
    if (!tiles[i]) continue;
    const oneHot = Array<boolean>(9).fill(false);
    oneHot[i] = true;
    const canonical = structureCuboids({
      buildType: "wall",
      grid: input.grid,
      rotation: input.rotation,
      editGrid: { kind: "wall", tiles: oneHot },
    });
    const { center } = canonical[0]!;
    boxes.push(boxAt(center.x, center.z, center.y, cs / 3 * 0.96, lh / 3 * 0.96, WALL_INSET_THICKNESS));
  }
  return boxes;
}

/**
 * Visual boxes for a floor: full-height edge trims around a slightly lower
 * deck (thin framed platform with readable edges), or — when edited — one
 * thin slab per retained canonical quadrant.
 */
function floorVisualBoxes(input: VisualInput): VisualBox[] {
  const cs = BUILD_GRID.cellSize;
  const x = input.grid.x * cs;
  const y = input.grid.y * BUILD_GRID.layerHeight;
  const z = input.grid.z * cs;
  const H = FLOOR_TOP_HEIGHT;
  const tiles =
    input.editGrid?.kind === "floor_cone" && input.editGrid.tiles.length === 4
      ? input.editGrid.tiles
      : Array<boolean>(4).fill(true);

  if (tiles.every(Boolean)) {
    const trim = cs * 0.05;
    const deckH = H - 0.04;
    const boxes: VisualBox[] = [
      { center: [x, y + H / 2, z - (cs / 2 - trim / 2)], size: [cs, H, trim] },
      { center: [x, y + H / 2, z + (cs / 2 - trim / 2)], size: [cs, H, trim] },
      { center: [x - (cs / 2 - trim / 2), y + H / 2, z], size: [trim, H, cs] },
      { center: [x + (cs / 2 - trim / 2), y + H / 2, z], size: [trim, H, cs] },
      { center: [x, y + deckH / 2, z], size: [cs - 2 * trim, deckH, cs - 2 * trim] },
    ];
    return boxes;
  }

  const boxes: VisualBox[] = [];
  for (let i = 0; i < 4; i++) {
    if (!tiles[i]) continue;
    const qx = x + ((i % 2) - 0.5) * cs / 2;
    const qz = z + (Math.floor(i / 2) - 0.5) * cs / 2;
    boxes.push({
      center: [qx, y + (H - 0.03) / 2, qz],
      size: [cs / 2 - 0.1, H - 0.03, cs / 2 - 0.1],
    });
  }
  return boxes;
}

/**
 * Visual pyramids for a cone: one smooth pyramid over the whole tile when
 * unedited, or one per retained canonical quadrant when edited. A quadrant
 * pyramid shrinks linearly toward its apex exactly like the canonical
 * stepped quadrants, so the openings stay where the collision has them.
 */
function coneVisualPyramids(input: VisualInput): VisualPyramid[] {
  const cs = BUILD_GRID.cellSize;
  const lh = BUILD_GRID.layerHeight;
  const x = input.grid.x * cs;
  const yBase = input.grid.y * lh;
  const z = input.grid.z * cs;
  const tiles =
    input.editGrid?.kind === "floor_cone" && input.editGrid.tiles.length === 4
      ? input.editGrid.tiles
      : Array<boolean>(4).fill(true);

  if (tiles.every(Boolean)) {
    return [{ center: [x, yBase + lh / 2, z], diameter: cs, depth: cs, height: lh }];
  }

  const pyramids: VisualPyramid[] = [];
  for (let i = 0; i < 4; i++) {
    if (!tiles[i]) continue;
    pyramids.push({
      center: [x + ((i % 2) - 0.5) * cs / 2, yBase + lh / 2, z + (Math.floor(i / 2) - 0.5) * cs / 2],
      diameter: cs / 2,
      depth: cs / 2,
      height: lh,
    });
  }
  return pyramids;
}

/** Plate thickness of the ramp visual (a touch more than the 0.3 m collision slabs, so its underside swallows the steps). */
const RAMP_PLATE_THICKNESS = 0.34;
/** Longitudinal tessellation of the ramp plate (straight plate — 12 is plenty smooth). */
const RAMP_PLATE_SEGMENTS = 12;

/**
 * Tiny closed-geometry builder: quads/triangles with their own vertices
 * (flat normals) and the winding the shared material's back-face culling
 * expects — the triangle whose normal (a−b)×(c−b) points along the given
 * outward direction is emitted as the front face.
 */
class FlatGeometry {
  private positions: number[] = [];
  private normals: number[] = [];
  private indices: number[] = [];

  private readonly at = (base: number, i: number): Vector3 =>
    new Vector3(this.positions[(base + i) * 3]!, this.positions[(base + i) * 3 + 1]!, this.positions[(base + i) * 3 + 2]!);

  private addFace(corners: [number, number, number][], outNormal: Vector3, isQuad: boolean): void {
    const base = this.positions.length / 3;
    for (const [x, y, z] of corners) this.positions.push(x, y, z);
    const a = this.at(base, 0);
    const b = this.at(base, 1);
    const c = this.at(base, 2);
    const faceNormal = Vector3.Cross(a.subtract(b), c.subtract(b));
    const n = outNormal.normalize();
    const forward = faceNormal.dot(n) >= 0;
    if (isQuad) {
      if (forward) this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    } else if (forward) {
      this.indices.push(base, base + 1, base + 2);
    } else {
      this.indices.push(base, base + 2, base + 1);
    }
    for (let i = 0; i < corners.length; i++) this.normals.push(n.x, n.y, n.z);
  }

  addQuad(corners: [number, number, number][], outNormal: Vector3): void {
    this.addFace(corners, outNormal, true);
  }

  addTriangle(corners: [number, number, number][], outNormal: Vector3): void {
    this.addFace(corners, outNormal, false);
  }

  build(scene: Scene, name: string): Mesh {
    const mesh = new Mesh(name, scene);
    mesh.setVerticesData("position", this.positions);
    mesh.setVerticesData("normal", this.normals);
    mesh.setIndices(this.indices);
    return mesh;
  }
}

/**
 * Build the continuous ramp plate: a closed, planar inclined slab spanning
 * exactly the canonical 1×1 tile footprint. The top surface follows the
 * canonical walking line (from the tile base at one end to one layer up at
 * the other, reversed for flipped/descending orientations), the width and
 * lateral shear follow the canonical variant (full / flipped / half_left /
 * half_right / turn_left / turn_right), and the plate is closed (top,
 * bottom, side and end faces) so it reads solid from every angle while the
 * canonical collision steps remain hidden underneath. Vertices are emitted
 * in tile-relative coordinates (origin: tile centre at the layer base).
 */
function buildRampPlateMesh(
  scene: Scene,
  rotation: GridRotation,
  variant: string,
): Mesh {
  const cs = BUILD_GRID.cellSize;
  const lh = BUILD_GRID.layerHeight;
  const alongX = rotation === 0 || rotation === 2;
  const reversed = (rotation === 2 || rotation === 3) !== (variant === "flipped");
  const ascent = reversed ? -1 : 1;
  // Lateral sign of the climber's left side (same convention as the
  // canonical step slabs in `structureCuboids`).
  const leftSign = alongX ? ascent : -ascent;
  const side = variant === "half_left" ? 1 : variant === "half_right" ? -1 : 0;
  const turn = variant === "turn_left" ? -1 : variant === "turn_right" ? 1 : 0;

  const S = RAMP_PLATE_SEGMENTS;
  const geo = new FlatGeometry();

  // One station per longitudinal segment boundary: the four plate corners
  // (top lo, top hi, bottom hi, bottom lo) at parameter u.
  const cornersAt = (u: number): [number, number, number][] => {
    const run = -cs / 2 + u * cs;
    const topY = lh * (reversed ? 1 - u : u);
    const bottomY = Math.max(0, topY - RAMP_PLATE_THICKNESS);
    let lo: number;
    let hi: number;
    if (side !== 0) {
      const lateral = side * leftSign * cs / 4;
      lo = lateral - cs / 4;
      hi = lateral + cs / 4;
    } else if (turn !== 0) {
      const lateral = turn * u * cs / 4;
      lo = lateral - cs / 4;
      hi = lateral + cs / 4;
    } else {
      lo = -cs / 2;
      hi = cs / 2;
    }
    const point = (lateral: number, y: number): [number, number, number] =>
      alongX ? [run, y, lateral] : [lateral, y, run];
    return [point(lo, topY), point(hi, topY), point(hi, bottomY), point(lo, bottomY)];
  };

  const runDir = alongX ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
  const latDir = alongX ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
  const eRun = runDir.scale(cs).add(new Vector3(0, lh, 0)).normalize();
  const nTop = runDir.scale(-lh).add(new Vector3(0, cs, 0)).normalize();
  const nBottom = nTop.negate();
  const nLo = latDir.negate();
  const nHi = latDir;
  const nCapStart = eRun.negate();
  const nCapEnd = eRun;

  const stations = Array.from({ length: S + 1 }, (_, s) => cornersAt(s / S));
  for (let s = 0; s < S; s++) {
    const p = stations[s]!;
    const q = stations[s + 1]!;
    geo.addQuad([p[0]!, p[1]!, q[1]!, q[0]!], nTop); // top
    geo.addQuad([p[3]!, q[3]!, q[2]!, p[2]!], nBottom); // bottom
    geo.addQuad([p[3]!, q[3]!, q[0]!, p[0]!], nLo); // low-lateral side
    geo.addQuad([p[1]!, p[2]!, q[2]!, q[1]!], nHi); // high-lateral side
  }
  const first = stations[0]!;
  const last = stations[S]!;
  geo.addQuad([first[0]!, first[1]!, first[2]!, first[3]!], nCapStart); // low end
  geo.addQuad([last[0]!, last[3]!, last[2]!, last[1]!], nCapEnd); // high end

  return geo.build(scene, "");
}

/**
 * Build the smooth pyramid visual (four slanted faces + base) with its base
 * centred on the origin — this Babylon build has no `CreatePyramid`, so the
 * solid is emitted as a flat-shaded closed mesh.
 */
function buildPyramidMesh(
  scene: Scene,
  name: string,
  diameter: number,
  depth: number,
  height: number,
): Mesh {
  const d2 = diameter / 2;
  const z2 = depth / 2;
  const A: [number, number, number] = [-d2, 0, -z2];
  const B: [number, number, number] = [d2, 0, -z2];
  const C: [number, number, number] = [d2, 0, z2];
  const D: [number, number, number] = [-d2, 0, z2];
  const P: [number, number, number] = [0, height, 0];
  const geo = new FlatGeometry();
  geo.addTriangle([A, B, P], new Vector3(0, 0, -1));
  geo.addTriangle([B, C, P], new Vector3(1, 0, 0));
  geo.addTriangle([C, D, P], new Vector3(0, 0, 1));
  geo.addTriangle([D, A, P], new Vector3(-1, 0, 0));
  geo.addQuad([A, B, C, D], new Vector3(0, -1, 0));
  return geo.build(scene, name);
}

/**
 * Populate a structure root with its presentation visuals, relative to the
 * root pose (anchor + half the effective height). Rebuilding disposes any
 * existing children, so this is safe to call on every geometry change.
 * Children carry no material here — the caller assigns the shared
 * structure material to the root and every child.
 */
function fillStructureVisual(
  scene: Scene,
  root: AbstractMesh,
  id: string,
  input: VisualInput,
): void {
  for (const child of root.getChildMeshes(false)) child.dispose();
  const base = gridToWorld(input.grid);
  const baseY = base.y + getEffectiveHeight(input.buildType) / 2;
  const rel = (cx: number, cy: number, cz: number) =>
    new Vector3(cx - base.x, cy - baseY, cz - base.z);

  const finish = (mesh: Mesh, index: number, cx: number, cy: number, cz: number): void => {
    mesh.name = `visual-${id}-${index}`;
    mesh.parent = root;
    mesh.position = rel(cx, cy, cz);
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    if (root.material) mesh.material = root.material;
  };

  if (input.buildType === "ramp") {
    const variant = input.editGrid?.kind === "ramp" ? input.editGrid.variant : "full";
    const plate = buildRampPlateMesh(scene, input.rotation, variant);
    // Tile-relative origin (tile centre at the layer base) → relative offset.
    finish(
      plate,
      0,
      input.grid.x * BUILD_GRID.cellSize,
      input.grid.y * BUILD_GRID.layerHeight,
      input.grid.z * BUILD_GRID.cellSize,
    );
    return;
  }

  if (input.buildType === "cone") {
    let index = 0;
    for (const py of coneVisualPyramids(input)) {
      const mesh = buildPyramidMesh(
        scene,
        `visual-${id}-${index}`,
        py.diameter,
        py.depth,
        py.height,
      );
      // The pyramid mesh's local origin is its base centre (not its bounding
      // centre like CreateBox), so offset down by half its height.
      finish(mesh, index, py.center[0], py.center[1] - py.height / 2, py.center[2]);
      index += 1;
    }
    return;
  }

  const boxes = input.buildType === "wall" ? wallVisualBoxes(input) : floorVisualBoxes(input);
  for (const [index, part] of boxes.entries()) {
    const mesh = MeshBuilder.CreateBox(`visual-${id}-${index}`, {
      width: part.size[0],
      height: part.size[1],
      depth: part.size[2],
    }, scene);
    finish(mesh, index, part.center[0], part.center[1], part.center[2]);
  }
}

/**
 * Create the placement-preview ghost: the same presentation visuals as the
 * permanent renderer, grid cell and rotation, with no edit state. The root
 * sits at the anchor (+ half the effective height) with no rotation of its
 * own — the rotation is part of the canonical shape — and the visuals are
 * child meshes sharing the preview material.
 */
function createStructureMesh(
  scene: Scene,
  name: string,
  buildType: BuildType,
  grid: GridPosition,
  rotation: GridRotation,
): AbstractMesh {
  const worldPos = gridToWorld(grid);
  const root = new Mesh(name, scene);
  root.position = new Vector3(worldPos.x, worldPos.y + getEffectiveHeight(buildType) / 2, worldPos.z);
  root.isPickable = false;
  root.checkCollisions = false;
  fillStructureVisual(scene, root, name, { buildType, grid, rotation });
  return root;
}

// ─── Material palette ──────────────────────────────────────────────────────

const SOLID_COLORS: Record<BuildType, Color3> = {
  wall: new Color3(0.42, 0.50, 0.60),
  floor: new Color3(0.55, 0.42, 0.28),
  ramp: new Color3(0.68, 0.56, 0.35),
  cone: new Color3(0.85, 0.65, 0.2),
};

const SOLID_EMISSIVE = new Color3(0.02, 0.02, 0.04);

/** Target diffuse colour for a fully damaged structure (durability ≈ 0). */
const DAMAGED_COLOR = new Color3(0.92, 0.32, 0.12);

/** Target emissive colour for a fully damaged structure. */
const DAMAGED_EMISSIVE = new Color3(0.35, 0.12, 0.03);

const PREVIEW_VALID_COLOR = new Color3(0.2, 0.9, 0.4);
const PREVIEW_INVALID_COLOR = new Color3(0.95, 0.25, 0.2);
const PREVIEW_OPACITY_BASE = 0.4;
const PREVIEW_OPACITY_PULSE = 0.1;
/** Pulse frequency for the *valid* preview (cycles per second). */
const PREVIEW_PULSE_FREQ = 2.5;
/** Opacity base for the *invalid* preview (clearer rejected signal). */
const PREVIEW_INVALID_OPACITY_BASE = 0.5;
/** Opacity amplitude for the *invalid* preview pulse (wider than valid). */
const PREVIEW_INVALID_OPACITY_PULSE = 0.22;
/** Pulse frequency for the *invalid* preview (cycles per second). */
const PREVIEW_INVALID_PULSE_FREQ = 4.5;
/** One-shot opacity blink when the preview transitions valid→invalid (ms). */
const PREVIEW_DENIED_BLINK_DURATION = 180;
const PREVIEW_DENIED_BLINK_STRENGTH = 0.55;
/**
 * Frame-rate-independent exponential smoothing rate for the placement ghost
 * (per second): position/rotation ease toward the new grid target instead of
 * snapping. ≈90% of the remaining distance is closed in ~150ms.
 */
const PREVIEW_SMOOTHING_RATE = 16;
/**
 * Ground marker under the snapped preview cell: a thin, low-opacity slab the
 * width of one build cell, making the grid snap legible.
 */
const PREVIEW_CELL_MARKER_ALPHA = 0.3;
const PREVIEW_CELL_MARKER_SIZE = 0.94;

/**
 * Warm emissive glow (RGB) layered onto a newly-accepted structure while its
 * placement confirmation plays; scaled by the composed `confirmStrength`.
 */
const CONFIRM_GLOW = [0.75, 0.6, 0.25] as const;

/** Emissive boost (RGB) applied while a structure is the aimed build-edit target. */
const EDIT_TARGET_EMISSIVE_BOOST = [0.18, 0.38, 0.22] as const;

/**
 * Subtle emissive accent (RGB) for structures owned by the local player.
 * Applied on top of the base emissive so the owner is distinguishable at a
 * glance without overwhelming the damage tint or hit-flash readability.
 */
const LOCAL_OWNER_ACCENT: readonly [number, number, number] = [0.02, 0.06, 0.02];
/**
 * Subtle emissive accent (RGB) for structures owned by a remote player.
 * Warm-shifted to contrast with the local player's cool-green accent.
 */
const REMOTE_OWNER_ACCENT: readonly [number, number, number] = [0.05, 0.02, 0.01];

/** Ghost colour for the half-wall result preview (pre-confirmation). */
const EDIT_PREVIEW_COLOR = new Color3(0.3, 0.95, 0.6);
/** Opacity of the half-wall result preview ghost. */
const EDIT_PREVIEW_OPACITY = 0.45;

// ─── Per-structure runtime state ───────────────────────────────────────────

interface StructureRuntime {
  mesh: AbstractMesh;
  material: StandardMaterial;
  buildType: BuildType;
  effects: StructureEffects;
  /** The target edit pose (scaleY, yOffset) for the current edit state. */
  targetScaleY: number;
  targetYOffset: number;
  /** The authoritative grid position (for tick position computation). */
  grid: GridPosition;
  /** Current durability (null if no damage event received yet). */
  durability: StructureDurabilityState | null;
  /** Previous durability value to detect hits. */
  prevDurability: number;
  /** Base diffuse color (durability-tinted, before hit-flash boost). */
  baseDiffuse: Color3;
  /** True when the material/mesh needs one more tick after a state change. */
  dirty: boolean;
  /** The authoritative session ID of the player who placed this structure. */
  ownerId: string;
  /** Whether the structure belongs to the local player (drives the ownership accent). */
  isLocalOwner: boolean;
  geometryKey: string;
}

/**
 * Fingerprint of one synced structure — enough to detect an unchanged
 * authoritative state without copying any per-frame objects.
 */
interface StructureFingerprint {
  buildType: BuildType;
  x: number;
  y: number;
  z: number;
  rotation: GridRotation;
  geometryKey: string;
}

function geometryKey(structure: StructureState): string {
  const edit = structure.editGrid;
  const state = edit?.kind === "ramp"
    ? `r:${edit.variant}`
    : edit ? `t:${edit.tiles.map((value) => value ? "1" : "0").join("")}` : "default";
  return `${structure.buildType}:${structure.rotation}:${state}`;
}

/** A non-rendered root carries the existing effects/material. Child meshes
 * are the presentation visuals, relative to the anchored root pose. */
function createReplicatedMesh(scene: Scene, structure: StructureState): AbstractMesh {
  const root = new Mesh(`structure-${structure.structureId}`, scene);
  root.isPickable = false;
  root.checkCollisions = false;
  fillStructureVisual(scene, root, structure.structureId, structure);
  return root;
}

// ─── BuildStructureRenderer ────────────────────────────────────────────────

/**
 * Presentation-only renderer for building previews and replicated structures.
 *
 * All meshes are owned by this class and disposed on `dispose()`.
 * A scene render observer drives per-frame animation updates.
 */
export class BuildStructureRenderer {
  private readonly scene: Scene;
  private disposed = false;

  private previewMesh: AbstractMesh | null = null;
  private previewMaterial: StandardMaterial | null = null;
  private previewBuildType: BuildType | null = null;
  /** Rotation the current ghost was built for (the shape depends on it). */
  private previewRotation: GridRotation | null = null;
  /** Whether the current preview candidate is valid (drives pulse styling). */
  private previewValid = true;
  /** Target world position the ghost eases toward (set by showPreview). */
  private readonly previewTargetPos = new Vector3();
  /** Target Y-axis rotation the ghost eases toward (set by showPreview). */
  private previewTargetRotY = 0;
  /** One-shot opacity blink on the valid→invalid transition. */
  private previewDeniedBlink: AnimationState | null = null;
  /** Ground marker for the snapped preview cell (clearer grid snap). */
  private previewCellMesh: AbstractMesh | null = null;
  private previewCellMaterial: StandardMaterial | null = null;
  /** Timestamp of the previous tick (frame-rate-independent ghost easing). */
  private _lastTickMs: number | null = null;

  /** The structure currently aimed for a build edit (emissive highlight). */
  private editTargetId: string | null = null;
  private editPreviewMesh: AbstractMesh | null = null;
  private editPreviewMaterial: StandardMaterial | null = null;
  /** The structure the half-wall result preview is shown for (self-cleanup). */
  private editPreviewStructureId: string | null = null;

  /**
   * The local player's session ID. Structures owned by this session receive
   * the local-owner accent; all others receive the remote-owner accent.
   * Set by the GameRuntime when the connection is established.
   */
  private localSessionId: string | null = null;

  private structures = new Map<string, StructureRuntime>();

  /** Structures awaiting destruction animation completion before mesh disposal. */
  private pendingDestruction = new Map<string, { mesh: AbstractMesh; material: StandardMaterial; effects: StructureEffects; scaleY: number; baseEmissive: Color3; /** Composed visual alpha at destruction start (interrupted build-ups fade from their current transparency instead of popping to opaque). */ startAlpha: number }>();

  /**
   * Fingerprint of the last synced state (keyed by structureId). Lets the
   * per-frame `syncStructures` call take an allocation-free fast path when
   * the authoritative state has not changed.
   */
  private readonly _fingerprints = new Map<string, StructureFingerprint>();
  /** Reusable composition buffer for the per-frame tick (no per-frame allocation). */
  private readonly _composed = createComposedVisual();
  /** Reusable emissive scratch color for the per-frame tick. */
  private readonly _tempEmissive = new Color3(0, 0, 0);
  /** Previous frame's edit-target id (for detecting edit-target changes). */
  private _prevEditTargetId: string | null = null;

  private readonly _observer: Observer<Scene>;

  constructor(scene: Scene) {
    this.scene = scene;
    this._observer = scene.onBeforeRenderObservable.add(() => this._tick());
  }

  /**
   * Show (or re-target) the grid-snapped placement preview. The ghost eases
   * toward the new cell/rotation in the render tick; the first appearance
   * snaps directly (no ease from an arbitrary previous state).
   */
  public showPreview(
    buildType: BuildType,
    grid: GridPosition,
    rotation: GridRotation,
    valid: boolean,
  ): void {
    if (this.disposed) return;

    const worldPos = gridToWorld(grid);
    const effectiveHeight = getEffectiveHeight(buildType);
    this.previewTargetPos.set(
      worldPos.x,
      worldPos.y + effectiveHeight / 2,
      worldPos.z,
    );
    // The canonical ghost already encodes its rotation (see createStructureMesh).
    this.previewTargetRotY = 0;
    const color = valid ? PREVIEW_VALID_COLOR : PREVIEW_INVALID_COLOR;

    const hadPreview = this.previewMesh !== null;

    if (this.previewMesh && (this.previewBuildType !== buildType || this.previewRotation !== rotation)) {
      this.disposePreview();
    }

    if (!this.previewMesh) {
      const mesh = createStructureMesh(
        this.scene,
        "build-preview",
        buildType,
        grid,
        rotation,
      );
      const mat = new StandardMaterial("build-preview-material", this.scene);
      mat.alpha = valid ? PREVIEW_OPACITY_BASE : PREVIEW_INVALID_OPACITY_BASE;
      mat.diffuseColor = color;
      mat.emissiveColor = color;
      mat.specularColor = new Color3(0, 0, 0);
      mesh.material = mat;
      for (const part of mesh.getChildMeshes()) part.material = mat;
      // Snap directly to the target on first appearance.
      mesh.position.copyFrom(this.previewTargetPos);
      mesh.rotation.y = this.previewTargetRotY;
      this.previewMesh = mesh;
      this.previewMaterial = mat;
      this.previewBuildType = buildType;
      this.previewRotation = rotation;
      this.createPreviewCellMarker(worldPos.x, worldPos.z, color);
    } else {
      // Re-target: the render tick eases the ghost toward the new cell and
      // rotation instead of teleporting it.
      if (this.previewMaterial) {
        this.previewMaterial.diffuseColor = color;
        this.previewMaterial.emissiveColor = color;
      }
      if (this.previewCellMaterial) {
        this.previewCellMaterial.diffuseColor = color;
        this.previewCellMaterial.emissiveColor = color;
      }
    }

    // Clearer rejected-placement feedback: a short opacity blink when an
    // existing preview transitions from a valid to an invalid candidate.
    if (hadPreview && !valid && this.previewValid) {
      this.previewDeniedBlink = createAnimation(
        Date.now(),
        PREVIEW_DENIED_BLINK_DURATION,
      );
    }
    this.previewValid = valid;
  }

  /** Hide the placement preview. */
  public hidePreview(): void {
    this.disposePreview();
  }

  /**
   * Highlight the structure currently aimed for a build edit (a subtle
   * green emissive boost on its existing mesh). Idempotent — the same id
   * keeps the highlight; the boost is recomposed every frame.
   */
  public showEditTarget(structureId: string): void {
    if (this.disposed) return;
    this.editTargetId = structureId;
  }

  /** Remove the build-edit target highlight. */
  public hideEditTarget(): void {
    this.editTargetId = null;
  }

  /**
   * Show a semi-transparent ghost of the half-wall *result* shape (the top
   * or bottom half of the wall) at the target's position — the shape the
   * structure will have once the edit is accepted. Walls only: the renderer
   * models half-wall results for walls, so the preview is hidden for other
   * build types.
   */
  public showEditResultPreview(
    structureId: string,
    pose: "half_top" | "half_bottom",
    rotation: GridRotation,
  ): void {
    if (this.disposed) return;
    const runtime = this.structures.get(structureId);
    if (!runtime || runtime.buildType !== "wall") {
      this.disposeEditPreview();
      return;
    }
    const [w, h, d] = getFootprintWorldDims(runtime.buildType);
    if (!this.editPreviewMesh || !this.editPreviewMaterial) {
      const mesh = MeshBuilder.CreateBox("build-edit-result-preview", {
        width: w,
        height: h / 2,
        // Match the canonical wall panel's full depth (the panel is thin,
        // not a thick slab).
        depth: d * 0.15,
      }, this.scene);
      const mat = new StandardMaterial(
        "build-edit-result-preview-material",
        this.scene,
      );
      mat.diffuseColor = EDIT_PREVIEW_COLOR;
      mat.emissiveColor = EDIT_PREVIEW_COLOR;
      mat.specularColor = new Color3(0, 0, 0);
      mat.alpha = EDIT_PREVIEW_OPACITY;
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      this.editPreviewMesh = mesh;
      this.editPreviewMaterial = mat;
    }
    const worldPos = gridToWorld(runtime.grid);
    const offset = pose === "half_top" ? h / 4 : -h / 4;
    this.editPreviewMesh.position.set(
      worldPos.x,
      worldPos.y + h / 2 + offset,
      worldPos.z,
    );
    this.editPreviewMesh.rotation.y =
      rotation === 0 ? 0 : rotationToYAxis(rotation);
    this.editPreviewStructureId = structureId;
  }

  /** Hide the half-wall result preview. */
  public hideEditResultPreview(): void {
    this.disposeEditPreview();
  }

  private disposeEditPreview(): void {
    if (this.editPreviewMesh) {
      this.editPreviewMesh.dispose();
      this.editPreviewMesh = null;
    }
    if (this.editPreviewMaterial) {
      this.editPreviewMaterial.dispose();
      this.editPreviewMaterial = null;
    }
    this.editPreviewStructureId = null;
  }

  private disposePreview(): void {
    if (this.previewMesh) {
      this.previewMesh.dispose();
      this.previewMesh = null;
    }
    if (this.previewMaterial) {
      this.previewMaterial.dispose();
      this.previewMaterial = null;
    }
    if (this.previewCellMesh) {
      this.previewCellMesh.dispose();
      this.previewCellMesh = null;
    }
    if (this.previewCellMaterial) {
      this.previewCellMaterial.dispose();
      this.previewCellMaterial = null;
    }
    this.previewBuildType = null;
    this.previewRotation = null;
    this.previewValid = true;
    this.previewDeniedBlink = null;
  }

  /**
   * Lazily create the low-opacity ground marker for the snapped preview cell.
   * Reused while the preview is visible; disposed with it.
   */
  private createPreviewCellMarker(x: number, z: number, color: Color3): void {
    if (this.previewCellMesh) return;
    const size = BUILD_GRID.cellSize * PREVIEW_CELL_MARKER_SIZE;
    const mesh = MeshBuilder.CreateBox("build-preview-cell", {
      width: size,
      height: 0.02,
      depth: size,
    }, this.scene);
    const mat = new StandardMaterial("build-preview-cell-material", this.scene);
    mat.diffuseColor = color;
    mat.emissiveColor = color;
    mat.specularColor = new Color3(0, 0, 0);
    mat.alpha = PREVIEW_CELL_MARKER_ALPHA;
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.position.set(x, 0.011, z);
    this.previewCellMesh = mesh;
    this.previewCellMaterial = mat;
  }

  /**
   * Synchronize scene structure meshes with the authoritative
   * `BuildingState`. Creates new meshes (with construction animation),
   * removes stale ones (with destruction animation), and updates positions
   * and edit shapes if needed. Idempotent.
   */
  public syncStructures(state: BuildingState): void {
    if (this.disposed) return;

    // Fast path: the per-frame sync call is usually unchanged state. Compare
    // the incoming structures against the last fingerprint (no allocation) —
    // identical id set + identical poses means no mesh work at all.
    let identical = true;
    let count = 0;
    for (const key in state.structures) {
      const s = state.structures[key];
      count += 1;
      if (identical) {
        const fp = this._fingerprints.get(s.structureId);
        if (
          fp === undefined ||
          fp.buildType !== s.buildType ||
          fp.x !== s.grid.x ||
          fp.y !== s.grid.y ||
          fp.z !== s.grid.z ||
          fp.rotation !== s.rotation ||
          fp.geometryKey !== geometryKey(s)
        ) {
          identical = false;
        }
      }
    }
    if (identical && count === this._fingerprints.size) {
      return;
    }

    const now = Date.now();
    const currentIds = new Set<string>();

    for (const structure of Object.values(state.structures)) {
      currentIds.add(structure.structureId);
      const existing = this.structures.get(structure.structureId);

      if (!existing) {
        this.createStructure(structure, now);
      } else {
    this.updateStructure(existing, structure);
      }
    }

    // Detect removed structures → start destruction animation
    for (const [id, runtime] of this.structures) {
      if (!currentIds.has(id)) {
        this.startDestruction(id, runtime, now);
      }
    }

    // Self-clean build-edit presentation for vanished structures.
    if (this.editTargetId !== null && !currentIds.has(this.editTargetId)) {
      this.editTargetId = null;
    }
    if (
      this.editPreviewStructureId !== null &&
      !currentIds.has(this.editPreviewStructureId)
    ) {
      this.disposeEditPreview();
    }

    // Refresh the no-change fast path cache (mirrors `this.structures`).
    this._fingerprints.clear();
    for (const structure of Object.values(state.structures)) {
      this._fingerprints.set(structure.structureId, {
        buildType: structure.buildType,
        x: structure.grid.x,
        y: structure.grid.y,
        z: structure.grid.z,
        rotation: structure.rotation,
        geometryKey: geometryKey(structure),
      });
    }
  }

  /**
   * Set the local player's session ID so structures can be tinted with an
   * ownership accent. Structures whose `ownerId` matches this session get
   * the local-owner accent; all others get the remote-owner accent.
   *
   * When the session ID changes (reconnect), the accent is recomputed for
   * every live structure and the materials are marked dirty so the next
   * tick applies the new accent. Safe to call with `null` (clears all
   * local-owner accents — every structure becomes "remote").
   */
  public setLocalSessionId(sessionId: string | null): void {
    if (this.disposed) return;
    if (sessionId === this.localSessionId) return;
    this.localSessionId = sessionId;
    for (const runtime of this.structures.values()) {
      runtime.isLocalOwner = sessionId !== null && runtime.ownerId === sessionId;
      runtime.dirty = true;
    }
  }

  /**
   * Update the durability (damage state) of a single structure, tinting
   * its mesh material to visually reflect the damage. Triggers a hit flash
   * when durability decreases.
   */
  public updateStructureDurability(
    structureId: string,
    durability: StructureDurabilityState,
  ): void {
    if (this.disposed) return;

    const runtime = this.structures.get(structureId);
    if (!runtime) return;

    // The per-frame caller re-applies the mirrored durability every frame;
    // when nothing changed there is no tint or flash work to do.
    const last = runtime.durability;
    if (
      last !== null &&
      last.currentDurability === durability.currentDurability &&
      last.maxDurability === durability.maxDurability
    ) {
      return;
    }

    // Detect hit: durability decreased from a positive value
    if (runtime.prevDurability > 0 && durability.currentDurability < runtime.prevDurability) {
      triggerHitFlash(runtime.effects, Date.now());
    }

    runtime.prevDurability = durability.currentDurability;
    runtime.durability = durability;
    runtime.dirty = true;
    this.applyDurabilityTint(runtime);
  }

  /**
   * Dispose all owned meshes and materials.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.scene.onBeforeRenderObservable.remove(this._observer);
    this.disposePreview();
    this.disposeEditPreview();
    this.editTargetId = null;

    for (const runtime of this.structures.values()) {
      runtime.mesh.dispose();
      runtime.material.dispose();
    }
    this.structures.clear();
    this._fingerprints.clear();

    for (const pending of this.pendingDestruction.values()) {
      pending.mesh.dispose();
      pending.material.dispose();
    }
    this.pendingDestruction.clear();
  }

  // ─── Private: structure lifecycle ────────────────────────────────────────

  private createStructure(structure: StructureState, now: number): void {
    const mesh = createReplicatedMesh(this.scene, structure);
    const mat = new StandardMaterial(
      `structure-material-${structure.structureId}`,
      this.scene,
    );
    // Clone the shared constants: the per-frame tick mutates the material's
    // diffuse/emissive colors in place, so every structure needs its own
    // Color3 instances (aliasing SOLID_COLORS/SOLID_EMISSIVE would corrupt
    // the module constants and every other structure's material).
    const solidColor = SOLID_COLORS[structure.buildType] ?? new Color3(0.5, 0.5, 0.5);
    mat.diffuseColor = solidColor.clone();
    mat.emissiveColor = SOLID_EMISSIVE.clone();
    mat.specularColor = new Color3(0.15, 0.15, 0.15);
    mesh.material = mat;
    for (const child of mesh.getChildMeshes(false)) child.material = mat;

    const effects = createConstructionEffects(now);

    const baseColor = SOLID_COLORS[structure.buildType] ?? new Color3(0.5, 0.5, 0.5);
    const runtime: StructureRuntime = {
      mesh,
      material: mat,
      buildType: structure.buildType,
      effects,
      targetScaleY: 1,
      targetYOffset: 0,
      grid: { ...structure.grid },
      durability: null,
      prevDurability: 0,
      baseDiffuse: baseColor.clone(),
      dirty: true,
      ownerId: structure.ownerId,
      isLocalOwner: this.localSessionId !== null && structure.ownerId === this.localSessionId,
      geometryKey: geometryKey(structure),
    };

    this.structures.set(structure.structureId, runtime);
  }

  private updateStructure(runtime: StructureRuntime, structure: StructureState): void {
    // Update grid position (may have moved) — written in place (the runtime
    // owns its grid object; the protocol state is re-read fresh each sync).
    const grid = runtime.grid;
    const incoming = structure.grid;
    const gridChanged = grid.x !== incoming.x || grid.y !== incoming.y || grid.z !== incoming.z;
    grid.x = incoming.x;
    grid.y = incoming.y;
    grid.z = incoming.z;
    if (gridChanged) {
      runtime.dirty = true;
    }

    const nextGeometryKey = geometryKey(structure);
    if (nextGeometryKey !== runtime.geometryKey || gridChanged) {
      fillStructureVisual(this.scene, runtime.mesh, structure.structureId, structure);
      runtime.geometryKey = nextGeometryKey;
      runtime.dirty = true;
    }
  }

  private startDestruction(id: string, runtime: StructureRuntime, now: number): void {
    const effects = createDestructionEffects(now);
    // Persist the base emissive for the pending-destruction tick (one
    // allocation per destruction event, not per frame).
    const baseEmissive = this._computeBaseEmissive(runtime, now, this._tempEmissive).clone();
    // Capture the current visual alpha so a build-up interrupted mid-
    // construction fades from its actual (partially transparent) state
    // rather than popping to opaque. Completed builds compose to 1, so the
    // normal destruction fade is unchanged.
    composeVisualInto(
      runtime.effects,
      runtime.targetScaleY,
      runtime.targetYOffset,
      now,
      this._composed,
    );
    const startAlpha = this._composed.alpha;
    this.pendingDestruction.set(id, {
      mesh: runtime.mesh,
      material: runtime.material,
      effects,
      scaleY: runtime.targetScaleY,
      baseEmissive,
      startAlpha,
    });
    // Reset diffuse to base (clear any active hit-flash boost)
    runtime.material.diffuseColor = runtime.baseDiffuse.clone();
    this.structures.delete(id);
  }

  // ─── Private: durability tint ────────────────────────────────────────────

  /**
   * Apply a durability-based diffuse tint to a structure's material.
   * Emissive is computed per-frame in _tick to allow hit flash overlay.
   */
  private applyDurabilityTint(runtime: StructureRuntime): void {
    const durability = runtime.durability;
    if (!durability) return;

    const baseColor = SOLID_COLORS[runtime.buildType] ?? new Color3(0.5, 0.5, 0.5);
    const maxDur = Math.max(1, durability.maxDurability);
    const fraction = Math.max(0, Math.min(1, durability.currentDurability / maxDur));
    const damage = 1 - fraction;
    // Non-linear tint: subtle at high durability, aggressive at low durability
    const tintAmount = Math.pow(damage, 1.5);
    runtime.baseDiffuse = lerpColor(baseColor, DAMAGED_COLOR, tintAmount);
  }

  // ─── Private: per-frame tick ─────────────────────────────────────────────

  /**
   * Called every frame by the scene render observer.
   * Advances all animations and applies composed visuals to meshes.
   */
  private _tick(): void {
    if (this.disposed) return;
    const now = Date.now();
    // Frame delta for the frame-rate-independent ghost easing (clamped so a
    // paused tab never produces a giant jump).
    const dtSec =
      this._lastTickMs === null
        ? 0
        : Math.min(0.05, Math.max(0, (now - this._lastTickMs) / 1000));
    this._lastTickMs = now;
    const prevEditTarget = this._prevEditTargetId;
    const curEditTarget = this.editTargetId;

    // Update structure meshes — skip static structures (no active effects,
    // no warning pulse, no pending state change) to avoid redundant writes.
    for (const [id, runtime] of this.structures) {
      const isEditTargeted = id === curEditTarget;
      const editTargetChanged = isEditTargeted !== (id === prevEditTarget);
      const static_ = this._isStatic(runtime);

      if (!editTargetChanged && !runtime.dirty && static_) {
        continue;
      }

      this._applyRuntimeVisual(runtime, now, isEditTargeted);

      if (static_) {
        runtime.dirty = false;
      }
    }
    this._prevEditTargetId = curEditTarget;

    // Update pending destruction meshes
    const toRemove: string[] = [];
    for (const [id, pending] of this.pendingDestruction) {
      const { shouldRemove } = composeVisualInto(
        pending.effects,
        1,
        0,
        now,
        this._composed,
      );
      const visual = this._composed;
      pending.mesh.scaling.set(
        visual.uniformScale,
        visual.uniformScale * pending.scaleY,
        visual.uniformScale,
      );
      pending.material.alpha = visual.alpha * pending.startAlpha;
      // Write the boost into the existing material color (no allocation).
      const emissive = pending.material.emissiveColor;
      emissive.copyFrom(pending.baseEmissive);
      emissive.r += visual.emissiveBoost[0];
      emissive.g += visual.emissiveBoost[1];
      emissive.b += visual.emissiveBoost[2];
      if (shouldRemove) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      const pending = this.pendingDestruction.get(id)!;
      pending.mesh.dispose();
      pending.material.dispose();
      this.pendingDestruction.delete(id);
    }

    // Update preview: eased ghost movement + pulsing opacity + grid marker.
    if (this.previewMesh && this.previewMaterial) {
      // Smooth ghost movement: ease position toward the snapped target and
      // rotate along the shortest arc (clean rotation feedback).
      if (dtSec > 0) {
        const a = 1 - Math.exp(-PREVIEW_SMOOTHING_RATE * dtSec);
        const pos = this.previewMesh.position;
        pos.x += (this.previewTargetPos.x - pos.x) * a;
        pos.y += (this.previewTargetPos.y - pos.y) * a;
        pos.z += (this.previewTargetPos.z - pos.z) * a;
        let dRot = this.previewTargetRotY - this.previewMesh.rotation.y;
        while (dRot > Math.PI) dRot -= Math.PI * 2;
        while (dRot < -Math.PI) dRot += Math.PI * 2;
        this.previewMesh.rotation.y += dRot * a;
      }

      // The ground cell marker tracks the snapped (smoothed) cell.
      if (this.previewCellMesh) {
        this.previewCellMesh.position.x = this.previewMesh.position.x;
        this.previewCellMesh.position.z = this.previewMesh.position.z;
      }

      // Opacity pulse: valid = calm, invalid = faster and wider (clearer
      // rejected-placement feedback), plus a one-shot blink on the
      // valid→invalid transition.
      const base = this.previewValid ? PREVIEW_OPACITY_BASE : PREVIEW_INVALID_OPACITY_BASE;
      const amp = this.previewValid ? PREVIEW_OPACITY_PULSE : PREVIEW_INVALID_OPACITY_PULSE;
      const freq = this.previewValid ? PREVIEW_PULSE_FREQ : PREVIEW_INVALID_PULSE_FREQ;
      const pulse = Math.sin((now / 1000) * freq * Math.PI * 2);
      let alpha = base + amp * pulse;
      if (this.previewDeniedBlink && !this.previewDeniedBlink.done) {
        const t = animationProgress(this.previewDeniedBlink, now);
        alpha += (1 - t) * PREVIEW_DENIED_BLINK_STRENGTH;
      }
      this.previewMaterial.alpha = alpha;
    }
  }

  private _applyRuntimeVisual(
    runtime: StructureRuntime,
    now: number,
    isEditTargeted: boolean,
  ): void {
    composeVisualInto(
      runtime.effects,
      runtime.targetScaleY,
      runtime.targetYOffset,
      now,
      this._composed,
    );
    const visual = this._composed;

    // Compose scaling: uniform * (1, scaleY, 1)
    runtime.mesh.scaling.set(
      visual.uniformScale,
      visual.uniformScale * visual.scaleY,
      visual.uniformScale,
    );

    // Position: base world position + yOffset (half-wall shift), written
    // in place (the cached grid is the single source; no per-frame vector).
    const grid = runtime.grid;
    runtime.mesh.position.set(
      grid.x * BUILD_GRID.cellSize,
      grid.y * BUILD_GRID.layerHeight +
        getEffectiveHeight(runtime.buildType) / 2 +
        visual.yOffset,
      grid.z * BUILD_GRID.cellSize,
    );

    // Alpha (for destruction fade — though destruction is in pendingDestruction)
    runtime.material.alpha = visual.alpha;

    // Diffuse: base (durability-tinted) + hit-flash white-shift, written in
    // place so no per-frame Color3 is allocated.
    const d = visual.diffuseBoost;
    const diffuse = runtime.material.diffuseColor;
    diffuse.copyFrom(runtime.baseDiffuse);
    diffuse.r += d[0];
    diffuse.g += d[1];
    diffuse.b += d[2];

    // Emissive: base (incl. warning pulse) + transient boost + build-edit
    // target boost + acceptance-confirmation glow, written in place.
    const baseEmissive = this._computeBaseEmissive(runtime, now, this._tempEmissive);
    const e = visual.emissiveBoost;
    const confirm = visual.confirmStrength;
    const emissive = runtime.material.emissiveColor;
    emissive.copyFrom(baseEmissive);
    emissive.r += e[0] + (isEditTargeted ? EDIT_TARGET_EMISSIVE_BOOST[0] : 0) + confirm * CONFIRM_GLOW[0];
    emissive.g += e[1] + (isEditTargeted ? EDIT_TARGET_EMISSIVE_BOOST[1] : 0) + confirm * CONFIRM_GLOW[1];
    emissive.b += e[2] + (isEditTargeted ? EDIT_TARGET_EMISSIVE_BOOST[2] : 0) + confirm * CONFIRM_GLOW[2];
  }

  /**
   * Returns true when the structure needs no per-frame work: all transient
   * effects are complete and the durability is above the warning-pulse
   * threshold (or absent).
   */
  private _isStatic(runtime: StructureRuntime): boolean {
    const e = runtime.effects;
    if (e.construction && !e.construction.done) return false;
    if (e.confirmation && !e.confirmation.done) return false;
    if (e.hitFlash && !e.hitFlash.done) return false;
    if (e.editTransition && !e.editTransition.done) return false;
    if (runtime.durability) {
      const maxDur = Math.max(1, runtime.durability.maxDurability);
      const fraction = runtime.durability.currentDurability / maxDur;
      if (fraction <= NEARLY_BROKEN_THRESHOLD) return false;
    }
    return true;
  }

  private _computeBaseEmissive(
    runtime: StructureRuntime,
    now: number,
    out: Color3,
  ): Color3 {
    const durability = runtime.durability;
    if (!durability) {
      out.copyFrom(SOLID_EMISSIVE);
    } else {
      const maxDur = Math.max(1, durability.maxDurability);
      const fraction = Math.max(0, Math.min(1, durability.currentDurability / maxDur));
      const damage = 1 - fraction;
      const tintAmount = Math.pow(damage, 1.5);
      // Lerp into `out` in place (no allocation).
      out.copyFrom(SOLID_EMISSIVE);
      out.r += (DAMAGED_EMISSIVE.r - SOLID_EMISSIVE.r) * tintAmount;
      out.g += (DAMAGED_EMISSIVE.g - SOLID_EMISSIVE.g) * tintAmount;
      out.b += (DAMAGED_EMISSIVE.b - SOLID_EMISSIVE.b) * tintAmount;

      // Warning pulse for nearly-broken structures (deterministic, time-based)
      if (fraction <= NEARLY_BROKEN_THRESHOLD) {
        const severity = (NEARLY_BROKEN_THRESHOLD - fraction) / NEARLY_BROKEN_THRESHOLD;
        const pulse = 0.5 + 0.5 * Math.sin((now / 1000) * WARNING_PULSE_FREQ * Math.PI * 2);
        const w = severity * pulse * WARNING_PULSE_STRENGTH;
        out.r += w;
        out.g += w * 0.4;
      }
    }

    // Ownership accent: subtle constant emissive shift so the player can
    // distinguish their own builds from the opponent's at a glance.
    const accent = runtime.isLocalOwner ? LOCAL_OWNER_ACCENT : REMOTE_OWNER_ACCENT;
    out.r += accent[0];
    out.g += accent[1];
    out.b += accent[2];

    return out;
  }
}
