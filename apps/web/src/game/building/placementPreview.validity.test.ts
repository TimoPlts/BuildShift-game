/**
 * The client ghost must never promise a placement the server will refuse.
 *
 * The preview is not authority — the server independently recomputes the same
 * shared rules from replicated state — but a ghost that glows green over a wall
 * that will be refused (through a body, or hanging in mid air) is what made the
 * two reported bugs feel arbitrary to play. These tests take whatever candidate
 * the aim resolver actually snaps to and re-decide it with the shared rule
 * functions the server itself calls, so the ghost's `valid`/`reason` pair is
 * pinned to the authoritative verdict — including the refusal ORDER, which names
 * bodies before support and both before range-cost bookkeeping.
 */
import { describe, expect, it } from "vitest";
import {
  BUILD_GRID,
  isWithinBuildBounds,
  isWithinPlacementRange,
  placementActorsBlockCandidate,
  placementIsSupported,
  structureSlots,
  type PlacementActorPose,
} from "@buildshift/game-config";
import type { BuildType, GridRotation, StructureEditState } from "@buildshift/protocol";
import { computePlacementPreview, type OccupiedStructure, type PlacementPreview } from "./placementPreview.js";

const CS = BUILD_GRID.cellSize;
const LH = BUILD_GRID.layerHeight;

const norm = (v: { x: number; y: number; z: number }) => {
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};

interface Scenario {
  buildType: BuildType;
  rotation?: GridRotation;
  /** The local feet pose: the eye the aim is traced from is feet + shared eye height. */
  feet: { x: number; y: number; z: number };
  /** World point the crosshair is on (structure face or ground plane). */
  aimAt: { x: number; y: number; z: number };
  occupied?: OccupiedStructure[];
  actors?: PlacementActorPose[];
}

const EYE_STANDING = 1.2; // shared SHOT_EYE_HEIGHT_STANDING above the feet

const ghost = (s: Scenario): PlacementPreview => {
  const aimOrigin = { x: s.feet.x, y: s.feet.y + EYE_STANDING, z: s.feet.z };
  return computePlacementPreview({
    aimOrigin,
    aimDirection: norm({ x: s.aimAt.x - aimOrigin.x, y: s.aimAt.y - aimOrigin.y, z: s.aimAt.z - aimOrigin.z }),
    playerPosition: s.feet,
    buildType: s.buildType,
    rotation: s.rotation ?? 0,
    occupied: s.occupied ?? [],
    actors: s.actors ?? [],
  });
};

const occupied = (s: Scenario) =>
  (s.occupied ?? []).map((o) => ({
    buildType: o.buildType,
    grid: o.grid,
    rotation: (o.rotation ?? 0) as GridRotation,
    editGrid: o.editGrid as StructureEditState | undefined,
  }));

/**
 * The authoritative verdict for the candidate the ghost is offering, computed
 * with the shared rules in the server's gate order. `null` = the gates all pass
 * (line of sight is exercised in `placementPreview.occlusion.test.ts`).
 */
const authoritativeReason = (s: Scenario, p: PlacementPreview): string | null => {
  const grid = p.grid!;
  const candidate = { buildType: s.buildType, grid, rotation: p.rotation };
  const existing = occupied(s);
  if (!isWithinBuildBounds(s.buildType, grid, p.rotation)) return "out_of_bounds";
  if (!isWithinPlacementRange(s.feet, grid)) return "out_of_range";
  const mine = new Set(structureSlots(s.buildType, grid, p.rotation));
  if (existing.some((e) => structureSlots(e.buildType, e.grid, e.rotation).some((k) => mine.has(k)))) return "overlap";
  if (placementActorsBlockCandidate({ candidate, actors: s.actors ?? [] }).blocked) return "actor_overlap";
  if (!placementIsSupported({ candidate, structures: existing }).supported) return "unsupported";
  return null;
};

/** Assert the ghost and the authoritative gates give the same answer, reason and all. */
const expectParity = (s: Scenario) => {
  const p = ghost(s);
  expect(p.present, "a ghost is shown").toBe(true);
  expect(p.grid, "the aim resolved a candidate").not.toBeNull();
  const expected = authoritativeReason(s, p);
  if (expected !== null) expect([p.valid, p.reason]).toEqual([false, expected]);
  else expect(p.reason ?? "valid", "the ghost is green exactly when the gates pass").toBe("valid");
  return p;
};

const wall = (x: number, y: number, z: number, rotation: GridRotation): OccupiedStructure => ({ buildType: "wall", grid: { x, y, z }, rotation });
const floor = (x: number, y: number, z: number): OccupiedStructure => ({ buildType: "floor", grid: { x, y, z }, rotation: 0 });

describe("placement preview parity with the authoritative geometry gates", () => {
  // ─── Bug 1: no green ghost over a build through a body ────────────────────

  it("refuses the wall through the local body — the exact pose that used to place", () => {
    // Feet on the tile's −Z boundary line, crosshair straight down onto it: the
    // resolver snaps the wall panel to that edge, which is where the body stands.
    const feet = { x: 0, y: 0, z: -CS / 2 };
    const scenario: Scenario = { buildType: "wall", rotation: 0, feet, aimAt: { x: 0, y: 0.1, z: -CS / 2 }, actors: [{ x: feet.x, y: 0, z: feet.z, crouched: false }] };
    expect(ghost(scenario).reason).toBe("actor_overlap");
    expectParity(scenario);
    // The very same slot is green with no body in its panel.
    expect(ghost({ ...scenario, actors: [] }).valid, "no body in the panel: green").toBe(true);
  });

  it("refuses a full-tile ramp built in the tile the local player is standing in", () => {
    const feet = { x: CS, y: 0, z: 0 };
    const scenario: Scenario = { buildType: "ramp", rotation: 1, feet, aimAt: { x: CS, y: 0.1, z: 0 }, actors: [{ x: feet.x, y: 0, z: feet.z, crouched: false }] };
    expect(ghost(scenario).reason).toBe("actor_overlap");
    expectParity(scenario);
  });

  it("refuses the same candidate when it is an OPPONENT's body in the way", () => {
    const local = { x: 0, y: 0, z: 0 };
    const opponent = { x: CS, y: 0, z: 0, crouched: false };
    const scenario: Scenario = { buildType: "ramp", rotation: 1, feet: local, aimAt: { x: CS, y: 0.1, z: 0 }, actors: [{ x: local.x, y: 0, z: local.z, crouched: false }, opponent] };
    expect(ghost(scenario).reason).toBe("actor_overlap");
    expectParity(scenario);
    // With that actor out of the roster (eliminated, so the runtime drops it),
    // the same aim is green again.
    expectParity({ ...scenario, actors: [{ x: local.x, y: 0, z: local.z, crouched: false }] });
  });

  it("follows the stance, like the server: a cone on the local axis blocks standing, not crouching", () => {
    const feet = { x: 0, y: 0, z: 0 };
    const standing: Scenario = { buildType: "cone", feet, aimAt: { x: 0, y: 0.1, z: 0 }, actors: [{ x: 0, y: 0, z: 0, crouched: false }] };
    expect(ghost(standing).reason).toBe("actor_overlap");
    expectParity(standing);
    expectParity({ buildType: "cone", feet, aimAt: { x: 0, y: 0.1, z: 0 }, actors: [{ x: 0, y: 0, z: 0, crouched: true }] });
  });

  it("keeps the legal neighbours green: the plate under the feet, walls beside the capsule, a roof over the head", () => {
    const feet = { x: 0, y: 0, z: 0 };
    const actors = [{ x: 0, y: 0, z: 0, crouched: false }];
    expectParity({ buildType: "floor", feet, aimAt: { x: 0, y: 0.1, z: 0 }, actors }); // stood on, not through
    const box = [wall(0, 0, 0, 0), wall(0, 0, 0, 1), wall(0, 0, 0, 2), wall(0, 0, 0, 3)];
    expectParity({ buildType: "floor", feet: { x: -CS * 1.4, y: 0, z: -CS * 1.4 }, aimAt: { x: 0, y: LH, z: 0 }, occupied: box }); // on the box's top
    expectParity({ // a parapet on the roof edge, nowhere near the body
      buildType: "wall",
      rotation: 1,
      feet: { x: -CS * 1.4, y: 0, z: -CS * 1.4 },
      aimAt: { x: 0, y: LH * 1.5, z: CS / 2 + 0.01 },
      occupied: [...box, floor(0, 1, 0)],
    });
  });

  // ─── Bug 2: no green ghost for a piece that hangs in mid air ──────────────

  it("refuses an elevated candidate whose neighbours are all floating", () => {
    // A piece left floating (its support was destroyed) is mirrored as-is; a new
    // piece attaching only to it still has no load path to the arena foundation.
    const floating = [wall(0, 1, 0, 0)];
    const scenario: Scenario = {
      buildType: "wall",
      rotation: 0,
      feet: { x: -CS * 1.4, y: 0, z: -CS * 1.4 },
      aimAt: { x: 0, y: LH * 2, z: 0 },
      occupied: floating,
    };
    const p = ghost(scenario);
    expect(p.grid!.y, "the candidate is above the ground plane").toBeGreaterThan(0);
    expect(p.reason).toBe("unsupported");
    expectParity(scenario);
  });

  it("refuses a floor whose only footing is a floating slab", () => {
    const floatingFloor = [floor(0, 2, 0)];
    const scenario: Scenario = {
      buildType: "floor",
      feet: { x: 0, y: 0, z: -CS }, // two tiles back: the far slab stays in range
      aimAt: { x: 0, y: LH * 2 + 0.07, z: -CS / 2 - 0.01 },
      occupied: floatingFloor,
    };
    const p = ghost(scenario);
    expect(p.grid).not.toBeNull();
    expectParity(scenario);
    expect(p.reason).toBe("unsupported");
  });

  it("a piece that reaches the ground through the designed load path is green", () => {
    const grounded = [
      { buildType: "ramp" as const, grid: { x: 0, y: 0, z: 0 }, rotation: 1 as const },
      floor(0, 1, 0), // rests on the ramp crest
      floor(0, 1, 1), // edge onto the next tile
    ];
    expectParity({
      buildType: "wall",
      rotation: 0,
      feet: { x: -CS, y: 0, z: CS },
      aimAt: { x: 0, y: LH * 1.5, z: CS / 2 + 0.01 },
      occupied: grounded,
    });
  });

  // ─── Ordering: bodies are measured before support, both before the rest ───

  it("names the body first when a candidate is both unsupported and occupied", () => {
    const body = { x: CS, y: LH, z: 0 }; // inside the elevated candidate's volume
    const scenario: Scenario = {
      buildType: "wall",
      rotation: 0,
      feet: { x: CS, y: 0, z: CS }, // standing in the tile it is aiming at
      aimAt: { x: CS, y: LH * 1.5, z: 0 },
      occupied: [wall(1, 1, 0, 0), wall(1, 0, 0, 0)], // the layer-1 wall has no footing
      actors: [{ x: body.x, y: LH, z: body.z, crouched: false }],
    };
    const p = ghost(scenario);
    expect(p.grid, "a candidate was resolved").not.toBeNull();
    expect(p.reason).not.toBe(null);
    expectParity(scenario);
  });

  it("agrees with the shared rules across the poses and stacks that produced both bugs", () => {
    const onBoundary = { x: 0, y: 0, z: -CS / 2 };
    const inTile = { x: CS, y: 0, z: 0 };
    const selfOnBoundary: PlacementActorPose[] = [{ x: 0, y: 0, z: -CS / 2, crouched: false }];
    const selfInTile: PlacementActorPose[] = [{ x: CS, y: 0, z: 0, crouched: false }];
    const box = [wall(0, 0, 0, 0), wall(0, 0, 0, 1), wall(0, 0, 0, 2), wall(0, 0, 0, 3)];
    const scenarios: Scenario[] = [
      // bodies
      { buildType: "wall", rotation: 0, feet: onBoundary, aimAt: { x: 0, y: 0.1, z: -CS / 2 }, actors: selfOnBoundary },
      { buildType: "wall", rotation: 0, feet: onBoundary, aimAt: { x: 0, y: 0.1, z: -CS / 2 }, actors: [] },
      { buildType: "ramp", rotation: 1, feet: inTile, aimAt: { x: CS, y: 0.1, z: 0 }, actors: selfInTile },
      { buildType: "ramp", rotation: 1, feet: inTile, aimAt: { x: CS, y: 0.1, z: 0 }, actors: [{ x: CS, y: 0, z: 0, crouched: true }] },
      { buildType: "cone", feet: { x: 0, y: 0, z: 0 }, aimAt: { x: 0, y: 0.1, z: 0 }, actors: [{ x: 0, y: 0, z: 0, crouched: false }] },
      { buildType: "cone", feet: { x: 0, y: 0, z: 0 }, aimAt: { x: 0, y: 0.1, z: 0 }, actors: [{ x: 0, y: 0, z: 0, crouched: true }] },
      { buildType: "ramp", rotation: 1, feet: { x: 0, y: 0, z: 0 }, aimAt: { x: CS * 2, y: 0.1, z: 0 }, actors: selfInTile }, // body elsewhere: legal
      // structures: grounded, floating, roofed
      { buildType: "floor", feet: { x: -CS * 1.4, y: 0, z: -CS * 1.4 }, aimAt: { x: 0, y: LH, z: 0 }, occupied: box },
      { buildType: "wall", rotation: 2, feet: { x: -CS * 1.4, y: 0, z: -CS * 1.4 }, aimAt: { x: 0, y: LH, z: 0 }, occupied: box },
      { buildType: "wall", rotation: 0, feet: { x: -CS * 1.4, y: 0, z: -CS * 1.4 }, aimAt: { x: 0, y: LH * 2, z: 0 }, occupied: [wall(0, 1, 0, 0)] },
      { buildType: "wall", rotation: 0, feet: { x: -CS * 1.4, y: 0, z: -CS * 1.4 }, aimAt: { x: 0, y: LH * 2, z: 0 }, occupied: [wall(0, 0, 0, 0)] },
      { buildType: "floor", feet: { x: -CS * 1.4, y: 0, z: -CS * 1.4 }, aimAt: { x: 0, y: LH * 2 + 0.2, z: 0 }, occupied: [floor(0, 1, 0)] },
    ];
    for (const s of scenarios) expectParity(s);
  });
});
