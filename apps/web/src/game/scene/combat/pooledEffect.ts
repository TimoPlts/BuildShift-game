/**
 * Small pooling machinery for short-lived Babylon presentation effects.
 *
 * A {@link PooledEffectGroup} owns a fixed set of effect slots (mesh +
 * material pairs) created up front. Activations always reuse an existing
 * slot (round-robin), so repeated triggers can never grow the scene graph.
 * Each slot fades out over its activation duration, then becomes reusable.
 *
 * The group is driven by a single per-frame {@link PooledEffectGroup.tick}
 * from its owner component (CombatFeedback), and is disposed together with
 * that component.
 */
import type { Scene, Mesh } from "@babylonjs/core";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

/** One reusable presentation slot: a mesh and its dedicated unlit material. */
export interface EffectSlot {
  mesh: Mesh;
  material: StandardMaterial;
  active: boolean;
  activatedAtMs: number;
  durationMs: number;
}

/** Creates a slot's unlit emissive material used for fade-out via `alpha`. */
export function createEffectMaterial(scene: Scene, name: string): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.disableLighting = true;
  material.alpha = 0;
  material.backFaceCulling = false;
  return material;
}

export class PooledEffectGroup {
  /** Every owned slot. Fixed length for the group's lifetime. */
  readonly slots: EffectSlot[] = [];
  private _nextSlotIndex = 0;

  constructor(createSlot: (index: number) => EffectSlot, slotCount: number) {
    for (let i = 0; i < slotCount; i++) {
      const slot = createSlot(i);
      // These meshes are short-lived presentation only. They must never be a
      // selectable surface for any gameplay raycast now or in the future.
      slot.mesh.isPickable = false;
      this.slots.push(slot);
    }
  }

  /** Number of slots currently mid-fade. */
  get activeCount(): number {
    let count = 0;
    for (const slot of this.slots) {
      if (slot.active) count++;
    }
    return count;
  }

  /**
   * Activate the next slot (round-robin; if the slot is still fading its
   * previous effect is overwritten) and pose it via `activate`.
   */
  spawn(nowMs: number, durationMs: number, activate: (slot: EffectSlot) => void): EffectSlot {
    const slot = this.slots[this._nextSlotIndex % this.slots.length];
    this._nextSlotIndex = (this._nextSlotIndex + 1) % this.slots.length;
    slot.active = true;
    slot.activatedAtMs = nowMs;
    slot.durationMs = durationMs;
    slot.material.alpha = 1;
    activate(slot);
    return slot;
  }

  /** Fade active slots and deactivate expired ones. */
  tick(nowMs: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      const elapsed = nowMs - slot.activatedAtMs;
      if (elapsed >= slot.durationMs) {
        this.deactivate(slot);
      } else {
        slot.material.alpha = Math.max(0, 1 - elapsed / slot.durationMs);
      }
    }
  }

  /** Immediately deactivate every slot without disposing anything. */
  deactivateAll(): void {
    for (const slot of this.slots) {
      if (slot.active) this.deactivate(slot);
    }
  }

  /** Dispose every owned mesh and material. Idempotent. */
  dispose(): void {
    for (const slot of this.slots) {
      slot.mesh.dispose();
      slot.material.dispose();
    }
    this.slots.length = 0;
    this._nextSlotIndex = 0;
  }

  private deactivate(slot: EffectSlot): void {
    slot.active = false;
    slot.mesh.setEnabled(false);
    slot.material.alpha = 0;
  }
}
