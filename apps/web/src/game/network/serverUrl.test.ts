import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_SERVER_URL, resolveGameServerUrl } from "./serverUrl";

describe("production game server URL resolution", () => {
  it("uses an explicit deployment endpoint when configured", () => {
    expect(
      resolveGameServerUrl(
        { VITE_GAME_SERVER_URL: " wss://games.example.test " },
        { protocol: "https:", hostname: "frontend.example.test" },
      ),
    ).toBe("wss://games.example.test");
  });

  it("uses the frontend host and secure protocol for an unconfigured browser", () => {
    expect(
      resolveGameServerUrl({}, { protocol: "https:", hostname: "frontend.example.test" }),
    ).toBe("wss://frontend.example.test:2567");
  });

  it("keeps the local default for non-browser callers", () => {
    expect(resolveGameServerUrl({}, undefined)).toBe(DEFAULT_GAME_SERVER_URL);
  });
});
