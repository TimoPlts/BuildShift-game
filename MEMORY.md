# Project memory

## Project

BuildShift is a TypeScript pnpm monorepo for a server-authoritative multiplayer browser building shooter. The web client uses React, Vite, and Babylon.js; the game server uses Colyseus and Rapier. See `README.md` and `docs/TECHNICAL_ARCHITECTURE.md` for the source-of-truth architecture.

## Current goal

Add small, client-only combat feedback to the production App → GameCanvas → GameRuntime → NetworkClient path: a local muzzle flash for accepted local shots and a center-screen hit marker only after an authoritative confirmed hit. Assault-rifle and shotgun muzzle flashes must differ. Gameplay rules and server authority must not change.

## Agreed plan

1. Build and test a self-cleaning Babylon combat-feedback component in the UI/scene worker worktree.
2. Review that component, then have the client worker wire local accepted fire and the authoritative hit event through the canonical runtime/network path.
3. Review the integrated diff, run the full test, typecheck, and build gates, then update this record with actual results.

## Decisions

- Persistent project memory consists of this file for changing status and `AGENTS.md` for stable collaboration rules.
- Pi is configured outside this repository with a private VIVES model configuration. No credentials belong in this repository.
- Future Pi work uses four isolated worker worktrees: shared contracts, server, client/networking, and UI/scene. The coordinator assigns tasks, collects reports, and owns shared memory updates.
- Do not commit or push unless the user explicitly approves it.

## Progress and checks

- Paused the runner safely with T6 interrupted and T5 pending. Independently ran web tests on the partial T6 tree: 225 passed, 3 skipped, 2 lighting failures. Root cause: disposing lights mutates the array during iteration and skips a light on repeat setup. No browser validation yet.
- Finished T6 and T5 directly, preserving worker branches and original task history. Added T8 for the isolated lighting regression; all eight tasks integrated normally. Final integration `9b47f0b591860998c7ecba03f8225a38aa0f65ab`: 754 tests passed, 3 skipped; typecheck and build passed. Controller final acceptance sweep passed and mission is completed. Game main remains `25b8982bc56975e3a6a12cbd77e7d23ddf3cf985`. No browser smoke test was performed.
- Fixed integrator stale-baseline replay by excluding exact ancestors already reachable from integration HEAD; 33 control-plane tests passed, including the new regression. Agent-system fix pushed as `0770a6b`. Temporary operator handoff script and recovery plan retained under private runtime `backups/`; no model retries used for the completion work.

- Pi is installed and its VIVES configuration was validated without exposing the key.
- The legacy visual-foundation mission completed with all eight tasks integrated. Its `integration/auto` result was merged into `main` locally.
- After the merge, `pnpm test`, `pnpm typecheck`, and `pnpm build` all passed. The test output includes pre-existing Colyseus “message not registered” warnings; the commands still exited successfully.
- The two memory files were reviewed and checked for trailing whitespace. No application code was changed for the memory setup itself.
- Four clean Pi worker worktrees and a private controller were created. The controller can start, steer, inspect, interrupt, and stop the shared, server, client, and UI workers through tmux. No worker task or Pi editing session has been started yet.
- A non-editing VIVES Pi readiness request succeeded.
- The combat-feedback mission is planned but implementation has not started. Browser/manual visual verification remains required after automated checks.

## Next step

Review the UI worker's isolated component before assigning canonical client/runtime wiring.
