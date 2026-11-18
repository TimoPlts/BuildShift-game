/**
 * Preparation-override guard contract (QA R1).
 *
 * The authoritative build preparation is 8 s for BOTH players
 * (`BOX_FIGHT_PREPARATION.durationSeconds`). A shorter preparation is reachable
 * ONLY through a capability token that this server process issued into
 * `server.define()` handler options (CONTRACT.md §7,
 * `./testPreparationOverride.ts`); no client join option can arm it or pick a
 * duration.
 *
 * Why a token instead of a boolean: Colyseus 0.18 gives `onCreate`
 * `merge({}, clientOptions, handler.options)` (`@colyseus/core/src/MatchMaker.ts`)
 * and `merge` is a shallow key assignment. Any option name the registration does
 * NOT pin therefore arrives straight from the client, and a client-supplied
 * boolean guard ("testPreparationSeconds + enabled flag") would be spoofable. The
 * production registration pins `__testPreparationToken: ""` explicitly (an
 * explicit value, not an absent key) and the room resolves the duration from a
 * SERVER-SIDE map keyed by that token, so a client can neither arm the override
 * nor choose a length.
 *
 * The wire case below runs against the REAL production registration —
 * `createServer()` with no deps, exactly what `src/index.ts` boots — and joins
 * with the canonical route through a real `@colyseus/sdk` client.
 *
 * The positive control (a test-constructed server whose prep IS shortened) lives
 * in `twoPlayerPreparationFixture.test.ts`: this file must stay free of any
 * server-issued override, and Colyseus keeps its room-type registry in a
 * process-global matchMaker, so one file = one server registration.
 *
 * All waits are bounded.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client, type Room as ClientRoom } from "@colyseus/sdk";

import { MatchPhase, ROOMS } from "@buildshift/protocol";
import { BOX_FIGHT_PREPARATION } from "@buildshift/game-config";

import {
  createServer,
  roomRegistrationOptions,
  shutdownServer,
  startServer,
  TWO_PLAYER_ROOM,
  type GameServer,
} from "../server.js";
import {
  hasTestPreparationOverride,
  resolveTestPreparationSeconds,
  TEST_PREPARATION_TOKEN_OPTION,
} from "./testPreparationOverride.js";
import { TWO_PLAYER_MOVEMENT_ROOM, TwoPlayerMovementRoom } from "./TwoPlayerMovementRoom.js";
import { MATCH_EVENTS } from "../match/matchLifecycle.js";

const TICK_RATE = 30;
/** Authoritative preparation length in ticks (8 s @ 30 Hz = 240). */
const AUTHORITATIVE_TICKS = Math.round(BOX_FIGHT_PREPARATION.durationSeconds * TICK_RATE);
/** Seconds a hostile client would like preparation to be. */
const SPOOF_SECONDS = 0.02;
/** Spoofed tick count the attacker is aiming for (max(1, round(0.6)) = 1). */
const SPOOF_TICKS = 1;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function deadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`[prep-guard] "${label}" timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Exactly what a hostile client can put in `joinOrCreate(name, options)` — the
 * historical option name, the token key with guesses, and other plausible flags.
 */
const MALICIOUS_OPTIONS: Record<string, unknown> = {
  testPreparationSeconds: SPOOF_SECONDS,
  [TEST_PREPARATION_TOKEN_OPTION]: "true",
  testPreparationEnabled: true,
  skipPreparation: true,
  preparationSeconds: SPOOF_SECONDS,
};

/** Shallow merge Colyseus performs for a join: client options then handler options. */
const colyseusMerge = (clientOptions: Record<string, unknown>, handlerOptions: Record<string, unknown>) => ({ ...clientOptions, ...handlerOptions });

function phaseOf(room: ClientRoom): MatchPhase | undefined {
  return (room.state as Record<string, unknown> | undefined)?.matchPhase as MatchPhase | undefined;
}
function prepActiveOf(room: ClientRoom): boolean {
  return (room.state as Record<string, unknown> | undefined)?.preparationActive === true;
}

describe("preparation override guard (server-owned capability token, CONTRACT.md §7)", () => {
  // ─── 1: registration shapes ─────────────────────────────────────────────

  it("production registration pins an EMPTY token and resolves no override", () => {
    for (const deps of [undefined, {}, { testPreparationSeconds: 0 }, { testPreparationSeconds: Number.NaN }, { testPreparationSeconds: -1 }, { testPreparationSeconds: "0.1" as unknown as number }]) {
      const options = roomRegistrationOptions(deps);
      expect(options).toEqual({ [TEST_PREPARATION_TOKEN_OPTION]: "" });
      expect(resolveTestPreparationSeconds(options)).toBeUndefined();
    }
  });

  it("test registration carries a server-issued token bound to the duration", () => {
    const options = roomRegistrationOptions({ testPreparationSeconds: 0.4 });
    const token = options[TEST_PREPARATION_TOKEN_OPTION];
    expect(typeof token).toBe("string");
    expect((token as string).length).toBeGreaterThan(0);
    expect(hasTestPreparationOverride(token)).toBe(true);
    // The duration is resolved server-side from the token, not from a client key.
    expect(resolveTestPreparationSeconds(options)).toBe(0.4);
  });

  it("a client-sent token never resolves, even next to a valid handler token", () => {
    const handler = roomRegistrationOptions({ testPreparationSeconds: 0.4 });
    // The attacker's own token key is overwritten by the handler key (shallow
    // merge), so the merged options still resolve to the SERVER's duration only.
    const merged = colyseusMerge({ ...MALICIOUS_OPTIONS, [TEST_PREPARATION_TOKEN_OPTION]: "attacker-guess" }, handler);
    expect(resolveTestPreparationSeconds(merged)).toBe(0.4);
    // And with the production handler pinned empty, nothing resolves at all.
    expect(resolveTestPreparationSeconds(colyseusMerge(MALICIOUS_OPTIONS, roomRegistrationOptions()))).toBeUndefined();
  });

  // ─── 2: room-level onCreate ─────────────────────────────────────────────

  describe("room.onCreate()", () => {
    const probe: TwoPlayerMovementRoom[] = [];

    const ticksFor = (options: Record<string, unknown> | undefined) => {
      const instance = new TwoPlayerMovementRoom();
      vi.spyOn(instance, "onMessage").mockImplementation(() => {});
      vi.spyOn(instance, "setFixedTimestep").mockImplementation(() => {});
      vi.spyOn(instance, "broadcast").mockImplementation(() => {});
      instance.onCreate(options);
      probe.push(instance);
      return { ptt: (instance as any).ptt as number, ptl: (instance as any).ptl as number };
    };

    afterAll(() => {
      for (const instance of probe) {
        instance.onDispose();
        instance.clock.clear();
      }
      vi.restoreAllMocks();
    });

    it("uses the authoritative 8 s with no options and with a bare join payload", () => {
      expect(ticksFor(undefined).ptt).toBe(AUTHORITATIVE_TICKS);
      expect(ticksFor({}).ptt).toBe(AUTHORITATIVE_TICKS);
      expect(ticksFor({ testPreparationSeconds: SPOOF_SECONDS }).ptt).toBe(AUTHORITATIVE_TICKS);
    });

    it("ignores every client-forgeable override flag, token guesses included", () => {
      for (const options of [
        MALICIOUS_OPTIONS,
        { ...MALICIOUS_OPTIONS, [TEST_PREPARATION_TOKEN_OPTION]: "null" },
        { ...MALICIOUS_OPTIONS, [TEST_PREPARATION_TOKEN_OPTION]: "0" },
      ]) {
        const { ptt, ptl } = ticksFor(options);
        expect(ptt).toBe(AUTHORITATIVE_TICKS);
        expect(ptl).toBe(AUTHORITATIVE_TICKS);
      }
    });

    it("resolves the duration server-side: an issued token + attacker duration still uses the server value", () => {
      const handler = roomRegistrationOptions({ testPreparationSeconds: 0.4 });
      // Merge as Colyseus would, then let the attacker rewrite the duration key:
      // the room never reads a duration from options at all.
      const tampered = { ...colyseusMerge({}, handler), testPreparationSeconds: SPOOF_SECONDS };
      expect(ticksFor(tampered).ptt).toBe(Math.round(0.4 * TICK_RATE));
    });
  });

  // ─── 3: real public join path, guard disabled (production registration) ──

  describe("production server (createServer(), no deps)", () => {
    let server: GameServer;
    let url: string;
    const rooms: ClientRoom[] = [];

    beforeAll(async () => {
      // The REAL production path — identical to src/index.ts. No deps, so the
      // registration carries an empty token: the override is disabled.
      const started = await deadline(startServer(0, createServer()), 20_000, "startServer");
      server = started.server;
      url = `ws://127.0.0.1:${started.port}`;
    }, 40_000);

    afterAll(async () => {
      for (const room of rooms) {
        room.leave().catch(() => undefined);
        try {
          room.connection.close();
        } catch {
          /* already closed */
        }
      }
      await deadline(shutdownServer(server), 8_000, "shutdownServer").catch(() => undefined);
    }, 30_000);

    it("joins the single canonical route (no separate test room type exists)", () => {
      expect(TWO_PLAYER_MOVEMENT_ROOM).toBe(TWO_PLAYER_ROOM);
    });

    it("ignores a malicious testPreparationSeconds + spoofed guard/token pair on the public join path", async () => {
      const totals: number[] = [];
      const join = async () => {
        const room = await deadline(
          new Client(url).joinOrCreate(ROOMS.TWO_PLAYER_MOVEMENT, { ...MALICIOUS_OPTIONS }),
          10_000,
          "join",
        );
        rooms.push(room);
        room.onMessage(MATCH_EVENTS.COUNTDOWN_TICK, (payload: { totalTicks?: number }) => {
          if (typeof payload?.totalTicks === "number") totals.push(payload.totalTicks);
        });
        return room;
      };
      const a = await join();
      const b = await join();

      // Preparation actually runs (both players connected) and every tick reports
      // the AUTHORITATIVE total, never the requested 0.02 s / 1 tick.
      await deadline(wait(400), 5_000, "collect prep ticks");
      expect(totals.length).toBeGreaterThan(0);
      expect(new Set(totals)).toEqual(new Set([AUTHORITATIVE_TICKS]));
      expect(totals).not.toContain(SPOOF_TICKS);
      expect(prepActiveOf(a)).toBe(true);
      expect(phaseOf(a)).toBe(MatchPhase.COUNTDOWN);
      expect(phaseOf(b)).toBe(MatchPhase.COUNTDOWN);

      // A client that had succeeded would already be fighting; a second later the
      // room is still preparing and the countdown is only ~1 s into its 8 s.
      await deadline(wait(1_200), 5_000, "wait past the spoof window");
      expect(phaseOf(a)).toBe(MatchPhase.COUNTDOWN);
      expect(prepActiveOf(a)).toBe(true);
      // The replicated countdown has advanced but is nowhere near done — a client
      // that had shortened prep would already have been in IN_PROGRESS.
      const remaining = totals[totals.length - 1]!;
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(AUTHORITATIVE_TICKS);
      expect(remaining).toBeGreaterThan(AUTHORITATIVE_TICKS - 180); // >= 6 s still left
    }, 30_000);
  });
});
