/**
 * Focused UI contract tests for the in-match HUD presentation layer
 * (Batch 2D-C: HUD and competitive UI polish).
 *
 * Two contracts are verified:
 *
 *  1. **Markup classes** — the presentation components emit the class
 *     names the HUD stylesheets target. Rendered via SSR (the project
 *     test toolchain runs vitest in a node environment without a DOM
 *     testing library).
 *  2. **Stylesheet coverage** — every HUD class a component emits has a
 *     rule in the stylesheets (the BuildEditHud panel previously shipped
 *     markup whose classes had no CSS), the crosshair is styled, and the
 *     responsive tiers (≤900px / ≤640px) cover the bottom-row panels so
 *     the HUD stays legible on smaller viewports.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchPhase } from "@buildshift/protocol";
import { BuildEditHud, type BuildEditHudProps } from "./BuildEditHud";
import { BuildHud, type BuildHudProps } from "../BuildHud";
import { MatchHud, type MatchHudProps } from "../MatchHud";

/** The root stylesheets the HUD components rely on. */
const stylesCss = readFileSync(
  fileURLToPath(new URL("../../styles.css", import.meta.url)),
  "utf8",
);
const gameHudCss = readFileSync(
  fileURLToPath(new URL("./game-hud.css", import.meta.url)),
  "utf8",
);

function renderEdit(props: Partial<BuildEditHudProps>): string {
  return renderToStaticMarkup(
    createElement(BuildEditHud, {
      mode: false,
      target: null,
      removedTiles: 0,
      totalTiles: 0,
      rampVariant: null,
      feedback: null,
      applyReady: false,
      ...props,
    }),
  );
}

function renderBuild(props: Partial<BuildHudProps>): string {
  return renderToStaticMarkup(
    createElement(BuildHud, {
      inBuildMode: false,
      selectedBuildType: "wall",
      placementValid: null,
      gridPosition: null,
      ...props,
    }),
  );
}

function matchProps(overrides: Partial<MatchHudProps> = {}): MatchHudProps {
  return {
    localScore: 1,
    remoteScore: 0,
    phase: MatchPhase.IN_PROGRESS,
    currentRound: 2,
    localWonLastRound: true,
    localWonMatch: null,
    ...overrides,
  };
}

describe("HUD markup classes (SSR contract)", () => {
  it("BuildEditHud: active panel emits the header, title, target and ready-hint classes", () => {
    const html = renderEdit({
      mode: true,
      target: { structureId: "w1", buildType: "wall", grid: { x: 1, y: 0, z: 2 } },
      removedTiles: 1,
      totalTiles: 9,
      applyReady: true,
    });

    expect(html).toContain("class=\"build-edit-hud\"");
    expect(html).toContain("build-edit-hud__header");
    expect(html).toContain("build-edit-hud__title");
    expect(html).toContain("build-edit-hud__target");
    expect(html).toContain("build-edit-hud__tiles");
    expect(html).toContain("build-edit-hud__hint--ok");
  });

  it("BuildEditHud: aim-off state emits the prompt and no-target chip classes", () => {
    const html = renderEdit({ mode: true });

    expect(html).toContain("build-edit-hud__aim");
    expect(html).toContain("build-edit-hud__none");
  });

  it("BuildEditHud: invalid reason and pending state use distinct chip classes", () => {
    const target = { structureId: "s", buildType: "floor", grid: { x: 0, y: 0, z: 0 } };

    const invalid = renderEdit({
      mode: true,
      target,
      applyReady: true,
      unconfirmed: true,
      invalidReason: "Floor cannot be fully opened",
    });
    expect(invalid).toContain("build-edit-hud__invalid");
    expect(invalid).not.toContain("build-edit-hud__pending");

    const pending = renderEdit({ mode: true, target, applyReady: true, unconfirmed: true });
    expect(pending).toContain("build-edit-hud__pending");
    expect(pending).not.toContain("build-edit-hud__invalid");
  });

  it("BuildEditHud: result-only mode emits the result class plus banner glyph and message", () => {
    const html = renderEdit({ feedback: { kind: "accepted", message: "Edit confirmed" } });

    expect(html).toContain("build-edit-hud--result-only");
    expect(html).toContain("build-edit-hud__glyph");
    expect(html).toContain("build-edit-hud__message");
    expect(html).not.toContain("build-edit-hud__header");
  });

  it("BuildHud: active panel emits selection, validity and (demoted) grid classes", () => {
    const html = renderBuild({
      inBuildMode: true,
      selectedBuildType: "ramp",
      placementValid: true,
      gridPosition: { x: 3, y: 0, z: -1 },
    });

    expect(html).toContain("build-hud__mode-label--active");
    expect(html).toContain("build-hud__type--selected");
    expect(html).toContain("build-hud__validity--valid");
    expect(html).toContain("build-hud__grid");
    // Inactive toggle hint is absent while build mode is on.
    expect(html).not.toContain("build-hud--inactive");
  });

  it("BuildHud: invalid placement and the inactive state are distinguished", () => {
    const invalid = renderBuild({
      inBuildMode: true,
      placementValid: false,
    });
    expect(invalid).toContain("build-hud__validity--invalid");
    expect(invalid).not.toContain("build-hud__grid");

    const inactive = renderBuild({ inBuildMode: false });
    expect(inactive).toContain("build-hud--inactive");
    expect(inactive).toContain("build-hud__toggle-hint");
  });

  it("MatchHud: the phase strip keeps its demoted row classes", () => {
    const html = renderToStaticMarkup(createElement(MatchHud, matchProps()));

    expect(html).toContain("match-hud__phase-row");
    expect(html).toContain("match-hud__phase--active");
    expect(html).toContain("match-hud__round");
    // "IN PROGRESS" is demoted text, but it is still presented.
    expect(html).toContain("IN PROGRESS");
  });
});

describe("HUD stylesheet contract", () => {
  it("every BuildEditHud class emitted by the component has a stylesheet rule", () => {
    const classes = [
      "build-edit-hud",
      "build-edit-hud--result-only",
      "build-edit-hud__header",
      "build-edit-hud__title",
      "build-edit-hud__target",
      "build-edit-hud__aim",
      "build-edit-hud__none",
      "build-edit-hud__tiles",
      "build-edit-hud__invalid",
      "build-edit-hud__pending",
      "build-edit-hud__hint",
      "build-edit-hud__hint--ok",
      "build-edit-hud__hint--warn",
      "build-edit-hud__feedback",
      "build-edit-hud__feedback--accepted",
      "build-edit-hud__feedback--rejected",
      "build-edit-hud__feedback--info",
      "build-edit-hud__glyph",
    ];

    for (const name of classes) {
      expect(stylesCss, `missing rule for .${name}`).toContain(`.${name}`);
    }

    // The retired pre-polish markup is gone from the stylesheet, so the
    // panel cannot drift back to unstyled legacy classes.
    expect(stylesCss).not.toContain("build-edit-hud__top-row");
    expect(stylesCss).not.toContain("build-edit-hud__edit--selected");
    expect(stylesCss).not.toContain("build-edit-hud--feedback-only");
  });

  it("the crosshair is styled as a compact dot-and-ticks reticle", () => {
    const crosshairStart = stylesCss.indexOf(".crosshair {");
    expect(crosshairStart).toBeGreaterThan(-1);
    const block = stylesCss.slice(crosshairStart, stylesCss.indexOf("}", crosshairStart));
    expect(block).toContain("radial-gradient");

    // Both tick pseudo-elements keep a center gap (transparent mid-span).
    expect(stylesCss).toContain(".crosshair::before");
    expect(stylesCss).toContain(".crosshair::after");
    expect(stylesCss).toContain("transparent 5px 13px");
  });

  it("the demoted dev-flavored read-outs keep their quiet styles", () => {
    // The raw phase word is rendered small and muted, not as a primary cue.
    expect(stylesCss).toMatch(/\.match-hud__phase \{[^}]*0\.62rem/s);
    // Build grid coordinates are the quietest line of the build panel.
    expect(stylesCss).toMatch(/\.build-hud__grid \{[^}]*0\.64rem/s);
  });

  it("responsive tiers cover the bottom-row panels and the centered stack", () => {
    const wide = stylesCss.includes("@media") || gameHudCss.includes("@media (max-width: 900px)");
    expect(wide).toBe(true);

    const wideBlock = gameHudCss.slice(gameHudCss.indexOf("@media (max-width: 900px)"));
    expect(wideBlock).toContain(".match-hud__timer-track");

    const narrow = gameHudCss.indexOf("@media (max-width: 640px)");
    expect(narrow).toBeGreaterThan(-1);
    const narrowBlock = gameHudCss.slice(narrow);
    // Corner panels shrink; the centered build/edit stack moves to its own
    // lane above the corner panels; grid coordinates drop at this size.
    for (const selector of [
      ".weapon-hud",
      ".combat-vitals-hud",
      ".build-hud",
      ".build-edit-hud",
      ".match-hud__score-value",
    ]) {
      expect(narrowBlock, `missing ${selector} in the 640px tier`).toContain(selector);
    }
    expect(narrowBlock).toMatch(/\.build-hud__grid \{\s*display: none;/s);
  });
});
