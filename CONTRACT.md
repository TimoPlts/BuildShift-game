# Round Preparation — Shared Contract (server worker, 2026-11-18)

Authoritative definition of the **8-second pre-fight preparation phase** and the
**removal of all timed round resolution**. Owner: server worker (TASK A).
Client (web) and any other workers MUST follow this document. If the server
later changes a signature it will be recorded here first with a note to the
affected workers.

Baseline carried: `6ffa06ef4f4ff84c49df87ea8740567cf685df5d` (includes centred
aim `a20e30f` + visual offset `caa2b53`). Camera / facing / HUD / AI Guide chat
model / key bindings are otherwise unchanged.

## 1. Gameplay rules (authoritative)

- Each round: **preparation phase → fight → elimination → short reset pause →
  next preparation**. Match is first to `ROUNDS_TO_WIN` (3) round wins.
- **Preparation**: `BOX_FIGHT_PREPARATION.durationSeconds = 8` seconds. Starts
  fairly (the countdown only ticks while BOTH players are connected) after both
  players are present in `MatchPhase.COUNTDOWN`.
- During preparation each player is restricted to ONE build-grid row at their
  end of the arena (the outermost X rows of `BUILD_BOUNDS`). They may move,
  jump, crouch, build, and edit inside their assigned row only. Controlled
  movement IS allowed (this replaces the old frozen countdown).
- **No firing, no damage, no ammo spend** during preparation. Fire inputs are
  ignored by the server (no `FIRE_REJECTED` broadcast, no ammo consumed).
- When preparation ends, both players' temporary barriers vanish
  simultaneously and the full arena opens in the SAME tick: prep constraints
  lift, full-arena movement/combat/building allowed, and **all structures built
  during preparation survive**.
- Rounds end **only on elimination**. Disconnect-grace expiry forfeit is kept
  as the explicit player-leaving exception. There is NO round-duration timer,
  NO anti-stall timeout, and NO health-comparison winner. A fight may last
  arbitrarily long and stays `IN_PROGRESS`.
- Round end → `ROUND_ENDED` (pause, unchanged `ROUND_RESET_DELAY_SECONDS`) →
  next round: ALL structures cleared exactly once, players respawn at their
  preparation-row spawn, health/shield/energy/ammo reset, fresh 8 s prep with
  the SAME side assignments.
- Energy: normal costs/regen apply during prep AND fight (same rates, capped at
  `ENERGY.maxEnergy`). Prep building is not free — it uses the same energy.

## 2. Phase vocabulary (unchanged enum, reused semantics)

`MatchPhase.COUNTDOWN` == build preparation. `MatchPhase.IN_PROGRESS` == fight.
`ROUND_ENDED` / `MATCH_ENDED` unchanged.

## 3. Shared config — `@buildshift/game-config` → `./boxFightPreparation.js`

New module, exported from the package index:

```ts
export const BOX_FIGHT_PREPARATION = { durationSeconds: 8 } as const;

export type PreparationSide = "negative" | "positive";

export interface PreparationZone {
  /** World-space X range of the allowed strip (one build-cell wide). */
  minX: number; maxX: number;
  /** World-space Z range: the FULL playable arena Z. */
  minZ: number; maxZ: number;
  /** The single allowed build-grid X column index. */
  gridX: number;
  /** Row-centre spawn (feet convention, y = VERTICAL_MOVEMENT.groundY, z = 0). */
  spawn: { x: number; y: number; z: number };
}

export function getPreparationZone(side: PreparationSide): PreparationZone;
/** Copy-on-clamp of pose {x,z} into the strip, capsule radius respected
 *  (same convention as clampToPlayableArena). */
export function clampToPreparationZone<T extends { x: number; z: number }>(
  pose: T, radius: number, side: PreparationSide): T;
/** Whether a placement anchor grid cell lies in the side's prep row
 *  (grid.x === zone.gridX; any in-bounds z and layer are allowed). */
export function isGridAllowedDuringPreparation(
  grid: { x: number; y: number; z: number }, side: PreparationSide): boolean;
```

Derivation (NOT hardcoded visual geometry): `gridX` = `BUILD_BOUNDS.minX`
(negative side) / `BUILD_BOUNDS.maxX` (positive side); the strip is the cell's
world span `[gridX*cellSize − cellSize/2, gridX*cellSize + cellSize/2]`;
`minZ/maxZ` = `PLAYABLE_ARENA_BOUNDS.minZ/maxZ`; spawn = row centre
`(gridX*cellSize, VERTICAL_MOVEMENT.groundY, 0)`.

**Spawns changed**: the two room spawn points are now the preparation row
centres (x = ∓10.24 m with the current grid), replacing the old x = ∓5 m
centres. Client spawn-related assumptions must read the state positions, not
hardcode ±5.

**Removed from `@buildshift/game-config`**: `ROUND_DURATION_SECONDS` and
`ANTI_STALL_TIMEOUT_SECONDS` are DELETED (no consumer may import them).
`REMATCH_WINDOW_SECONDS`, `ROUND_COUNTDOWN_SECONDS` (legacy; now only the
reset-pause/countdown doc value — the prep duration is
`BOX_FIGHT_PREPARATION.durationSeconds`), `WIN_ROUNDS`/`ROUNDS_TO_WIN`,
`ROUND_RESET_DELAY_SECONDS` remain.

## 4. Replicated state — `@buildshift/protocol` schemas

- `RoomStateSchema.preparationActive: t.boolean()` — `true` ONLY while both
  players are connected AND the preparation `COUNTDOWN` is actually running
  (it is `false` while a solo player waits, during the fight, and after).
- `PlayerStateSchema.preparationSide: t.string()` — `"negative"`,
  `"positive"`, or `""` (empty before assignment). Assignment is by room
  spawn-slot index: slot 0 → `"negative"` (−X row), slot 1 → `"positive"`
  (+X row). Stable for the session lifetime incl. reconnect-restore.

Both fields are plain defaults (`false` / `""`) until the server sets them.
Clients: render prep UI from `preparationActive` + `matchPhase === COUNTDOWN`
+ `preparationSide`; do NOT derive the zone from visuals — import
`getPreparationZone` from game-config.

## 5. Broadcasts

- `match:countdown_tick` — preparation countdown (payload unchanged:
  `{ countdownTicks, totalTicks }`; `totalTicks` now = 8 s × 30 Hz = 240).
- `match:round_timer` — **NO LONGER BROADCAST**. Clients must stop relying on
  it (the server-side event constant stays declared for wire compatibility but
  is dead).
- `match:round_reset`, `match:round_over`, `match:end`, rematch events —
  unchanged.
- Round-over / match-end `reason` values now only: `"elimination"` and
  `"disconnect"`. `"time_expired"` and `"anti_stall_timeout"` are DEPRECATED in
  `@buildshift/protocol` (`RoundEndReason` keeps the literals for compatibility
  but the server never emits them).

## 6. Build/edit validation during preparation (server-side, authoritative)

- Placement is accepted during `COUNTDOWN` only when
  `isGridAllowedDuringPreparation(grid, player.preparationSide)` — i.e.
  `grid.x === zone.gridX`. Crossing builds (enemy row, centre rows) are
  rejected with NEW reason `"preparation_zone"` (added to
  `BuildRejectionReason` in `@buildshift/protocol`).
- Editing owned structures is allowed during `COUNTDOWN` too (ownership check
  unchanged, so edits cannot escape the row).
- Normal validation (bounds/rotation/range/overlap/rate/energy) is unchanged
  and still applies during prep.
- Movement enforcement: server clamps the capsule inside the assigned strip
  every processed input while `matchPhase === COUNTDOWN`, including while
  jumping/crouching and after reconnect; spoofed out-of-zone inputs simply
  clamp to the strip. Reconnect restores `preparationSide` and clamps the
  restored position into the row when reconnecting during prep.

## 7. Test-only escape hatch (server-owned capability token)

The preparation length is never a client input. A real `joinOrCreate(...)`
payload can contain anything at all, so the contract does not ask clients to
refrain — the server simply has no way to honour it:

- **Production (`createServer()`, i.e. what `src/index.ts` boots) registers the
  canonical room with `{ __testPreparationToken: "" }`** and the room resolves
  the preparation length only from a token this process issued
  (`apps/game-server/src/rooms/testPreparationOverride.js`). No token ⇒ the
  authoritative `BOX_FIGHT_PREPARATION.durationSeconds` (8 s) for both players.
  A client cannot shorten its own or the opponent's preparation with
  `testPreparationSeconds` or any guard/flag name it invents.
- **Why a token and not a boolean guard:** Colyseus 0.18 hands `onCreate`
  `merge({}, clientOptions, handler.options)`
  (`@colyseus/core/src/MatchMaker.ts`), a shallow key assignment. Every option
  name the registration does NOT pin arrives verbatim from the client, so a
  client-supplied boolean "test mode" flag would be spoofable — and an absent
  key (rather than an explicitly pinned one) would not be overwritten either.
  The duration is therefore resolved server-side from the issued token; the room
  never reads a duration out of `onCreate` options at all.
- **Allowed test setup:** construct the server with the override, which puts a
  freshly issued token in the server-defined handler options —
  `createServer({}, { testPreparationSeconds: 0.4 })`, wrapped by the test
  fixture `apps/game-server/src/test/testServerFixture.js`
  (`startTestServer(0, { testPreparationSeconds })`, default 0.1 s). The token is
  random per registration and is never sent to clients, so even a client on a
  test server can neither arm nor widen the shortening.
- **Not allowed / not honoured:** no environment variable, no `NODE_ENV`-derived
  behaviour, no dedicated test room type, and no client-side option name. Tests
  must join the single canonical `ROOMS.TWO_PLAYER_MOVEMENT` route exactly as the
  web client does.
- Contract coverage: `twoPlayerPreparationGuard.test.ts` (production registration
  + hostile join proving 8 s survives spoofed durations/flags/tokens) and
  `twoPlayerPreparationFixture.test.ts` (positive control: the server-pinned
  short preparation really is what clients observe).
