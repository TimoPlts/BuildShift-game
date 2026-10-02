/**
 * HealthHud — a DOM-based combat HUD for the Stage 2D canonical combat path.
 *
 * Displays local player health, shield, ammo, and weapon name. When the
 * player is eliminated, shows a brief "ELIMINATED" banner.
 *
 * Intentionally framework-free (plain DOM, no React) so it can be attached
 * and detached directly by the game runtime's lifecycle.
 */

/** The duration (ms) the elimination banner stays visible before fading. */
const ELIMINATION_DURATION_MS = 1500;

/** Inline styles, applied via `style.setProperty` so no stylesheet is needed. */
function css(el: HTMLElement, rule: string, value: string): void {
  el.style.setProperty(rule, value);
}

/**
 * A combat HUD rendered as a fixed, bottom-centred DOM overlay.
 *
 * Shows:
 *  - Health bar (green → amber → red)
 *  - Shield bar (blue)
 *  - Ammo count
 *  - Weapon name
 *  - Elimination banner (transient)
 */
export class HealthHud {
  private readonly overlay: HTMLDivElement;
  private readonly barTrack: HTMLDivElement;
  private readonly barFill: HTMLDivElement;
  private readonly healthText: HTMLDivElement;
  private readonly shieldTrack: HTMLDivElement;
  private readonly shieldFill: HTMLDivElement;
  private readonly shieldText: HTMLDivElement;
  private readonly ammoText: HTMLDivElement;
  private readonly weaponText: HTMLDivElement;
  private readonly elimination: HTMLDivElement;
  private attached = false;
  private eliminationTimer: number | null = null;

  public constructor() {
    // Root overlay.
    this.overlay = document.createElement("div");
    css(this.overlay, "position", "fixed");
    css(this.overlay, "left", "50%");
    css(this.overlay, "transform", "translateX(-50%)");
    css(this.overlay, "bottom", "24px");
    css(this.overlay, "z-index", "1000");
    css(this.overlay, "pointer-events", "none");
    css(this.overlay, "display", "flex");
    css(this.overlay, "flex-direction", "column");
    css(this.overlay, "align-items", "center");
    css(this.overlay, "gap", "6px");
    css(this.overlay, "font-family",
      "system-ui, -apple-system, 'Segoe UI', sans-serif");
    css(this.overlay, "display", "none");

    // ── Health bar ──
    this.barTrack = document.createElement("div");
    css(this.barTrack, "width", "240px");
    css(this.barTrack, "height", "18px");
    css(this.barTrack, "background", "rgba(0, 0, 0, 0.55)");
    css(this.barTrack, "border", "1px solid rgba(255, 255, 255, 0.6)");
    css(this.barTrack, "border-radius", "9px");
    css(this.barTrack, "overflow", "hidden");

    this.barFill = document.createElement("div");
    css(this.barFill, "height", "100%");
    css(this.barFill, "width", "100%");
    css(this.barFill, "background", "#4ade80");
    css(this.barFill, "transition", "width 120ms ease-out, background 200ms");

    this.healthText = document.createElement("div");
    css(this.healthText, "color", "#ffffff");
    css(this.healthText, "font-size", "13px");
    css(this.healthText, "text-shadow", "0 1px 2px rgba(0,0,0,0.8)");
    this.healthText.textContent = "100 / 100";

    // ── Shield bar ──
    this.shieldTrack = document.createElement("div");
    css(this.shieldTrack, "width", "240px");
    css(this.shieldTrack, "height", "10px");
    css(this.shieldTrack, "background", "rgba(0, 0, 0, 0.45)");
    css(this.shieldTrack, "border", "1px solid rgba(96, 165, 250, 0.5)");
    css(this.shieldTrack, "border-radius", "5px");
    css(this.shieldTrack, "overflow", "hidden");

    this.shieldFill = document.createElement("div");
    css(this.shieldFill, "height", "100%");
    css(this.shieldFill, "width", "0%");
    css(this.shieldFill, "background", "#3b82f6");
    css(this.shieldFill, "transition", "width 150ms ease-out");

    this.shieldText = document.createElement("div");
    css(this.shieldText, "color", "#93c5fd");
    css(this.shieldText, "font-size", "11px");
    css(this.shieldText, "text-shadow", "0 1px 2px rgba(0,0,0,0.8)");
    this.shieldText.textContent = "Shield: 0 / 50";

    // ── Ammo + weapon readout ──
    const ammoRow = document.createElement("div");
    css(ammoRow, "display", "flex");
    css(ammoRow, "align-items", "center");
    css(ammoRow, "gap", "8px");

    this.ammoText = document.createElement("div");
    css(this.ammoText, "color", "#fbbf24");
    css(this.ammoText, "font-size", "16px");
    css(this.ammoText, "font-weight", "700");
    css(this.ammoText, "text-shadow", "0 1px 2px rgba(0,0,0,0.8)");
    this.ammoText.textContent = "30";

    this.weaponText = document.createElement("div");
    css(this.weaponText, "color", "#e5e7eb");
    css(this.weaponText, "font-size", "12px");
    css(this.weaponText, "text-shadow", "0 1px 2px rgba(0,0,0,0.8)");
    this.weaponText.textContent = "Assault Rifle";

    ammoRow.appendChild(this.ammoText);
    ammoRow.appendChild(this.weaponText);

    // ── Elimination banner ──
    this.elimination = document.createElement("div");
    css(this.elimination, "color", "#f87171");
    css(this.elimination, "font-size", "40px");
    css(this.elimination, "font-weight", "700");
    css(this.elimination, "letter-spacing", "4px");
    css(this.elimination, "text-shadow", "0 2px 6px rgba(0,0,0,0.9)");
    css(this.elimination, "opacity", "0");
    css(this.elimination, "transition", "opacity 300ms");
    this.elimination.textContent = "ELIMINATED";

    // Assemble.
    this.overlay.appendChild(this.elimination);
    this.overlay.appendChild(this.barTrack);
    this.overlay.appendChild(this.healthText);
    this.overlay.appendChild(this.shieldTrack);
    this.overlay.appendChild(this.shieldText);
    this.overlay.appendChild(ammoRow);
    this.barTrack.appendChild(this.barFill);
    this.shieldTrack.appendChild(this.shieldFill);
  }

  /**
   * Attach the HUD to the document and make it visible.
   * Returns a cleanup function that detaches it again.
   */
  public attach(): () => void {
    if (this.attached) {
      return () => this.detach();
    }
    document.body.appendChild(this.overlay);
    css(this.overlay, "display", "flex");
    this.attached = true;
    return () => this.detach();
  }

  /**
   * Update the health bar and read-out.
   */
  public setHealth(current: number, max: number): void {
    if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) {
      return;
    }
    const clamped = Math.max(0, Math.min(current, max));
    const fraction = clamped / max;
    this.barFill.style.width = `${(fraction * 100).toFixed(1)}%`;
    this.barFill.style.background = healthColor(fraction);
    this.healthText.textContent = `${Math.round(clamped)} / ${Math.round(max)}`;
  }

  /**
   * Update the shield bar and read-out.
   */
  public setShield(current: number, max: number): void {
    if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) {
      return;
    }
    const clamped = Math.max(0, Math.min(current, max));
    const fraction = clamped / max;
    this.shieldFill.style.width = `${(fraction * 100).toFixed(1)}%`;
    this.shieldText.textContent = `Shield: ${Math.round(clamped)} / ${Math.round(max)}`;
  }

  /**
   * Update the ammo display.
   */
  public setAmmo(ammo: number): void {
    if (!Number.isFinite(ammo) || ammo < 0) {
      return;
    }
    this.ammoText.textContent = `${Math.round(ammo)}`;
  }

  /**
   * Update the weapon name display.
   */
  public setWeapon(name: string): void {
    this.weaponText.textContent = name;
  }

  /**
   * Flash the "ELIMINATED" banner for a brief moment.
   */
  public showEliminationOverlay(): void {
    if (!this.attached) {
      return;
    }
    this.elimination.style.opacity = "1";
    if (this.eliminationTimer !== null) {
      window.clearTimeout(this.eliminationTimer);
    }
    this.eliminationTimer = window.setTimeout(() => {
      this.elimination.style.opacity = "0";
      this.eliminationTimer = null;
    }, ELIMINATION_DURATION_MS);
  }

  /** Detach the HUD from the document and reset transient state. */
  public detach(): void {
    if (!this.attached) {
      return;
    }
    if (this.eliminationTimer !== null) {
      window.clearTimeout(this.eliminationTimer);
      this.eliminationTimer = null;
    }
    this.elimination.style.opacity = "0";
    if (this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    css(this.overlay, "display", "none");
    this.attached = false;
  }

  /** Alias of {@link detach} so callers can use dispose() for symmetry. */
  public dispose(): void {
    this.detach();
  }
}

/**
 * Map a health fraction [0, 1] to a CSS colour.
 */
function healthColor(fraction: number): string {
  if (fraction > 0.5) {
    return "#4ade80";
  }
  if (fraction > 0.25) {
    return "#facc15";
  }
  return "#f87171";
}
