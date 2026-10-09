/**
 * Contract tests for the EnergyHud presentation layer.
 *
 * The project's test toolchain runs vitest in a node environment without a
 * DOM testing library, so the component is rendered to static markup (SSR)
 * and the contract is asserted on the resulting HTML: the fill-state class
 * ladder (healthy / low / critical), the matching numeric read-out tint,
 * and the progressbar accessibility attributes.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EnergyHud } from "./EnergyHud";

function renderEnergy(currentEnergy: number, maxEnergy = 100): string {
  return renderToStaticMarkup(
    createElement(EnergyHud, { currentEnergy, maxEnergy }),
  );
}

describe("EnergyHud", () => {
  it("exposes the energy bar as an accessible progressbar with authoritative values", () => {
    const html = renderEnergy(61, 100);
    expect(html).toContain("energy-hud");
    expect(html).toContain("role=\"progressbar\"");
    expect(html).toContain("aria-valuenow=\"61\"");
    expect(html).toContain("aria-valuemin=\"0\"");
    expect(html).toContain("aria-valuemax=\"100\"");
  });

  it("selects the healthy fill (and neutral value tint) above half energy", () => {
    const html = renderEnergy(61, 100);
    expect(html).toContain("energy-hud__bar-fill--healthy");
    expect(html).not.toContain("energy-hud__bar-fill--low");
    expect(html).not.toContain("energy-hud__bar-fill--critical");
    // Above half energy the numeric read-out stays neutral.
    expect(html).not.toContain("energy-hud__value--low");
    expect(html).not.toContain("energy-hud__value--critical");
  });

  it("selects the low fill and low value tint between a quarter and half energy", () => {
    const html = renderEnergy(30, 100);
    expect(html).toContain("energy-hud__bar-fill--low");
    expect(html).not.toContain("energy-hud__bar-fill--healthy");
    expect(html).not.toContain("energy-hud__bar-fill--critical");
    // The read-out mirrors the bar state.
    expect(html).toContain("energy-hud__value--low");
    expect(html).not.toContain("energy-hud__value--critical");
  });

  it("selects the critical fill and critical value tint at or below a quarter energy", () => {
    const html = renderEnergy(10, 100);
    expect(html).toContain("energy-hud__bar-fill--critical");
    expect(html).not.toContain("energy-hud__bar-fill--healthy");
    expect(html).not.toContain("energy-hud__bar-fill--low");
    expect(html).toContain("energy-hud__value--critical");
    expect(html).not.toContain("energy-hud__value--low");
  });

  it("clamps out-of-range energy into [0, max] before presenting", () => {
    const over = renderEnergy(140, 100);
    expect(over).toContain("aria-valuenow=\"100\"");
    expect(over).toContain("energy-hud__bar-fill--healthy");

    const under = renderEnergy(-5, 100);
    expect(under).toContain("aria-valuenow=\"0\"");
    expect(under).toContain("energy-hud__bar-fill--critical");
  });
});
