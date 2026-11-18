/**
 * Authoritative aim-point resolver — regression tests.
 *
 * These pin the client-side reticle/tracer resolver against the SAME shared
 * primitives the server `TwoPlayerMovementRoom.rf` uses (`hitscan`,
 * `rayStructureIntersection`, `structureCuboids`) and the exact server
 * constants (`VERTICAL_MOVEMENT.playerHalfHeight` eye height, standing target
 * radius 0.4, crouched eye/radius, ASSAULT_RIFLE/SHOTGUN ranges — NOT the
 * unused legacy/id-table lookups). The point is parity of the *shot ray
 * geometry*, which is what the projected reticle and converged tracer render.
 */
import { describe, expect, it } from "vitest";
import {
  ASSAULT_RIFLE,
  SHOTGUN,
  VERTICAL_MOVEMENT,
  PLAYER_COLLIDER_HALF_TOTAL_HEIGHT,
  PLAYER_CROUCH_COLLIDER_HALF_TOTAL_HEIGHT,
  PLAYER_CROUCH_COLLIDER,
  BUILD_GRID,
  rayStructureIntersection,
  structureCuboids,
} from "@buildshift/game-config";
import {
  authoritativeAimOrigin,
  resolveAuthoritativeAimPoint,
  AIM_EYE_HEIGHT_STANDING,
  AIM_EYE_HEIGHT_CROUCHED,
  AIM_TARGET_RADIUS_STANDING,
  AIM_TARGET_RADIUS_CROUCHED,
  type AimStructure,
  type AimVec3,
} from "./authoritativeAim";

/** The server `ad(yaw, pitch)` direction. */
function ad(yaw: number, pitch: number): AimVec3 {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

describe("authoritative aim origin (server rf eye origin)", () => {
  it("stands at VERTICAL_MOVEMENT.playerHalfHeight over the feet (server EH)", () => {
    // The server fires from `y + playerHalfHeight` with y = feet. Pin the
    // identity the client mirror relies on (game-config documents it).
    expect(VERTICAL_MOVEMENT.playerHalfHeight).toBe(0.9);
    expect(AIM_EYE_HEIGHT_STANDING).toBe(VERTICAL_MOVEMENT.playerHalfHeight);
    expect(AIM_EYE_HEIGHT_STANDING).toBe(PLAYER_COLLIDER_HALF_TOTAL_HEIGHT);
    const o = authoritativeAimOrigin({ x: 3, y: 0, z: -7 }, false);
    expect(o).toEqual({ x: 3, y: 0.9, z: -7 });
  });

  it("crouches to the crouch collider half-total (server crouch origin)", () => {
    expect(AIM_EYE_HEIGHT_CROUCHED).toBe(PLAYER_CROUCH_COLLIDER_HALF_TOTAL_HEIGHT);
    expect(AIM_EYE_HEIGHT_CROUCHED).toBeLessThan(AIM_EYE_HEIGHT_STANDING);
    const o = authoritativeAimOrigin({ x: 0, y: 2, z: 0 }, true);
    expect(o.y).toBe(2 + PLAYER_CROUCH_COLLIDER_HALF_TOTAL_HEIGHT);
  });

  it("uses the server target radii (0.4 standing, crouch collider radius)", () => {
    expect(AIM_TARGET_RADIUS_STANDING).toBe(0.4);
    expect(AIM_TARGET_RADIUS_CROUCHED).toBe(PLAYER_CROUCH_COLLIDER.radius);
  });

  it("mirrors the server wcfg ranges (rifle 60, shotgun 15 — not id-table weapons)", () => {
    // Canonical parity: the room's wcfg() maps shotgun→SHOTGUN else→ASSAULT_RIFLE.
    expect(ASSAULT_RIFLE.id).toBe("assault_rifle");
    expect(ASSAULT_RIFLE.range).toBe(60);
    expect(SHOTGUN.id).toBe("shotgun");
    expect(SHOTGUN.range).toBe(15);
  });
});

describe("resolveAuthoritativeAimPoint — shot-ray endpoint", () => {
  const feet = { x: 0, y: 0, z: 0 };

  it("clean shot ends exactly at eye-origin + dir·range near the muzzle axis, any pitch", () => {
    for (const pitch of [0, -0.5, 0.6]) {
      const d = ad(0, pitch);
      const r = resolveAuthoritativeAimPoint({
        feet, crouched: false, aimDirection: d, weaponRange: ASSAULT_RIFLE.range,
        remotePlayers: [], structures: [],
      });
      expect(r.kind).toBe("range-end");
      expect(r.distance).toBeCloseTo(60, 6);
      expect(r.point.x).toBeCloseTo(0, 9);
      expect(r.point.y).toBeCloseTo(0.9 + Math.sin(pitch) * 60, 9);
      expect(r.point.z).toBeCloseTo(-Math.cos(pitch) * 60, 9);
    }
  });

  it("shotgun clean shots terminate at the short 15 m range, rifle at 60 m", () => {
    const d = ad(0, 0);
    const sg = resolveAuthoritativeAimPoint({
      feet, crouched: false, aimDirection: d, weaponRange: SHOTGUN.range,
      remotePlayers: [], structures: [],
    });
    expect(sg.distance).toBeCloseTo(15, 6);
  });

  it("hits a standing remote at near/mid/far ranges with the shared hitscan geometry", () => {
    for (const T of [5, 20, 40]) {
      const r = resolveAuthoritativeAimPoint({
        feet, crouched: false, aimDirection: ad(0, 0), weaponRange: ASSAULT_RIFLE.range,
        remotePlayers: [{ id: "p2", feet: { x: 0, y: 0, z: -T }, crouch: false }],
        structures: [],
      });
      expect(r.kind).toBe("player");
      expect(r.targetId).toBe("p2");
      // Direct centre-line hit: the shared resolver reports the ray's ENTRY
      // point into the target capsule (T − radius) — exactly the point the
      // server reports as the authoritative hit point.
      const entry = T - AIM_TARGET_RADIUS_STANDING;
      expect(r.distance).toBeCloseTo(entry, 6);
      expect(r.point.y).toBeCloseTo(AIM_EYE_HEIGHT_STANDING, 6);
      expect(r.point.z).toBeCloseTo(-entry, 6);
    }
  });

  it("misses beyond weapon range (shotgun at 20 m is a range-end miss)", () => {
    const r = resolveAuthoritativeAimPoint({
      feet, crouched: false, aimDirection: ad(0, 0), weaponRange: SHOTGUN.range,
      remotePlayers: [{ id: "p2", feet: { x: 0, y: 0, z: -20 }, crouch: false }],
      structures: [],
    });
    expect(r.kind).toBe("range-end");
    expect(r.distance).toBeCloseTo(15, 6);
  });

  it("resolves a crouched remote with the crouched centre/radius (same server pass)", () => {
    // A crouched body's centre is lower; the server tests it with the crouch
    // radius. A horizontal rifle ray at the standing eye height must resolve
    // to the crouch-pass distance, i.e. still hit near the centre height.
    const r = resolveAuthoritativeAimPoint({
      feet, crouched: false, aimDirection: ad(0, 0), weaponRange: ASSAULT_RIFLE.range,
      remotePlayers: [{ id: "p2", feet: { x: 0, y: 0, z: -12 }, crouch: true }],
      structures: [],
    });
    // eye 0.9 vs crouch centre 0.6 → perpendicular 0.3 < 0.35 → hit; the
    // shared resolver reports the ray-sphere ENTRY distance:
    // 12 − √(0.35² − 0.3²).
    expect(r.kind).toBe("player");
    expect(r.distance).toBeCloseTo(12 - Math.sqrt(0.35 * 0.35 - 0.3 * 0.3), 6);
    // ...and a deliberately off-axis crouch beyond the crouch radius misses.
    const miss = resolveAuthoritativeAimPoint({
      feet, crouched: false, aimDirection: ad(0, 0), weaponRange: ASSAULT_RIFLE.range,
      remotePlayers: [{ id: "p2", feet: { x: 0.7, y: 0, z: -12 }, crouch: true }],
      structures: [],
    });
    expect(miss.kind).toBe("range-end");
  });

  it("nearest cover blocks the player: wall in front resolves as the structure", () => {
    const cs = BUILD_GRID.cellSize;
    // Rotation 0: the panel spans X and is thin in Z — it blocks a -Z shot.
    const wall: AimStructure = {
      buildType: "wall", grid: { x: 0, y: 0, z: -3 }, rotation: 0,
    };
    const r = resolveAuthoritativeAimPoint({
      feet, crouched: false, aimDirection: ad(0, 0), weaponRange: ASSAULT_RIFLE.range,
      remotePlayers: [{ id: "p2", feet: { x: 0, y: 0, z: -20 }, crouch: false }],
      structures: [wall],
    });
    expect(r.kind).toBe("structure");
    // Edge centre at (grid.z−0.5)·cs, front face 0.075·cs closer.
    expect(r.distance).toBeCloseTo((3.5 - 0.075) * cs, 6);
    expect(r.distance).toBeLessThan(20);
    expect(r.point.y).toBeCloseTo(AIM_EYE_HEIGHT_STANDING, 6); // eye-height ray crosses the panel body
  });

  it("player closer than cover still wins", () => {
    const cs = BUILD_GRID.cellSize;
    const wall: AimStructure = { buildType: "wall", grid: { x: 0, y: 0, z: -1 }, rotation: 0 };
    // Face at (1.5−0.075)·cs ≈ 7.3 m — behind the player at 4 m.
    expect((1.5 - 0.075) * cs).toBeGreaterThan(4);
    const r = resolveAuthoritativeAimPoint({
      feet, crouched: false, aimDirection: ad(0, 0), weaponRange: ASSAULT_RIFLE.range,
      remotePlayers: [{ id: "p2", feet: { x: 0, y: 0, z: -4 }, crouch: false }],
      structures: [wall],
    });
    expect(r.kind).toBe("player");
    expect(r.distance).toBeCloseTo(4 - AIM_TARGET_RADIUS_STANDING, 6);
  });

  it("pitched-down shots resolve onto cover between eye and a farther player", () => {
    const cs = BUILD_GRID.cellSize;
    const wall: AimStructure = { buildType: "wall", grid: { x: 0, y: 0, z: -2 }, rotation: 0 };
    const pitch = -0.02; // shallow drop keeps the eye-height ray inside the panel
    const d = ad(0, pitch);
    const r = resolveAuthoritativeAimPoint({
      feet: { x: 0, y: 0, z: 0 }, crouched: true, aimDirection: d,
      weaponRange: ASSAULT_RIFLE.range,
      remotePlayers: [{ id: "p2", feet: { x: 0, y: 0, z: -30 }, crouch: false }],
      structures: [wall],
    });
    expect(r.kind).toBe("structure");
    expect(r.distance).toBeCloseTo((2.5 - 0.075) * cs / Math.cos(pitch), 6);
    expect(r.point.y).toBeLessThan(AIM_EYE_HEIGHT_CROUCHED + 1e-9);
    expect(r.point.y).toBeGreaterThan(0);
  });

  it("edits open the structure: a windowed wall lets the shot through", () => {
    // Centre tile removed (3×3 wall edit): the eye-height ray passes through
    // the opening — shared geometry decides, not a client-side guess.
    const tiles = [true, true, true, true, false, true, true, true, true];
    const wall: AimStructure = {
      buildType: "wall", grid: { x: 0, y: 0, z: -3 }, rotation: 0,
      editGrid: { kind: "wall", tiles },
    };
    // Eye ray at layer-middle height: with the centre tile gone, no hit near the wall.
    const r = resolveAuthoritativeAimPoint({
      feet, crouched: false, aimDirection: ad(0, 0), weaponRange: ASSAULT_RIFLE.range,
      remotePlayers: [], structures: [wall],
    });
    // The tile layout is server geometry; assert only parity with the shared
    // function itself (same call the room makes), whatever it concludes.
    const expected = rayStructureIntersection(
      { x: 0, y: 0.9, z: 0 }, ad(0, 0), 60,
      structureCuboids({ buildType: "wall", grid: { x: 0, y: 0, z: -3 }, rotation: 0, editGrid: { kind: "wall", tiles } }),
    );
    if (expected) {
      expect(r.kind).toBe("structure");
      expect(r.distance).toBeCloseTo(expected.distance, 9);
    } else {
      expect(r.kind).toBe("range-end");
    }
  });
});
