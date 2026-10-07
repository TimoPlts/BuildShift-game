/**
 * Reusable presentation component for production combat feedback.
 *
 * Exposes a small imperative API that a game runtime can call to:
 *   1. Trigger a brief muzzle flash at a world-space position, with
 *      visibly different timing / shape / scale per weapon type.
 *   2. Trigger a short center-screen hit marker after a confirmed hit.
 *   3. Dispose all owned meshes, materials, and scene observers.
 *
 * The component uses only Babylon primitives and materials—no external assets.
 * It does not make gameplay decisions, send network messages, change weapon
 * state, or listen for browser input.
 */
import type { WeaponType } from "@buildshift/protocol";
import type { Scene, Mesh, Observer } from "@babylonjs/core";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";

// ─── Internal effect state ───────────────────────────────────────────────────

interface ActiveEffect {
  mesh: Mesh;
  material: StandardMaterial;
  createdAtMs: number;
  durationMs: number;
}

/** Configuration for muzzle flash variants. */
interface MuzzleFlashConfig {
  durationMs: number;
  shape: "sphere" | "disc";
  /** Radius of the created mesh. */
  radius: number;
  color: Color3;
}

const ASSAULT_RIFLE_CONFIG: MuzzleFlashConfig = {
  durationMs: 60,
  shape: "sphere",
  radius: 0.04,
  color: new Color3(1.0, 0.92, 0.55), // warm white-yellow
};

const SHOTGUN_CONFIG: MuzzleFlashConfig = {
  durationMs: 120,
  shape: "disc",
  radius: 0.11,
  color: new Color3(1.0, 0.75, 0.3), // warmer orange
};

const HIT_MARKER_DURATION_MS = 200;
const HIT_MARKER_RADIUS = 0.03;
const HIT_MARKER_COLOR = new Color3(1.0, 1.0, 1.0);

// ─── Public API ──────────────────────────────────────────────────────────────

export class CombatFeedback {
  private readonly _scene: Scene;
  private readonly _effects: ActiveEffect[] = [];
  private readonly _observer: Observer<Scene>;
  private _disposed = false;

  constructor(scene: Scene) {
    this._scene = scene;
    this._observer = scene.onBeforeRenderObservable.add((_s) => this._tick());
  }

  /**
   * Trigger a brief muzzle flash at the given world-space position.
   * The visual differs per weapon type (shape, scale, duration, color).
   */
  triggerMuzzleFlash(weaponType: WeaponType, muzzlePosition: Vector3): void {
    if (this._disposed) return;

    const config = weaponType === "assault_rifle" ? ASSAULT_RIFLE_CONFIG : SHOTGUN_CONFIG;
    const mesh = this._createMuzzleMesh(config, muzzlePosition);
    const material = this._createFlashMaterial(config.color);
    mesh.material = material;

    this._effects.push({
      mesh,
      material,
      createdAtMs: Date.now(),
      durationMs: config.durationMs,
    });
  }

  /**
   * Trigger a short center-screen hit marker.
   * The marker is billboarded to the active camera so it stays centered
   * in screen-space.
   */
  triggerHitMarker(): void {
    if (this._disposed) return;

    const camera = this._scene.activeCamera;
    if (!camera) return;

    const forward = camera.getForwardRay().direction;
    const pos = camera.globalPosition.add(forward.scale(1.5));

    const disc = CreateDisc(
      "combat-feedback-hitmarker",
      { tessellation: 16, radius: HIT_MARKER_RADIUS },
      this._scene
    );
    disc.position.copyFrom(pos);
    disc.billboardMode = 7; // BILLBOARDMODE_ALL

    const material = this._createFlashMaterial(HIT_MARKER_COLOR);
    disc.material = material;

    this._effects.push({
      mesh: disc,
      material,
      createdAtMs: Date.now(),
      durationMs: HIT_MARKER_DURATION_MS,
    });
  }

  /**
   * Dispose all meshes, materials, and observers owned by this component.
   * Safe to call multiple times.
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this._scene.onBeforeRenderObservable.remove(this._observer);

    for (const fx of this._effects) {
      fx.mesh.dispose();
      fx.material.dispose();
    }
    this._effects.length = 0;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private _tick(): void {
    if (this._effects.length === 0) return;

    const now = Date.now();

    for (let i = this._effects.length - 1; i >= 0; i--) {
      const fx = this._effects[i];
      const elapsed = now - fx.createdAtMs;

      if (elapsed >= fx.durationMs) {
        fx.mesh.dispose();
        fx.material.dispose();
        this._effects.splice(i, 1);
      } else {
        fx.material.alpha = 1 - elapsed / fx.durationMs;
      }
    }
  }

  private _createMuzzleMesh(config: MuzzleFlashConfig, position: Vector3): Mesh {
    if (config.shape === "sphere") {
      const sphere = CreateSphere(
        "combat-feedback-muzzle",
        { diameter: config.radius * 2, segments: 8 },
        this._scene
      );
      sphere.position.copyFrom(position);
      return sphere;
    }
    const disc = CreateDisc(
      "combat-feedback-muzzle",
      { tessellation: 12, radius: config.radius },
      this._scene
    );
    disc.position.copyFrom(position);
    disc.billboardMode = 7; // BILLBOARDMODE_ALL
    return disc;
  }

  private _createFlashMaterial(color: Color3): StandardMaterial {
    const mat = new StandardMaterial("combat-feedback-flash", this._scene);
    mat.diffuseColor = color;
    mat.emissiveColor = color;
    mat.disableLighting = true;
    mat.alpha = 1.0;
    mat.backFaceCulling = false;
    return mat;
  }
}
