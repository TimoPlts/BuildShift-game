import { expect, it } from "vitest";
import { ASSAULT_RIFLE } from "@buildshift/game-config";
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

it("real NetworkClient reload and build edits round-trip through the canonical room to both clients", async () => {
  const { server, port } = await startServer(0);
  const a = new NetworkClient({ serverUrl: `ws://127.0.0.1:${port}` });
  const b = new NetworkClient({ serverUrl: `ws://127.0.0.1:${port}` });
  const weapons: any[] = [];
  a.onEvent("combat:weapon_state", event => weapons.push(event));
  try {
    await a.start(); await b.start();
    await until(() => a.state.match.matchPhase === MatchPhase.IN_PROGRESS);
    a.sendInput({ sequence: 10, moveX: 0, moveZ: 0, lookYaw: 0, lookPitch: 0, jump: false, sprint: false, crouch: false, primaryFire: true, secondaryFire: false });
    await until(() => a.state.players[a.sessionId!]?.ammo === ASSAULT_RIFLE.maxAmmo - 1);
    a.sendWeaponReload();
    await until(() => weapons.some(w => w.reloading));
    await until(() => a.state.players[a.sessionId!]?.ammo === ASSAULT_RIFLE.maxAmmo);
    expect(weapons.at(-1)).toMatchObject({ reloading: false, reloadRemainingMs: 0 });
    a.sendWeaponSwitch("shotgun");
    await until(() => weapons.at(-1)?.weaponId === "shotgun");
    a.send(BUILD_EVENTS.PLACEMENT_REQUEST, { sequence: 1, buildType: "wall", grid: { x: -2, y: 0, z: 1 }, rotation: 0 });
    await until(() => Object.keys(a.state.building.structures).length === 1 && Object.keys(b.state.building.structures).length === 1);
    const id = Object.keys(a.state.building.structures)[0];
    a.sendBuildEdit(id, "window_center");
    await until(() => a.state.building.structures[id]?.openings?.[0]?.pattern === "window_center" && b.state.building.structures[id]?.openings?.[0]?.pattern === "window_center");
    a.sendBuildEdit(id, "none");
    await until(() => a.state.building.structures[id]?.openings?.length === 0 && b.state.building.structures[id]?.openings?.length === 0);
    a.send("two-player:build_edit", { structureId: id, editType: "half_top", gridOffset: { x: 1, y: 1, z: 0 } });
    await until(() => a.state.building.structures[id]?.editType === "half_top" && b.state.building.structures[id]?.editType === "half_top");
  } finally {
    a.stop(); b.stop();
    await shutdownServer(server);
  }
}, 25000);
