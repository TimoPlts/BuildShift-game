/**
 * movementDust — a small, bounded, reused dust-burst pool for movement
 * presentation (Babylon only).
 *
 * Every activation reuses one of a fixed set of pre-created flat-disc slots
 * (round-robin), so arbitrary jump/land spam can never grow meshes or
 * materials. Each slot fades out and spreads slightly over its activation
 * duration, then becomes reusable. The pool is driven by a single
 * {@link MovementDust.tick} from its owner component (MovementFeedback) and
 * is disposed together with it.
 *
 * Presentation only: this module never decides when a jump or landing
 * happened and never touches gameplay state.
 */
import type { Scene } from "@babylonjs/core";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

export const MOVEMENT_DUST_NAME_PREFIX = "movement-feedback-dust";

/** Tuning for the dust burst (presentation only). */
export interface MovementDustConfig {
  /** Fixed number of reusable disc slots. */
  readonly slotCount: number;
  /** Effect lifetime at zero intensity (ms). */
  readonly baseDurationMs: number;
  /** Extra lifetime (ms) added at full intensity. */
  readonly intensityDurationMs: number;
  /** Peak alpha at zero intensity. */
  readonly baseAlpha: number;
  /** Extra peak alpha added at full intensity. */
  readonly intensityAlpha: number;
  /** Disc scale at zero intensity (diameter 1 base mesh). */
  readonly baseScale: number;
  /** Extra scale at full intensity. */
  readonly intensityScale: number;
  /** Extra growth factor applied by end of life (dust spreading out). */
  readonly growthFactor: number;
  /** Small lift (m) so the disc rests on the ground surface. */
  readonly groundEpsilon: number;
}

export const DEFAULT_MOVEMENT_DUST_CONFIG: MovementDustConfig = {
  slotCount: 6,
  baseDurationMs: 300,
  intensityDurationMs: 150,
  baseAlpha: 0.3,
  intensityAlpha: 0.25,
  baseScale: 0.55,
  intensityScale: 0.35,
  growthFactor: 0.45,
  groundEpsilon: 0.02,
} as const;

/** Neutral, unlit dust tint (a soft warm gray readable against the arena). */
const DUST_TINT = new Color3(0.62, 0.58, 0.52);

/**
 * Deterministic per-slot radial offsets (m) around the ground point. Fixed
 * per slot (not random) so bursts read slightly scattered while tests stay
 * deterministic. Round-robin activation spreads consecutive bursts apart.
 */
const DUST_SPREAD: ReadonlyArray<readonly [number, number]> = [
  [0.16, 0.06],
  [-0.15, 0.1],
  [0.05, -0.18],
  [-0.08, 0.16],
  [0.14, -0.12],
  [-0.13, -0.13],
];

interface DustSlot {
  readonly mesh: Mesh;
  readonly material: StandardMaterial;
  active: boolean;
  activatedAtMs: number;
  durationMs: number;
  startAlpha: number;
  startScale: number;
}

export class MovementDust {
  private readonly slots: DustSlot[] = [];
  private readonly config: MovementDustConfig;
  private nextSlot = 0;
  private _disposed = false;

  public constructor(scene: Scene, config: MovementDustConfig = DEFAULT_MOVEMENT_DUST_CONFIG) {
    this.config = config;
    for (let i = 0; i < config.slotCount; i += 1) {
      this.slots.push(this.createSlot(scene, i));
    }
  }

  /** Number of slots currently mid-fade. */
  public get activeCount(): number {
    let count = 0;
    for (const slot of this.slots) {
      if (slot.active) count += 1;
    }
    return count;
  }

  /** The fixed pool size (never grows). */
  public get slotCount(): number {
    return this.slots.length;
  }

  /**
   * Activate the next slot (round-robin) at the given ground point.
   * `intensity` is clamped to [0, 1] and scales alpha, size, and lifetime.
   * If a slot is still fading, its previous effect is overwritten.
   */
  public spawn(
    groundX: number,
    groundY: number,
    groundZ: number,
    intensity: number,
    nowMs: number,
  ): DustSlot | null {
    if (this._disposed) return null;

    const t = Math.min(1, Math.max(0, intensity));
    const index = this.nextSlot % this.slots.length;
    const slot = this.slots[index];
    this.nextSlot = (this.nextSlot + 1) % this.slots.length;

    const [ox, oz] = DUST_SPREAD[index % DUST_SPREAD.length];
    slot.mesh.position.set(groundX + ox, groundY + this.config.groundEpsilon, groundZ + oz);
    slot.startAlpha = this.config.baseAlpha + this.config.intensityAlpha * t;
    slot.startScale = this.config.baseScale + this.config.intensityScale * t;
    slot.durationMs = this.config.baseDurationMs + this.config.intensityDurationMs * t;
    slot.active = true;
    slot.activatedAtMs = nowMs;
    slot.material.alpha = slot.startAlpha;
    slot.mesh.scaling.setAll(slot.startScale);
    slot.mesh.setEnabled(true);
    return slot;
  }

  /**
   * Fade active slots (alpha linear down, scale gently up) and deactivate
   * expired ones.
   */
  public tick(nowMs: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      const elapsed = nowMs - slot.activatedAtMs;
      if (elapsed >= slot.durationMs) {
        this.deactivate(slot);
      } else {
        const t = elapsed / slot.durationMs;
        slot.material.alpha = Math.max(0, slot.startAlpha * (1 - t));
        slot.mesh.scaling.setAll(slot.startScale * (1 + this.config.growthFactor * t));
      }
    }
  }

  /** Immediately deactivate every slot without disposing anything. */
  public deactivateAll(): void {
    for (const slot of this.slots) {
      if (slot.active) this.deactivate(slot);
    }
  }

  /** Dispose every owned mesh and material. Idempotent. */
  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const slot of this.slots) {
      slot.mesh.dispose();
      slot.material.dispose();
    }
    this.slots.length = 0;
    this.nextSlot = 0;
  }

  private deactivate(slot: DustSlot): void {
    slot.active = false;
    slot.mesh.setEnabled(false);
    slot.material.alpha = 0;
  }

  private createSlot(scene: Scene, index: number): DustSlot {
    // A very flat cylinder: a visible "puddle" from the third-person angle
    // without any external assets.
    const mesh = CreateCylinder(
      `${MOVEMENT_DUST_NAME_PREFIX}-${index}`,
      { height: 0.02, diameter: 1, tessellation: 16 },
      scene,
    );
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.setEnabled(false);

    const material = new StandardMaterial(`${MOVEMENT_DUST_NAME_PREFIX}-mat-${index}`, scene);
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.alpha = 0;
    material.diffuseColor.copyFrom(DUST_TINT);
    material.emissiveColor.copyFrom(DUST_TINT);
    mesh.material = material;

    return {
      mesh,
      material,
      active: false,
      activatedAtMs: 0,
      durationMs: 0,
      startAlpha: 0,
      startScale: 1,
    };
  }
}
