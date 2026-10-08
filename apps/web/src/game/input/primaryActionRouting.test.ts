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
  const mouseTarget = new FakeTarget();
  const inertTarget = new FakeTarget();
  const environment: BuildingInputEnvironment = {
    keyTarget,
    mouseTarget,
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
  const click = (): void => mouseTarget.dispatch("mousedown", { button: 0 });
  const update = (valid: boolean, x = 0): void => {
    controller.updateFrame({
      aimOrigin: { x, y: 5, z: 0 },
      aimDirection: valid ? { x: 0, y: -1, z: 0 } : { x: 1, y: 0, z: 0 },
      playerPosition: { x: 0, y: 0, z: 0 },
    });
  };
  const placeIfPressed = () =>
    controller.consumePlacePressed() ? controller.requestPlace() : null;

  return { controller, input, sent, setBuildMode, click, update, placeIfPressed };
}

describe("primary left-click routing", () => {
  it("build mode off routes a click to weapon fire only", () => {
    const fixture = createFixture();
    fixture.click();

    expect(fixture.controller.consumePlacePressed()).toBe(false);
    expect(routePrimaryAction(false, true, true)).toEqual({
      weaponFirePressed: true,
      weaponFireHeld: true,
    });
    fixture.controller.dispose();
  });

  it("build mode on with a valid candidate places only", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);
    fixture.click();
    fixture.update(true);

    expect(routePrimaryAction(true, true, true)).toEqual({
      weaponFirePressed: false,
      weaponFireHeld: false,
    });
    expect(fixture.placeIfPressed()).not.toBeNull();
    expect(fixture.sent).toEqual([
      expect.objectContaining({ type: "build:placement_request" }),
    ]);
    fixture.controller.dispose();
  });

  it("build mode on with an invalid candidate does neither action", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);
    fixture.click();
    fixture.update(false);

    expect(routePrimaryAction(true, true, true)).toEqual({
      weaponFirePressed: false,
      weaponFireHeld: false,
    });
    expect(fixture.placeIfPressed()).toBeNull();
    expect(fixture.sent).toHaveLength(0);
    fixture.controller.dispose();
  });

  it("returns a click to weapon fire immediately after leaving build mode", () => {
    const fixture = createFixture();
    fixture.setBuildMode(true);
    fixture.setBuildMode(false);
    fixture.click();

    expect(fixture.controller.consumePlacePressed()).toBe(false);
    expect(routePrimaryAction(false, true, true)).toEqual({
      weaponFirePressed: true,
      weaponFireHeld: true,
    });
    fixture.controller.dispose();
  });

  it("repeated build-mode toggles produce one placement per click", () => {
    const fixture = createFixture();
    for (let index = 0; index < 3; index += 1) {
      fixture.setBuildMode(true);
      fixture.click();
      fixture.update(true, index * 2);
      expect(fixture.placeIfPressed()).not.toBeNull();
      fixture.setBuildMode(false);
    }

    expect(fixture.sent).toHaveLength(3);
    fixture.controller.dispose();
  });
});
