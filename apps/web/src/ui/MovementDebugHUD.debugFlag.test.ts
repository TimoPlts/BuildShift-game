/**
 * Tests for the explicit debug-HUD opt-in helper.
 *
 * The development movement/debug HUD is hidden by default; it is only shown
 * when the caller explicitly opts in through the `?debug=1` / `?debug=true`
 * URL query parameter.
 */
import { describe, expect, it } from "vitest";
import { debugHudEnabledFromUrl } from "./MovementDebugHUD";

function urlWith(query: string): URL {
  return new URL(`https://localhost/session${query}`);
}

describe("debugHudEnabledFromUrl", () => {
  it("is disabled without the debug parameter (hidden by default)", () => {
    expect(debugHudEnabledFromUrl(new URL("https://localhost/session"))).toBe(
      false,
    );
    expect(
      debugHudEnabledFromUrl(new URL("https://localhost/session?theme=dark")),
    ).toBe(false);
  });

  it("is enabled with ?debug=1", () => {
    expect(debugHudEnabledFromUrl(urlWith("?debug=1"))).toBe(true);
  });

  it("is enabled with ?debug=true", () => {
    expect(debugHudEnabledFromUrl(urlWith("?debug=true"))).toBe(true);
  });

  it("rejects other debug parameter values (no truthy-string coercion)", () => {
    expect(debugHudEnabledFromUrl(urlWith("?debug=0"))).toBe(false);
    expect(debugHudEnabledFromUrl(urlWith("?debug=yes"))).toBe(false);
    expect(debugHudEnabledFromUrl(urlWith("?debug="))).toBe(false);
  });

  it("coexists with other query parameters", () => {
    expect(debugHudEnabledFromUrl(urlWith("?theme=dark&debug=1"))).toBe(true);
    expect(debugHudEnabledFromUrl(urlWith("?debug=true&verbose=0"))).toBe(true);
  });

  it("defaults to disabled in non-browser environments when no URL is given", () => {
    // vitest runs in a node environment: no window, so the helper must not
    // throw and must stay disabled.
    expect(typeof window).toBe("undefined");
    expect(debugHudEnabledFromUrl()).toBe(false);
  });
});
