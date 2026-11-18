// @vitest-environment happy-dom
/**
 * Runtime wiring coverage for the preparation seam in the REAL React mount
 * path (R2 of the round-prep QA review): the replicated preparation flag and
 * the local preparation side must flow all the way from the runtime's
 * authoritative match-state emission into BOTH the lifecycle view handed to
 * App (banner source) and the MatchHud props (BUILD flag + waiting-pill
 * suppression). Optional props compiling is NOT proof — this mounts
 * GameCanvas against a controlled runtime and a spy GameHud and asserts the
 * rendered data for each preparation moment.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatchPhase } from "@buildshift/protocol";
import type { MatchLifecycleView } from "./matchLifecycleView";
import type { ParsedMatchState } from "./network";

const runtimeMocks = vi.hoisted(() => ({
  create: vi.fn(),
  hudProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("./GameRuntime", () => ({
  GameRuntime: { create: runtimeMocks.create },
}));

// Spy on the presentation-only HUD so the exact MatchHudProps the client
// mapper produced for each emission are observable.
vi.mock("../ui/hud/GameHud", () => ({
  GameHud: ({ match }: { match: Record<string, unknown> }) => {
    runtimeMocks.hudProps.push(match);
    return null;
  },
}));

import { GameCanvas } from "./GameCanvas";

/** Controlled runtime: snapshots are pushed through the captured listener. */
function createRuntime() {
  return {
    start: vi.fn(),
    dispose: vi.fn(),
    getLocalHudView: vi.fn(() => ({})),
    getMatchState: vi.fn(() => snapshot(false)),
    getSessionId: vi.fn(() => "session-a"),
    getCountdownSeconds: vi.fn(() => 8),
    getPreparationSide: vi.fn(() => (lastPrepActive ? preparationSide : "")),
    connected: true,
    onLocalHudChange: vi.fn(() => () => {}),
    onMatchStateChange: vi.fn((listener: (state: ParsedMatchState) => void) => {
      emit = listener;
      return () => {};
    }),
    leaveRoom: vi.fn(),
    rejoinRoom: vi.fn(),
    requestRematch: vi.fn(),
    setGameplayInputSuppressed: vi.fn(),
  };
}

let emit: ((state: ParsedMatchState) => void) | undefined;
let preparationSide = "";
// Mirrors the REAL getter semantics: GameRuntime only exposes a side while
// preparation is actually active (syncPreparation gates it), so the mock
// must not leak a side into non-preparation emissions.
let lastPrepActive = false;

/** Fresh COUNTDOWN round-0 room; `preparationActive` exactly as replicated. */
function snapshot(preparationActive: boolean, currentRound = 0): ParsedMatchState {
  return {
    matchPhase: MatchPhase.COUNTDOWN,
    roundScore: { "session-a": 0, "session-b": 0 },
    currentRound,
    lastRoundResult: null,
    matchWinnerId: null,
    preparationActive,
  };
}

describe("GameCanvas preparation wiring", () => {
  let host: HTMLDivElement;
  let root: Root;
  let unmounted: boolean;
  let lifecycle: MatchLifecycleView[];

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    runtimeMocks.create.mockReset();
    runtimeMocks.hudProps.length = 0;
    emit = undefined;
    preparationSide = "";
    lastPrepActive = false;
    lifecycle = [];
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
  });

  async function mount() {
    const runtime = createRuntime();
    runtimeMocks.create.mockResolvedValue(runtime);
    await act(async () => {
      root.render(<GameCanvas onMatchLifecycleChange={(v) => lifecycle.push(v)} />);
    });
    await act(async () => {
      await vi.waitFor(() => expect(runtimeMocks.create).toHaveBeenCalled());
    });
    return runtime;
  }

  /** Push one replicated snapshot through the runtime's emission seam. */
  async function push(state: ParsedMatchState) {
    lastPrepActive = state.preparationActive;
    await act(async () => {
      emit?.(state);
    });
  }

  const lastHud = () => runtimeMocks.hudProps[runtimeMocks.hudProps.length - 1];
  const lastView = () => lifecycle[lifecycle.length - 1];

  it("primes the initial view preparation-free (current snapshot, no stale flags)", async () => {
    await mount();
    expect(lifecycle).toHaveLength(1);
    expect(lifecycle[0].preparationActive).toBe(false);
    expect(lifecycle[0].preparationSide).toBe("");
  });

  it("first preparation with currentRound 0 renders preparing data, not waiting", async () => {
    await mount();
    // The side is replicated from the join onwards, but only reaches the
    // view while preparation is active (runtime gating) — model that.
    preparationSide = "negative";

    // Round-0 COUNTDOWN WITHOUT the replicated flag: waiting data.
    await push(snapshot(false));
    expect(lastView().preparationActive).toBe(false);
    expect(lastView().preparationSide).toBe("");
    expect(lastHud().waitingForOpponent).toBe(true);
    expect(lastHud().preparationActive).toBe(false);

    // The second player joins: the SAME phase / round / scores now carry
    // preparationActive = true. This is the first preparation of the match.
    await push(snapshot(true));
    expect(lastView().currentRound).toBe(0);
    expect(lastView().preparationActive).toBe(true);
    expect(lastView().preparationSide).toBe("negative");
    // HUD: BUILD flag set and the waiting pill is excluded.
    expect(lastHud().preparationActive).toBe(true);
    expect(lastHud().waitingForOpponent).toBe(false);
  });

  it("preparation pauses and resumes inside COUNTDOWN round 0 with no phase/score change", async () => {
    await mount();
    preparationSide = "positive";
    await push(snapshot(true));
    expect(lastHud().preparationActive).toBe(true);
    expect(lastView().preparationSide).toBe("positive");

    // Pause: the flag drops while everything else is identical.
    preparationSide = "";
    await push(snapshot(false));
    expect(lastView().preparationActive).toBe(false);
    expect(lastView().preparationSide).toBe("");
    expect(lastHud().preparationActive).toBe(false);

    // Resume: the toggle alone re-triggers the preparing presentation.
    preparationSide = "positive";
    await push(snapshot(true));
    expect(lastView().preparationActive).toBe(true);
    expect(lastView().preparationSide).toBe("positive");
    expect(lastHud().preparationActive).toBe(true);
    expect(lastHud().waitingForOpponent).toBe(false);
  });

  it("stale preparation fields reset on the next round and on disconnect", async () => {
    const runtime = await mount();
    preparationSide = "negative";
    await push(snapshot(true));
    expect(lastView().preparationActive).toBe(true);

    // Next round: the runtime's reset + re-sync leave the flags cleared, so
    // the emission carries fresh (false / "") values, not the round-0 ones.
    preparationSide = "";
    await push({ ...snapshot(false), currentRound: 1 });
    expect(lastView().preparationActive).toBe(false);
    expect(lastView().preparationSide).toBe("");
    expect(lastHud().preparationActive).toBe(false);
    expect(lastHud().waitingForOpponent).toBe(false); // round 1 — not waiting

    // Disconnect: with the connection down the view must not keep a stale
    // side hint or a live preparation presentation (App gates overlays on
    // `connected`, the builder zeroes the side).
    runtime.connected = false;
    preparationSide = "negative";
    await push(snapshot(true));
    expect(lastView().connected).toBe(false);
    expect(lastView().preparationSide).toBe("");
    expect(lastHud().waitingForOpponent).toBe(false); // disconnected — not waiting
  });

  it("the side hint data reaches the view structurally for the UI derivation", async () => {
    await mount();
    preparationSide = "positive";
    await push(snapshot(true));
    // PreparationUiSource reads `preparationSide` structurally off the view
    // (approved UI branch) — no further UI change is required.
    expect(lastView()).toMatchObject({
      preparationActive: true,
      preparationSide: "positive",
      roundState: "COUNTDOWN",
    });
  });
});
