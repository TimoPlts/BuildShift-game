import { describe, expect, it } from "vitest";
import { NetworkClient } from "./NetworkClient";

describe("NetworkClient canonical weapon commands", () => {
  it("puts only canonical switch and reload messages on the room transport", () => {
    const sent: Array<{ type: string; payload: unknown }> = [];
    const client = new NetworkClient() as unknown as {
      sendWeaponSwitch(weaponId: "assault_rifle" | "shotgun"): boolean;
      sendWeaponReload(): boolean;
      sendRematchRequest(): boolean;
      room: { send(type: string, payload?: unknown): void } | null;
      _isConnected: boolean;
    };

    client.room = {
      send(type, payload) {
        sent.push({ type, payload });
      },
    };
    client._isConnected = true;

    expect(client.sendWeaponSwitch("shotgun")).toBe(true);
    expect(client.sendWeaponReload()).toBe(true);
    expect(client.sendRematchRequest()).toBe(true);
    expect(sent).toEqual([
      { type: "two-player:weapon_switch", payload: { targetWeaponId: "shotgun" } },
      { type: "two-player:weapon_reload", payload: {} },
      { type: "match:rematch_request", payload: {} },
    ]);
    expect(sent.some(message => message.type.startsWith("weapon:"))).toBe(false);
  });
});
