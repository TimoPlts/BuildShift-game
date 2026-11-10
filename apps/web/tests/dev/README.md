# BuildShift — developer visual-capture harness (Batch 2D D)

Manual, repeatable screenshot harness for visual-polish review. It drives the
**real production path** — the built web client (`apps/web/dist`, Babylon +
Rapier + Colyseus) against the real authoritative game server (run in-process,
unmodified) — in headless Chromium using the real input bindings. No production
code is modified; the only in-page hook used is the pre-existing `?devdiag=1`
developer hook (`window.__buildshiftEngine`), which is OFF unless explicitly
requested in the URL.

## Captured scenarios

| # | file | content |
|---|------|---------|
| 01 | `01-idle-local.png` | local humanoid, idle at round start |
| 02 | `02-run-local.png` | local humanoid, running (mid-hold `W`) |
| 03 | `03-opponent.png` | opponent character (second live client, idle at mirrored spawn) |
| 04 | `04-weapon-ar.png` | assault rifle equipped (model + HUD) |
| 05 | `05-weapon-shotgun.png` | shotgun equipped (model + HUD) |
| 06 | `06-build.png` | wall + floor + ramp + cone placed (build layer, live pieces) |
| 07 | `07-build-edited.png` | a placed piece edited through the live edit flow (select → confirm) |
| 08 | `08-arena-overview.png` | overhead arena view (one-shot dev-hook camera override) |
| 09 | `09-hud-active.png` | active-round HUD (weapon, ammo, vitals, round timer) |

Every shot is accompanied by read-only scene diagnostics (mesh / active-mesh /
material / texture / geometry counts, `structure-*` root count, approximate
draw-call metrics from `engine._drawCalls`, camera pose) collected via the
devdiag hook and written to `artifacts/visual-report.json`.

## Run

```bash
pnpm install
pnpm --filter @buildshift/web build      # produces apps/web/dist

cd apps/game-server
node_modules/.bin/tsx ../web/tests/dev/visualScreenshot.ts
```

Artifacts land in `apps/web/tests/dev/artifacts/` (gitignored). Exit code 0 =
all nine scenarios captured and their production-state checks passed. The run
is bounded by a watchdog (default 150 s; `BS_VISUAL_TIMEOUT_MS`).

### Ports / environment

| variable | default | purpose |
|----------|---------|---------|
| `BS_VISUAL_GAME_PORT` | `25783` | authoritative game server |
| `BS_VISUAL_STATIC_PORT` | `41883` | static `dist` server |
| `BS_VISUAL_TIMEOUT_MS` | `150000` | overall watchdog |

Default ports are chosen to be unique against the other harnesses in the repo
(the browser suite and the stress harness use different pairs); override the
environment variables if a port collides in a parallel environment.

## Determinism notes & limitations

- Setup is deterministic where the game allows it: fixed spawns, fixed input
  sequence, fixed camera (no aim changes except the strafe in scenario 03).
  Frames are still *live* gameplay — the server ticks, the opponent is a real
  second client, and timings can vary run-to-run. This is a **manual**
  reference-capture tool, not a pixel-diff gate; no mandatory pixel-diff CI is
  added by design.
- Headless Chromium renders via software fallback, so colors/shadows may differ
  slightly from a desktop GPU browser.
- Scenario 08 uses a dev-only, one-frame-class camera override installed
  through the existing `?devdiag=1` engine hook and removed immediately after
  the shot; the third-person camera controller re-claims the camera on the next
  frame, so no camera state persists.
- Scenario 07 depends on aiming at a just-placed structure at the default
  camera pose; if the edit target cannot be acquired, the scenario is reported
  as failed in the JSON report rather than skipped silently.
- Scenario 06 first pitches the camera down at the floor in front (a level
  aim has no build-plane candidate, so pieces would not place) and pans to a
  fresh cell between pieces; scenario 07 pans back onto the first-placed
  floor piece so the edit flow has a live owned structure to aim at.
- The overlay removed before each shot (`.devdiag-overlay`) is the
  presentational developer diagnostics panel only; the engine hook itself stays
  attached for diagnostics collection.
