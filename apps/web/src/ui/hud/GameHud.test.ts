/**
 * Rendering tests for the cohesive in-game HUD components.
 *
 * The project's test toolchain runs vitest in a node environment without a
 * DOM testing library, so these tests render the components to static markup
 * (SSR) and assert on the resulting HTML: every panel, its accessibility
 * contract (roles, labels, live regions) and its data-driven classes.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GameHud, type GameHudProps } from "./GameHud";
import { CombatVitalsHud } from "./CombatVitalsHud";
import { WeaponHUD } from "./WeaponHud";
import type { LocalHudView } from "../../game/localHudView";
import type { MatchHudProps } from "../MatchHud";
import { MatchPhase } from "@buildshift/protocol";
import {
  buildLocalHudView,
  type LocalHudViewInput,
} from "../../game/localHudView";

/** A full, well-formed local HUD view for the render tests. */
function fullLocalView(overrides: Partial<LocalHudViewInput> = {}): LocalHudView {
  return buildLocalHudView({
    health: 84,
    shield: 20,
    energy: 61,
    weaponType: "assault_rifle",
    magazineAmmo: 12,
    magazineSize: 30,
    isReloading: true,
    reloadProgress: 0.42,
    eliminated: false,
    buildMode: true,
    selectedBuildType: "wall",
    placementValid: true,
    gridPosition: { x: 1, y: 0, z: -2 },
    buildEdit: { mode: false, target: null, selectedEdit: "door", allowedEdits: [], feedback: null, applyReady: false },
    roundTimer: { remainingMs: 45_000, totalMs: 90_000 },
    countdownSeconds: 0,
    ...overrides,
  });
}

/** A minimal match header view (round 1 in progress). */
function matchProps(): MatchHudProps {
  return {
    localScore: 1,
    remoteScore: 1,
    phase: MatchPhase.IN_PROGRESS,
    currentRound: 1,
    localWonLastRound: null,
    localWonMatch: null,
    waitingForOpponent: false,
  };
}

describe("GameHud (cohesive container)", () => {
  it("renders nothing before any data source is available", () => {
    const props: GameHudProps = { match: null, local: null };
    expect(renderToStaticMarkup(createElement(GameHud, props))).toBe("");
  });

  it("renders only the match header when the local view is not yet available", () => {
    const html = renderToStaticMarkup(
      createElement(GameHud, { match: matchProps(), local: null }),
    );
    expect(html).toContain("match-hud");
    expect(html).toContain("score");
    // No player panels before the first local snapshot:
    expect(html).not.toContain("combat-vitals-hud");
    expect(html).not.toContain("weapon-hud");
    expect(html).not.toContain("energy-hud");
  });

  it("composes all five panels once both sources are available", () => {
    const html = renderToStaticMarkup(
      createElement(GameHud, { match: matchProps(), local: fullLocalView() }),
    );
    // The shared container layer:
    expect(html).toContain("game-hud");
    // Match header with the authoritative round timer (45_000/90_000 → 45%):
    expect(html).toContain("match-hud");
    expect(html).toContain("match-hud__timer");
    // Player panels:
    expect(html).toContain("energy-hud");
    expect(html).toContain("weapon-hud");
    expect(html).toContain("combat-vitals-hud");
    expect(html).toContain("build-hud");
  });

  it("shows the round timer with remaining seconds when the server timer is live", () => {
    const html = renderToStaticMarkup(
      createElement(GameHud, {
        match: matchProps(),
        local: fullLocalView(),
      }),
    );
    // 45_000 ms remaining → "0:45" shown in the timer read-out.
    expect(html).toMatch(/match-hud__timer-value[^>]*>\s*0:45\s*</);
  });

  it("hides the round timer when no authoritative timer is present", () => {
    const html = renderToStaticMarkup(
      createElement(GameHud, {
        match: matchProps(),
        local: fullLocalView({ roundTimer: null }),
      }),
    );
    expect(html).not.toContain("match-hud__timer");
  });

  it("does not duplicate the pre-round countdown in the header (overlay owns it)", () => {
    const html = renderToStaticMarkup(
      createElement(GameHud, {
        match: matchProps(),
        local: fullLocalView({ countdownSeconds: 3 }),
      }),
    );
    // The countdown is presented exclusively by the full-screen
    // CountdownOverlay in the App shell, never by the match header.
    expect(html).not.toContain("match-hud__countdown");
    expect(html).not.toContain("countdown-overlay");
  });

  it("pulses the score values so an authoritative score change is visible", () => {
    const html = renderToStaticMarkup(
      createElement(GameHud, {
        match: { ...matchProps(), localScore: 2, remoteScore: 1 },
        local: fullLocalView(),
      }),
    );
    expect(html).toContain("match-hud__score-value--pulse");
    expect(html).toMatch(/match-hud__score-value--local match-hud__score-value--pulse/);
    expect(html).toMatch(/match-hud__score-value--remote match-hud__score-value--pulse/);
  });

  it("does not duplicate round or match result banners in the header", () => {
    const roundOver = renderToStaticMarkup(
      createElement(GameHud, {
        match: {
          ...matchProps(),
          phase: MatchPhase.ROUND_ENDED,
          localWonLastRound: true,
        },
        local: fullLocalView(),
      }),
    );
    const matchOver = renderToStaticMarkup(
      createElement(GameHud, {
        match: {
          ...matchProps(),
          phase: MatchPhase.MATCH_ENDED,
          localWonMatch: true,
        },
        local: fullLocalView(),
      }),
    );
    // Result presentation is owned by the RoundEndBanner / MatchEndScreen
    // overlays in the App shell.
    expect(roundOver).not.toContain("match-hud__banner");
    expect(matchOver).not.toContain("match-hud__banner");
    expect(roundOver).not.toContain("ROUND WON");
    expect(matchOver).not.toContain("VICTORY");
  });
});

describe("CombatVitalsHud", () => {
  it("renders labelled health and shield bars with their values", () => {
    const html = renderToStaticMarkup(
      createElement(CombatVitalsHud, {
        health: 84,
        maxHealth: 100,
        shield: 20,
        maxShield: 50,
        eliminated: false,
      }),
    );
    expect(html).toContain("combat-vitals-hud");
    expect(html).toContain("HEALTH");
    expect(html).toContain("SHIELD");
    expect(html).toContain("role=\"progressbar\"");
    expect(html).toContain("aria-valuenow=\"84\"");
    expect(html).toContain("aria-valuenow=\"20\"");
    expect(html).toContain("/ 100");
    expect(html).toContain("/ 50");
  });

  it("selects the critical health fill when health is low", () => {
    const critical = renderToStaticMarkup(
      createElement(CombatVitalsHud, {
        health: 15,
        maxHealth: 100,
        shield: 0,
        maxShield: 50,
        eliminated: false,
      }),
    );
    expect(critical).toContain("combat-vitals-hud__bar-fill--critical");

    const healthy = renderToStaticMarkup(
      createElement(CombatVitalsHud, {
        health: 90,
        maxHealth: 100,
        shield: 0,
        maxShield: 50,
        eliminated: false,
      }),
    );
    expect(healthy).toContain("combat-vitals-hud__bar-fill--healthy");
    expect(healthy).not.toContain("combat-vitals-hud__bar-fill--critical");
  });

  it("shows the elimination state when eliminated", () => {
    const html = renderToStaticMarkup(
      createElement(CombatVitalsHud, {
        health: 0,
        maxHealth: 100,
        shield: 0,
        maxShield: 50,
        eliminated: true,
      }),
    );
    expect(html).toContain("ELIMINATED");
    expect(html).toContain("combat-vitals-hud--eliminated");
  });
});

describe("WeaponHUD", () => {
  it("shows the active weapon with its magazine rounds and capacity", () => {
    const html = renderToStaticMarkup(
      createElement(WeaponHUD, {
        activeWeapon: "assault_rifle",
        magazineAmmo: 12,
        magazineSize: 30,
        isReloading: false,
        reloadProgress: 0,
      }),
    );
    expect(html).toContain("weapon-hud");
    expect(html).toContain("Assault Rifle");
    expect(html).toContain("Shotgun");
    expect(html).toContain("weapon-hud__slot--active");
    expect(html).toContain("12");
    expect(html).toContain("30");
  });

  it("flags an empty magazine", () => {
    const html = renderToStaticMarkup(
      createElement(WeaponHUD, {
        activeWeapon: "shotgun",
        magazineAmmo: 0,
        magazineSize: 8,
        isReloading: false,
        reloadProgress: 0,
      }),
    );
    expect(html).toContain("weapon-hud__ammo--empty");
  });

  it("shows each weapon slot's switch keybind (1 / 2) on its chip", () => {
    const html = renderToStaticMarkup(
      createElement(WeaponHUD, {
        activeWeapon: "assault_rifle",
        magazineAmmo: 12,
        magazineSize: 30,
        isReloading: false,
        reloadProgress: 0,
      }),
    );
    // The slot chips carry the same keys the InputManager binds for
    // weapon switching (Digit1 → assault rifle, Digit2 → shotgun).
    expect(html).toContain("weapon-hud__slot-key");
    expect(html).toContain("Assault Rifle (key 1)");
    expect(html).toContain("Shotgun (key 2)");
    // The secondary ammo count is labelled as capacity, not reserve.
    expect(html).toContain("weapon-hud__ammo-capacity");
  });

  it("prompts to reload with the R keybind only when the magazine is empty and idle", () => {
    const empty = renderToStaticMarkup(
      createElement(WeaponHUD, {
        activeWeapon: "shotgun",
        magazineAmmo: 0,
        magazineSize: 8,
        isReloading: false,
        reloadProgress: 0,
      }),
    );
    expect(empty).toContain("weapon-hud__reload-hint");
    expect(empty).toContain("to reload");

    // While a reload is running the progress bar owns the read-out.
    const reloading = renderToStaticMarkup(
      createElement(WeaponHUD, {
        activeWeapon: "shotgun",
        magazineAmmo: 0,
        magazineSize: 8,
        isReloading: true,
        reloadProgress: 0.5,
      }),
    );
    expect(reloading).not.toContain("weapon-hud__reload-hint");

    // With rounds in the magazine there is nothing to prompt.
    const loaded = renderToStaticMarkup(
      createElement(WeaponHUD, {
        activeWeapon: "shotgun",
        magazineAmmo: 3,
        magazineSize: 8,
        isReloading: false,
        reloadProgress: 0,
      }),
    );
    expect(loaded).not.toContain("weapon-hud__reload-hint");
  });

  it("shows the reload progress bar only while reloading", () => {
    const reloading = renderToStaticMarkup(
      createElement(WeaponHUD, {
        activeWeapon: "assault_rifle",
        magazineAmmo: 0,
        magazineSize: 30,
        isReloading: true,
        reloadProgress: 0.42,
      }),
    );
    expect(reloading).toContain("weapon-hud__reload-track");
    expect(reloading).toContain("role=\"progressbar\"");
    expect(reloading).toContain("aria-valuenow=\"42\"");

    const idle = renderToStaticMarkup(
      createElement(WeaponHUD, {
        activeWeapon: "assault_rifle",
        magazineAmmo: 12,
        magazineSize: 30,
        isReloading: false,
        reloadProgress: 0,
      }),
    );
    expect(idle).not.toContain("weapon-hud__reload-track");
  });
});
