/**
 * In-game HUD barrel exports — presentation-only React components for the
 * BuildShift 1v1 Energy Box Fight game HUD.
 *
 * - **GameHud** — the cohesive full-viewport HUD layer composing the match
 *   header, energy, weapon, vitals and build panels.
 * - **CombatVitalsHud** — bottom-right health + shield panel.
 * - **WeaponHUD** — bottom-left equipped weapon, magazine rounds, reload
 *   progress and loadout slot indicator.
 *
 * All components are purely presentational: they accept data via props and
 * perform no networking, no game runtime queries, and no side effects beyond
 * rendering.
 */

export {
  GameHud,
  type GameHudProps,
} from "./GameHud";

export {
  CombatVitalsHud,
  type CombatVitalsHudProps,
} from "./CombatVitalsHud";

export {
  WeaponHUD,
  type WeaponHUDProps,
} from "./WeaponHud";
