/**
 * Focused tests for the build-preparation presentation layer.
 *
 * Covers the agreed round-preparation contract from the UI side:
 *  - COUNTDOWN is the build phase; the authoritative preparation countdown
 *    (8 seconds under `BOX_FIGHT_PREPARATION`) is the only clock presented;
 *  - a half-filled room presents "waiting for opponent" instead of a clock;
 *  - the assigned side arrives as the server's `negative` / `positive`
 *    vocabulary and is only ever rendered as a readable hint when supplied;
 *  - nothing is presented once the fight is in progress (an untimed fight has
 *    no clock at all), and no state ever invents a duration, a 0:00 or an
 *    infinite countdown.
 */
import { describe, expect, it } from "vitest";
import { RoundState } from "@buildshift/protocol";
import {
  derivePreparationUi,
  preparationSideHint,
  NO_PREPARATION,
  PREPARATION_OPENING_LABEL,
  PREPARATION_PHASE_LABEL,
  READY_PHASE_LABEL,
  WAITING_PHASE_LABEL,
  type PreparationUiSource,
} from "./preparationPresentation";

/** The agreed preparation duration (server-side `BOX_FIGHT_PREPARATION`). */
const PREPARATION_SECONDS = 8;

function source(overrides: Partial<PreparationUiSource> = {}): PreparationUiSource {
  return {
    connected: true,
    roundState: RoundState.COUNTDOWN,
    countdownRemainingSeconds: 0,
    preparationActive: false,
    preparationSide: "",
    currentRound: 0,
    ...overrides,
  };
}

describe("derivePreparationUi: waiting for the second player", () => {
  it("presents 'waiting for opponent' in a COUNTDOWN room without preparation", () => {
    const ui = derivePreparationUi(source());
    expect(ui.mode).toBe("waiting");
    expect(ui.sideHint).toBeNull();
  });

  it("never shows a clock while waiting, even if a stale countdown is present", () => {
    const ui = derivePreparationUi(
      source({ countdownRemainingSeconds: PREPARATION_SECONDS }),
    );
    expect(ui.mode).toBe("waiting");
    expect(ui.remainingSeconds).toBe(0);
  });

  it("presents nothing while disconnected or with no view at all", () => {
    expect(derivePreparationUi(source({ connected: false }))).toEqual(NO_PREPARATION);
    expect(derivePreparationUi(null)).toEqual(NO_PREPARATION);
    expect(derivePreparationUi(undefined)).toEqual(NO_PREPARATION);
  });
});

describe("derivePreparationUi: the build phase clock", () => {
  it("presents the full authoritative 8-second preparation countdown", () => {
    const ui = derivePreparationUi(
      source({
        preparationActive: true,
        preparationSide: "positive",
        countdownRemainingSeconds: PREPARATION_SECONDS,
        currentRound: 1,
      }),
    );
    expect(ui.mode).toBe("preparing");
    expect(ui.remainingSeconds).toBe(PREPARATION_SECONDS);
    expect(ui.roundNumber).toBe(1);
  });

  it("tracks every authoritative second down to the gate opening", () => {
    for (let remaining = PREPARATION_SECONDS; remaining >= 0; remaining -= 1) {
      const ui = derivePreparationUi(
        source({
          preparationActive: true,
          countdownRemainingSeconds: remaining,
          currentRound: 1,
        }),
      );
      expect(ui.mode).toBe("preparing");
      expect(ui.remainingSeconds).toBe(remaining);
    }
  });

  it("clamps a nonsense countdown instead of faking 0:00 or infinity", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -5, 3.7]) {
      const ui = derivePreparationUi(
        source({ preparationActive: true, countdownRemainingSeconds: bad }),
      );
      expect(ui.mode).toBe("preparing");
      expect(Number.isFinite(ui.remainingSeconds)).toBe(true);
      expect(ui.remainingSeconds).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(ui.remainingSeconds)).toBe(true);
    }
  });

  it("falls back to a plain GET READY countdown when the server did not flag preparation", () => {
    const ui = derivePreparationUi(
      source({ countdownRemainingSeconds: 3, currentRound: 2 }),
    );
    expect(ui.mode).toBe("ready");
    expect(ui.remainingSeconds).toBe(3);
    expect(ui.roundNumber).toBe(2);
    expect(ui.sideHint).toBeNull();
  });
});

describe("derivePreparationUi: an in-progress fight has no clock", () => {
  it("presents nothing during PLAYING even if a preparation flag lingers", () => {
    const ui = derivePreparationUi(
      source({
        roundState: RoundState.PLAYING,
        preparationActive: true,
        preparationSide: "negative",
        countdownRemainingSeconds: PREPARATION_SECONDS,
        currentRound: 1,
      }),
    );
    expect(ui).toEqual(NO_PREPARATION);
  });

  it("presents nothing for round results or the match end", () => {
    for (const roundState of [RoundState.ROUND_OVER, RoundState.MATCH_OVER]) {
      expect(
        derivePreparationUi(
          source({ roundState, preparationActive: true, countdownRemainingSeconds: 4 }),
        ),
      ).toEqual(NO_PREPARATION);
    }
  });
});

describe("preparationSideHint: only a real assignment is readable", () => {
  it("maps the server side vocabulary to readable row hints", () => {
    expect(preparationSideHint("negative")).toBe("YOUR BUILD ROW: -X END");
    expect(preparationSideHint("positive")).toBe("YOUR BUILD ROW: +X END");
    expect(preparationSideHint("  Positive ")).toBe("YOUR BUILD ROW: +X END");
  });

  it("yields no hint before assignment or for an unknown value", () => {
    expect(preparationSideHint("")).toBeNull();
    expect(preparationSideHint(null)).toBeNull();
    expect(preparationSideHint(undefined)).toBeNull();
    expect(preparationSideHint("middle")).toBeNull();
  });

  it("surfaces the assigned side in the preparation state only when known", () => {
    const base = { preparationActive: true, countdownRemainingSeconds: 6 };
    expect(derivePreparationUi(source({ ...base, preparationSide: "negative" })).sideHint)
      .toBe("YOUR BUILD ROW: -X END");
    expect(derivePreparationUi(source({ ...base, preparationSide: "" })).sideHint).toBeNull();
  });
});

describe("preparation labels are stable UI vocabulary", () => {
  it("exposes one compact label per preparation moment", () => {
    expect(PREPARATION_PHASE_LABEL).toBe("BUILD PHASE");
    expect(PREPARATION_OPENING_LABEL).toBe("ARENA OPENING");
    expect(WAITING_PHASE_LABEL).toBe("WAITING FOR OPPONENT");
    expect(READY_PHASE_LABEL).toBe("GET READY");
  });
});
