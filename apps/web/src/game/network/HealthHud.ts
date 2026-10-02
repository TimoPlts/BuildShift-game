/**
 * Re-export from the canonical HealthHud location.
 *
 * The canonical implementation lives at `apps/web/src/game/HealthHud.ts`.
 * This re-export exists only for backward-compatible path resolution;
 * new code should import directly from `../HealthHud` or the canonical path.
 */
export { HealthHud } from "../HealthHud";
