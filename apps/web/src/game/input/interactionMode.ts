/**
 * Centralized interaction-mode ownership (overhaul task 12).
 *
 * The build layer (KeyB) and the build-edit layer (KeyF) each used to own an
 * independent boolean flag, so both could be active at once and the
 * build -> edit -> build -> weapon transition loop left stale intents behind
 * (e.g. "confirm then shotgun": confirm closed edit mode, but build mode kept
 * owning Digit1/Digit2, so the number keys picked floor instead of the
 * shotgun). This coordinator is the single owner of both layer intents:
 *
 *   - `edit` sits on top of `build`: F toggles the edit layer (over weapon or
 *     over build); B toggles the build layer, and while the edit layer is on
 *     top B reveals the build layer (edit off, build on) — the fast
 *     "build -> edit -> build" step.
 *   - The effective mode is always the topmost active layer:
 *     `edit > build > weapon`.
 *   - Confirm/cancel (`exitToWeapon`) drops both layers at once, so the
 *     primary button and the number keys mean combat actions immediately.
 *   - Round reset / disconnect / dispose tear down only what the caller owns
 *     (`clearEdit` keeps the build layer; `clearAll` drops both), so no stale
 *     intent survives a transition.
 *
 * The coordinator is a pure state machine: it owns **no browser listeners**.
 * Each input controller keeps its own single listener set and routes its key
 * presses here, so wiring one shared coordinator into both systems cannot
 * create duplicate listeners.
 */

/** Effective interaction mode: the topmost active layer. */
export type InteractionMode = "weapon" | "build" | "edit";

export class InteractionModeCoordinator {
  private buildIntent = false;
  private editIntent = false;

  /**
   * The effective mode. `buildIntent` may remain true while `editIntent` is
   * also true (the build layer under the edit layer); the effective mode is
   * always the topmost layer, so `edit > build > weapon` holds.
   */
  get mode(): InteractionMode {
    if (this.editIntent) return "edit";
    if (this.buildIntent) return "build";
    return "weapon";
  }

  /** True only when build is the topmost layer (not merely under edit). */
  isBuildActive(): boolean {
    return this.mode === "build";
  }

  /** True only when edit is the topmost layer. */
  isEditActive(): boolean {
    return this.mode === "edit";
  }

  /**
   * KeyB toggle. While the edit layer is on top, B reveals the build layer
   * (edit off, build on) — the fast "build -> edit -> build" step. Otherwise
   * it flips the build layer (weapon <-> build).
   */
  toggleBuild(): void {
    if (this.editIntent) {
      this.editIntent = false;
      this.buildIntent = true;
      return;
    }
    this.buildIntent = !this.buildIntent;
  }

  /** KeyF toggle: flips the edit layer (over weapon, or over build). */
  toggleEdit(): void {
    this.editIntent = !this.editIntent;
  }

  /**
   * Drop only the edit layer, preserving the build layer beneath it. Used by
   * round reset / disconnect / dispose: the player's build context (mode +
   * selected piece) survives exactly as before the coordinator existed.
   */
  clearEdit(): void {
    this.editIntent = false;
  }

  /**
   * Commit-exit from editing (confirm/cancel): drop both layers, returning
   * to weapon mode so the primary button and the number keys are combat
   * actions immediately — "confirm then shotgun" works.
   */
  exitToWeapon(): void {
    this.editIntent = false;
    this.buildIntent = false;
  }

  /** Drop every layer intent (pointer unlock, tab hidden, dispose). */
  clearAll(): void {
    this.editIntent = false;
    this.buildIntent = false;
  }
}
