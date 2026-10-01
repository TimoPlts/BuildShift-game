/**
 * Port module barrel smoke test (Stage P7C-B).
 *
 * A tiny, dependency-free smoke test for the pure `port` module.
 * It verifies that the module's public exports are well-formed and that
 * `resolvePort` honours its documented precedence without requiring a
 * running server or any native dependencies.
 *
 * Behaviour is unchanged: this test imports and observes the module, it does
 * not mutate any runtime code path.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_PORT, resolvePort } from "./port.js";

describe("port module (smoke)", () => {
  it("exports DEFAULT_PORT as the documented fallback", () => {
    expect(DEFAULT_PORT).toBe(2567);
  });

  it("exports resolvePort as a function", () => {
    expect(typeof resolvePort).toBe("function");
  });

  it("returns DEFAULT_PORT when no env vars are set", () => {
    expect(resolvePort({})).toBe(DEFAULT_PORT);
  });

  it("prefers GAME_SERVER_PORT over PORT", () => {
    expect(resolvePort({ GAME_SERVER_PORT: "9999", PORT: "8888" })).toBe(9999);
  });

  it("falls through to PORT when GAME_SERVER_PORT is absent", () => {
    expect(resolvePort({ PORT: "7777" })).toBe(7777);
  });

  it("ignores non-numeric values and returns DEFAULT_PORT", () => {
    expect(resolvePort({ GAME_SERVER_PORT: "abc", PORT: "xyz" })).toBe(
      DEFAULT_PORT,
    );
  });
});
