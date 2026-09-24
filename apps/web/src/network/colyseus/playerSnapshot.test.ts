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

  it("rejects an entry with a flat (obsolete) position instead of nested position", () => {
    // The accepted contract nests the position; the old flat x/y/z wire shape
    // no longer exists and must NOT be silently accepted.
    const result = mapPlayersToSnapshot({
      p1: { playerId: "p1", x: 10, y: 20, z: 30, yaw: -0.2, acknowledgedSequence: -1 },
    });
    expect(result).toEqual({});
  });

  it("requires a nested position object with finite x/y/z", () => {
    // Missing position entirely.
    expect(
      mapPlayersToSnapshot({
        p1: { playerId: "p1", yaw: 0, acknowledgedSequence: -1 },
      }),
    ).toEqual({});
    // Non-finite coordinate.
    expect(
      mapPlayersToSnapshot({
        p1: validPlayer({ playerId: "p1", position: { x: Number.NaN, y: 0, z: 0 } }),
      }),
    ).toEqual({});
    // position present but not an object.
    expect(
      mapPlayersToSnapshot({
        p1: validPlayer({ playerId: "p1", position: 42 }),
      }),
    ).toEqual({});
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

  it("does not synthesise a missing / empty playerId", () => {
    // No playerId on the wire → invalid (NOT filled in from the key).
    const result = mapPlayersToSnapshot({
      fallback: validPlayer({ playerId: undefined }),
      other: validPlayer({ playerId: "" }),
      notString: validPlayer({ playerId: 7 }),
    });
    expect(result).toEqual({});
  });

  it("rejects an entry whose playerId does not match its map key", () => {
    // schema drift: wire playerId differs from the stored key → skip.
    const result = mapPlayersToSnapshot({
      someKey: validPlayer({ playerId: "realId" }),
      good: validPlayer({ playerId: "good" }),
    });
    expect(Object.keys(result)).toEqual(["good"]);
    expect(result.good.playerId).toBe("good");
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

  describe("acknowledgedSequence validation", () => {
    it("accepts -1 (no input processed yet)", () => {
      const result = mapPlayersToSnapshot({
        p1: validPlayer({ playerId: "p1", acknowledgedSequence: -1 }),
      });
      expect(result.p1?.acknowledgedSequence).toBe(-1);
    });

    it("accepts 0 and positive safe integers", () => {
      const result = mapPlayersToSnapshot({
        p1: validPlayer({ playerId: "p1", acknowledgedSequence: 0 }),
        p2: validPlayer({ playerId: "p2", acknowledgedSequence: 42 }),
      });
      expect(result.p1?.acknowledgedSequence).toBe(0);
      expect(result.p2?.acknowledgedSequence).toBe(42);
    });

    it("rejects -2 (below the -1 sentinel)", () => {
      const result = mapPlayersToSnapshot({
        p1: validPlayer({ playerId: "p1", acknowledgedSequence: -2 }),
      });
      expect(result).toEqual({});
    });

    it("rejects -50 (far below the -1 sentinel)", () => {
      const result = mapPlayersToSnapshot({
        p1: validPlayer({ playerId: "p1", acknowledgedSequence: -50 }),
      });
      expect(result).toEqual({});
    });

    it("rejects fractional values", () => {
      const result = mapPlayersToSnapshot({
        p1: validPlayer({ playerId: "p1", acknowledgedSequence: 2.5 }),
      });
      expect(result).toEqual({});
    });

    it("rejects NaN / Infinity / non-number", () => {
      const result = mapPlayersToSnapshot({
        a: validPlayer({ playerId: "a", acknowledgedSequence: Number.NaN }),
        b: validPlayer({ playerId: "b", acknowledgedSequence: Number.POSITIVE_INFINITY }),
        c: validPlayer({ playerId: "c", acknowledgedSequence: "7" }),
      });
      expect(result).toEqual({});
    });

    it("rejects values beyond Number.MAX_SAFE_INTEGER", () => {
      const result = mapPlayersToSnapshot({
        p1: validPlayer({
          playerId: "p1",
          acknowledgedSequence: Number.MAX_SAFE_INTEGER + 1,
        }),
      });
      expect(result).toEqual({});
    });
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
