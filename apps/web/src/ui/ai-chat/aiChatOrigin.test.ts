import { describe, expect, it } from "vitest";
import { aiChatEndpoint, resolveAiChatOrigin } from "./aiChatOrigin";

describe("resolveAiChatOrigin — derived from the game-server URL config", () => {
  it("keeps chat on the same host and port as the containerized page", () => {
    expect(aiChatEndpoint(
      { VITE_GAME_SERVER_URL: "same-origin" },
      { protocol: "http:", hostname: "game.example.test", host: "game.example.test:8080" },
    )).toBe("http://game.example.test:8080/api/ai-chat");
  });

  it("keeps chat on the school HTTPS origin without an internal port", () => {
    expect(aiChatEndpoint(
      { VITE_GAME_SERVER_URL: "same-origin" },
      { protocol: "https:", hostname: "ai-operations-14.devbitapp.be", host: "ai-operations-14.devbitapp.be" },
    )).toBe("https://ai-operations-14.devbitapp.be/api/ai-chat");
  });

  it("uses the runtime game-server override ahead of the build-time URL", () => {
    expect(aiChatEndpoint(
      { VITE_GAME_SERVER_URL: "ws://unused.example.test:2567" },
      { protocol: "http:", hostname: "frontend.example.test", search: "?gameServer=ws://127.0.0.1:25809" },
    )).toBe("http://127.0.0.1:25809/api/ai-chat");
  });

  it("uses the current remote browser hostname and HTTPS scheme", () => {
    expect(aiChatEndpoint({}, { protocol: "https:", hostname: "game.example.test" }))
      .toBe("https://game.example.test:2567/api/ai-chat");
  });

  it("falls back to the local dev origin when VITE_GAME_SERVER_URL is unset", () => {
    expect(resolveAiChatOrigin({})).toBe("http://localhost:2567");
  });

  it("maps ws:// to http:// (no hardcoded host)", () => {
    expect(
      resolveAiChatOrigin({ VITE_GAME_SERVER_URL: "ws://game.local:2567" }),
    ).toBe("http://game.local:2567");
  });

  it("maps wss:// to https://", () => {
    expect(
      resolveAiChatOrigin({ VITE_GAME_SERVER_URL: "wss://staging.example.com:2567" }),
    ).toBe("https://staging.example.com:2567");
  });

  it("accepts an already-HTTP game-server URL", () => {
    expect(
      resolveAiChatOrigin({ VITE_GAME_SERVER_URL: "http://192.168.1.10:2567" }),
    ).toBe("http://192.168.1.10:2567");
  });

  it("ignores a whitespace-only env value and uses the default", () => {
    expect(resolveAiChatOrigin({ VITE_GAME_SERVER_URL: "   " })).toBe(
      "http://localhost:2567",
    );
  });

  it("rejects URLs that cannot be mapped to an HTTP(S) origin", () => {
    expect(() =>
      resolveAiChatOrigin({ VITE_GAME_SERVER_URL: "file:///etc/passwd" }),
    ).toThrow(/Cannot derive the AI Guide origin/);
  });

  it("aiChatEndpoint appends /api/ai-chat to the derived origin", () => {
    expect(aiChatEndpoint({ VITE_GAME_SERVER_URL: "ws://game.local:2567" })).toBe(
      "http://game.local:2567/api/ai-chat",
    );
  });
});
