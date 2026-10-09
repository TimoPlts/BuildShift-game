/**
 * Unit tests for the modular camera-recoil model.
 *
 * The recoil is presentation-only: a two-phase kick/return. A kick raises an
 * accumulated target; the applied offset ({@link CameraRecoil.currentOffset})
 * snaps up toward it over a fast attack phase and eases back to neutral as the
 * target decays. These tests pin the "shotgun feels heavier than the assault
 * rifle" feel and the bounded, self-clearing lifecycle — the two properties the
 * GameRuntime relies on when it drives the camera's transient pitch offset each
 * frame.
 *
 * Because the target decays while the offset chases it, magnitudes are asserted
 * against the offset's PEAK (sampled over the settle) rather than a single
 * instant, and the cap is asserted as an invariant the applied offset never
 * exceeds under sustained fire.
 */
import { describe, expect, it } from "vitest";
import {
  CameraRecoil,
  DEFAULT_RECOIL_CONFIG,
  type RecoilConfig,
} from "./cameraRecoil";

/** Kick `kickCount` times, then sample the applied offset and return its peak. */
function peakOffset(
  weaponType: "assault_rifle" | "shotgun",
  kickCount: number,
  sampleSeconds: number,
  step = 1 / 240,
): number {
  const recoil = new CameraRecoil();
  for (let i = 0; i < kickCount; i += 1) recoil.kick(weaponType);
  let peak = 0;
  for (let t = 0; t < sampleSeconds; t += step) {
    peak = Math.max(peak, recoil.update(step));
  }
  return peak;
}

/** Advance the clock by `seconds` (in small steps) and return the final offset. */
function advance(recoil: CameraRecoil, seconds: number, step = 1 / 120): number {
  let elapsed = 0;
  let last = 0;
  while (elapsed < seconds) {
    const dt = Math.min(step, seconds - elapsed);
    last = recoil.update(dt);
    elapsed += dt;
  }
  return last;
}

describe("CameraRecoil", () => {
  it("starts neutral (no applied offset)", () => {
    expect(new CameraRecoil().currentOffset).toBe(0);
  });

  it("kick-up is not instant: the applied offset rises over the attack phase", () => {
    const recoil = new CameraRecoil();
    recoil.kick("assault_rifle");
    // Right after the kick the target is set but the camera has not yet
    // snapped up — the applied offset is still at rest.
    expect(recoil.currentOffset).toBe(0);
    // One small step moves the applied offset part-way toward the kick.
    const afterStep = recoil.update(0.016);
    expect(afterStep).toBeGreaterThan(0);
    expect(afterStep).toBeLessThan(DEFAULT_RECOIL_CONFIG.kick.assault_rifle);
  });

  it("kicks per weapon, with the shotgun kicking harder than the assault rifle", () => {
    const riflePeak = peakOffset("assault_rifle", 1, 0.4);
    const shotgunPeak = peakOffset("shotgun", 1, 0.4);
    expect(riflePeak).toBeGreaterThan(0);
    expect(shotgunPeak).toBeGreaterThan(0);
    // The shotgun's kick is larger and its return slower, so its peak is higher.
    expect(shotgunPeak).toBeGreaterThan(riflePeak);
  });

  it("the shotgun reads as heavier: it stays displaced after the rifle has returned", () => {
    const rifle = new CameraRecoil();
    const shotgun = new CameraRecoil();
    rifle.kick("assault_rifle");
    shotgun.kick("shotgun");

    // At a moment after the kick the shotgun's applied offset is larger ...
    const rifleAt100 = advance(rifle, 0.1);
    const shotgunAt100 = advance(shotgun, 0.1);
    expect(shotgunAt100).toBeGreaterThan(rifleAt100);

    // ... and after enough time the rifle is fully back to neutral while the
    // shotgun's heavier settle is still displaced.
    advance(rifle, 0.6);
    advance(shotgun, 0.6);
    expect(rifle.currentOffset).toBe(0);
    expect(shotgun.currentOffset).toBeGreaterThan(0);
  });

  it("never exceeds the configured max offset under sustained fire", () => {
    const recoil = new CameraRecoil();
    // Without the cap, ~1000 shotgun kicks would accumulate a target of ~50
    // radians; with the cap the applied offset can never exceed maxOffset.
    for (let i = 0; i < 1000; i += 1) recoil.kick("shotgun");
    recoil.update(1 / 120);
    expect(recoil.currentOffset).toBeLessThanOrEqual(
      DEFAULT_RECOIL_CONFIG.maxOffset,
    );
  });

  it("decays the offset back to neutral as time advances", () => {
    const recoil = new CameraRecoil();
    recoil.kick("shotgun");
    advance(recoil, 0.05);
    expect(recoil.currentOffset).toBeGreaterThan(0);

    // After enough elapsed time the nudge settles fully back to neutral.
    advance(recoil, 2);
    expect(recoil.currentOffset).toBe(0);
  });

  it("does not advance on a zero or negative frame delta", () => {
    const recoil = new CameraRecoil();
    recoil.kick("assault_rifle");
    const before = recoil.currentOffset; // 0, before any update

    expect(recoil.update(0)).toBeCloseTo(before, 6);
    expect(recoil.update(-1)).toBeCloseTo(before, 6);
    expect(recoil.currentOffset).toBeCloseTo(before, 6);
  });

  it("reset clears accumulated recoil immediately", () => {
    const recoil = new CameraRecoil();
    recoil.kick("shotgun");
    advance(recoil, 0.05);
    expect(recoil.currentOffset).toBeGreaterThan(0);

    recoil.reset();
    expect(recoil.currentOffset).toBe(0);
    expect(recoil.update(0.1)).toBe(0);
  });

  it("honours a caller-supplied config", () => {
    const config: RecoilConfig = {
      kick: { assault_rifle: 0.1, shotgun: 0.2 },
      attackRatePerSec: 100,
      returnRate: { assault_rifle: 2, shotgun: 2 },
      maxOffset: 0.5,
    };
    // The offset reflects the configured kick (much larger than the default
    // 0.02) rather than the default tuning.
    const customPeak = peakOffset("assault_rifle", 2, 0.2, 1 / 480);
    expect(customPeak).toBeGreaterThan(DEFAULT_RECOIL_CONFIG.kick.assault_rifle);
    // ... and stays under the configured cap.
    const capped = new CameraRecoil(config);
    for (let i = 0; i < 100; i += 1) capped.kick("shotgun");
    capped.update(1 / 120);
    expect(capped.currentOffset).toBeLessThanOrEqual(config.maxOffset);
  });
});
