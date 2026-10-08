/**
 * Source-wiring contract test for the round / match lifecycle presentation.
 *
 * `GameRuntime.create()` needs a WebGL canvas and an async Rapier physics
 * world, so the canonical `App -> GameCanvas -> GameRuntime -> NetworkClient`
 * route is asserted at the source level (mirroring
 * `GameRuntime.hudWiring.contract.test.ts`). The pure presentation layer is
 * unit-tested in `ui/matchPresentation.test.ts` and
 * `ui/useMatchPresentation.test.ts`.
 *
 * What this contract locks down:
 *  - the lifecycle screens (countdown overlay, round banner, match-end
 *    screen) are rendered by `App` exclusively from the presentation state
 *    derived by `useMatchPresentation` off the authoritative lifecycle view;
 *  - `GameCanvas` builds that view ONLY from the runtime's existing
 *    authoritative sources (`getMatchState`, `getSessionId`,
 *    `getCountdownSeconds`, `connected`) — no mirrored gameplay state is
 *    invented in the React layer;
 *  - the runtime's match state comes from the shared `NetworkClient`'s
 *    `onStateChange` (the canonical authoritative route) and is republished
 *    through `onMatchStateChange` for the React layer;
 *  - rematch routes through the runtime's EXISTING rejoin mechanism
 *    (`rejoinRoom` -> `networkClient.stop()` + `start()`) — the same
 *    NetworkClient that runs the match, never a second connection;
 *  - the authoritative match mapping (`buildMatchLifecycleView`) translates
 *    the parsed server state into the local player's perspective and
 *    connection-gates the countdown (unit-tested below with the real parser
 *    and protocol values);
 *  - reconnect clears the match bookkeeping (match-over flag, snapshot
 *    baseline, countdown) so a rematch starts clean, and dispose releases
 *    the match-state listeners.
 */
import { readFileSync } from "node:fs";
import { MatchPhase, RoundState } from "@buildshift/protocol";
import { describe, expect, it } from "vitest";
import { buildMatchLifecycleView } from "./matchLifecycleView";
import { parseMatchState } from "./network/matchStateParse";

const runtime = readFileSync(new URL("./GameRuntime.ts", import.meta.url), "utf8");
const canvas = readFileSync(new URL("./GameCanvas.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

describe("App round / match lifecycle presentation", () => {
  it("renders every lifecycle screen from the useMatchPresentation state", () => {
    expect(app).toContain('import { useMatchPresentation } from "./ui/useMatchPresentation";');
    expect(app).toContain("const presentation = useMatchPresentation(lifecycle);");
    // All three lifecycle moments come from that single derived state:
    expect(app).toContain("<CountdownOverlay");
    expect(app).toContain("<RoundEndBanner");
    expect(app).toContain("<MatchEndScreen");
    expect(app).toContain("onPlayAgain={handlePlayAgain}");
  });

  it("routes Play Again through the runtime's rejoin action", () => {
    expect(app).toContain("actionsRef.current?.rejoinRoom();");
  });
});

describe("GameCanvas round / match lifecycle wiring", () => {
  it("builds the lifecycle view only from the runtime's authoritative sources", () => {
    // Initial prime and every subsequent update use the runtime's own
    // match state, session id, countdown, and connection flag.
    const builds = canvas.match(/buildMatchLifecycleView\(/g) ?? [];
    expect(builds.length).toBeGreaterThanOrEqual(2);
    expect(canvas).toContain("r.getMatchState()");
    expect(canvas).toContain("r.getSessionId()");
    expect(canvas).toContain("r.getCountdownSeconds()");
    expect(canvas).toContain("r.connected");
    // The view is pushed to the parent (App) for the overlay screens.
    expect(canvas).toContain("onLifecycleChangeRef.current?.(view);");
  });

  it("subscribes to the runtime's authoritative match-state updates and unsubscribes", () => {
    expect(canvas).toContain("unsubMatch = r.onMatchStateChange((state: ParsedMatchState) => {");
    expect(canvas).toContain("unsubMatch?.();");
  });

  it("exposes rematch through the runtime's existing rejoin mechanism", () => {
    // Both the rejoin action and the rematch action delegate to the SAME
    // runtime rejoin — no second client or second connection surface.
    expect(canvas).toContain("rejoinRoom: () => r.rejoinRoom(),");
    expect(canvas).toContain("requestRematch: () => r.rejoinRoom(),");
    expect(canvas).toContain("leaveRoom: () => r.leaveRoom(),");
  });
});

describe("GameRuntime round / match state route", () => {
  it("derives the match state from the shared NetworkClient state changes", () => {
    // The match state enters the runtime through the canonical state
    // subscription on the shared network client ...
    expect(runtime).toContain(
      "this.unsubscribeState=this.networkClient.onStateChange((s)=>this.handleNetworkState(s))",
    );
    // ... and is republished to the React layer via onMatchStateChange.
    expect(runtime).toContain("public onMatchStateChange(listener:(state:ParsedMatchState)=>void):()=>void");
  });

  it("detects reset / match-end from the canonical snapshot diff", () => {
    expect(runtime).toContain(
      "const dec=computeMatchReset(this.prevMatchSnapshot,snap);this.prevMatchSnapshot=snap;if(dec.matchEnded)this.matchOver=true;",
    );
  });

  it("rejoins a room through the existing NetworkClient stop/start route", () => {
    // Rematch = stop the current room and start a fresh one on the SAME
    // client instance (the canonical route, no second connection).
    expect(runtime).toContain(
      "public async rejoinRoom():Promise<void>{this.networkClient.stop();await this.networkClient.start();}",
    );
    expect(runtime).toContain("public leaveRoom():void{this.networkClient.stop();}");
  });

  it("clears match bookkeeping on (re)connect so a rematch starts clean", () => {
    const idx = runtime.indexOf("this.unsubscribeConnection=this.networkClient.onConnectionChange");
    expect(idx).toBeGreaterThan(-1);
    const block = runtime.slice(idx, idx + 900);
    // The match-over flag, the snapshot baseline, and the countdown all
    // return to their fresh-match values on (re)connect.
    expect(block).toContain("this.matchOver=false");
    expect(block).toContain("this.prevMatchSnapshot={...INITIAL_MATCH_SNAPSHOT}");
    expect(block).toContain("this.countdownSeconds=0");
  });

  it("releases the match-state listeners and the state subscription on teardown", () => {
    expect(runtime).toContain("this.matchStateListeners.length=0;");
    expect(runtime).toContain("this.unsubscribeState?.();");
  });
});

describe("buildMatchLifecycleView (authoritative state -> local perspective)", () => {
  it("maps an authoritative match-end state to the local player's perspective", () => {
    const parsed = parseMatchState({
      matchPhase: MatchPhase.MATCH_ENDED,
      roundScore: { "session-a": 3, "session-b": 1 },
      currentRound: 4,
      lastRoundResult: { winnerId: "session-a", roundNumber: 4 },
    });
    const view = buildMatchLifecycleView(parsed, "session-a", 0, true);
    expect(view.roundState).toBe(RoundState.MATCH_OVER);
    expect(view.currentRound).toBe(4);
    expect(view.localScore).toBe(3);
    expect(view.remoteScore).toBe(1);
    expect(view.localWonMatch).toBe(true);
    expect(view.localWonLastRound).toBe(true);
  });

  it("reports the loss from the local perspective when the remote wins", () => {
    const parsed = parseMatchState({
      matchPhase: MatchPhase.MATCH_ENDED,
      roundScore: { "session-a": 1, "session-b": 3 },
      currentRound: 4,
      lastRoundResult: { winnerId: "session-b", roundNumber: 4 },
    });
    const view = buildMatchLifecycleView(parsed, "session-a", 0, true);
    expect(view.localWonMatch).toBe(false);
    expect(view.localWonLastRound).toBe(false);
  });

  it("zeroes the countdown while disconnected and nulls the perspective without a session", () => {
    const parsed = parseMatchState({
      matchPhase: MatchPhase.COUNTDOWN,
      roundScore: {},
      currentRound: 0,
    });
    // Disconnected: the authoritative countdown must not render.
    const disconnected = buildMatchLifecycleView(parsed, "session-a", 3, false);
    expect(disconnected.countdownRemainingSeconds).toBe(0);
    expect(disconnected.roundState).toBe(RoundState.COUNTDOWN);
    // No session: perspective values are null, scores are zero.
    const noSession = buildMatchLifecycleView(parsed, null, 3, true);
    expect(noSession.localWonMatch).toBeNull();
    expect(noSession.localWonLastRound).toBeNull();
    expect(noSession.localScore).toBe(0);
    expect(noSession.remoteScore).toBe(0);
  });
});
