/**
 * InteractionModeCoordinator — centralized interaction-mode ownership
 * (overhaul task 12).
 *
 * The coordinator is the single owner of the build layer (KeyB) and the
 * build-edit layer (KeyF). The effective mode is always the topmost active
 * layer (`edit > build > weapon`), so the two layers can never be "active"
 * at once and the fast transition loops stay clean:
 *
 *   place then edit          B, F        (build under edit)
 *   confirm then shotgun     Enter       (exitToWeapon: both layers off)
 *   repeat edit / reset      F, Backspace, F
 *
 * These tests pin the state machine itself — no listeners, no listeners to
 * duplicate: the coordinator is a pure intent owner.
 */
import { describe, expect, it } from "vitest";
import { InteractionModeCoordinator } from "./interactionMode";

describe("InteractionModeCoordinator", () => {
  it("starts in weapon mode with no layers active", () => {
    const mode = new InteractionModeCoordinator();
    expect(mode.mode).toBe("weapon");
    expect(mode.isBuildActive()).toBe(false);
    expect(mode.isEditActive()).toBe(false);
  });

  it("B toggles the build layer over weapon (and back)", () => {
    const mode = new InteractionModeCoordinator();
    mode.toggleBuild();
    expect(mode.mode).toBe("build");
    expect(mode.isBuildActive()).toBe(true);
    expect(mode.isEditActive()).toBe(false);
    mode.toggleBuild();
    expect(mode.mode).toBe("weapon");
    expect(mode.isBuildActive()).toBe(false);
  });

  it("F toggles the edit layer over weapon (and back)", () => {
    const mode = new InteractionModeCoordinator();
    mode.toggleEdit();
    expect(mode.mode).toBe("edit");
    expect(mode.isEditActive()).toBe(true);
    expect(mode.isBuildActive()).toBe(false);
    mode.toggleEdit();
    expect(mode.mode).toBe("weapon");
  });

  it("F over build enters edit with the build layer kept underneath", () => {
    const mode = new InteractionModeCoordinator();
    mode.toggleBuild();
    mode.toggleEdit();
    expect(mode.mode).toBe("edit");
    // Build is not the topmost layer — it never "owns" anything while edit
    // is on top (no placement, no piece selection acting as build intents).
    expect(mode.isBuildActive()).toBe(false);
    expect(mode.isEditActive()).toBe(true);
  });

  it("runs the full mission loop: weapon -> build -> edit -> build -> weapon", () => {
    const mode = new InteractionModeCoordinator();
    const seen: string[] = [mode.mode];

    mode.toggleBuild(); // B: weapon -> build
    seen.push(mode.mode);
    mode.toggleEdit(); // F: build -> edit (build underneath)
    seen.push(mode.mode);
    mode.toggleEdit(); // F: edit -> build (build revealed)
    seen.push(mode.mode);
    mode.toggleBuild(); // B: build -> weapon
    seen.push(mode.mode);

    expect(seen).toEqual(["weapon", "build", "edit", "build", "weapon"]);
  });

  it("B while in edit (entered from weapon) reveals build", () => {
    const mode = new InteractionModeCoordinator();
    mode.toggleEdit(); // weapon -> edit
    mode.toggleBuild(); // B: edit -> build (build layer asserted)
    expect(mode.mode).toBe("build");
    expect(mode.isBuildActive()).toBe(true);
    expect(mode.isEditActive()).toBe(false);
  });

  it("exitToWeapon (confirm/cancel) clears both layers — confirm then shotgun", () => {
    const mode = new InteractionModeCoordinator();
    mode.toggleBuild();
    mode.toggleEdit(); // edit over build
    mode.exitToWeapon();
    expect(mode.mode).toBe("weapon");
    expect(mode.isBuildActive()).toBe(false);
    expect(mode.isEditActive()).toBe(false);
    // Also from a bare edit session (entered from weapon).
    mode.toggleEdit();
    mode.exitToWeapon();
    expect(mode.mode).toBe("weapon");
  });

  it("clearEdit keeps the build layer (round reset / disconnect preserve build context)", () => {
    const mode = new InteractionModeCoordinator();
    mode.toggleBuild();
    mode.toggleEdit();
    mode.clearEdit();
    expect(mode.mode).toBe("build");
    expect(mode.isBuildActive()).toBe(true);
    // clearEdit from weapon mode is a no-op.
    const bare = new InteractionModeCoordinator();
    bare.clearEdit();
    expect(bare.mode).toBe("weapon");
  });

  it("clearAll drops every layer (pointer unlock / hidden tab / dispose)", () => {
    const mode = new InteractionModeCoordinator();
    mode.toggleBuild();
    mode.toggleEdit();
    mode.clearAll();
    expect(mode.mode).toBe("weapon");
    // Idempotent.
    mode.clearAll();
    expect(mode.mode).toBe("weapon");
  });

  it("survives repeated transition cycles without drifting", () => {
    const mode = new InteractionModeCoordinator();
    for (let i = 0; i < 5; i++) {
      mode.toggleBuild(); // build
      mode.toggleEdit(); // edit
      mode.toggleEdit(); // build
      mode.toggleBuild(); // weapon
      expect(mode.mode).toBe("weapon");
      expect(mode.isBuildActive()).toBe(false);
      expect(mode.isEditActive()).toBe(false);
    }
    // The edit -> reset -> edit repeat (reset never changes the mode):
    mode.toggleEdit();
    expect(mode.mode).toBe("edit");
    // (reset intent is consumed by the edit controller; the mode is stable)
    mode.toggleEdit();
    expect(mode.mode).toBe("weapon");
    mode.toggleEdit();
    expect(mode.mode).toBe("edit");
  });
});
