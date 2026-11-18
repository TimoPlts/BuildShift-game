/**
 * PreparationBarrierPresentation — original temporary barrier visuals for
 * the pre-round build preparation strip (presentation ONLY).
 *
 * While preparation is active the local player sees translucent blue panels
 * sealing their assigned prep strip: one on the strip's INNER edge (facing
 * the arena centre) and one on the strip's OUTER boundary (the playable
 * arena edge behind the row). Both sides are told by the SAME authoritative
 * signal (`preparationActive` going false in `MatchPhase.COUNTDOWN` →
 * `IN_PROGRESS`) that the barriers vanish together when the arena opens —
 * there is no client-side timer here.
 *
 * Authority contract: the shared preparation zone
 * ({@link getPreparationZone}, CONTRACT.md §3) and the server movement clamp
 * are the ONLY gameplay authority. These panels are non-pickable, carry no
 * collider, and are never fed to the camera obstacle list — the player's
 * confinement is enforced by prediction + the server clamp, and after the
 * arena opens nothing here can block the camera or the player.
 *
 * Geometry is DERIVED, never hardcoded: the panel planes/extent come from
 * the shared zone + the authoritative playable arena bounds, and the panel
 * height from the actual build-volume ceiling
 * (`BUILD_BOUNDS.maxLayer × BUILD_GRID.layerHeight`, the top of the highest
 * buildable layer) down to `VERTICAL_MOVEMENT.groundY`.
 *
 * Lifecycle (no mesh/material growth):
 *  - `open(side)`  — creates at most two panel meshes + one material for the
 *    side (idempotent for the same side; replaces panels on side change).
 *  - `close()`     — disposes every panel mesh and the material; safe to
 *    call anytime (phase open, round reset, disconnect, leave).
 *  - `dispose()`   — `close()` + permanently inert. Idempotent.
 *
 * Visuals are original primitives (box + edge outline) with a blue
 * team-treatment tint — no floor grid, no props, no external assets.
 */
import type { Scene } from "@babylonjs/core";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { BUILD_BOUNDS, BUILD_GRID, PLAYABLE_ARENA_BOUNDS, VERTICAL_MOVEMENT } from "@buildshift/game-config";
import { getPreparationZone, type PreparationSide } from "./preparationContract";

/** Stable name prefix for owned meshes/materials (tests + leak checks). */
export const PREPARATION_BARRIER_NAME = "preparation-barrier-";

/** Panel slab thickness in metres — presentation-scale, non-colliding. */
const PANEL_THICKNESS = 0.12;

/** Translucent panel tint: readable blue "team gate" treatment. */
const PANEL_DIFFUSE = new Color3(0.16, 0.45, 0.95);
/** Panel opacity — clearly visible, clearly see-through. */
const PANEL_ALPHA = 0.32;
/** Panel border (edge outline) colour. */
const PANEL_EDGE = new Color4(0.45, 0.72, 1.0, 0.9);

/**
 * The top of the actual arena build volume (the highest buildable layer's
 * top face) — the height the temporary barriers reach. Derived from the
 * shared build geometry so it matches whatever ceiling the arena really has.
 */
export function preparationBarrierTopY(): number {
  return (BUILD_BOUNDS.maxLayer + 1) * BUILD_GRID.layerHeight;
}

/** Which panel planes one side needs. */
function panelXPositions(side: PreparationSide): { innerX: number; outerX: number } {
  const zone = getPreparationZone(side);
  return side === "negative"
    ? { innerX: zone.maxX, outerX: PLAYABLE_ARENA_BOUNDS.minX }
    : { innerX: zone.minX, outerX: PLAYABLE_ARENA_BOUNDS.maxX };
}

export class PreparationBarrierPresentation {
  private readonly scene: Scene;
  private side: PreparationSide | null = null;
  private panels: Mesh[] | null = null;
  private material: StandardMaterial | null = null;
  private disposed = false;

  public constructor(scene: Scene) {
    this.scene = scene;
  }

  /** The side whose barriers are currently presented, or null when closed. */
  public get openSide(): PreparationSide | null {
    return this.side;
  }

  /** Whether any barrier panels are currently presented. */
  public get isOpen(): boolean {
    return this.panels !== null;
  }

  /**
   * Present the barriers for `side`. Idempotent for the same side; opening
   * the other side replaces the panels. No-op after `dispose()`.
   */
  public open(side: PreparationSide): void {
    if (this.disposed) return;
    if (this.side === side && this.panels !== null) return;
    this.close();

    const zone = getPreparationZone(side);
    const { innerX, outerX } = panelXPositions(side);
    const groundY = VERTICAL_MOVEMENT.groundY;
    const topY = preparationBarrierTopY();
    const height = topY - groundY;
    // Panels span the strip's full allowed Z (the playable arena Z).
    const depth = zone.maxZ - zone.minZ;
    const centreZ = (zone.minZ + zone.maxZ) / 2;
    const centreY = groundY + height / 2;

    const material = new StandardMaterial(`${PREPARATION_BARRIER_NAME}mat`, this.scene);
    material.diffuseColor = PANEL_DIFFUSE;
    material.emissiveColor = PANEL_DIFFUSE.scale(0.35);
    material.alpha = PANEL_ALPHA;
    material.disableLighting = false;

    const makePanel = (name: string, x: number): Mesh => {
      const panel = MeshBuilder.CreateBox(
        `${PREPARATION_BARRIER_NAME}${name}`,
        { width: PANEL_THICKNESS, height, depth },
        this.scene,
      );
      panel.position.set(x, centreY, centreZ);
      panel.material = material;
      // Presentation only: never pickable, no collider, and not part of the
      // camera obstacle source (that reads the building store only).
      panel.isPickable = false;
      panel.enableEdgesRendering();
      panel.edgesWidth = 4;
      panel.edgesColor = PANEL_EDGE;
      return panel;
    };

    this.material = material;
    this.panels = [makePanel("inner", innerX), makePanel("outer", outerX)];
    this.side = side;
  }

  /**
   * Remove and dispose every barrier panel and material. Called when the
   * authoritative preparation ends (arena opens), on round reset, on
   * disconnect/leave, and from {@link dispose}. Safe when already closed.
   */
  public close(): void {
    if (this.panels) {
      for (const panel of this.panels) {
        panel.dispose(false, false);
      }
      this.panels = null;
    }
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
    this.side = null;
  }

  /** Idempotent permanent teardown. */
  public dispose(): void {
    if (this.disposed) return;
    this.close();
    this.disposed = true;
  }
}
