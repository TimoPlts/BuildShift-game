/**
 * Primary left-button routing tests.
 *
 * The shared left mouse button's browser state is owned by the centralized
 * `InputManager`; `routePrimaryAction` is the single decision that assigns
 * the press/hold to either weapon fire, build placement, or build-edit tile
 * selection. These tests pin the mutual exclusivity and priority of that
 * decision (edit > build > weapon) and drive the building side through the
 * same per-frame contract the runtime uses (`updateFrame` +
 * `pollHeldPlacement`).
 */
import { describe, expect, it } from "vitest";
import { BuildingController, type BuildingNetworkLike } from "../building/buildingController";
import { BuildingInputController, type BuildingInputEnvironment, type InputEventTarget } from "../building/buildingInputController";
import { BuildingStateStore } from "../building/buildingStateStore";
import { routePrimaryAction } from "./primaryActionRouting";

class FakeTarget implements InputEventTarget {
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function createFixture() {
  const canvas = {} as HTMLCanvasElement;
  const keyTarget = new FakeTarget();
  const inertTarget = new FakeTarget();
  const environment: BuildingInputEnvironment = {
    keyTarget,
    pointerLockTarget: inertTarget,
    visibilityTarget: inertTarget,
    getPointerLockElement: () => canvas,
    isHidden: () => false,
  };
  const input = new BuildingInputController(canvas, environment);
  const sent: Array<{ type: string; payload?: unknown }> = [];
  const network: BuildingNetworkLike = {
    send: (type, payload) => {
      sent.push({ type, payload });
      return true;
    },
    onEvent: () => () => undefined,
  };
  const controller = new BuildingController(input, new BuildingStateStore(), network);

  const setBuildMode = (active: boolean): void => {
    if (input.isBuildModeActive() !== active) {
      keyTarget.dispatch("keydown", { code: "KeyB", repeat: false });
    }
  };
  /**
   * One render frame: recomputes the preview from the aim, then drives the
   * routed held primary — the same decision the runtime makes with
   * `routePrimaryAction` over the centralized `InputManager` fire state.
   * `held` plays the role of `InputManager.isFiring()`.
   */
  const frame = (valid: boolean, held: boolean, x = 0, now = 0): void => {
    controller.updateFrame({
      aimOrigin: { x, y: 5, z: 0 },
      aimDirection: valid ? { x: 0, y: -1, z: 0 } : { x: 1, y: 0, z: 0 },
      playerPosition: { x: 0, y: 0, z: 0 },
    });
    const route = routePrimaryAction(input.isBuildModeActive(), false, held, held);
    controller.pollHeldPlacement(now, route.buildPlaceHeld);
  };

  return { controller, input, sent, setBuildMode, frame };
}

describe("primary left-click routing", () => {
  it("build mode off routes a held primary to weapon fire only", () => {
    const fixture = createFixture();
    fixture.frame(true, true);

    expect(fixture.sent).toHaveLength(0);
    expect(routePrimaryAction(false, false, true, true)).toEqual({
      weaponFirePressed: true,
      weaponFireHeld: true,
      buildPlacePressed: false,
      buildPlaceHeld: false,
      editSelectPressed: false,
      editSelectHeld: false,
    });
    fixture.controller.dispose();
  });

  it("build mode on with a valid candidate places on the held primary only", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);
    fixture.frame(true, true);

    expect(routePrimaryAction(true, false, true, true)).toEqual({
      weaponFirePressed: false,
      weaponFireHeld: false,
      buildPlacePressed: true,
      buildPlaceHeld: true,
      editSelectPressed: false,
      editSelectHeld: false,
    });
    expect(fixture.sent).toEqual([
      expect.objectContaining({ type: "build:placement_request" }),
    ]);
    fixture.controller.dispose();
  });

  it("build mode on with an invalid candidate does neither action", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);
    fixture.frame(false, true);

    expect(routePrimaryAction(true, false, true, true)).toEqual({
      weaponFirePressed: false,
      weaponFireHeld: false,
      buildPlacePressed: true,
      buildPlaceHeld: true,
      editSelectPressed: false,
      editSelectHeld: false,
    });
    expect(fixture.sent).toHaveLength(0);
    fixture.controller.dispose();
  });

  it("returns the held primary to weapon fire immediately after leaving build mode", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);
    fixture.setBuildMode(false);
    fixture.frame(true, true);

    expect(fixture.sent).toHaveLength(0);
    expect(routePrimaryAction(false, false, true, true)).toEqual({
      weaponFirePressed: true,
      weaponFireHeld: true,
      buildPlacePressed: false,
      buildPlaceHeld: false,
      editSelectPressed: false,
      editSelectHeld: false,
    });
    fixture.controller.dispose();
  });

  it("a released primary places nothing even in build mode", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);
    fixture.frame(true, false);

    expect(fixture.sent).toHaveLength(0);
    fixture.controller.dispose();
  });

  it("held placement is rate-limited while the aim moves to fresh cells", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);
    // Move the aim a full modular cell (≈5.12 m) per placement so each
    // request targets a fresh, non-overlapping grid cell.
    fixture.frame(true, true, 0, 0);
    fixture.frame(true, true, 6, 100);
    expect(fixture.sent).toHaveLength(1);
    fixture.frame(true, true, 12, 500);
    expect(fixture.sent).toHaveLength(2);
    fixture.controller.dispose();
  });

  it("edit mode on routes the primary to tile selection only (never fire, never place)", () => {
    expect(routePrimaryAction(false, true, true, true)).toEqual({
      weaponFirePressed: false,
      weaponFireHeld: false,
      buildPlacePressed: false,
      buildPlaceHeld: false,
      editSelectPressed: true,
      editSelectHeld: true,
    });
  });

  it("edit mode wins over build mode when both flags are somehow active", () => {
    expect(routePrimaryAction(true, true, true, true)).toEqual({
      weaponFirePressed: false,
      weaponFireHeld: false,
      buildPlacePressed: false,
      buildPlaceHeld: false,
      editSelectPressed: true,
      editSelectHeld: true,
    });
  });

  it("leaving edit mode returns the primary to build placement (build on) and weapon (build off)", () => {
    expect(routePrimaryAction(true, false, true, true)).toEqual({
      weaponFirePressed: false,
      weaponFireHeld: false,
      buildPlacePressed: true,
      buildPlaceHeld: true,
      editSelectPressed: false,
      editSelectHeld: false,
    });
    expect(routePrimaryAction(false, false, true, true)).toEqual({
      weaponFirePressed: true,
      weaponFireHeld: true,
      buildPlacePressed: false,
      buildPlaceHeld: false,
      editSelectPressed: false,
      editSelectHeld: false,
    });
  });

  it("a released primary selects nothing in edit mode", () => {
    expect(routePrimaryAction(false, true, false, false)).toEqual({
      weaponFirePressed: false,
      weaponFireHeld: false,
      buildPlacePressed: false,
      buildPlaceHeld: false,
      editSelectPressed: false,
      editSelectHeld: false,
    });
  });
});
