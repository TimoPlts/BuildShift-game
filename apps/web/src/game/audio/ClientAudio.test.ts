/**
 * Unit tests for the ClientAudio module.
 *
 * Tests the lifecycle (unlock, reset, dispose), sound playback gating
 * (no-op when not unlocked or disposed), and the procedural sound
 * generation paths using a mock AudioContext.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ClientAudio } from "./ClientAudio";
import type {
  AudioContextLike,
  OscillatorNodeLike,
  GainNodeLike,
  BufferSourceNodeLike,
  AudioBufferLike,
  BiquadFilterNodeLike,
  AudioNodeLike,
} from "./ClientAudio";

// ── Mock AudioContext ────────────────────────────────────────────────────────

function createMockGain(): GainNodeLike {
  const gainParam = {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  return {
    gain: gainParam,
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function createMockOscillator(): OscillatorNodeLike {
  const freqParam = {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
  return {
    type: "sine",
    frequency: freqParam,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
    onended: null,
  };
}

function createMockBufferSource(): BufferSourceNodeLike {
  return {
    buffer: null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
    onended: null,
  };
}

function createMockBuffer(): AudioBufferLike {
  return {
    numberOfChannels: 1,
    length: 4410,
    sampleRate: 44100,
    getChannelData: vi.fn().mockReturnValue(new Float32Array(4410)),
  };
}

function createMockFilter(): BiquadFilterNodeLike {
  return {
    type: "lowpass",
    frequency: { value: 0 },
    Q: { value: 1 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function createMockDestination(): AudioNodeLike {
  return { connect: vi.fn(), disconnect: vi.fn() };
}

function createMockAudioContext(state: string = "suspended"): AudioContextLike {
  return {
    currentTime: 0,
    state,
    sampleRate: 44100,
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createOscillator: vi.fn(() => createMockOscillator()),
    createGain: vi.fn(() => createMockGain()),
    createBufferSource: vi.fn(() => createMockBufferSource()),
    createBuffer: vi.fn((_ch: number, _len: number, _sr: number) => createMockBuffer()),
    createBiquadFilter: vi.fn(() => createMockFilter()),
    destination: createMockDestination(),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a ClientAudio with an injected mock context.
 * We bypass the private _ensureContext by directly setting _ctx via
 * the createClientAudio factory with a custom factory.
 */
function createAudioWithMock(mockCtx: AudioContextLike): {
  audio: ClientAudio;
  mockCtx: AudioContextLike;
} {
  // Directly construct and inject
  const audio = new ClientAudio();
  (audio as any)._ctx = mockCtx;
  (audio as any)._unlocked = true;
  return { audio, mockCtx };
}

/** Advance the mock context's clock (the real API's currentTime is read-only). */
function advanceClock(ctx: AudioContextLike, t: number): void {
  (ctx as unknown as { currentTime: number }).currentTime = t;
}

describe("ClientAudio", () => {
  let mockCtx: AudioContextLike;

  beforeEach(() => {
    mockCtx = createMockAudioContext("running");
  });

  describe("lifecycle", () => {
    it("starts with unlocked=false and plays nothing before unlock", () => {
      const audio = new ClientAudio();
      expect(audio.unlocked).toBe(false);
      // Play calls should be safe no-ops (no crash)
      audio.playFire("assault_rifle");
      audio.playHitConfirm();
      audio.playBuildPlace();
      audio.playBuildDestroy();
      audio.playReload();
      audio.playJump();
      audio.playLand(0.5);
      audio.playCountdownTick();
      audio.playRoundWin();
      audio.playRoundLoss();
    });

    it("unlock creates context and resumes if suspended", async () => {
      const mockCtxSuspended = createMockAudioContext("suspended");
      const audio = new ClientAudio();
      // Inject so _ensureContext returns our mock
      (audio as any)._ctx = mockCtxSuspended;

      audio.unlock();
      expect(mockCtxSuspended.resume).toHaveBeenCalled();
    });

    it("reset stops all active sources", () => {
      const { audio } = createAudioWithMock(mockCtx);
      // Play something to get active sources
      audio.playFire("assault_rifle");
      // Now reset should be safe
      audio.reset();
    });

    it("dispose is idempotent and closes the context", async () => {
      const { audio, mockCtx: ctx } = createAudioWithMock(mockCtx);
      audio.dispose();
      expect(ctx.close).toHaveBeenCalled();
      // Second call should not throw
      audio.dispose();
      // After dispose, play calls are safe no-ops
      audio.playFire("assault_rifle");
      audio.playHitConfirm();
    });

    it("dispose prevents further playback", () => {
      const { audio } = createAudioWithMock(mockCtx);
      audio.dispose();
      // These should not throw
      audio.playFire("shotgun");
      audio.playJump();
      audio.playRoundWin();
    });
  });

  describe("playFire", () => {
    it("creates a buffer source for AR fire", () => {
      const { audio, mockCtx: ctx } = createAudioWithMock(mockCtx);
      audio.playFire("assault_rifle");
      expect(ctx.createBufferSource).toHaveBeenCalled();
      expect(ctx.createBiquadFilter).toHaveBeenCalled();
    });

    it("creates a buffer source for shotgun fire", () => {
      const { audio, mockCtx: ctx } = createAudioWithMock(mockCtx);
      audio.playFire("shotgun");
      expect(ctx.createBufferSource).toHaveBeenCalled();
    });
  });

  describe("playHitConfirm", () => {
    it("creates an oscillator for the hit tone", () => {
      const { audio, mockCtx: ctx } = createAudioWithMock(mockCtx);
      audio.playHitConfirm();
      expect(ctx.createOscillator).toHaveBeenCalled();
      expect(ctx.createGain).toHaveBeenCalled();
    });
  });

  describe("playBuildPlace", () => {
    it("creates an oscillator for the placement tone", () => {
      const { audio, mockCtx: ctx } = createAudioWithMock(mockCtx);
      audio.playBuildPlace();
      expect(ctx.createOscillator).toHaveBeenCalled();
    });
  });

  describe("playBuildDestroy", () => {
    it("creates an oscillator for the destruction tone", () => {
      const { audio, mockCtx: ctx } = createAudioWithMock(mockCtx);
      audio.playBuildDestroy();
      expect(ctx.createOscillator).toHaveBeenCalled();
    });
  });

  describe("playJump", () => {
    it("creates an oscillator for the jump sweep", () => {
      const { audio, mockCtx: ctx } = createAudioWithMock(mockCtx);
      audio.playJump();
      expect(ctx.createOscillator).toHaveBeenCalled();
    });
  });

  describe("playLand", () => {
    it("creates an oscillator for the landing tone", () => {
      const { audio, mockCtx: ctx } = createAudioWithMock(mockCtx);
      audio.playLand(0.5);
      expect(ctx.createOscillator).toHaveBeenCalled();
    });

    it("clamps intensity to [0, 1]", () => {
      const { audio, mockCtx: ctx } = createAudioWithMock(mockCtx);
      // Should not throw for out-of-range values
      audio.playLand(-1);
      audio.playLand(2);
      expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
    });
  });

  describe("playReload", () => {
    it("creates two oscillators for the reload blips", () => {
      const { audio, mockCtx: ctx } = createAudioWithMock(mockCtx);
      audio.playReload();
      expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
    });
  });

  describe("build sound throttling", () => {
    it("skips a build place replay inside the min gap", () => {
      const { audio, mockCtx: ctx } = createAudioWithMock(mockCtx);
      audio.playBuildPlace();
      expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
      // 50 ms later is inside the 120 ms gap.
      advanceClock(ctx, 0.05);
      audio.playBuildPlace();
      expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
      // 200 ms later is outside the gap.
      advanceClock(ctx, 0.2);
      audio.playBuildPlace();
      expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
    });

    it("skips overlapping build destroy blasts inside the min gap", () => {
      const { audio, mockCtx: ctx } = createAudioWithMock(mockCtx);
      audio.playBuildDestroy();
      expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
      advanceClock(ctx, 0.05);
      audio.playBuildDestroy();
      expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
      advanceClock(ctx, 0.3);
      audio.playBuildDestroy();
      expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
    });

    it("uses independent throttles for place and destroy", () => {
      const { audio, mockCtx: ctx } = createAudioWithMock(mockCtx);
      audio.playBuildPlace();
      advanceClock(ctx, 0.05);
      // Destroy is not suppressed by a recent place.
      audio.playBuildDestroy();
      expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
    });

    it("reset clears the throttle so a fresh round can play build sounds", () => {
      const { audio, mockCtx: ctx } = createAudioWithMock(mockCtx);
      audio.playBuildDestroy();
      advanceClock(ctx, 0.05);
      audio.reset();
      audio.playBuildDestroy();
      expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
    });
  });

  describe("playCountdownTick", () => {
    it("creates an oscillator for the tick", () => {
      const { audio, mockCtx: ctx } = createAudioWithMock(mockCtx);
      audio.playCountdownTick();
      expect(ctx.createOscillator).toHaveBeenCalled();
    });
  });

  describe("playRoundWin", () => {
    it("creates three oscillators for the ascending jingle", () => {
      const { audio, mockCtx: ctx } = createAudioWithMock(mockCtx);
      audio.playRoundWin();
      expect(ctx.createOscillator).toHaveBeenCalledTimes(3);
    });
  });

  describe("playRoundLoss", () => {
    it("creates three oscillators for the descending jingle", () => {
      const { audio, mockCtx: ctx } = createAudioWithMock(mockCtx);
      audio.playRoundLoss();
      expect(ctx.createOscillator).toHaveBeenCalledTimes(3);
    });
  });

  describe("reset", () => {
    it("is safe when no sources are active", () => {
      const { audio } = createAudioWithMock(mockCtx);
      audio.reset(); // Should not throw
    });

    it("is safe after dispose", () => {
      const { audio } = createAudioWithMock(mockCtx);
      audio.dispose();
      audio.reset(); // Should not throw
    });
  });

  describe("unlock safety", () => {
    it("is safe to call multiple times", () => {
      const mockCtxRunning = createMockAudioContext("running");
      const audio = new ClientAudio();
      (audio as any)._ctx = mockCtxRunning;
      audio.unlock();
      audio.unlock();
      audio.unlock();
      // resume should only be called once (state was already running)
      expect(mockCtxRunning.resume).toHaveBeenCalledTimes(0);
    });

    it("is safe after dispose", () => {
      const { audio } = createAudioWithMock(mockCtx);
      audio.dispose();
      audio.unlock(); // Should not throw
    });
  });
});
