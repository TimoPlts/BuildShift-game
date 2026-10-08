/**
 * SSR rendering tests for the {@link BuildEditHud} panel.
 *
 * The test toolchain runs vitest in a node environment without a DOM testing
 * library, so the panel is rendered to static markup and asserted on: its
 * visibility rules (nothing when idle, feedback-only after a result, full
 * panel in edit mode), the targeted-structure read-out, the key-hinted edit
 * selector, the contextual control hint (apply vs "Not connected"), and the
 * accepted/rejected/info feedback banners.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BuildEditHud,
  type BuildEditHudProps,
} from "./BuildEditHud";

function render(props: BuildEditHudProps): string {
  return renderToStaticMarkup(createElement(BuildEditHud, props));
}

const baseTarget = { structureId: "wall1", buildType: "wall", grid: { x: 2, y: 0, z: -3 } };
const wallEdits = ["door", "window", "half_top", "half_bottom"] as const;

describe("BuildEditHud", () => {
  it("renders nothing when idle (mode off, no feedback)", () => {
    expect(
      render({
        mode: false,
        target: null,
        selectedEdit: "door",
        allowedEdits: [],
        feedback: null,
        applyReady: false,
      }),
    ).toBe("");
  });

  it("renders the full edit panel when in edit mode with a target", () => {
    const html = render({
      mode: true,
      target: baseTarget,
      selectedEdit: "door",
      allowedEdits: wallEdits,
      feedback: null,
      applyReady: true,
    });

    expect(html).toContain("EDIT MODE");
    expect(html).toContain("Aim: Wall (2, 0, -3)");
    // Every allowed edit plus "clear" is listed as a key-hinted chip.
    expect(html).toContain("Door");
    expect(html).toContain("Window");
    expect(html).toContain("Top half");
    expect(html).toContain("Bottom half");
    expect(html).toContain("Clear");
    // The selected edit (door) is highlighted.
    expect(html).toContain("build-edit-hud__edit--selected");
    // With a target and a live connection, the hint offers to apply.
    expect(html).toContain("Enter");
    expect(html).toContain("apply");
  });

  it("shows an accurate aim prompt and a no-target chip when in edit mode but aiming off", () => {
    const html = render({
      mode: true,
      target: null,
      selectedEdit: "door",
      allowedEdits: [],
      feedback: null,
      applyReady: false,
    });

    // Walls, roofs and floors are all editable — the prompt names all three.
    expect(html).toContain("Aim at an owned wall, roof, or floor");
    expect(html).toContain("No target");
    // Without a target there is nothing to apply, so no connection warning.
    expect(html).not.toContain("Not connected");
  });

  it("labels a roof target with its display name", () => {
    const html = render({
      mode: true,
      target: { structureId: "roof1", buildType: "roof", grid: { x: 1, y: 2, z: 3 } },
      selectedEdit: "half_top",
      allowedEdits: ["half_top"],
      feedback: null,
      applyReady: true,
    });

    expect(html).toContain("Aim: Roof (1, 2, 3)");
  });

  it("warns that apply is unavailable while disconnected", () => {
    const html = render({
      mode: true,
      target: baseTarget,
      selectedEdit: "door",
      allowedEdits: wallEdits,
      feedback: null,
      applyReady: false,
    });

    expect(html).toContain("Not connected");
    expect(html).toContain("build-edit-hud__hint--warn");
    expect(html).not.toContain("apply");
  });

  it("shows only the accepted feedback banner after the mode has ended", () => {
    const html = render({
      mode: false,
      target: null,
      selectedEdit: "door",
      allowedEdits: [],
      feedback: { kind: "accepted", message: "Edit applied: Door" },
      applyReady: false,
    });

    expect(html).toContain("build-edit-hud__feedback--accepted");
    expect(html).toContain("Edit applied: Door");
    // The full edit panel is not shown when the mode is off.
    expect(html).not.toContain("EDIT MODE");
  });

  it("marks a rejected feedback banner distinctly", () => {
    const html = render({
      mode: true,
      target: baseTarget,
      selectedEdit: "window",
      allowedEdits: wallEdits,
      feedback: { kind: "rejected", message: "Not your structure" },
      applyReady: true,
    });

    expect(html).toContain("build-edit-hud__feedback--rejected");
    expect(html).toContain("Not your structure");
  });

  it("renders an informational banner without a pass/fail glyph", () => {
    const html = render({
      mode: true,
      target: baseTarget,
      selectedEdit: "door",
      allowedEdits: wallEdits,
      feedback: { kind: "info", message: "Edit mode on" },
      applyReady: true,
    });

    expect(html).toContain("build-edit-hud__feedback--info");
    expect(html).toContain("Edit mode on");
    expect(html).not.toContain("✓");
    expect(html).not.toContain("✕");
  });
});
