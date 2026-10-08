/**
 * ClientAudio — self-contained, procedurally-generated client-side audio
 * presentation layer.
 *
 * Design constraints:
 *  - Presentation only: responds to existing local/authoritative events;
 *    never determines timing, gameplay, networking, hit detection, or
 *    server state.
 *  - All sounds are generated procedurally via Web Audio API oscillators
 *    and noise buffers (no external assets, license-safe).
 *  - Browser unlock: the AudioContext starts suspended; the module attaches
 *    one-time `pointerdown`/`keydown` listeners on `window` to resume it
 *    (standard user-gesture unlock pattern).
 *  - Full lifecycle: `unlock()`, `reset()`, `dispose()` — safe across
 *    round reset, rematch, reconnect, and teardown.
 *
 * Public API:
 *  - `unlock()` — resume the AudioContext (also called automatically on
 *    first user interaction).
 *  - `playFire(weaponType)` — AR or shotgun fire sound.
 *  - `playHitConfirm()` — confirmed hit marker sound.
 *  - `playBuildPlace()` — structure placement sound.
 *  - `playBuildDestroy()` — structure destruction sound.
 *  - `playJump()` — jump takeoff sound.
 *  - `playLand(intensity)` — landing sound (intensity 0–1).
 *  - `playCountdownTick()` — countdown tick sound.
 *  - `playRoundWin()` — round win jingle.
 *  - `playRoundLoss()` — round loss jingle.
 *  - `reset()` — stop all active sources (round reset / reconnect).
 *  - `dispose()` — remove unlock listeners, disconnect all nodes, close
 *    the AudioContext. Idempotent.
 */

import type { WeaponType } from "@buildshift/protocol";

/** A narrow interface so tests can substitute a fake AudioContext. */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: string;
  resume(): Promise<void>;
  close(): Promise<void>;
  createOscillator(): OscillatorNodeLike;
  createGain(): GainNodeLike;
  createBufferSource(): BufferSourceNodeLike;
  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): AudioBufferLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  readonly destination: AudioNodeLike;
  readonly sampleRate: number;
}

export interface OscillatorNodeLike {
  type: string;
  frequency: { value: number; setValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void };
  connect(dest: AudioNodeLike): void;
  start(when?: number): void;
  stop(when?: number): void;
  disconnect(): void;
  onended: (() => void) | null;
}

export interface GainNodeLike {
  gain: { value: number; setValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void };
  connect(dest: AudioNodeLike): void;
  disconnect(): void;
}

export interface BufferSourceNodeLike {
  buffer: AudioBufferLike | null;
  connect(dest: AudioNodeLike): void;
  start(when?: number): void;
  stop(when?: number): void;
  disconnect(): void;
  onended: (() => void) | null;
}

export interface AudioBufferLike {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export interface BiquadFilterNodeLike {
  type: string;
  frequency: { value: number };
  Q: { value: number };
  connect(dest: AudioNodeLike): void;
  disconnect(): void;
}

export interface AudioNodeLike {
  connect(dest: AudioNodeLike): void;
  disconnect(): void;
}

/**
 * The modular client audio component.
 */
export class ClientAudio {
  private _ctx: AudioContextLike | null = null;
  private _disposed = false;
  private _unlocked = false;
  private readonly _activeSources: Set<
    OscillatorNodeLike | BufferSourceNodeLike
  > = new Set();
  private _unlockPointerHandler: (() => void) | null = null;
  private _unlockKeyHandler: (() => void) | null = null;

  /**
   * Attempt to resume the AudioContext. Safe to call multiple times.
   * If no AudioContext has been created yet, one is created (suspended).
   */
  public unlock(): void {
    if (this._disposed) return;
    if (this._unlocked) return;
    const ctx = this._ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      void ctx.resume().then(() => {
        this._unlocked = true;
      }).catch(() => {
        // Browser may refuse if no user gesture — will retry on next unlock.
      });
    } else if (ctx.state === "running") {
      this._unlocked = true;
    }
    this._attachUnlockListeners();
  }

  /** Whether the AudioContext is currently running (audio can play). */
  public get unlocked(): boolean {
    return this._unlocked;
  }

  /** Play the AR fire sound. */
  public playFire(weaponType: WeaponType): void {
    if (this._disposed || !this._unlocked) return;
    const ctx = this._ctx;
    if (!ctx) return;

    if (weaponType === "shotgun") {
      this._playNoiseBurst(0.08, 0.12, 400, 0.6);
    } else {
      // assault_rifle (default)
      this._playNoiseBurst(0.04, 0.06, 800, 0.4);
    }
  }

  /** Play the confirmed-hit sound. */
  public playHitConfirm(): void {
    if (this._disposed || !this._unlocked) return;
    const ctx = this._ctx;
    if (!ctx) return;
    this._playTone(880, 0.05, "sine", 0.3);
  }

  /** Play the build placement sound. */
  public playBuildPlace(): void {
    if (this._disposed || !this._unlocked) return;
    const ctx = this._ctx;
    if (!ctx) return;
    this._playTone(200, 0.1, "sine", 0.35);
  }

  /** Play the build destruction sound. */
  public playBuildDestroy(): void {
    if (this._disposed || !this._unlocked) return;
    const ctx = this._ctx;
    if (!ctx) return;
    this._playTone(80, 0.2, "sawtooth", 0.5);
  }

  /** Play the jump takeoff sound. */
  public playJump(): void {
    if (this._disposed || !this._unlocked) return;
    const ctx = this._ctx;
    if (!ctx) return;
    this._playSweep(400, 600, 0.08, "sine", 0.2);
  }

  /** Play the landing sound. `intensity` in [0, 1]. */
  public playLand(intensity: number): void {
    if (this._disposed || !this._unlocked) return;
    const ctx = this._ctx;
    if (!ctx) return;
    const vol = 0.15 + 0.35 * Math.max(0, Math.min(1, intensity));
    this._playTone(150, 0.06, "sine", vol);
  }

  /** Play the countdown tick sound. */
  public playCountdownTick(): void {
    if (this._disposed || !this._unlocked) return;
    const ctx = this._ctx;
    if (!ctx) return;
    this._playTone(1000, 0.03, "square", 0.15);
  }

  /** Play the round win jingle. */
  public playRoundWin(): void {
    if (this._disposed || !this._unlocked) return;
    const ctx = this._ctx;
    if (!ctx) return;
    // Ascending three-note arpeggio.
    this._playTone(523.25, 0.12, "sine", 0.3); // C5
    this._playTone(659.25, 0.12, "sine", 0.3, 0.12); // E5
    this._playTone(783.99, 0.18, "sine", 0.35, 0.24); // G5
  }

  /** Play the round loss jingle. */
  public playRoundLoss(): void {
    if (this._disposed || !this._unlocked) return;
    const ctx = this._ctx;
    if (!ctx) return;
    // Descending three-note arpeggio.
    this._playTone(783.99, 0.12, "sine", 0.3); // G5
    this._playTone(659.25, 0.12, "sine", 0.3, 0.12); // E5
    this._playTone(523.25, 0.18, "sine", 0.35, 0.24); // C5
  }

  /**
   * Stop all active audio sources immediately. Called on round reset or
   * reconnect to prevent stale sounds from carrying over.
   */
  public reset(): void {
    if (this._disposed) return;
    for (const src of this._activeSources) {
      try {
        src.stop?.();
        src.disconnect();
      } catch {
        // Ignore — source may already be stopped.
      }
    }
    this._activeSources.clear();
  }

  /**
   * Idempotent teardown: removes unlock listeners, disconnects all active
   * sources, and closes the AudioContext.
   */
  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.reset();
    this._removeUnlockListeners();
    if (this._ctx) {
      void this._ctx.close().catch(() => {});
      this._ctx = null;
    }
    this._unlocked = false;
  }

  // ── internals ─────────────────────────────────────────────────────────

  private _ensureContext(): AudioContextLike | null {
    if (this._ctx) return this._ctx;
    if (typeof window === "undefined" || typeof (window as any).AudioContext === "undefined") {
      return null;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctor = (window as any).AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctor) return null;
      this._ctx = new Ctor() as AudioContextLike;
    } catch {
      return null;
    }
    return this._ctx;
  }

  private _attachUnlockListeners(): void {
    if (this._unlockPointerHandler || this._unlockKeyHandler) return;
    if (typeof window === "undefined") return;
    this._unlockPointerHandler = () => this.unlock();
    this._unlockKeyHandler = () => this.unlock();
    window.addEventListener("pointerdown", this._unlockPointerHandler);
    window.addEventListener("keydown", this._unlockKeyHandler);
  }

  private _removeUnlockListeners(): void {
    if (typeof window === "undefined") return;
    if (this._unlockPointerHandler) {
      window.removeEventListener("pointerdown", this._unlockPointerHandler);
      this._unlockPointerHandler = null;
    }
    if (this._unlockKeyHandler) {
      window.removeEventListener("keydown", this._unlockKeyHandler);
      this._unlockKeyHandler = null;
    }
  }

  /** Play a simple tone (oscillator → gain → destination). */
  private _playTone(
    freq: number,
    duration: number,
    type: string,
    volume: number,
    delay = 0,
  ): void {
    const ctx = this._ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
    this._trackSource(osc);
    osc.onended = () => {
      this._activeSources.delete(osc);
      osc.disconnect();
      gain.disconnect();
    };
  }

  /** Play a frequency sweep. */
  private _playSweep(
    fromFreq: number,
    toFreq: number,
    duration: number,
    type: string,
    volume: number,
  ): void {
    const ctx = this._ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fromFreq, t);
    osc.frequency.linearRampToValueAtTime(toFreq, t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
    this._trackSource(osc);
    osc.onended = () => {
      this._activeSources.delete(osc);
      osc.disconnect();
      gain.disconnect();
    };
  }

  /** Play a filtered white-noise burst. */
  private _playNoiseBurst(
    attackDur: number,
    totalDur: number,
    filterFreq: number,
    volume: number,
  ): void {
    const ctx = this._ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const sampleRate = ctx.sampleRate;
    const length = Math.ceil(totalDur * sampleRate);
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterFreq;
    filter.Q.value = 1;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + attackDur);
    gain.gain.exponentialRampToValueAtTime(0.001, t + totalDur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(t);
    src.stop(t + totalDur);
    this._trackSource(src);
    src.onended = () => {
      this._activeSources.delete(src);
      src.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  private _trackSource(
    src: OscillatorNodeLike | BufferSourceNodeLike,
  ): void {
    this._activeSources.add(src);
  }
}

/**
 * Factory for creating a ClientAudio instance with an injectable
 * AudioContext constructor (for tests).
 */
export function createClientAudio(
  audioContextFactory?: () => AudioContextLike | null,
): ClientAudio {
  const audio = new ClientAudio();
  if (audioContextFactory) {
    // Inject the factory by patching _ensureContext.
    const originalEnsure = (audio as any)._ensureContext.bind(audio);
    (audio as any)._ensureContext = (): AudioContextLike | null => {
      if ((audio as any)._ctx) return (audio as any)._ctx;
      const ctx = audioContextFactory();
      if (ctx) {
        (audio as any)._ctx = ctx;
      }
      return (audio as any)._ctx ?? originalEnsure();
    };
  }
  return audio;
}
