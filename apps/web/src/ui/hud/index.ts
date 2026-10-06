/**
 * Weapon HUD barrel exports — presentation-only React components for the
 * BuildShift 1v1 Energy Box Fight weapon status.
 *
 * **Composed HUD:**
 * - **WeaponHUD** — the full bottom-left overlay combining weapon name,
 *   ammo counter, reload bar, and weapon-slot indicator.
 *
 * **Composable sub-components** (for flexible layouts / partial rendering):
 * - **WeaponNameLabel** — standalone weapon name display.
 * - **AmmoCounter** — standalone magazine/reserve ammo display with
 *   low/empty visual states.
 * - **ReloadProgressBar** — standalone reload progress bar.
 *
 * All components are purely presentational: they accept the local player's
 * weapon state via explicit props and perform no networking, no game
 * runtime queries, and no side effects beyond rendering.
 */

export {
  WeaponHUD,
  type WeaponHUDProps,
  type WeaponStateView,
} from "./WeaponHud";

export { WeaponNameLabel, type WeaponNameLabelProps } from "./WeaponNameLabel";

export { AmmoCounter, type AmmoCounterProps } from "./AmmoCounter";

export {
  ReloadProgressBar,
  type ReloadProgressBarProps,
} from "./ReloadProgressBar";
