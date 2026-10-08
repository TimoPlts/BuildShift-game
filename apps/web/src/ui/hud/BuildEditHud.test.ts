/**
 * SSR rendering tests for the {@link BuildEditHud} panel.
 *
 * The test toolchain runs vitest in a node environment without a DOM testing
 * library, so the panel is rendered to static markup and asserted on: its
 * visibility rules (nothing when idle, feedback-only after a result, full
 * panel in edit mode), the targeted-structure read-out, the key-hinted edit
 * selector, and the accepted/rejected feedback banner.
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
    // The control hints are shown.
    expect(html).toContain("Enter");
  });

  it("shows an aim prompt and a no-target chip when in edit mode but aiming off", () => {
    const html = render({
      mode: true,
      target: null,
      selectedEdit: "door",
      allowedEdits: [],
      feedback: null,
    });

    expect(html).toContain("Aim at your wall");
    expect(html).toContain("No target");
  });

  it("shows only the accepted feedback banner after the mode has ended", () => {
    const html = render({
      mode: false,
      target: null,
      selectedEdit: "door",
      allowedEdits: [],
      feedback: { kind: "accepted", message: "Edit applied" },
    });

    expect(html).toContain("build-edit-hud__feedback--accepted");
    expect(html).toContain("Edit applied");
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
    });

    expect(html).toContain("build-edit-hud__feedback--rejected");
    expect(html).toContain("Not your structure");
  });
});
