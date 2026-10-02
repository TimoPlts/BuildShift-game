import { describe, expect, it } from "vitest";
import {
  PLAYER_NETWORK_INPUT_LIMITS,
  validatePlayerNetworkInput,
  type PlayerNetworkInput,
} from "../index.js";

/** Builds a valid PlayerNetworkInput frame, then lets a test override fields. */
function validInput(overrides: Partial<PlayerNetworkInput> = {}): PlayerNetworkInput {
  return {
    sequence: 7,
    moveX: 0,
    moveZ: 1,
    lookYaw: 0.6,
    lookPitch: -0.3,
    jump: false,
    sprint: false,
    crouch: false,
    primaryFire: false,
    secondaryFire: false,
    ...overrides,
  };
}

describe("validatePlayerNetworkInput — valid frames", () => {
  it("accepts a representative valid input and returns the typed value", () => {
    const input = validInput();
    const result = validatePlayerNetworkInput(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(input);
    }
  });

  it("accepts an input with all action flags set", () => {
    const result = validatePlayerNetworkInput(
      validInput({
        jump: true,
        sprint: true,
        crouch: true,
        primaryFire: true,
        secondaryFire: true,
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.jump).toBe(true);
      expect(result.value.sprint).toBe(true);
      expect(result.value.crouch).toBe(true);
      expect(result.value.primaryFire).toBe(true);
      expect(result.value.secondaryFire).toBe(true);
    }
  });

  it("accepts a full-movement diagonal frame", () => {
    const result = validatePlayerNetworkInput(
      validInput({ moveX: 1, moveZ: -1, jump: true }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.moveX).toBe(1);
      expect(result.value.moveZ).toBe(-1);
    }
  });
});

describe("validatePlayerNetworkInput — sequence validation", () => {
  it("rejects a negative sequence", () => {
    const result = validatePlayerNetworkInput(validInput({ sequence: -1 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("sequence");
    }
  });

  it("rejects a non-integer (fractional) sequence", () => {
    const result = validatePlayerNetworkInput(validInput({ sequence: 2.5 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("sequence");
    }
  });

  it("rejects a non-numeric sequence", () => {
    const result = validatePlayerNetworkInput(
      validInput({ sequence: "7" as unknown as number }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("sequence");
    }
  });

  it("accepts the lowest valid sequence (0)", () => {
    expect(validatePlayerNetworkInput(validInput({ sequence: 0 })).ok).toBe(true);
  });

  it("accepts Number.MAX_SAFE_INTEGER (upper safe-integer bound)", () => {
    const result = validatePlayerNetworkInput(
      validInput({ sequence: Number.MAX_SAFE_INTEGER }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sequence).toBe(Number.MAX_SAFE_INTEGER);
    }
  });

  it("rejects Number.MAX_SAFE_INTEGER + 1 (outside the safe-integer range)", () => {
    const result = validatePlayerNetworkInput(
      validInput({ sequence: Number.MAX_SAFE_INTEGER + 1 }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("sequence");
    }
  });
});

describe("validatePlayerNetworkInput — movement range", () => {
  it("rejects a movement axis above the upper bound", () => {
    const result = validatePlayerNetworkInput(validInput({ moveX: 1.5 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("moveX");
    }
  });

  it("rejects a movement axis below the lower bound", () => {
    const result = validatePlayerNetworkInput(validInput({ moveZ: -1.2 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("moveZ");
    }
  });

  it("accepts movement at the exact inclusive boundaries (-1 and 1)", () => {
    const result = validatePlayerNetworkInput(validInput({ moveX: -1, moveZ: 1 }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.moveX).toBe(-1);
      expect(result.value.moveZ).toBe(1);
    }
  });

  it("matches the documented movement limits", () => {
    expect(PLAYER_NETWORK_INPUT_LIMITS.movementMin).toBe(-1);
    expect(PLAYER_NETWORK_INPUT_LIMITS.movementMax).toBe(1);
  });
});

describe("validatePlayerNetworkInput — non-finite numbers", () => {
  it("rejects NaN in a movement axis", () => {
    const result = validatePlayerNetworkInput(validInput({ moveX: NaN }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("moveX");
    }
  });

  it("rejects Infinity in a movement axis", () => {
    const result = validatePlayerNetworkInput(validInput({ moveZ: Infinity }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("moveZ");
    }
  });

  it("rejects NaN in lookYaw", () => {
    const result = validatePlayerNetworkInput(validInput({ lookYaw: NaN }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("lookYaw");
    }
  });

  it("rejects NaN in lookPitch", () => {
    const result = validatePlayerNetworkInput(validInput({ lookPitch: NaN }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("lookPitch");
    }
  });

  it("rejects a negative-Infinity lookYaw", () => {
    const result = validatePlayerNetworkInput(validInput({ lookYaw: -Infinity }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("lookYaw");
    }
  });
});

describe("validatePlayerNetworkInput — look angles", () => {
  it("accepts representative yaw / pitch values", () => {
    const result = validatePlayerNetworkInput(
      validInput({ lookYaw: Math.PI / 2, lookPitch: -Math.PI / 4 }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lookYaw).toBeCloseTo(Math.PI / 2);
      expect(result.value.lookPitch).toBeCloseTo(-Math.PI / 4);
    }
  });

  it("accepts yaw beyond a single revolution (unbounded)", () => {
    const result = validatePlayerNetworkInput(validInput({ lookYaw: 5 }));

    expect(result.ok).toBe(true);
  });

  it("rejects a lookPitch outside [-π, π]", () => {
    const result = validatePlayerNetworkInput(validInput({ lookPitch: 4 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("lookPitch");
    }
  });

  it("accepts lookPitch at the inclusive ±π boundaries", () => {
    expect(validatePlayerNetworkInput(validInput({ lookPitch: Math.PI })).ok).toBe(
      true,
    );
    expect(
      validatePlayerNetworkInput(validInput({ lookPitch: -Math.PI })).ok,
    ).toBe(true);
  });
});

describe("validatePlayerNetworkInput — boolean fields", () => {
  it("rejects a truthy-but-not-boolean jump (1)", () => {
    const result = validatePlayerNetworkInput(
      validInput({ jump: 1 as unknown as boolean }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("jump");
    }
  });

  it("rejects a truthy-but-not-boolean sprint (1)", () => {
    const result = validatePlayerNetworkInput(
      validInput({ sprint: 1 as unknown as boolean }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("sprint");
    }
  });

  it("rejects a truthy-but-not-boolean crouch (1)", () => {
    const result = validatePlayerNetworkInput(
      validInput({ crouch: 1 as unknown as boolean }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("crouch");
    }
  });

  it("rejects a truthy-but-not-boolean primaryFire (1)", () => {
    const result = validatePlayerNetworkInput(
      validInput({ primaryFire: 1 as unknown as boolean }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("primaryFire");
    }
  });

  it("rejects a truthy-but-not-boolean secondaryFire (1)", () => {
    const result = validatePlayerNetworkInput(
      validInput({ secondaryFire: 1 as unknown as boolean }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("secondaryFire");
    }
  });

  it("rejects a string jump", () => {
    const result = validatePlayerNetworkInput(
      validInput({ jump: "true" as unknown as boolean }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("jump");
    }
  });
});

describe("validatePlayerNetworkInput — malformed input", () => {
  it("rejects non-object input", () => {
    expect(validatePlayerNetworkInput(null).ok).toBe(false);
    expect(validatePlayerNetworkInput(undefined).ok).toBe(false);
    expect(validatePlayerNetworkInput("frame").ok).toBe(false);
    expect(validatePlayerNetworkInput(42).ok).toBe(false);
    expect(validatePlayerNetworkInput([1, 2, 3]).ok).toBe(false);
  });

  it("reports every offending field at once (aggregated errors)", () => {
    const result = validatePlayerNetworkInput({
      sequence: -3,
      moveX: 9,
      jump: "yes",
      sprint: "fast",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const joined = result.errors.join(" ");
      expect(joined).toContain("sequence");
      expect(joined).toContain("moveX");
      expect(joined).toContain("jump");
      expect(joined).toContain("sprint");
      expect(joined).toContain("lookYaw");
    }
  });
});
