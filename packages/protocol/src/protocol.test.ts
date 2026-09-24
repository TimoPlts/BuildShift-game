import { describe, expect, it } from "vitest";
import {
  EVENTS,
  PLAYER_INPUT_LIMITS,
  PROTOCOL_VERSION,
  ROOMS,
  validatePlayerInputFrame,
  type PlayerInputFrame,
} from "./index.js";

/** Builds a valid frame, then lets a test override individual fields. */
function validFrame(overrides: Partial<PlayerInputFrame> = {}): PlayerInputFrame {
  return {
    sequence: 7,
    moveX: 0,
    moveZ: 1,
    lookYaw: 0.6,
    lookPitch: -0.3,
    jump: false,
    ...overrides,
  };
}

describe("protocol version", () => {
  it("is the first concrete-contract version (0.2.0)", () => {
    expect(PROTOCOL_VERSION).toBe("0.2.0");
  });
});

describe("validatePlayerInputFrame — valid frames", () => {
  it("accepts a representative valid frame and returns the typed value", () => {
    const input = validFrame();
    const result = validatePlayerInputFrame(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(input);
    }
  });

  it("accepts a frame with a jump edge set", () => {
    const result = validatePlayerInputFrame(validFrame({ jump: true }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.jump).toBe(true);
    }
  });

  it("accepts a full-movement diagonal frame", () => {
    const result = validatePlayerInputFrame(
      validFrame({ moveX: 1, moveZ: 1, jump: true }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.moveX).toBe(1);
      expect(result.value.moveZ).toBe(1);
    }
  });
});

describe("validatePlayerInputFrame — sequence validation", () => {
  it("rejects a negative sequence", () => {
    const result = validatePlayerInputFrame(validFrame({ sequence: -1 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("sequence");
    }
  });

  it("rejects a non-integer (fractional) sequence", () => {
    const result = validatePlayerInputFrame(validFrame({ sequence: 2.5 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("sequence");
    }
  });

  it("rejects a non-numeric sequence", () => {
    const result = validatePlayerInputFrame(
      validFrame({ sequence: "7" as unknown as number }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("sequence");
    }
  });

  it("accepts the lowest valid sequence (0)", () => {
    expect(validatePlayerInputFrame(validFrame({ sequence: 0 })).ok).toBe(true);
  });
});

describe("validatePlayerInputFrame — movement range", () => {
  it("rejects a movement axis above the upper bound", () => {
    const result = validatePlayerInputFrame(validFrame({ moveX: 1.5 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("moveX");
    }
  });

  it("rejects a movement axis below the lower bound", () => {
    const result = validatePlayerInputFrame(validFrame({ moveZ: -1.2 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("moveZ");
    }
  });

  it("accepts movement at the exact inclusive boundaries (-1 and 1)", () => {
    const result = validatePlayerInputFrame(validFrame({ moveX: -1, moveZ: 1 }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.moveX).toBe(-1);
      expect(result.value.moveZ).toBe(1);
    }
  });

  it("matches the documented movement limits", () => {
    expect(PLAYER_INPUT_LIMITS.movementMin).toBe(-1);
    expect(PLAYER_INPUT_LIMITS.movementMax).toBe(1);
  });
});

describe("validatePlayerInputFrame — non-finite numbers", () => {
  it("rejects NaN in a movement axis", () => {
    const result = validatePlayerInputFrame(validFrame({ moveX: NaN }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("moveX");
    }
  });

  it("rejects Infinity in a movement axis", () => {
    const result = validatePlayerInputFrame(validFrame({ moveZ: Infinity }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("moveZ");
    }
  });

  it("rejects NaN in lookYaw", () => {
    const result = validatePlayerInputFrame(validFrame({ lookYaw: NaN }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("lookYaw");
    }
  });

  it("rejects NaN in lookPitch", () => {
    const result = validatePlayerInputFrame(validFrame({ lookPitch: NaN }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("lookPitch");
    }
  });

  it("rejects a negative-Infinity lookYaw", () => {
    const result = validatePlayerInputFrame(validFrame({ lookYaw: -Infinity }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("lookYaw");
    }
  });
});

describe("validatePlayerInputFrame — look angles", () => {
  it("accepts representative yaw / pitch values", () => {
    const result = validatePlayerInputFrame(
      validFrame({ lookYaw: Math.PI / 2, lookPitch: -Math.PI / 4 }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lookYaw).toBeCloseTo(Math.PI / 2);
      expect(result.value.lookPitch).toBeCloseTo(-Math.PI / 4);
    }
  });

  it("accepts yaw beyond a single revolution (unbounded)", () => {
    const result = validatePlayerInputFrame(validFrame({ lookYaw: 5 }));

    expect(result.ok).toBe(true);
  });

  it("rejects a lookPitch outside [-π, π]", () => {
    const result = validatePlayerInputFrame(validFrame({ lookPitch: 4 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("lookPitch");
    }
  });

  it("accepts lookPitch at the inclusive ±π boundaries", () => {
    expect(validatePlayerInputFrame(validFrame({ lookPitch: Math.PI })).ok).toBe(
      true,
    );
    expect(
      validatePlayerInputFrame(validFrame({ lookPitch: -Math.PI })).ok,
    ).toBe(true);
  });
});

describe("validatePlayerInputFrame — jump value", () => {
  it("rejects a truthy-but-not-boolean jump (1)", () => {
    const result = validatePlayerInputFrame(
      validFrame({ jump: 1 as unknown as boolean }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("jump");
    }
  });

  it("rejects a string jump", () => {
    const result = validatePlayerInputFrame(
      validFrame({ jump: "true" as unknown as boolean }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("jump");
    }
  });
});

describe("validatePlayerInputFrame — malformed input", () => {
  it("rejects non-object input", () => {
    expect(validatePlayerInputFrame(null).ok).toBe(false);
    expect(validatePlayerInputFrame(undefined).ok).toBe(false);
    expect(validatePlayerInputFrame("frame").ok).toBe(false);
    expect(validatePlayerInputFrame(42).ok).toBe(false);
    expect(validatePlayerInputFrame([1, 2, 3]).ok).toBe(false);
  });

  it("reports every offending field at once (aggregated errors)", () => {
    const result = validatePlayerInputFrame({
      sequence: -3,
      moveX: 9,
      jump: "yes",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const joined = result.errors.join(" ");
      expect(joined).toContain("sequence");
      expect(joined).toContain("moveX");
      expect(joined).toContain("jump");
      expect(joined).toContain("lookYaw");
    }
  });
});

describe("room / event identifiers", () => {
  it("declares the foundation room identifier", () => {
    expect(ROOMS.FOUNDATION).toBe("foundation");
  });

  it("declares the player-input event identifier", () => {
    expect(EVENTS.PLAYER_INPUT).toBe("player:input");
  });
});
