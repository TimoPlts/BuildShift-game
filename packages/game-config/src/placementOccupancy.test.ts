/**
 * Actor occupancy for placement — the SHARED "a build may not spawn inside a
 * player" rule, asserted with the same capsule/cuboid mathematics the movement
 * resolver uses.
 *
 * The rule: a candidate piece is blocked when its collision geometry penetrates
 * a capsule by more than the character controller's contact slack — evaluated
 * for BOTH players and each one's current stance — and is permitted where the
 * overlap is geometry a player may legally occupy: a walkable plate within the
 * auto-step window at the feet, and the hollow interior of a CONE shell.
 *
 * All numbers are the real canonical solids: cell 5.12 m, layer 3.84 m, floor
 * slab 0.15 m, wall panel 0.384 m half-thickness, 16 ramp treads of 0.24 m
 * rise, cone roof shell rising to a 1.92 m apex. Capsule: radius 0.35 m,
 * 1.8 m standing / 1.2 m crouched, FEET-convention position.
 */
import { describe, expect, it } from "vitest";
import {
  BUILD_GRID,
  PLAYER_COLLIDER,
  PLAYER_COLLIDER_TOTAL_HEIGHT,
  PLAYER_CROUCH_COLLIDER_TOTAL_HEIGHT,
  PLACEMENT_OCCUPANCY,
  placementActorCapsule,
  placementActorsBlockCandidate,
  capsuleSolidGapMeters,
  structureCuboids,
  type StructureGeometryInput,
} from "./index.js";

const CS = BUILD_GRID.cellSize;
const LH = BUILD_GRID.layerHeight;
const R = PLAYER_COLLIDER.radius;
const STAND = placementActorCapsule({ x: 0, y: 0, z: 0, crouched: false });
const CROUCH = placementActorCapsule({ x: 0, y: 0, z: 0, crouched: true });

const g = (x: number, y: number, z: number) => ({ x, y, z });
const piece = (buildType: "wall" | "floor" | "ramp" | "cone", x: number, y: number, z: number, rotation = 0) =>
  ({ buildType, grid: g(x, y, z), rotation }) satisfies StructureGeometryInput;
/** An explicit box, for the raw-math cases. */
const box = (cx: number, cy: number, cz: number, hx = 0.5, hy = 0.5, hz = 0.5) => ({
  center: { x: cx, y: cy, z: cz },
  halfExtents: { x: hx, y: hy, z: hz },
});
const blocks = (solids: readonly { center: any; halfExtents: any }[], ...actors: any[]) =>
  placementActorsBlockCandidate({ candidate: { cuboids: solids }, actors });

describe("the capsule itself (feet convention, stance-dependent)", () => {
  it("stands 1.8 m and crouches to 1.2 m with the same radius", () => {
    expect(STAND.radius).toBe(R);
    expect(CROUCH.radius).toBe(R);
    // Bottom of the body is the feet: the core segment starts one radius up and
    // the lower sphere closes the gap, so the envelope starts exactly at y.
    expect(STAND.segmentFrom - R).toBe(0);
    expect(STAND.segmentTo + R).toBeCloseTo(PLAYER_COLLIDER_TOTAL_HEIGHT, 10);
    expect(CROUCH.segmentTo + R).toBeCloseTo(PLAYER_CROUCH_COLLIDER_TOTAL_HEIGHT, 10);
    expect(PLAYER_COLLIDER_TOTAL_HEIGHT).toBeCloseTo(1.8, 10);
    expect(PLAYER_CROUCH_COLLIDER_TOTAL_HEIGHT).toBeCloseTo(1.2, 10);
  });

  it("a jump moves the capsule up without changing its shape", () => {
    const air = placementActorCapsule({ x: 1, y: 2.5, z: -1, crouched: false });
    expect(air.segmentTo - air.segmentFrom).toBeCloseTo(STAND.segmentTo - STAND.segmentFrom, 10);
    expect(air.feetY).toBe(2.5);
    expect(air.headY).toBeCloseTo(2.5 + PLAYER_COLLIDER_TOTAL_HEIGHT, 10);
  });
});

describe("exact capsule↔cuboid clearance (no broad AABB involved)", () => {
  it("is minus the radius when the body is inside, zero when exactly touching, positive when clear", () => {
    expect(capsuleSolidGapMeters(STAND, box(0, 1, 0, 1, 1, 1))).toBeCloseTo(-R, 10);
    expect(capsuleSolidGapMeters(STAND, box(1, 1, 0, 1 - R, 1, 1))).toBeCloseTo(0, 10); // face on the capsule surface
    expect(capsuleSolidGapMeters(STAND, box(0, 0.5, 0, 1, 0.4, 1))).toBeCloseTo(-R, 10); // inside, low
    expect(capsuleSolidGapMeters(STAND, box(2, 1, 0, 1, 1, 1))).toBeCloseTo(0.65, 10); // a tile-side clear
  });

  it("measures to the ROUND caps above and below, not the segment ends", () => {
    // Directly overhead / underfoot the nearest point is the sphere surface, so
    // the clearance is the plain gap between body top/bottom and the solid.
    expect(capsuleSolidGapMeters(STAND, box(0, 2.2, 0, 0.2, 0.2, 0.2))).toBeCloseTo(2.0 - PLAYER_COLLIDER_TOTAL_HEIGHT, 10);
    expect(capsuleSolidGapMeters(STAND, box(0, -0.4, 0, 0.2, 0.2, 0.2))).toBeCloseTo(0 - -0.2, 10);
    expect(capsuleSolidGapMeters(CROUCH, box(0, 1.7, 0, 1, 0.2, 1))).toBeCloseTo(0.3, 10);
  });

  it("measures the true nearest point on a horizontal edge", () => {
    // Box face 0.35 m off the axis and its bottom 2.05 m above the segment's
    // top end: the nearest feature is that top edge, so the clearance is the
    // 3-D distance to it minus the radius — a plane-only or AABB-only test
    // would report a different number.
    const gap = capsuleSolidGapMeters(STAND, box(0.85, 4, 0, 0.5, 0.5, 0.5));
    expect(gap).toBeCloseTo(Math.hypot(0.35, 2.05) - R, 10);
    expect(gap).toBeGreaterThan(1.3);
  });

  it("is stance-dependent: the same solid clears a crouch and swallows a stand", () => {
    const slab = box(0, 1.7, 0, 1, 0.2, 1); // occupies y ∈ [1.5, 1.9]
    expect(capsuleSolidGapMeters(STAND, slab)).toBeCloseTo(-0.3, 10);
    expect(capsuleSolidGapMeters(CROUCH, slab)).toBeCloseTo(0.3, 10);
  });
});

describe("occupancy policy: penetration blocks, slack and climbable plates pass", () => {
  it("blocks a wall panel created through a standing body (the reported bug)", () => {
    // The wall on the near edge of the tile ahead, at the actor's own z: the
    // panel (half-thickness 0.384) swallows the capsule.
    const panel = structureCuboids(piece("wall", 0, 0, 1, 0)); // z ∈ [2.176, 2.944]
    expect(panel[0]!.halfExtents.z).toBeCloseTo(0.384, 6); // a panel's half-thickness
    const r = blocks(panel, { x: 0, y: 0, z: CS / 2, crouched: false });
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe("actor_overlap");
    expect(r.depth).toBeGreaterThan(PLACEMENT_OCCUPANCY.contactSlack);
  });

  it("allows a wall beside the body and blocks it once the body is inside the panel", () => {
    const panel = structureCuboids(piece("wall", 0, 0, 1, 0));
    expect(blocks(panel, { x: 0, y: 0, z: 1.5, crouched: false }).blocked).toBe(false);
    // 0.176 m of the panel is inside the capsule — more than the controller's
    // contact slack, and geometry the resolver would have to depenetrate.
    const inside = blocks(panel, { x: 0, y: 0, z: 2.0, crouched: false });
    expect(inside.blocked).toBe(true);
    expect(inside.actorIndex).toBe(0);
    expect(inside.depth).toBeCloseTo(0.174, 3);
    // Right up to the surface is still legitimate contact, not overlap.
    expect(blocks(panel, { x: 0, y: 0, z: 2.176 - R + PLACEMENT_OCCUPANCY.contactSlack, crouched: false }).blocked).toBe(false);
  });

  it("allows the walkable plate at the feet (what the actor simply steps onto)", () => {
    const slab = structureCuboids(piece("floor", 0, 0, 0)); // y ∈ [0, 0.15]
    expect(slab[0]!.halfExtents.y * 2).toBe(0.15);
    const r = blocks(slab, { x: 0, y: 0, z: 0, crouched: false });
    expect(r.blocked).toBe(false);
    expect(capsuleSolidGapMeters(STAND, slab[0]!)).toBeLessThan(0); // it really does overlap the legs
    expect(blocks(slab, { x: 0, y: 0, z: 0, crouched: true }).blocked).toBe(false);
    // Above the auto-step window it is no longer a foot placement.
    const raised = [box(0, PLACEMENT_OCCUPANCY.stepUpTolerance + 0.2, 0, 2, 0.075, 2)];
    expect(blocks(raised, { x: 0, y: 0, z: 0, crouched: false }).blocked).toBe(true);
  });

  it("allows a roof the body can stand under and blocks one that meets it mid-jump", () => {
    const roof = structureCuboids(piece("floor", 0, 1, 0)); // y ∈ [3.84, 3.99]
    expect(blocks(roof, { x: 0, y: 0, z: 0, crouched: false }).blocked).toBe(false);
    expect(blocks(roof, { x: 0, y: 2.5, z: 0, crouched: false }).blocked).toBe(true); // slab across the head mid-jump
    // A plate the body can step up onto is still legal even mid-jump.
    expect(blocks(roof, { x: 0, y: 3.99 - PLACEMENT_OCCUPANCY.stepUpTolerance, z: 0, crouched: false }).blocked).toBe(false);
  });

  it("allows the ramp's walking surface where a body steps onto it and blocks a tread inside the legs", () => {
    const ramp = structureCuboids(piece("ramp", 0, 0, 0, 0));
    // Standing just off the low end: tread 0 (top 0.24 m ≤ the auto-step height)
    // clips the ankle and is a walkable plate, so the piece is legal.
    expect(blocks(ramp, { x: -CS / 2 - 0.3, y: 0, z: 0, crouched: false }).blocked).toBe(false);
    // In the run, the tread that would be created through the legs tops out at
    // 0.48 m — above the step window, so that placement is refused.
    expect(blocks(ramp, { x: -CS / 2 + 0.48, y: 0, z: 0, crouched: false }).blocked).toBe(true);
    // Under the ramp's high end the body has clearance (ramps are open below).
    expect(blocks(ramp, { x: CS / 2 - 0.2, y: 0, z: 0, crouched: false }).blocked).toBe(false);
    // A body a whole tile away is untouched.
    expect(blocks(ramp, { x: CS, y: 0, z: 0, crouched: false }).blocked).toBe(false);
  });

  it("treats a CONE as the hollow shell it is, with the headroom the geometry really gives", () => {
    const cone = structureCuboids(piece("cone", 0, 0, 0));
    // Crouched under the apex (head 1.2 m, shell starts at 1.68 m): legal.
    expect(blocks(cone, { x: 0, y: 0, z: 0, crouched: true }).blocked).toBe(false);
    // Standing under a ground cone's 1.92 m apex does NOT fit — physics, not a
    // bug (the shell's inner surface reaches down past the 1.8 m capsule dome).
    expect(blocks(cone, { x: 0, y: 0, z: 0, crouched: false }).blocked).toBe(true);
    // Inside the SHELL (the ring that crosses 1.28 m at 0.84…1.08 m) is overlap.
    expect(blocks(cone, { x: 1.3, y: 0, z: 0, crouched: false }).blocked).toBe(true);
    // One layer up the interior is hollow only for a CROUCHED body: the shell's
    // inner surface reaches down into a standing capsule's dome, exactly as at
    // ground level, and a body raised further into the run is inside it.
    const elevated = structureCuboids(piece("cone", 0, 1, 0));
    expect(blocks(elevated, { x: 0, y: LH, z: 0, crouched: true }).blocked).toBe(false);
    expect(blocks(elevated, { x: 0, y: LH, z: 0, crouched: false }).blocked).toBe(true);
    expect(blocks(elevated, { x: 0, y: LH + 0.5, z: 0, crouched: false }).blocked).toBe(true);
    // A body with real headroom under the shell is allowed.
    expect(blocks(elevated, { x: 0, y: LH - PLAYER_COLLIDER_TOTAL_HEIGHT - 0.1, z: 0, crouched: false }).blocked).toBe(false);
  });

  it("uses each actor's own stance and checks the whole roster", () => {
    const panel = structureCuboids(piece("wall", 0, 0, 1, 0));
    const r = blocks(
      panel,
      { x: 0, y: 0, z: -4, crouched: false }, // far away
      { x: 0, y: 0, z: 1.5, crouched: true }, // clear of the panel
      { x: 0, y: 0, z: CS / 2, crouched: true }, // inside it
    );
    expect(r.blocked).toBe(true);
    expect(r.actorIndex).toBe(2);
  });

  it("accepts an empty roster and a candidate with no collision geometry", () => {
    expect(placementActorsBlockCandidate({ candidate: { cuboids: [] }, actors: [{ x: 0, y: 0, z: 0, crouched: false }] }).blocked).toBe(false);
    expect(placementActorsBlockCandidate({ candidate: { cuboids: structureCuboids(piece("wall", 0, 0, 1, 0)) }, actors: [] }).blocked).toBe(false);
  });
});
