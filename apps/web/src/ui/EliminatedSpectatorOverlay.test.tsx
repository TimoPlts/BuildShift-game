/**
 * Rendering tests for the EliminatedSpectatorOverlay component.
 *
 * The project's test toolchain runs vitest in a node environment without a
 * DOM testing library, so these tests render the component to static markup
 * (SSR) and assert on the resulting HTML: the overlay's accessibility
 * contract (role, aria-live, aria-label), its data-driven classes, and its
 * content (title, subtitle, vignette).
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EliminatedSpectatorOverlay } from "./EliminatedSpectatorOverlay";

describe("EliminatedSpectatorOverlay", () => {
  it("renders the eliminated/spectating content when visible", () => {
    const html = renderToStaticMarkup(
      createElement(EliminatedSpectatorOverlay, { visible: true }),
    );

    expect(html).toContain('class="eliminated-overlay');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(
      'aria-label="You have been eliminated. Spectating the round."',
    );
    expect(html).toContain("ELIMINATED");
    expect(html).toContain("SPECTATING");
    expect(html).toContain("eliminated-overlay__vignette");
    // Root div does not carry aria-hidden when visible
    const rootMatch = html.match(/<div class="eliminated-overlay[^"]*"[^>]*>/);
    expect(rootMatch).not.toBeNull();
    expect(rootMatch![0]).not.toContain('aria-hidden');
    // Not in leaving state
    expect(html).not.toContain("eliminated-overlay--leaving");
  });

  it("renders the leaving state with animation class and aria-hidden", () => {
    const html = renderToStaticMarkup(
      createElement(EliminatedSpectatorOverlay, { visible: false }),
    );

    expect(html).toContain("eliminated-overlay--leaving");
    expect(html).toContain('aria-live="off"');
    // The root gets aria-hidden when leaving
    expect(html).toContain("aria-hidden");
    // Content is still present (for the CSS fade-out)
    expect(html).toContain("ELIMINATED");
    expect(html).toContain("SPECTATING");
  });

  it("renders the vignette with aria-hidden so it is not read by screen readers", () => {
    const html = renderToStaticMarkup(
      createElement(EliminatedSpectatorOverlay, { visible: true }),
    );

    // The vignette div has aria-hidden="true"
    const vignetteMatch = html.match(
      /<div[^>]*class="eliminated-overlay__vignette"[^>]*>/,
    );
    expect(vignetteMatch).not.toBeNull();
    expect(vignetteMatch![0]).toContain('aria-hidden="true"');
  });

  it("does not add the leaving class when visible is true", () => {
    const html = renderToStaticMarkup(
      createElement(EliminatedSpectatorOverlay, { visible: true }),
    );

    expect(html).not.toContain("eliminated-overlay--leaving");
  });
});
