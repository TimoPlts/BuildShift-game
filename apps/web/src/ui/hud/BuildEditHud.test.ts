/**
 * SSR rendering tests for the {@link BuildEditHud} panel.
 *
 * The test toolchain runs vitest in a node environment without a DOM testing
 * library, so the panel is rendered to static markup and asserted on: its
 * visibility rules (nothing when idle, feedback-only after a result, full
 * panel in edit mode), the targeted-structure read-out, the pending tile
 * summary (open tiles / ramp variant), the contextual control hint (ready
 * vs "Not connected"), and the accepted/rejected/info feedback banners.
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

function props(overrides: Partial<BuildEditHudProps> = {}): BuildEditHudProps {
  return {
    mode: false,
    target: null,
    removedTiles: 0,
    totalTiles: 0,
    rampVariant: null,
    feedback: null,
    applyReady: false,
    ...overrides,
  };
}

describe("BuildEditHud", () => {
  it("renders nothing when idle (mode off, no feedback)", () => {
    expect(render(props())).toBe("");
  });

  it("renders the full edit panel when in edit mode with a target", () => {
    const html = render(
      props({
        mode: true,
        target: baseTarget,
        removedTiles: 2,
        totalTiles: 9,
        feedback: null,
        applyReady: true,
      }),
    );

    expect(html).toContain("EDIT MODE");
    expect(html).toContain("Aim: Wall (2, 0, -3)");
    // The pending tile summary reads the open count against the grid.
    expect(html).toContain("Tiles open: 2/9");
    // With a target and a live connection, the hint names the full control
    // set bound by the edit input controller + routed primary button.
    expect(html).toContain("LMB select tiles");
    expect(html).toContain("Enter");
    expect(html).toContain("confirm");
    expect(html).toContain("cancel");
    expect(html).toContain("reset");
  });

  it("shows an accurate aim prompt and a no-target chip when in edit mode but aiming off", () => {
    const html = render(props({ mode: true }));

    // Walls, floors, ramps and cones are all editable — the prompt names
    // all four.
    expect(html).toContain("Aim at an owned wall, floor, ramp, or cone");
    expect(html).toContain("No target");
    // Without a target there is nothing to apply, so no connection warning.
    expect(html).not.toContain("Not connected");
  });

  it("labels a ramp target with its pending variant", () => {
    const html = render(
      props({
        mode: true,
        target: { structureId: "ramp1", buildType: "ramp", grid: { x: 1, y: 2, z: 3 } },
        rampVariant: "half_left",
        applyReady: true,
      }),
    );

    expect(html).toContain("Aim: Ramp (1, 2, 3)");
    expect(html).toContain("Ramp: left half");
  });

  it("warns that editing is unavailable while disconnected", () => {
    const html = render(
      props({
        mode: true,
        target: baseTarget,
        removedTiles: 1,
        totalTiles: 9,
        applyReady: false,
      }),
    );

    expect(html).toContain("Not connected");
    expect(html).toContain("build-edit-hud__hint--warn");
    expect(html).not.toContain("LMB select tiles");
  });

  it("shows only the accepted feedback banner after the mode has ended", () => {
    const html = render(
      props({ feedback: { kind: "accepted", message: "Edit confirmed" } }),
    );

    expect(html).toContain("build-edit-hud__feedback--accepted");
    expect(html).toContain("Edit confirmed");
    // The full edit panel is not shown when the mode is off.
    expect(html).not.toContain("EDIT MODE");
  });

  it("marks a rejected feedback banner distinctly", () => {
    const html = render(
      props({
        mode: true,
        target: baseTarget,
        feedback: { kind: "rejected", message: "Not your structure" },
        applyReady: true,
      }),
    );

    expect(html).toContain("build-edit-hud__feedback--rejected");
    expect(html).toContain("Not your structure");
  });

  it("renders an informational banner without a pass/fail glyph", () => {
    const html = render(
      props({
        mode: true,
        target: baseTarget,
        feedback: { kind: "info", message: "Edit mode on" },
        applyReady: true,
      }),
    );

    expect(html).toContain("build-edit-hud__feedback--info");
    expect(html).toContain("Edit mode on");
    expect(html).not.toContain("✓");
    expect(html).not.toContain("✕");
  });
});
