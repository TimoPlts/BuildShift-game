/**
 * Centralized interaction-mode ownership.
 *
 * Single owner of the two layer intents — the build layer and the build-edit
 * layer — so the input controllers can never disagree about what the primary
 * button and the contextual keys mean:
 *
 *   - `edit` sits on top of `build`; the effective mode is always the topmost
 *     active layer: `edit > build > weapon`.
 *   - Direct transitions (competitive building): a build-piece bind enters
 *     the build layer from any mode (`selectBuild`), a weapon-slot bind
 *     returns to weapon mode from any mode (`selectWeapon`), the edit bind
 *     toggles the edit layer (`toggleEdit`). No mode key is required first.
 *   - Leaving the edit layer through one of those player actions (another
 *     bind, the edit bind again, confirm) is a **commit** exit: the edit the
 *     player made is applied. Leaving it through a forced teardown (round
 *     reset, disconnect, pointer unlock, cancel) is a **discard** exit. The
 *     exit kind is latched here, so the edit controller applies or drops its
 *     local draft no matter which key listener observed the key first.
 *
 * The coordinator is a pure state machine: it owns **no browser listeners**.
 * Each input controller keeps its own single listener set and routes its
 * actions here, so wiring one shared coordinator into both systems cannot
 * create duplicate listeners.
 */

/** Effective interaction mode: the topmost active layer. */
export type InteractionMode = "weapon" | "build" | "edit";

/** How the edit layer was last left (`null` once consumed / never left). */
export type EditExitKind = "commit" | "discard";

export class InteractionModeCoordinator {
  private buildIntent = false;
  private editIntent = false;
  private editExit: EditExitKind | null = null;

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

  /** A build-piece bind: enter (or stay in) the build layer from any mode. */
  selectBuild(): void {
    this.leaveEdit("commit");
    this.buildIntent = true;
  }

  /** A weapon-slot bind: return to weapon mode from any mode. */
  selectWeapon(): void {
    this.leaveEdit("commit");
    this.buildIntent = false;
  }

  /**
   * The optional legacy build toggle. While the edit layer is on top it
   * reveals the build layer (edit committed, build on); otherwise it flips the
   * build layer (weapon <-> build).
   */
  toggleBuild(): void {
    if (this.editIntent) {
      this.leaveEdit("commit");
      this.buildIntent = true;
      return;
    }
    this.buildIntent = !this.buildIntent;
  }

  /**
   * The edit bind: enters the edit layer (over weapon or build), or — while
   * editing — commits the edit and returns to the layer beneath.
   */
  toggleEdit(): void {
    if (this.editIntent) {
      this.leaveEdit("commit");
      return;
    }
    this.editIntent = true;
    this.editExit = null;
  }

  /**
   * Drop only the edit layer **without applying** the edit, preserving the
   * build layer beneath it (round reset / disconnect / dispose / cancel).
   */
  clearEdit(): void {
    this.leaveEdit("discard");
  }

  /**
   * Commit-exit from editing (confirm): apply the edit and drop both layers,
   * returning to weapon mode so the primary button means fire immediately.
   */
  exitToWeapon(): void {
    this.leaveEdit("commit");
    this.buildIntent = false;
  }

  /** Drop every layer intent without applying an edit (pointer unlock, tab hidden, dispose). */
  clearAll(): void {
    this.leaveEdit("discard");
    this.buildIntent = false;
  }

  /**
   * How the edit layer was left since the last call (`null` when it was not
   * left). Consumed once per frame by the edit controller.
   */
  consumeEditExit(): EditExitKind | null {
    const exit = this.editExit;
    this.editExit = null;
    return exit;
  }

  private leaveEdit(kind: EditExitKind): void {
    if (!this.editIntent) return;
    this.editIntent = false;
    // A discard never downgrades to commit within one frame, and a later
    // commit never overrides an earlier discard of the same session.
    if (this.editExit !== "discard") this.editExit = kind;
  }
}
