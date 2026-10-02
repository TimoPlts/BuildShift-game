/**
 * HealthHud — a minimal DOM-based health display for the combat milestone.
 *
 * A simple overlay (a div with a health-bar div inside) pinned to the bottom
 * centre of the screen. The {@link GameRuntime} drives it from the
 * authoritative room state: `setHealth` updates the bar fill from the local
 * player's `health`, and `showEliminationOverlay` flashes a brief "ELIMINATED"
 * banner when the local player is killed.
 *
 * Intentionally framework-free (plain DOM, no React) so it can be attached and
 * detached directly by the game runtime's lifecycle.
 */

/** The duration (ms) the elimination banner stays visible before fading. */
const ELIMINATION_DURATION_MS = 1500;

/** Inline styles, applied via `style.setProperty` so no stylesheet is needed. */
function css(el: HTMLElement, rule: string, value: string): void {
  el.style.setProperty(rule, value);
}

/**
 * A minimal health HUD rendered as a fixed, bottom-centred DOM overlay.
 */
export class HealthHud {
  private readonly overlay: HTMLDivElement;
  private readonly barTrack: HTMLDivElement;
  private readonly barFill: HTMLDivElement;
  private readonly healthText: HTMLDivElement;
  private readonly elimination: HTMLDivElement;
  private attached = false;
  private eliminationTimer: number | null = null;

  public constructor() {
    // Root overlay (positioned by attach(), not here, so we can pin it to the
    // viewport bottom-centre regardless of where the app mounts it).
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
    // Keep the overlay hidden until attached.
    css(this.overlay, "display", "none");

    // Health bar track.
    this.barTrack = document.createElement("div");
    css(this.barTrack, "width", "240px");
    css(this.barTrack, "height", "18px");
    css(this.barTrack, "background", "rgba(0, 0, 0, 0.55)");
    css(this.barTrack, "border", "1px solid rgba(255, 255, 255, 0.6)");
    css(this.barTrack, "border-radius", "9px");
    css(this.barTrack, "overflow", "hidden");

    // Health bar fill (its width reflects current/max).
    this.barFill = document.createElement("div");
    css(this.barFill, "height", "100%");
    css(this.barFill, "width", "100%");
    css(this.barFill, "background", "#4ade80");
    css(this.barFill, "transition", "width 120ms ease-out, background 200ms");

    // Numeric health read-out.
    this.healthText = document.createElement("div");
    css(this.healthText, "color", "#ffffff");
    css(this.healthText, "font-size", "13px");
    css(this.healthText, "text-shadow", "0 1px 2px rgba(0,0,0,0.8)");
    this.healthText.textContent = "100 / 100";

    // Elimination banner (hidden by default).
    this.elimination = document.createElement("div");
    css(this.elimination, "color", "#f87171");
    css(this.elimination, "font-size", "40px");
    css(this.elimination, "font-weight", "700");
    css(this.elimination, "letter-spacing", "4px");
    css(this.elimination, "text-shadow", "0 2px 6px rgba(0,0,0,0.9)");
    css(this.elimination, "opacity", "0");
    this.elimination.textContent = "ELIMINATED";

    this.overlay.appendChild(this.elimination);
    this.overlay.appendChild(this.barTrack);
    this.overlay.appendChild(this.healthText);
    this.barTrack.appendChild(this.barFill);
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
   *
   * @param current the player's current health (>= 0).
   * @param max     the player's maximum health (used for the fill fraction).
   */
  public setHealth(current: number, max: number): void {
    if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) {
      return;
    }
    const clamped = Math.max(0, Math.min(current, max));
    const fraction = clamped / max;
    this.barFill.style.width = `${(fraction * 100).toFixed(1)}%`;
    // Green → amber → red as health drops.
    this.barFill.style.background = healthColor(fraction);
    this.healthText.textContent = `${Math.round(clamped)} / ${Math.round(max)}`;
  }

  /**
   * Flash the "ELIMINATED" banner for a brief moment (visual feedback when the
   * local player is killed). Re-entrancy safe: calling it again restarts the
   * timer.
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
 * Map a health fraction [0, 1] to a CSS colour: green when healthy, amber when
 * wounded, red when critically low.
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
