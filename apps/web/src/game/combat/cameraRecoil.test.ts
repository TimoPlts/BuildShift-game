/**
 * Unit tests for the modular camera-recoil model.
 *
 * The recoil is presentation-only: a per-weapon kick that accumulates across
 * accepted shots and decays exponentially back to a neutral view. These tests
 * pin the "shotgun feels heavier than the assault rifle" feel and the
 * bounded, self-clearing lifecycle — the two properties the GameRuntime relies
 * on when it drives the camera's transient pitch offset each frame.
 */
import { describe, expect, it } from "vitest";
import {
  CameraRecoil,
  DEFAULT_RECOIL_CONFIG,
} from "./cameraRecoil";

describe("CameraRecoil", () => {
  it("starts neutral (no offset)", () => {
    expect(new CameraRecoil().currentOffset).toBe(0);
  });

  it("kicks per weapon, with the shotgun kicking harder than the assault rifle", () => {
    const rifle = new CameraRecoil();
    const shotgun = new CameraRecoil();
    rifle.kick("assault_rifle");
    shotgun.kick("shotgun");

    expect(rifle.currentOffset).toBeCloseTo(
      DEFAULT_RECOIL_CONFIG.kick.assault_rifle,
      6,
    );
    expect(shotgun.currentOffset).toBeCloseTo(
      DEFAULT_RECOIL_CONFIG.kick.shotgun,
      6,
    );
    expect(shotgun.currentOffset).toBeGreaterThan(rifle.currentOffset);
  });

  it("accumulates across kicks but is capped at the configured max offset", () => {
    const recoil = new CameraRecoil();
    for (let i = 0; i < 100; i += 1) {
      recoil.kick("shotgun");
    }
    expect(recoil.currentOffset).toBe(DEFAULT_RECOIL_CONFIG.maxOffset);
  });

  it("decays the offset exponentially toward zero as time advances", () => {
    const recoil = new CameraRecoil();
    recoil.kick("shotgun");
    const start = recoil.currentOffset;

    const after100ms = recoil.update(0.1);
    expect(after100ms).toBeGreaterThan(0);
    expect(after100ms).toBeLessThan(start);
    expect(after100ms).toBeCloseTo(
      start * Math.exp(-DEFAULT_RECOIL_CONFIG.decayRatePerSec * 0.1),
      6,
    );

    // After enough elapsed time the nudge settles fully back to neutral.
    for (let i = 0; i < 100; i += 1) {
      recoil.update(0.1);
    }
    expect(recoil.currentOffset).toBe(0);
  });

  it("does not decay on a zero or negative frame delta", () => {
    const recoil = new CameraRecoil();
    recoil.kick("assault_rifle");
    const start = recoil.currentOffset;

    expect(recoil.update(0)).toBeCloseTo(start, 6);
    expect(recoil.update(-1)).toBeCloseTo(start, 6);
    expect(recoil.currentOffset).toBeCloseTo(start, 6);
  });

  it("reset clears accumulated recoil immediately", () => {
    const recoil = new CameraRecoil();
    recoil.kick("shotgun");
    expect(recoil.currentOffset).toBeGreaterThan(0);

    recoil.reset();
    expect(recoil.currentOffset).toBe(0);
    expect(recoil.update(0.1)).toBe(0);
  });

  it("honours a caller-supplied config", () => {
    const recoil = new CameraRecoil({
      kick: { assault_rifle: 0.1, shotgun: 0.2 },
      decayRatePerSec: 5,
      maxOffset: 0.3,
    });

    recoil.kick("assault_rifle");
    recoil.kick("assault_rifle");
    expect(recoil.currentOffset).toBeCloseTo(0.2, 6);

    recoil.kick("assault_rifle"); // reaches the cap
    expect(recoil.currentOffset).toBeCloseTo(0.3, 6);
    recoil.kick("assault_rifle"); // stays capped
    expect(recoil.currentOffset).toBeCloseTo(0.3, 6);
  });
});
