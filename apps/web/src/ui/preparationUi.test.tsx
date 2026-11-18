/**
 * Focused SSR + contract tests for the preparation / open-gate / untimed-fight UI.
 *
 * The project's test toolchain runs vitest in a node environment without a DOM
 * testing library, so components are rendered to static markup and asserted on
 * the resulting HTML, the stylesheets they depend on, and the shell source that
 * mounts them.
 *
 * Contracts verified here:
 *  1. The preparation banner presents the waiting / build-phase moments and is
 *     a compact, pointer-transparent strip — never an opaque full-screen
 *     countdown over the arena and crosshair.
 *  2. An in-progress fight has no round timer anywhere in the HUD: no progress
 *     bar, no remaining-time read-out, no expiry label and no fake `0:00`, even
 *     when a legacy timer value still arrives.
 *  3. The App shell mounts the banner and the gate-opening FIGHT cue and no
 *     longer mounts the legacy full-screen counting overlay.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchPhase } from "@buildshift/protocol";
import { PreparationBanner, type PreparationBannerProps } from "./PreparationBanner";
import { CountdownOverlay } from "./CountdownOverlay";
import {
  MatchHud,
  phaseLabel,
  roundEndReasonLabel,
  type MatchHudProps,
} from "./MatchHud";
import { FIGHT_CUE_LABEL } from "./preparationPresentation";

const lifecycleCss = readFileSync(
  fileURLToPath(new URL("./match-lifecycle.css", import.meta.url)),
  "utf8",
);
const appSource = readFileSync(
  fileURLToPath(new URL("../App.tsx", import.meta.url)),
  "utf8",
);

/** The CSS rule block for the banner container. */
function bannerRule(): string {
  const start = lifecycleCss.indexOf(".preparation-banner {");
  expect(start).toBeGreaterThan(-1);
  return lifecycleCss.slice(start, lifecycleCss.indexOf("}", start) + 1);
}

/** Render the preparation banner from explicit props. */
function renderBanner(props: PreparationBannerProps): string {
  return renderToStaticMarkup(createElement(PreparationBanner, props));
}

/** Render the match header from a partial props object. */
function renderMatchHud(props: Partial<MatchHudProps>): string {
  const full = {
    localScore: 1,
    remoteScore: 0,
    phase: MatchPhase.IN_PROGRESS,
    currentRound: 1,
    localWonLastRound: null,
    localWonMatch: null,
    ...props,
  } as MatchHudProps;
  return renderToStaticMarkup(createElement(MatchHud, full));
}

describe("PreparationBanner markup", () => {
  it("renders nothing when idle or explicitly hidden", () => {
    expect(renderBanner({ mode: "idle" })).toBe("");
    expect(renderBanner({ mode: "preparing", remainingSeconds: 8, visible: false })).toBe("");
  });

  it("waiting mode names the missing opponent and shows no clock", () => {
    const html = renderBanner({ mode: "waiting" });
    expect(html).toContain("preparation-banner--waiting");
    expect(html).toContain("WAITING FOR OPPONENT");
    expect(html).not.toContain("preparation-banner__count");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it("build mode shows the BUILD PHASE label, the authoritative second and the side hint", () => {
    const html = renderBanner({
      mode: "preparing",
      remainingSeconds: 8,
      sideHint: "YOUR BUILD ROW: +X END",
      roundNumber: 3,
    });
    expect(html).toContain("preparation-banner--preparing");
    expect(html).toContain("BUILD PHASE");
    expect(html).toMatch(/preparation-banner__count[^>]*>\s*8\s*</);
    expect(html).toContain("YOUR BUILD ROW: +X END");
    expect(html).toContain("Round 3");
    expect(html).toContain("Arena opens in 8s");
    expect(html).toContain("8 seconds remaining");
  });

  it("the exhausted build second reads as the gate opening rather than a fake zero clock", () => {
    const html = renderBanner({ mode: "preparing", remainingSeconds: 0 });
    expect(html).toContain("ARENA OPENING");
    expect(html).not.toContain("preparation-banner__count");
    expect(html).not.toMatch(/0:00|0s|∞/);
  });

  it("omits the side hint when the server has not assigned a side", () => {
    const html = renderBanner({ mode: "preparing", remainingSeconds: 5, sideHint: null });
    expect(html).not.toContain("preparation-banner__side");
    expect(html).toContain("BUILD PHASE");
  });
});

describe("PreparationBanner stylesheet contract (visible, buildable arena)", () => {
  it("exists and is pointer-transparent so input reaches the game", () => {
    expect(bannerRule()).toContain("pointer-events: none");
  });

  it("is a compact top-band strip, not a full-viewport opaque takeover", () => {
    const rule = bannerRule();
    // No full-viewport geometry, and a translucent surface rather than a scrim:
    // the arena and the crosshair stay readable during preparation.
    expect(rule).not.toContain("inset: 0");
    expect(rule).toMatch(/background: rgb\(8 13 24 \/ 72%\)/);
    expect(rule).toContain("max-width: min(");
  });

  it("keeps a rule for every class the component emits", () => {
    for (const name of [
      "preparation-banner",
      "preparation-banner--waiting",
      "preparation-banner--preparing",
      "preparation-banner__round",
      "preparation-banner__label",
      "preparation-banner__count",
      "preparation-banner__hint",
      "preparation-banner__side",
    ]) {
      expect(lifecycleCss, `missing rule for .${name}`).toContain(`.${name}`);
    }
  });
});

describe("Untimed fight: the HUD never shows a round clock", () => {
  it("in-progress header shows score, round and status only", () => {
    const html = renderMatchHud({ phase: MatchPhase.IN_PROGRESS });
    expect(html).toContain("match-hud__score");
    expect(html).toContain("match-hud__round");
    expect(html).toContain("IN PROGRESS");
    expect(html).not.toContain("match-hud__timer");
    expect(html).not.toContain('role="timer"');
    expect(html).not.toMatch(/\d:\d\d/);
  });

  it("a legacy timer value arriving on the props cannot render a clock", () => {
    // Cast: the timer props were removed with the untimed-round contract, so a
    // stale caller passing them must still produce no timer markup.
    const legacyProps = {
      localScore: 1,
      remoteScore: 0,
      phase: MatchPhase.IN_PROGRESS,
      currentRound: 1,
      localWonLastRound: null,
      localWonMatch: null,
      roundTimerRemainingMs: 45_000,
      roundTimerTotalMs: 90_000,
    } as unknown as MatchHudProps;
    const html = renderToStaticMarkup(createElement(MatchHud, legacyProps));
    expect(html).not.toContain("match-hud__timer");
    expect(html).not.toContain("0:45");
    expect(html).not.toMatch(/\d:\d\d/);
  });

  it("only elimination and the leaving/forfeit disconnect are labelled", () => {
    expect(roundEndReasonLabel("elimination", true)).toBe("OPPONENT ELIMINATED");
    expect(roundEndReasonLabel("disconnect", false)).toBe("YOU DISCONNECTED");
    // Retired timed / anti-stall win conditions are suppressed, not labelled.
    expect(roundEndReasonLabel("time_expired", true)).toBeNull();
    expect(roundEndReasonLabel("anti_stall_timeout", false)).toBeNull();
    expect(roundEndReasonLabel(undefined, null)).toBeNull();
  });
});

describe("MatchHud preparation awareness", () => {
  it("labels the pre-fight phase as the build phase only while preparation runs", () => {
    expect(phaseLabel(MatchPhase.COUNTDOWN, true)).toBe("BUILD");
    expect(phaseLabel(MatchPhase.COUNTDOWN, false)).toBe("GET READY");
    expect(phaseLabel(MatchPhase.COUNTDOWN)).toBe("GET READY");
    expect(phaseLabel(MatchPhase.IN_PROGRESS, true)).toBe("IN PROGRESS");
  });

  it("renders the build label for a preparation countdown", () => {
    const html = renderMatchHud({
      phase: MatchPhase.COUNTDOWN,
      preparationActive: true,
      currentRound: 1,
    });
    expect(html).toContain(">BUILD<");
    expect(html).not.toContain("GET READY");
  });

  it("suppresses the waiting indicator while preparation proves both players joined", () => {
    const waiting = renderMatchHud({
      phase: MatchPhase.COUNTDOWN,
      waitingForOpponent: true,
    });
    expect(waiting).toContain("match-hud__waiting");

    const preparing = renderMatchHud({
      phase: MatchPhase.COUNTDOWN,
      waitingForOpponent: true,
      preparationActive: true,
    });
    expect(preparing).not.toContain("match-hud__waiting");
  });
});

describe("Gate-opening cue", () => {
  it("the go overlay presents the short FIGHT cue", () => {
    const html = renderToStaticMarkup(
      createElement(CountdownOverlay, {
        remainingSeconds: 0,
        visible: true,
        phase: "go",
        goLabel: FIGHT_CUE_LABEL,
      }),
    );
    expect(html).toContain("countdown-overlay--go");
    expect(html).toContain(">FIGHT<");
    expect(html).not.toContain("GO!");
  });

  it("falls back to GO! when the caller supplies no cue word", () => {
    const html = renderToStaticMarkup(
      createElement(CountdownOverlay, { remainingSeconds: 0, visible: true, phase: "go" }),
    );
    expect(html).toContain("GO!");
  });
});

describe("App shell wiring (source contract)", () => {
  it("mounts the preparation banner from the authoritative lifecycle view", () => {
    expect(appSource).toContain("derivePreparationUi(lifecycle)");
    expect(appSource).toContain("<PreparationBanner");
  });

  it("mounts the FIGHT gate cue and never the legacy full-screen counting overlay", () => {
    expect(appSource).toContain("goLabel={FIGHT_CUE_LABEL}");
    expect(appSource).not.toContain('phase="counting"');
  });
});
