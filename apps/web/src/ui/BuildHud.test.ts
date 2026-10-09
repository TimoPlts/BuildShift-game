/**
 * SSR rendering tests for the {@link BuildHud} panel.
 *
 * The test toolchain runs vitest in a node environment without a DOM testing
 * library, so the panel is rendered to static markup and asserted on: its
 * inactive-state keybind prompt, the number-key hints on each build-type chip
 * (mirroring the building input controller's 1-4 bindings), the contextual
 * control-hint row (rotate / place-or-aim / exit), and the placement
 * validity read-out.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BuildHud, type BuildHudProps } from "./BuildHud";

function render(props: BuildHudProps): string {
  return renderToStaticMarkup(createElement(BuildHud, props));
}

const baseProps: BuildHudProps = {
  inBuildMode: true,
  selectedBuildType: "wall",
  placementValid: true,
  gridPosition: { x: 3, y: 0, z: -2 },
};

describe("BuildHud", () => {
  it("shows an inactive prompt with the B keybind when build mode is off", () => {
    const html = render({ ...baseProps, inBuildMode: false });

    expect(html).toContain("BUILD MODE OFF");
    expect(html).toContain("build-hud--inactive");
    // The inactive state tells the player the exact toggle keybind.
    expect(html).toContain("Press");
    expect(html).toContain("<kbd>B</kbd>");
    expect(html).toContain("to build");
    // No selector chips or control hint while the mode is off.
    expect(html).not.toContain("build-hud__types");
    expect(html).not.toContain("build-hud__hint");
  });

  it("shows the selected build type with its cost and grid position", () => {
    const html = render(baseProps);

    expect(html).toContain("BUILD MODE");
    expect(html).toContain("Wall");
    expect(html).toContain("build-hud__selected");
    // Grid read-out for the current preview cell.
    expect(html).toContain("(3, 0, -2)");
    // Valid placement is flagged green.
    expect(html).toContain("build-hud__validity--valid");
    expect(html).toContain("VALID");
  });

  it("shows every build type as a chip with its number-key hint", () => {
    const html = render(baseProps);

    // All four build types are listed…
    expect(html).toContain("Wall");
    expect(html).toContain("Floor");
    expect(html).toContain("Ramp");
    expect(html).toContain("Cone");
    // …each with the same number-key hint the input controller binds
    // (1=wall, 2=floor, 3=ramp, 4=cone).
    for (const key of ["1", "2", "3", "4"]) {
      expect(html).toMatch(new RegExp(`build-hud__type-key[^>]*>\\s*${key}\\s*<`));
    }
    // The wall chip is the selected one.
    expect(html).toContain("build-hud__type--selected");
  });

  it("offers the contextual placement hint for each preview state", () => {
    // Valid preview → the left-click place intent is available.
    const valid = render({ ...baseProps, placementValid: true });
    expect(valid).toContain("Left click place");

    // Invalid preview → steer the player to a buildable surface.
    const invalid = render({ ...baseProps, placementValid: false });
    expect(invalid).toContain("Aim at a valid surface");
    expect(invalid).not.toContain("Left click place");

    // No preview (not aiming at a candidate) → prompt to aim.
    const noPreview = render({ ...baseProps, placementValid: null });
    expect(noPreview).toContain("Aim to preview");
    // No validity dot without an active preview.
    expect(noPreview).not.toContain("build-hud__validity");
  });

  it("always shows the rotate and exit keybinds in the control hint row", () => {
    const html = render(baseProps);

    expect(html).toContain("build-hud__hint");
    expect(html).toContain("rotate");
    expect(html).toContain("<kbd>Q</kbd>");
    expect(html).toContain("<kbd>E</kbd>");
    expect(html).toContain("exit");
  });
});
