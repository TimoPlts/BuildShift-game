/**
 * @deprecated RETIRED — Legacy combat room superseded by
 * {@link TwoPlayerMovementRoom}.
 *
 * The canonical authoritative gameplay path is now
 * {@link TwoPlayerMovementRoom} (see `TwoPlayerMovementRoom.ts`), which drives
 * movement AND hitscan combat in a single 30 Hz tick loop.
 *
 * This file previously held a competing "combat room" implementation that was
 * fully superseded by `TwoPlayerMovementRoom`. No production code path
 * registers, instantiates, or imports from it: `server.ts` registers only
 * `TwoPlayerMovementRoom`, and the rooms barrel (`index.ts`) exports only
 * `TwoPlayerMovementRoom`.
 *
 * This file is intentionally empty and exports nothing. It is retained solely
 * as an explicit marker for the retired legacy artifact. Do not re-add room
 * logic here — extend `TwoPlayerMovementRoom` instead.
 */
export {};
