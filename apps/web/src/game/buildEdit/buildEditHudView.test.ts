/**
 * Unit tests for {@link buildBuildEditHudView} / {@link buildEditHudChangeKey}
 * — the pure mapping from the build-edit controller's presentation state into
 * the flat {@link BuildEditHudState} the React panel renders from.
 */
import { describe, expect, it } from "vitest";
import {
  buildBuildEditHudView,
  buildEditHudChangeKey,
  type BuildEditHudInput,
  type BuildEditHudState,
} from "./buildEditHudView";
import type { TargetedStructure } from "./structureSelection";

function target(): TargetedStructure {
  return {
    structureId: "wall1",
    buildType: "wall",
    grid: { x: 2, y: 0, z: -3 },
    rotation: 0,
    ownerId: "me",
    distance: 2.5,
  };
}

function input(overrides: Partial<BuildEditHudInput> = {}): BuildEditHudInput {
  return {
    mode: false,
    target: null,
    selectedEdit: "door",
    allowedEdits: [],
    feedback: null,
    ...overrides,
  };
}

describe("buildBuildEditHudView", () => {
  it("defaults to an empty, off snapshot", () => {
    const view = buildBuildEditHudView(input());
    expect(view.mode).toBe(false);
    expect(view.target).toBeNull();
    expect(view.selectedEdit).toBe("door");
    expect(view.allowedEdits).toEqual([]);
    expect(view.feedback).toBeNull();
  });

  it("copies the target + allowed edits (cloned, not by reference)", () => {
    const edits = ["door", "window", "half_top", "half_bottom"] as const;
    const view = buildBuildEditHudView(
      input({ mode: true, target: target(), allowedEdits: edits, selectedEdit: "window" }),
    );
    expect(view.mode).toBe(true);
    expect(view.target).toEqual({ structureId: "wall1", buildType: "wall", grid: { x: 2, y: 0, z: -3 } });
    expect(view.selectedEdit).toBe("window");
    expect(view.allowedEdits).toEqual(["door", "window", "half_top", "half_bottom"]);
    // Cloning: mutating the returned array must not touch the input.
    view.allowedEdits.push("clear" as never);
    expect(edits).toHaveLength(4);
  });

  it("copies the feedback banner verbatim", () => {
    const view = buildBuildEditHudView(
      input({ feedback: { kind: "rejected", message: "Not your structure", structureId: "wall1" } }),
    );
    expect(view.feedback).toEqual({ kind: "rejected", message: "Not your structure" });
  });
});

describe("buildEditHudChangeKey", () => {
  it("is stable for identical presentation state", () => {
    const a = buildBuildEditHudView(input({ mode: true, target: target() }));
    const b = buildBuildEditHudView(input({ mode: true, target: target() }));
    expect(buildEditHudChangeKey(a)).toBe(buildEditHudChangeKey(b));
  });

  const base = buildBuildEditHudView(input({ mode: true, target: target() }));

  it("changes when the mode flips", () => {
    const next = { ...base, mode: false } as BuildEditHudState;
    expect(buildEditHudChangeKey(next)).not.toBe(buildEditHudChangeKey(base));
  });

  it("changes when the targeted structure id or grid changes", () => {
    const otherId = { ...base, target: { ...base.target!, structureId: "wall2" } } as BuildEditHudState;
    expect(buildEditHudChangeKey(otherId)).not.toBe(buildEditHudChangeKey(base));

    const otherGrid = {
      ...base,
      target: { ...base.target!, grid: { x: 2, y: 0, z: -4 } },
    } as BuildEditHudState;
    expect(buildEditHudChangeKey(otherGrid)).not.toBe(buildEditHudChangeKey(base));
  });

  it("changes when the selected edit changes", () => {
    const next = { ...base, selectedEdit: "window" } as BuildEditHudState;
    expect(buildEditHudChangeKey(next)).not.toBe(buildEditHudChangeKey(base));
  });

  it("changes when the allowed-edits list changes", () => {
    const next = { ...base, allowedEdits: ["door"] } as BuildEditHudState;
    expect(buildEditHudChangeKey(next)).not.toBe(buildEditHudChangeKey(base));
  });

  it("changes when feedback appears, and when its kind or message changes", () => {
    const withFb = {
      ...base,
      feedback: { kind: "accepted", message: "Edit applied" },
    } as BuildEditHudState;
    expect(buildEditHudChangeKey(withFb)).not.toBe(buildEditHudChangeKey(base));

    const rejected = {
      ...withFb,
      feedback: { kind: "rejected", message: "Edit applied" },
    } as BuildEditHudState;
    expect(buildEditHudChangeKey(rejected)).not.toBe(buildEditHudChangeKey(withFb));

    const otherMsg = {
      ...withFb,
      feedback: { kind: "accepted", message: "Something else" },
    } as BuildEditHudState;
    expect(buildEditHudChangeKey(otherMsg)).not.toBe(buildEditHudChangeKey(withFb));
  });
});
