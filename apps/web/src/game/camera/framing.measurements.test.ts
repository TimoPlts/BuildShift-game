import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core";
import {
  BUILD_GRID,
  PLAYER_COLLIDER_TOTAL_HEIGHT,
  SHOT_EYE_HEIGHT_STANDING,
} from "@buildshift/game-config";
import { THIRD_PERSON_CAMERA } from "./cameraConfig";
import { ThirdPersonCameraController } from "./ThirdPersonCameraController";
import { AIM_EYE_HEIGHT_STANDING } from "../aim/authoritativeAim";

/**
 * Framing + shot-eye measurements (framing-20261119) — the reported
 * screenshot pose as numbers at the production viewport 1280x720: yaw 0
 * (facing -Z), standing feet at the origin, LEVEL pitch, crosshair pinned
 * at canvas centre (640, 360).
 *
 * TWO fixes are pinned together here:
 *
 *  1. RIG DISTANCE (5.2 -> 3.7 m): the 1.8 m body spanned 148 px (20.5 %)
 *     of screen height — a full mannequin floating at eye line beside its
 *     builds. It now spans 208 px (28.9 %), an over-shoulder foreground
 *     figure at convincing human scale.
 *  2. SHOT-EYE HEIGHT (0.9 -> 1.2 m): the camera pivot, centred reticle ray
 *     and server shot origin share the canonical SHOT_EYE_HEIGHT_STANDING.
 *     The level crosshair now meets a wall at 31 % of its height (bottom/
 *     middle edit-row boundary of the 3x3 panel) and at 67 % of the body
 *     — sternum, not waist. The crosshair lands ON the body column
 *     (head above it, legs below), exactly the Fortnite-order pose.
 *
 * PROJECTION NOTE (learned the hard way): Babylon's real camera basis is
 * right = (-1,0,0) at yaw 0 (root +X maps screen-LEFT, the same convention
 * `playerBodyFacade.test.ts` pins) and the camera-space up axis is
 * (0,-1,0) — the view matrix deliberately Y-flips NDC. The screen
 * transform below uses that TRUE basis; the classic (up x forward)
 * cross-product derivation mirrors both axes and silently passes only
 * because of that double flip.
 */

const VIEW_W = 1280;
const VIEW_H = 720;
/** Canonical prep distance: the opponent row sits +5 cells from the wall row. */
const WALL_DISTANCE_M = 5 * BUILD_GRID.cellSize;
const FEET = new Vector3(0, 0, 0);
/** The old rig distance, kept here for the BEFORE/AFTER comparison pins. */
const BEFORE_DISTANCE = 5.2;
/** The old (collider-centre) firing eye, for the BEFORE wall-position pin. */
const BEFORE_EYE = 0.9;

function build() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const controller = new ThirdPersonCameraController(scene);
  return { engine, scene, controller };
}

/**
 * Screen pixels of a world point for the controller camera, using Babylon's
 * actual view basis (right = first view-matrix row, camera-space Y
 * flipped) — exactly what the renderer rasterises, not a naive pinhole.
 */
function screenPos(
  controller: ThirdPersonCameraController,
  point: Vector3,
): { x: number; y: number } | null {
  const cam = controller.getCamera();
  const m = cam.getViewMatrix().m;
  const z = m[2] * point.x + m[6] * point.y + m[10] * point.z + m[14];
  if (z <= 1e-9) return null;
  const xp = m[0] * point.x + m[4] * point.y + m[8] * point.z + m[12];
  const yp = m[1] * point.x + m[5] * point.y + m[9] * point.z + m[13];
  const halfH = Math.tan(cam.fov / 2);
  const halfW = halfH * (VIEW_W / VIEW_H);
  return {
    x: (-xp / z / halfW) * (VIEW_W / 2) + VIEW_W / 2,
    y: VIEW_H / 2 - (yp / z / halfH) * (VIEW_H / 2),
  };
}

/**
 * Same pinhole read done analytically at an arbitrary tracking distance and
 * eye height (yaw 0, level) through the TRUE Babylon basis; used to measure
 * the BEFORE baseline without touching the config.
 */
function analyticScreenPos(
  point: Vector3,
  distance: number,
  eye = AIM_EYE_HEIGHT_STANDING,
): { x: number; y: number } {
  const camPos = new Vector3(0, eye, distance); // yaw 0: the line runs +Z
  const z = camPos.z - point.z; // forward is -Z
  const halfH = Math.tan(THIRD_PERSON_CAMERA.fieldOfView / 2);
  const halfW = halfH * (VIEW_W / VIEW_H);
  // root +X maps screen-left, root +Y maps screen-up (view Y is flipped
  // once more by the camera basis — net: standard y-down screen output).
  return {
    x: VIEW_W / 2 - (point.x / z / halfW) * (VIEW_W / 2),
    y: VIEW_H / 2 - ((point.y - camPos.y) / z / halfH) * (VIEW_H / 2),
  };
}

/**
 * Root-local +X maps to screen-LEFT at yaw 0 (the shared convention proven
 * in `playerBodyFacade.test.ts`): the visible body column sits at world
 * x = +localViewOffsetX and lands LEFT of the centred reticle.
 */
const BODY_X = THIRD_PERSON_CAMERA.localViewOffsetX;

describe("framing measurements (level pitch, centred crosshair, 1280x720)", () => {
  it("local body is an over-shoulder foreground figure at human scale", () => {
    const { engine, controller } = build();
    try {
      controller.setCrouched(false);
      controller.update(FEET);

      const head = screenPos(controller, new Vector3(BODY_X, PLAYER_COLLIDER_TOTAL_HEIGHT, 0))!;
      const hip = screenPos(controller, new Vector3(BODY_X, 0.9, 0))!;
      const feet = screenPos(controller, new Vector3(BODY_X, 0, 0))!;

      // Torso (capsule centre -> head) span: 74 px BEFORE (analytic twin
      // at 5.2 m), 104 px after — +40 % presence where the eye looks.
      const torsoPx = hip.y - head.y;
      expect(Math.round(torsoPx)).toBe(104);

      // Full body span: 148 px (20.5 %) BEFORE, 208 px (28.9 %) AFTER.
      const wholePx = feet.y - head.y;
      expect(Math.round(wholePx)).toBe(208);
      expect(wholePx / VIEW_H).toBeGreaterThan(0.25);

      // BEFORE baseline measured here at the old distance: any regression
      // that re-widens the rig fails the growth pin.
      const beforeWhole =
        analyticScreenPos(new Vector3(BODY_X, 0, 0), BEFORE_DISTANCE).y -
        analyticScreenPos(new Vector3(BODY_X, PLAYER_COLLIDER_TOTAL_HEIGHT, 0), BEFORE_DISTANCE).y;
      expect(Math.round(beforeWhole)).toBe(148);
      expect(wholePx).toBeGreaterThan(beforeWhole * 1.3);

      // The body column is CLEAR of the centred crosshair (no sightline
      // block): x=732 vs centre 640 — ~92 px (~7 %) screen-right; the
      // camera-side shoulder convention (root +X -> screen-left basis).
      expect(Math.round(head.x)).toBe(732);
      expect(Math.abs(head.x - VIEW_W / 2)).toBeGreaterThan(0.05 * VIEW_W);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("shot-eye puts the centred crosshair on the torso and mid-wall, honestly", () => {
    const { engine, controller } = build();
    try {
      controller.setCrouched(false);
      controller.update(FEET);

      // THE waist-height fix, pinned: the level authoritative ray (eye =
      // feet + SHOT_EYE_HEIGHT_STANDING) meets the canvas centre, and at
      // the canonical 10.24 m wall that point sits 1.2 m up the 3.84 m
      // panel — the bottom/middle edit-row boundary (31 %), not 0.9 m
      // (23 %, the waist line in the bottom row).
      expect(SHOT_EYE_HEIGHT_STANDING).toBe(1.2);
      expect(AIM_EYE_HEIGHT_STANDING).toBe(SHOT_EYE_HEIGHT_STANDING);
      const hit = screenPos(controller, new Vector3(0, AIM_EYE_HEIGHT_STANDING, -WALL_DISTANCE_M))!;
      expect(Math.abs(hit.x - VIEW_W / 2)).toBeLessThan(0.5);
      expect(Math.abs(hit.y - VIEW_H / 2)).toBeLessThan(0.5);

      const top = screenPos(controller, new Vector3(0, BUILD_GRID.layerHeight, -WALL_DISTANCE_M))!;
      const bottom = screenPos(controller, new Vector3(0, 0, -WALL_DISTANCE_M))!;
      const belowFraction = (bottom.y - hit.y) / (bottom.y - top.y);
      expect(belowFraction).toBeCloseTo(
        AIM_EYE_HEIGHT_STANDING / BUILD_GRID.layerHeight,
        2,
      );
      // The BEFORE eye (0.9) met the wall noticeably lower; the fix lifts
      // the level reticle from 23 % to 31 % of the panel.
      const beforeBelow =
        (analyticScreenPos(new Vector3(0, 0, -WALL_DISTANCE_M), BEFORE_DISTANCE, BEFORE_EYE).y -
          VIEW_H / 2) /
        (analyticScreenPos(new Vector3(0, 0, -WALL_DISTANCE_M), BEFORE_DISTANCE, BEFORE_EYE).y -
          analyticScreenPos(new Vector3(0, BUILD_GRID.layerHeight, -WALL_DISTANCE_M), BEFORE_DISTANCE, BEFORE_EYE).y);
      expect(beforeBelow).toBeCloseTo(BEFORE_EYE / BUILD_GRID.layerHeight, 2);

      // The crosshair now lands ON the local body column: the body spans
      // the centre line (head above, feet below) at the shared shot eye —
      // sternum height (67 % of 1.8 m), not a waist cut.
      const head = screenPos(controller, new Vector3(BODY_X, PLAYER_COLLIDER_TOTAL_HEIGHT, 0))!;
      const feet = screenPos(controller, new Vector3(BODY_X, 0, 0))!;
      expect(head.y).toBeLessThan(VIEW_H / 2);
      expect(feet.y).toBeGreaterThan(VIEW_H / 2);
      const bodyFraction = (feet.y - VIEW_H / 2) / (feet.y - head.y);
      expect(bodyFraction).toBeCloseTo(
        AIM_EYE_HEIGHT_STANDING / PLAYER_COLLIDER_TOTAL_HEIGHT,
        2,
      );

      // The wall is a real, measurable object at the canonical prep range
      // and its dominance over the body is SHARED world geometry
      // (3.84 m vs 1.8 m = 2.13x), never a scaled prop.
      const wallPx = bottom.y - top.y;
      expect(Math.round(wallPx)).toBe(56);
      expect(BUILD_GRID.layerHeight / PLAYER_COLLIDER_TOTAL_HEIGHT).toBeCloseTo(2.133, 2);
    } finally {
      controller.dispose();
      engine.dispose();
    }
  });

  it("body-to-wall world ratio is shared config — framing scales nothing", () => {
    const ratio = PLAYER_COLLIDER_TOTAL_HEIGHT / BUILD_GRID.layerHeight;
    // 1.8 m body vs the 3.84 m layer (~0.47; wall 2.13x the player), pinned
    // on BOTH sides by shared config, so a presentation fix cannot move
    // it. Scaling the body or the wall is an explicit collider/balance
    // mission, not a framing change.
    expect(ratio).toBeCloseTo(0.469, 2);
    expect(THIRD_PERSON_CAMERA.distance).toBeCloseTo(3.7, 6);
  });
});
