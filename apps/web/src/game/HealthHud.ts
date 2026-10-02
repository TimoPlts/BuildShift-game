/**
 * @deprecated Legacy location — re-export of the canonical HealthHud.
 *
 * The canonical implementation now lives at:
 *   `apps/web/src/game/network/HealthHud.ts`
 *
 * Import from the canonical networking path directly:
 * ```ts
 * import { HealthHud } from "./network/HealthHud"; // relative to game/
 * ```
 *
 * This file is a temporary compatibility shim so any lingering importer of
 * the old `game/HealthHud` location still resolves to the single canonical
 * implementation. It should be deleted once that path is fully retired.
 */
export { HealthHud } from "./network/HealthHud";
