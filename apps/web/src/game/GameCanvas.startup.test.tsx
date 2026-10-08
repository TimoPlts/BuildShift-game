// @vitest-environment happy-dom
/**
 * Regression coverage for the real React mount path.
 *
 * GameRuntime creation has immediate WebGL side effects. In Vite development
 * React StrictMode performs a synthetic mount/cleanup/mount cycle, so runtime
 * creation must be deferred until that synthetic cleanup has had a chance to
 * cancel it. Otherwise two runtimes can contend for one canvas and the live
 * runtime may never make its canonical Colyseus join.
 */
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("./GameRuntime", () => ({
  GameRuntime: {
    create: runtimeMocks.create,
  },
}));

import { GameCanvas } from "./GameCanvas";

function createRuntime() {
  return {
    start: vi.fn(),
    dispose: vi.fn(),
    getLocalHudView: vi.fn(() => ({})),
    getMatchState: vi.fn(() => ({
      matchPhase: "COUNTDOWN",
      roundScore: {},
      currentRound: 0,
      lastRoundResult: null,
      matchWinnerId: null,
    })),
    getSessionId: vi.fn(() => null),
    getCountdownSeconds: vi.fn(() => 0),
    connected: false,
    onLocalHudChange: vi.fn(() => () => {}),
    onMatchStateChange: vi.fn(() => () => {}),
    leaveRoom: vi.fn(),
    rejoinRoom: vi.fn(),
    requestRematch: vi.fn(),
  };
}

describe("GameCanvas startup", () => {
  let host: HTMLDivElement;
  let root: Root;
  let unmounted: boolean;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    runtimeMocks.create.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    unmounted = false;
  });

  afterEach(async () => {
    if (!unmounted) {
      await act(async () => root.unmount());
    }
    host.remove();
    vi.useRealTimers();
  });

  it("starts one canonical runtime after StrictMode's synthetic cleanup", async () => {
    const runtime = createRuntime();
    runtimeMocks.create.mockResolvedValue(runtime);

    await act(async () => {
      root.render(
        <StrictMode>
          <GameCanvas />
        </StrictMode>,
      );
    });

    // No Babylon runtime (and consequently no NetworkClient) is constructed
    // by StrictMode's throwaway effect pass.
    expect(runtimeMocks.create).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(runtimeMocks.create).toHaveBeenCalledTimes(1);
    expect(runtime.start).toHaveBeenCalledTimes(1);
    expect(runtime.dispose).not.toHaveBeenCalled();
  });

  it("cancels a pending startup instead of constructing then immediately disposing it", async () => {
    await act(async () => {
      root.render(<GameCanvas />);
    });

    await act(async () => root.unmount());
    unmounted = true;
    await vi.advanceTimersByTimeAsync(0);

    expect(runtimeMocks.create).not.toHaveBeenCalled();
  });

});
