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
    setReticleElement: undefined as never,
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
    // Centred-aim invariant: the crosshair is a static CSS-centre element;
    // the runtime must never be handed it (no projected-reticle seam).
    expect((runtime as unknown as Record<string, unknown>).setReticleElement).toBeUndefined();
  });

  it("renders the static centred crosshair with no runtime-driven markup when locked", async () => {
    const runtime = createRuntime();
    runtimeMocks.create.mockResolvedValue(runtime);

    await act(async () => {
      root.render(<GameCanvas />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const canvas = host.querySelector("canvas");
    expect(canvas).not.toBeNull();
    // Crosshair only exists in gameplay (pointer locked) — and when present
    // it carries NO inline style: the runtime never moves it (centred-aim
    // invariant: the camera shares the shot line, centre == shot ray).
    expect(host.querySelector(".crosshair")).toBeNull();
    Object.defineProperty(document, "pointerLockElement", {
      configurable: true,
      get: () => canvas,
    });
    try {
      await act(async () => {
        document.dispatchEvent(new Event("pointerlockchange"));
      });
      const crosshair = host.querySelector(".crosshair");
      expect(crosshair).not.toBeNull();
      expect(crosshair?.getAttribute("style")).toBeNull();
    } finally {
      delete (document as { pointerLockElement?: unknown }).pointerLockElement;
    }
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

  it("shows the accurate, context-grouped keybinds while the pointer is unlocked", async () => {
    const runtime = createRuntime();
    runtimeMocks.create.mockResolvedValue(runtime);

    await act(async () => {
      root.render(<GameCanvas />);
    });

    // The pointer is not locked in the test environment, so the pre-play
    // overlay (with the control hints) is visible.
    const hints = host.querySelector(".control-hints");
    expect(hints).not.toBeNull();
    const text = hints?.textContent ?? "";

    // Move group — mirrors the InputManager movement bindings.
    expect(text).toContain("Move");
    expect(text).toContain("W A S D");
    expect(text).toContain("Space");
    expect(text).toContain("jump");
    expect(text).toContain("look");
    // Combat group — fire, reload and the 1/2 weapon-switch keys.
    expect(text).toContain("Combat");
    expect(text).toContain("fire");
    expect(text).toContain("reload");
    expect(text).toContain("weapons");
    // Build group — mirrors BuildingInputController (B, 1-4, Q/E, place).
    expect(text).toContain("Build");
    expect(text).toContain("build mode");
    expect(text).toContain("select piece");
    expect(text).toContain("rotate");
    expect(text).toContain("place");
    // Edit group — mirrors BuildEditInputController (F, tile select, Enter,
    // C, Backspace).
    expect(text).toContain("Edit");
    expect(text).toContain("edit mode");
    expect(text).toContain("select tile");
    expect(text).toContain("confirm");
    expect(text).toContain("cancel");
    expect(text).toContain("reset");
    // System group — pointer-lock release.
    expect(text).toContain("Esc");
  });

});
