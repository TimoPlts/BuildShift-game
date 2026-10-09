/**
 * Rendering tests for the MatchEndScreen component.
 *
 * The project's test toolchain runs vitest in a node environment without a
 * DOM testing library, so these tests render the component to static markup
 * (SSR) and assert on the resulting HTML: the victory/defeat emphasis,
 * final-score display, rematch-readiness state, accessibility contract,
 * and the action-button labels.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchEndScreen, type MatchEndScreenProps } from "./MatchEndScreen";

/** Render MatchEndScreen with a base set of props, merged with per-case overrides. */
function render(overrides: Partial<MatchEndScreenProps> = {}): string {
  const props: MatchEndScreenProps = {
    localWon: true,
    localScore: 3,
    remoteScore: 1,
    onPlayAgain: () => {},
    onLeave: () => {},
    ...overrides,
  };
  return renderToStaticMarkup(createElement(MatchEndScreen, props));
}

describe("MatchEndScreen — victory / defeat emphasis", () => {
  it("renders the Victory title with the victory style class when the local player won", () => {
    const html = render({ localWon: true });
    expect(html).toContain("Victory");
    expect(html).toContain("match-end-screen__title--victory");
    expect(html).not.toContain("match-end-screen__title--defeat");
  });

  it("renders the Defeat title with the defeat style class when the local player lost", () => {
    const html = render({ localWon: false });
    expect(html).toContain("Defeat");
    expect(html).toContain("match-end-screen__title--defeat");
    expect(html).not.toContain("match-end-screen__title--victory");
  });

  it("marks the container as a modal dialog for screen readers", () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Match ended"');
  });
});

describe("MatchEndScreen — final score emphasis", () => {
  it("shows the final score with the local score first", () => {
    const html = render({ localScore: 3, remoteScore: 1 });
    expect(html).toContain("match-end-screen__score");
    expect(html).toContain("Final Score");
    expect(html).toContain("3 — 1");
  });

  it("shows the total rounds when provided and > 0", () => {
    const html = render({ totalRounds: 4 });
    expect(html).toContain("match-end-screen__rounds");
    expect(html).toContain("4 rounds");
  });

  it("omits the total rounds line when totalRounds is 0 or undefined", () => {
    const zero = render({ totalRounds: 0 });
    expect(zero).not.toContain("match-end-screen__rounds");

    const undef = render({ totalRounds: undefined });
    expect(undef).not.toContain("match-end-screen__rounds");
  });
});

describe("MatchEndScreen — winner label and final round reason", () => {
  it("shows the explicit winner label when provided", () => {
    const html = render({ matchWinnerLabel: "Player Alpha" });
    expect(html).toContain("match-end-screen__winner");
    expect(html).toContain("Player Alpha");
  });

  it("omits the winner label when empty or not provided", () => {
    const empty = render({ matchWinnerLabel: "" });
    expect(empty).not.toContain("match-end-screen__winner");

    const undef = render({ matchWinnerLabel: undefined });
    expect(undef).not.toContain("match-end-screen__winner");
  });

  it("shows the final round reason label", () => {
    const html = render({ finalRoundReason: "elimination", localWon: true });
    expect(html).toContain("match-end-screen__reason");
    expect(html).toContain("OPPONENT ELIMINATED");
  });

  it("shows the round reason from the local perspective on a loss", () => {
    const html = render({ finalRoundReason: "elimination", localWon: false });
    expect(html).toContain("YOU WERE ELIMINATED");
  });

  it("omits the reason line when no reason is provided", () => {
    const html = render({ finalRoundReason: undefined });
    expect(html).not.toContain("match-end-screen__reason");
  });
});

describe("MatchEndScreen — rematch readiness", () => {
  it("shows the rematch-available status with a window countdown when open", () => {
    const html = render({ rematchAvailable: true, rematchWindowSeconds: 12 });
    expect(html).toContain("match-end-screen__rematch");
    expect(html).toContain("match-end-screen__rematch--ready");
    expect(html).toContain("Rematch available");
    expect(html).toContain("12s");
    // The primary button is labelled Rematch and carries the ready class.
    expect(html).toContain("match-end-screen__btn--rematch-ready");
    expect(html).toContain("Rematch");
  });

  it("shows the rematch-closed status when the window has expired", () => {
    const html = render({ rematchAvailable: false, rematchWindowSeconds: 0 });
    expect(html).toContain("match-end-screen__rematch--closed");
    expect(html).toContain("Rematch window closed");
    // The primary button falls back to "Play Again" (no rematch-ready class).
    expect(html).toContain("Play Again");
    expect(html).not.toContain("match-end-screen__btn--rematch-ready");
  });

  it("shows the generic 'Rematch available' status when no window seconds are known", () => {
    const html = render({ rematchAvailable: true, rematchWindowSeconds: undefined });
    expect(html).toContain("Rematch available");
    // No countdown seconds suffix
    expect(html).not.toContain("0s");
  });

  it("omits the rematch status line entirely when readiness is unknown", () => {
    const html = render({ rematchAvailable: undefined, rematchWindowSeconds: undefined });
    expect(html).not.toContain("match-end-screen__rematch");
  });
});

describe("MatchEndScreen — action buttons", () => {
  it("always renders both the primary and the Leave buttons", () => {
    const html = render();
    expect(html).toContain("match-end-screen__actions");
    expect(html).toContain("match-end-screen__btn--primary");
    expect(html).toContain("match-end-screen__btn--secondary");
    expect(html).toContain("Leave");
  });

  it("labels the primary button 'Play Again' when rematch is not available", () => {
    const html = render({ rematchAvailable: false });
    expect(html).toContain("Play Again");
    expect(html).not.toContain(
      // "Rematch" as a standalone button label (the word appears in the
      // rematch status line only when a status is shown)
      ">Rematch</button>",
    );
  });
});
