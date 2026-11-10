# Browser Repair — Surface F Held-Input Synchronization

## Cause (from trace)

The diagnostic run established:
- Each initial piece (wall, ramp, cone) produces exactly one request.
- The held chord emits the ramp request at 59109 ms and the wall at 59628 ms
  (519 ms gap). The full-suite run previously observed a **third** ramp at the
  final count because the fixture waited for the *authoritative* ramp echo
  (server round-trip ~330–500 ms) before dispatching the Mouse3 CDP switch.
  During that window the turbo loop (334 ms cadence, 10-tick interval) fires
  again, placing a second ramp at the next valid cell.

## Inference (root cause)

The CDP `Input.dispatchMouseEvent` round-trip (Node → browser process →
renderer) takes 30–60 ms in practice. Combined with the 100 ms default
`expect.poll` interval, the total delay from local-request to wall-switch
exceeded the remaining budget before the next 334 ms turbo tick, so the
second ramp request was submitted with `selectedBuildType` still "ramp".

## Fix

Replaced the authoritative-echo wait with a **10 ms local-request poll** plus
an **in-page synthetic `MouseEvent` dispatch** for the back button:

1. After `setPrimaryFire(a, true)`, poll `__surfaceFRequests` at 10 ms
   intervals until the first local ramp request for cell (1,0,1) appears.
2. Immediately dispatch `mousedown` + `mouseup` (button 3, buttons 9→1) on
   the pointer-locked canvas element — the same mechanism `setPrimaryFire`
   uses for the primary button. This executes synchronously in the page's
   JS context with zero cross-process latency.
3. Still wait for **both** authoritative structures (ramp and wall) before
   releasing primary.

The `buttons` bitmask (9 = primary + back on mousedown, 1 = primary only on
mouseup) preserves the `attachMouseBindPresses` held-button state without
releasing the primary.

## Changes

`apps/web/tests/production.browser.test.ts` — surface F test only:
- Replaced `waitStructure` (authoritative ramp) + `trace` + `pressKey`
  (CDP Mouse3) with `expect.poll` (10 ms local request) + `page.evaluate`
  (in-page side-button click).
- Removed the "held ramp observed before wall bind" trace (no longer
  meaningful after reordering).
- Retained all final assertions: 5-piece count, no navigation, ammo,
  edit sends, rejections.

## Result

```
6 passed (6.2m)
```

All six required tests pass: surface F, orientation A, edit reset B,
stack D, stack E, stack F.

Surface F trace confirms exactly 2 requests in the held chord:
- sequence 3: ramp {x:1, y:0, z:1} at 53147 ms
- sequence 4: wall {x:1, y:0, z:1} at 53766 ms (619 ms later, same cell)

No third ramp.

## Remaining risks

- Under extreme load (very slow CI machine), the 10 ms poll could miss the
  window if the renderer stalls >334 ms between frames. The 10 s timeout
  catches this as a test failure rather than a false pass.
- The in-page synthetic event bypasses the browser's input pipeline. If a
  future game change adds an `isTrusted` check on side-button events, this
  would break. No such check exists in the current codebase.

## Commit

Local commit on branch `pi/assignment09-browser-repair-20261110`.
