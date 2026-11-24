import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_SERVER_URL,
  GAME_SERVER_URL_QUERY_PARAM,
  resolveGameServerUrl,
} from "./serverUrl";

describe("production game server URL resolution", () => {
  it("uses the page port for the Docker single-origin deployment", () => {
    expect(resolveGameServerUrl(
      { VITE_GAME_SERVER_URL: "same-origin" },
      { protocol: "http:", hostname: "100.117.176.125", host: "100.117.176.125:8080" },
    )).toBe("ws://100.117.176.125:8080");
  });

  it("uses secure WebSockets on the school HTTPS origin", () => {
    expect(resolveGameServerUrl(
      { VITE_GAME_SERVER_URL: "same-origin" },
      { protocol: "https:", hostname: "ai-operations-14.devbitapp.be", host: "ai-operations-14.devbitapp.be" },
    )).toBe("wss://ai-operations-14.devbitapp.be");
  });

  it("preserves an IPv6 host and port", () => {
    expect(resolveGameServerUrl(
      { VITE_GAME_SERVER_URL: "same-origin" },
      { protocol: "http:", hostname: "::1", port: "8080" },
    )).toBe("ws://[::1]:8080");
  });

  it("requires a browser location for single-origin routing", () => {
    expect(() => resolveGameServerUrl({ VITE_GAME_SERVER_URL: "same-origin" }, undefined))
      .toThrow("requires a browser location");
  });

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

  it("honours the ?gameServer= runtime override for a browser page", () => {
    expect(
      resolveGameServerUrl(
        {},
        {
          protocol: "http:",
          hostname: "127.0.0.1",
          search: `?devdiag=1&${GAME_SERVER_URL_QUERY_PARAM}=ws://127.0.0.1:25671`,
        },
      ),
    ).toBe("ws://127.0.0.1:25671");
  });

  it("lets the ?gameServer= runtime override win over the build-time env", () => {
    expect(
      resolveGameServerUrl(
        { VITE_GAME_SERVER_URL: "wss://games.example.test" },
        {
          protocol: "https:",
          hostname: "frontend.example.test",
          search: `?${GAME_SERVER_URL_QUERY_PARAM}=wss://isolated.example.test:443`,
        },
      ),
    ).toBe("wss://isolated.example.test:443");
  });

  it("ignores a malformed ?gameServer= value and falls back", () => {
    const location = {
      protocol: "https:",
      hostname: "frontend.example.test",
      search: `?${GAME_SERVER_URL_QUERY_PARAM}=http://not-a-websocket`,
    };
    expect(resolveGameServerUrl({}, location)).toBe(
      "wss://frontend.example.test:2567",
    );
    expect(
      resolveGameServerUrl(
        { VITE_GAME_SERVER_URL: "ws://env.example.test" },
        location,
      ),
    ).toBe("ws://env.example.test");
  });

  it("ignores an empty ?gameServer= value", () => {
    expect(
      resolveGameServerUrl(
        {},
        {
          protocol: "http:",
          hostname: "127.0.0.1",
          search: `?${GAME_SERVER_URL_QUERY_PARAM}=   `,
        },
      ),
    ).toBe("ws://127.0.0.1:2567");
  });
});
