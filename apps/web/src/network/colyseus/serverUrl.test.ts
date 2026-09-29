import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_SERVER_URL,
  GAME_SERVER_URL_ENV,
  resolveGameServerUrl,
} from "./serverUrl";

describe("serverUrl", () => {
  it("returns the default local URL when the environment is empty", () => {
    expect(resolveGameServerUrl({})).toBe("ws://localhost:2567");
  });

  it("returns the default when the variable is undefined", () => {
    expect(resolveGameServerUrl({ [GAME_SERVER_URL_ENV]: undefined })).toBe(
      DEFAULT_GAME_SERVER_URL,
    );
  });

  it("returns the default when the variable is empty or whitespace-only", () => {
    expect(resolveGameServerUrl({ [GAME_SERVER_URL_ENV]: "" })).toBe(
      DEFAULT_GAME_SERVER_URL,
    );
    expect(resolveGameServerUrl({ [GAME_SERVER_URL_ENV]: "   " })).toBe(
      DEFAULT_GAME_SERVER_URL,
    );
  });

  it("prefers a non-empty VITE_GAME_SERVER_URL over the default", () => {
    expect(
      resolveGameServerUrl({ [GAME_SERVER_URL_ENV]: "ws://example.test:2567" }),
    ).toBe("ws://example.test:2567");
  });

  it("trims surrounding whitespace from a provided value", () => {
    expect(
      resolveGameServerUrl({ [GAME_SERVER_URL_ENV]: "  wss://example.test  " }),
    ).toBe("wss://example.test");
  });
});
