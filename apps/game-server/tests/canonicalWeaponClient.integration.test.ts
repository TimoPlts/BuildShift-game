import { expect, it } from "vitest";
import { ASSAULT_RIFLE, SHOTGUN } from "@buildshift/game-config";
import { BUILD_EVENTS, MatchPhase } from "@buildshift/protocol";
import { NetworkClient } from "../../web/src/game/network/NetworkClient";
import { startServer, shutdownServer } from "../src/server.js";

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 8000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for authoritative client state");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

it("real NetworkClient fire, reload, and build edits round-trip through the canonical room to both clients", async () => {
  const { server, port } = await startServer(0);
  const a = new NetworkClient({ serverUrl: `ws://127.0.0.1:${port}` });
  const b = new NetworkClient({ serverUrl: `ws://127.0.0.1:${port}` });
  const weapons: any[] = [];
  const roundTimers: any[] = [];
  const editResults: unknown[] = [];
  a.onEvent("combat:weapon_state", event => weapons.push(event));
  a.onEvent("match:round_timer", event => roundTimers.push(event));
  a.onEvent("two-player:edit_grid_action", event => editResults.push(event));
  try {
    await a.start(); await b.start();
    await until(() => a.state.match.matchPhase === MatchPhase.IN_PROGRESS);
    const timerCountBeforeFire = roundTimers.length;
    // Fire is carried only by the next canonical input frame.
    a.sendInput({ sequence: 10, moveX: 0, moveZ: 0, lookYaw: 0, lookPitch: 0, jump: false, sprint: false, crouch: false, primaryFire: true, secondaryFire: false });
    await until(() => a.state.players[a.sessionId!]?.ammo === ASSAULT_RIFLE.maxAmmo - 1);
    await until(() => roundTimers.length >= timerCountBeforeFire + 2);
    expect(a.isConnected).toBe(true);
    expect(a.state.match.matchPhase).toBe(MatchPhase.IN_PROGRESS);
    a.sendWeaponReload();
    await until(() => weapons.some(w => w.reloading));
    await until(() => a.state.players[a.sessionId!]?.ammo === ASSAULT_RIFLE.maxAmmo);
    expect(weapons.at(-1)).toMatchObject({ reloading: false, reloadRemainingMs: 0 });
    a.sendInput({ sequence: 20, moveX: 0, moveZ: 0, lookYaw: 0, lookPitch: 0, jump: false, sprint: false, crouch: false, primaryFire: true, secondaryFire: false });
    await until(() => a.state.players[a.sessionId!]?.ammo === ASSAULT_RIFLE.maxAmmo - 1);
    a.sendWeaponSwitch("shotgun");
    await until(() => weapons.at(-1)?.weaponId === "shotgun");
    await new Promise(resolve => setTimeout(resolve, 300));
    a.sendInput({ sequence: 100, moveX: 0, moveZ: 0, lookYaw: 0, lookPitch: 0, jump: false, sprint: false, crouch: false, primaryFire: true, secondaryFire: false });
    await until(() => a.state.players[a.sessionId!]?.ammo === SHOTGUN.maxAmmo - 1);
    a.sendWeaponReload();
    await until(() => weapons.some(w => w.weaponId === "shotgun" && w.reloading));
    await until(() => a.state.players[a.sessionId!]?.ammo === SHOTGUN.maxAmmo);
    a.sendWeaponSwitch("assault_rifle");
    await until(() => weapons.at(-1)?.weaponId === "assault_rifle");
    expect(a.isConnected).toBe(true);
    expect(a.state.match.matchPhase).toBe(MatchPhase.IN_PROGRESS);
    a.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 1, buildType: "wall", grid: { x: -2, y: 0, z: 1 }, rotation: 0 });
    await until(() => Object.keys(a.state.building.structures).length === 1 && Object.keys(b.state.building.structures).length === 1);
    const id = Object.keys(a.state.building.structures)[0];
    a.send("two-player:edit_grid_action", { structureId: id, action: "select", tileIndex: 4 });
    await until(() => editResults.length > 0);
    expect(editResults.at(-1)).toMatchObject({ structureId: id, success: true });
    await until(() => a.state.building.structures[id]?.editGrid?.kind === "wall" && a.state.building.structures[id]?.editGrid?.tiles[4] === false && b.state.building.structures[id]?.editGrid?.kind === "wall" && b.state.building.structures[id]?.editGrid?.tiles[4] === false);
    a.send("two-player:edit_grid_action", { structureId: id, action: "reset" });
    await until(() => a.state.building.structures[id]?.editGrid?.kind === "wall" && a.state.building.structures[id]?.editGrid?.tiles.every(Boolean) && b.state.building.structures[id]?.editGrid?.kind === "wall" && b.state.building.structures[id]?.editGrid?.tiles.every(Boolean));
  } finally {
    a.stop(); b.stop();
    await shutdownServer(server);
  }
}, 25000);
