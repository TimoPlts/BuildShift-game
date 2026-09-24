import { describe, expect, it } from "vitest";
import { countPlayers, mapPlayersToSnapshot } from "./playerSnapshot";

/** A valid authoritative player state as delivered over the wire. */
function validPlayer(overrides: Record<string, unknown> = {}) {
  return {
    playerId: "p1",
    position: { x: 1, y: 2, z: 3 },
    yaw: 0.5,
    acknowledgedSequence: 7,
    ...overrides,
  };
}

/**
 * A minimal stand-in for a Colyseus `@colyseus/schema` `MapSchema`: an object
 * that is NOT `instanceof Map` and has no `entries()`/`keys()`, but yields
 * `[key, value]` pairs via `Symbol.iterator` — exactly the surface the
 * snapshot mapper is required to tolerate.
 */
function mapSchemaLike(pairs: Array<[string, unknown]>) {
  return {
    [Symbol.iterator]: function* () {
      for (const pair of pairs) {
        yield pair;
      }
    },
  };
}

describe("mapPlayersToSnapshot", () => {
  it("returns an empty object for null / undefined", () => {
    expect(mapPlayersToSnapshot(null)).toEqual({});
    expect(mapPlayersToSnapshot(undefined)).toEqual({});
  });

  it("maps a plain-object players root keyed by player id", () => {
    const result = mapPlayersToSnapshot({
      p1: validPlayer({ playerId: "p1", position: { x: 0, y: 1, z: 0 } }),
      p2: validPlayer({ playerId: "p2", position: { x: -1, y: 0, z: 2 } }),
    });
    expect(result).toEqual({
      p1: {
        playerId: "p1",
        position: { x: 0, y: 1, z: 0 },
        yaw: 0.5,
        acknowledgedSequence: 7,
      },
      p2: {
        playerId: "p2",
        position: { x: -1, y: 0, z: 2 },
        yaw: 0.5,
        acknowledgedSequence: 7,
      },
    });
  });

  it("maps a flat-wire players entry (x/y/z on the entry, not nested position)", () => {
    // The Stage 2B2 server `PlayerState` schema flattens the position to
    // top-level `x` / `y` / `z` rather than the contract's nested `position`.
    const result = mapPlayersToSnapshot({
      p1: { playerId: "p1", x: 10, y: 20, z: 30, yaw: -0.2, acknowledgedSequence: -1 },
    });
    expect(result).toEqual({
      p1: {
        playerId: "p1",
        position: { x: 10, y: 20, z: 30 },
        yaw: -0.2,
        acknowledgedSequence: -1,
      },
    });
  });

  it("prefers a nested position when both nested and flat coordinates are present", () => {
    const result = mapPlayersToSnapshot({
      p1: {
        playerId: "p1",
        position: { x: 1, y: 2, z: 3 },
        x: 100,
        y: 200,
        z: 300,
        yaw: 0.5,
        acknowledgedSequence: 7,
      },
    });
    expect(result.p1?.position).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("maps a native Map players root", () => {
    const result = mapPlayersToSnapshot(
      new Map([
        ["p1", validPlayer({ playerId: "p1" })],
        ["p2", validPlayer({ playerId: "p2" })],
      ]),
    );
    expect(Object.keys(result).sort()).toEqual(["p1", "p2"]);
  });

  it("maps a MapSchema-like iterable (not instanceof Map, no entries())", () => {
    const result = mapPlayersToSnapshot(
      mapSchemaLike([
        ["p1", validPlayer({ playerId: "p1" })],
        ["p2", validPlayer({ playerId: "p2" })],
      ]),
    );
    expect(Object.keys(result).sort()).toEqual(["p1", "p2"]);
    expect(result.p1.position).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("falls back to the map key when an entry omits / has a bad playerId", () => {
    const result = mapPlayersToSnapshot({
      // No playerId on the wire → fall back to the key "fallback".
      fallback: validPlayer({ playerId: undefined }),
      // Empty-string playerId → fall back to the key.
      other: validPlayer({ playerId: "" }),
    });
    expect(result.fallback.playerId).toBe("fallback");
    expect(result.other.playerId).toBe("other");
    expect(Object.keys(result)).toHaveLength(2);
  });

  it("prefers the wire playerId over the key when both are present", () => {
    const result = mapPlayersToSnapshot({
      someKey: validPlayer({ playerId: "realId" }),
    });
    expect(Object.keys(result)).toEqual(["realId"]);
    expect(result.realId.playerId).toBe("realId");
  });

  it("skips structurally invalid entries without throwing", () => {
    const result = mapPlayersToSnapshot({
      good: validPlayer({ playerId: "good" }),
      // missing position
      noPos: {
        playerId: "noPos",
        yaw: 0,
        acknowledgedSequence: 1,
      },
      // non-finite position
      nanPos: validPlayer({ position: { x: NaN, y: 0, z: 0 } }),
      // non-safe-integer acknowledgedSequence
      badSeq: validPlayer({ acknowledgedSequence: 1.5 }),
      // not an object at all
      junk: "nope",
    });
    expect(Object.keys(result)).toEqual(["good"]);
  });

  it("returns an empty object for an all-invalid root", () => {
    expect(mapPlayersToSnapshot({ junk: 42, other: null })).toEqual({});
  });
});

describe("countPlayers", () => {
  it("counts valid players from a plain object", () => {
    expect(
      countPlayers({
        a: validPlayer({ playerId: "a" }),
        b: validPlayer({ playerId: "b" }),
      }),
    ).toBe(2);
  });

  it("counts valid players from a native Map", () => {
    expect(
      countPlayers(
        new Map<string, unknown>([
          ["a", validPlayer({ playerId: "a" })],
          ["b", validPlayer({ playerId: "b" })],
          ["bad", { junk: true }],
        ]),
      ),
    ).toBe(2);
  });

  it("returns 0 for null / undefined", () => {
    expect(countPlayers(null)).toBe(0);
    expect(countPlayers(undefined)).toBe(0);
  });
});
