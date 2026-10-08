/**
 * MovementDebugHUD — a minimal development debug overlay for the Stage 2D
 * two-player movement system.
 *
 * Shows:
 *  - Local player position (x, y, z)
 *  - Remote player position (x, y, z)
 *  - Input sequence number
 *  - Connection state
 *  - Last correction distance
 *
 * This is a DOM-based overlay driven from the game render loop. It reads
 * from a mutable debug state object that the GameRuntime updates each frame.
 *
 * The overlay is HIDDEN BY DEFAULT. It is only attached when the caller
 * explicitly opts in through the `?debug=1` / `?debug=true` URL query
 * parameter (see {@link debugHudEnabledFromUrl}).
 */

/**
 * Resolve whether the development/debug HUD was explicitly requested through
 * a URL query parameter (`?debug=1` or `?debug=true`).
 *
 * The debug HUD is hidden by default; it is only shown when the caller
 * explicitly opts in via the query parameter. Passing an explicit `url`
 * keeps the helper unit-testable without a browser; when omitted the
 * helper reads the current page URL (or defaults to disabled in
 * non-browser environments).
 */
export function debugHudEnabledFromUrl(url?: URL): boolean {
  const target =
    url ??
    (typeof window !== "undefined"
      ? new URL(window.location.href)
      : new URL("about:blank"));
  const value = target.searchParams.get("debug");
  return value === "1" || value === "true";
}

/**
 * The mutable debug state that the GameRuntime updates each frame.
 */
export interface MovementDebugState {
  localX: number;
  localY: number;
  localZ: number;
  remoteX: number;
  remoteY: number;
  remoteZ: number;
  remotePresent: boolean;
  sequence: number;
  connectionState: string;
  lastCorrectionDistance: number | null;
  visible: boolean;
}

/**
 * A DOM-based debug HUD that renders movement debug information as
 * text overlaid on the game canvas.
 *
 * Usage:
 * ```ts
 * const hud = new MovementDebugHUD(canvas);
 * hud.state.localX = 1.0;
 * hud.state.connectionState = "connected";
 * const cleanup = hud.attach();
 * // ... game loop updates hud.state ...
 * cleanup();
 * ```
 */
export class MovementDebugHUD {
  /** The mutable debug state, updated by the GameRuntime each frame. */
  public state: MovementDebugState = {
    localX: 0,
    localY: 0,
    localZ: 0,
    remoteX: 0,
    remoteY: 0,
    remoteZ: 0,
    remotePresent: false,
    sequence: 0,
    connectionState: "disconnected",
    lastCorrectionDistance: null,
    visible: true,
  };

  private readonly canvas: HTMLCanvasElement;
  private disposed = false;

  public constructor(parentCanvas: HTMLCanvasElement) {
    this.canvas = parentCanvas;
  }

  /**
   * Create a DOM-based debug overlay attached to the parent canvas's
   * container. Returns a cleanup function.
   */
  public attach(): () => void {
    const overlay = document.createElement("div");
    overlay.className = "movement-debug-hud";
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.cssText =
      "position:absolute;top:8px;left:8px;font-family:monospace;" +
      "font-size:12px;color:#0f0;background:rgba(0,0,0,0.7);" +
      "padding:8px 12px;border-radius:4px;pointer-events:none;" +
      "white-space:pre;z-index:100;line-height:1.5;";

    const parent = this.canvas.parentElement;
    if (parent) {
      parent.appendChild(overlay);
    }

    let rafId = 0;
    const update = (): void => {
      if (this.disposed) return;
      this.updateOverlay(overlay);
      rafId = requestAnimationFrame(update);
    };
    rafId = requestAnimationFrame(update);

    let cleaned = false;
    return () => {
      if (cleaned) return;
      cleaned = true;
      cancelAnimationFrame(rafId);
      overlay.remove();
    };
  }

  private updateOverlay(overlay: HTMLDivElement): void {
    if (!this.state.visible) {
      overlay.style.display = "none";
      return;
    }
    overlay.style.display = "block";

    const s = this.state;
    const lines: string[] = [];
    lines.push("[BuildShift 2D Debug]");
    lines.push(`Conn: ${s.connectionState}`);
    lines.push(`Seq:  ${s.sequence}`);
    lines.push("");
    lines.push(
      `Local:  (${s.localX.toFixed(2)}, ${s.localY.toFixed(2)}, ${s.localZ.toFixed(2)})`,
    );
    if (s.remotePresent) {
      lines.push(
        `Remote: (${s.remoteX.toFixed(2)}, ${s.remoteY.toFixed(2)}, ${s.remoteZ.toFixed(2)})`,
      );
    } else {
      lines.push("Remote: (not present)");
    }
    if (s.lastCorrectionDistance !== null) {
      lines.push("");
      lines.push(`Last correction: ${s.lastCorrectionDistance.toFixed(4)} m`);
    }

    overlay.textContent = lines.join("\n");
  }

  public dispose(): void {
    this.disposed = true;
  }
}
