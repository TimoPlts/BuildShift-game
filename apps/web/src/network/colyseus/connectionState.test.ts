import { describe, expect, it } from "vitest";
import {
  computeNextConnectionState,
  type ConnectionState,
  type ConnectionEvent,
} from "./connectionState";

describe("connectionState", () => {
  it("moves to `connecting` on join-started from any status", () => {
    const from: ConnectionState[] = [
      "disconnected",
      "connecting",
      "connected",
    ];
    for (const current of from) {
      expect(computeNextConnectionState(current, "join-started")).toBe(
        "connecting",
      );
    }
  });

  it("moves to `connected` on a connected event", () => {
    expect(computeNextConnectionState("connecting", "connected")).toBe(
      "connected",
    );
    // A connected event is authoritative regardless of the prior status.
    expect(computeNextConnectionState("disconnected", "connected")).toBe(
      "connected",
    );
  });

  it("moves to `disconnected` on a disconnected event", () => {
    expect(computeNextConnectionState("connected", "disconnected")).toBe(
      "disconnected",
    );
    expect(computeNextConnectionState("connecting", "disconnected")).toBe(
      "disconnected",
    );
  });

  it("moves to `disconnected` on a disposed event", () => {
    expect(computeNextConnectionState("connected", "disposed")).toBe(
      "disconnected",
    );
    expect(computeNextConnectionState("disconnected", "disposed")).toBe(
      "disconnected",
    );
  });

  it("never auto-reconnects: a disconnected status only changes via explicit events", () => {
    // There is no "reconnecting" event; the only terminal events keep the
    // status disconnected.
    const terminal: ConnectionEvent[] = ["disconnected", "disposed"];
    for (const event of terminal) {
      expect(computeNextConnectionState("disconnected", event)).toBe(
        "disconnected",
      );
    }
  });
});
