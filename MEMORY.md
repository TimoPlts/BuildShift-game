# Project memory

## Project

BuildShift is a TypeScript pnpm monorepo for a server-authoritative multiplayer browser building shooter. The web client uses React, Vite, and Babylon.js; the game server uses Colyseus and Rapier. See `README.md` and `docs/TECHNICAL_ARCHITECTURE.md` for the source-of-truth architecture.

## Current goal

Finish the remaining legacy visual mission immediately: preserve worker changes, fix the lighting disposal regression, complete production wiring and verification, and run normal integration gates. User approved committing and pushing task branches; main remains unchanged.

Use Pi with the VIVES Qwen model as the interactive coding harness for future BuildShift work. The user directs the work through Codex; no source-code task has yet been agreed for Pi.

## Agreed plan

1. Completed: the legacy visual-foundation mission reached completion and was merged into `main`.
2. For the next agreed feature, discuss a small plan before editing, then use Pi and keep this file current.

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

## Next step

Agree on the first Pi mission before changing source code. The coordinator will split it only when independent work is safe.
