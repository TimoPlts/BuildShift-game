import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@colyseus/core";
import { ASSAULT_RIFLE, SHOTGUN, SHOTGUN_WEAPON } from "@buildshift/game-config";
import { BUILD_EDIT_EVENTS, MatchPhase } from "@buildshift/protocol";
import { TwoPlayerMovementRoom, TWO_PLAYER_MOVEMENT_INPUT } from "./TwoPlayerMovementRoom.js";
import { StructureStateSchema } from "../state/buildingState.js";

// Use the production handlers and simulation, with a manually advanced server
// clock. No sleeps, duplicate implementation, or private-state authority mocks.
describe("canonical weapon and build-edit authority", () => {
  let room: TwoPlayerMovementRoom;
  let internal: any;
  let a: Client;
  let b: Client;
  let handlers: Map<string, (client: Client, message: unknown) => void>;
  const network = {
    sendWeaponSwitch: (weaponId: string) => send("two-player:weapon_switch", { targetWeaponId: weaponId }),
    sendWeaponReload: () => send("two-player:weapon_reload", {}),
    sendBuildEdit: (structureId: string, editPattern: string) => send("build:edit_request", { structureId, editPattern }),
  };
  const send = (type: string, value: unknown, client = a) => {
    const handler = handlers.get(type);
    expect(handler, `registered production route ${type}`).toBeDefined();
    handler!(client, value);
  };
  const fire = (sequence: number, yaw = 0) => {
    send(TWO_PLAYER_MOVEMENT_INPUT, { sequence, moveX: 0, moveZ: 0, lookYaw: yaw, lookPitch: 0, primaryFire: true });
    internal.tick();
  };
  const advance = (ticks: number) => { for (let i = 0; i < ticks; i++) internal.tick(); };
  const slot = (id = "assault_rifle") => internal.wps.get("a").slots.get(id);

  beforeEach(async () => {
    room = new TwoPlayerMovementRoom();
    internal = room as any;
    await internal.pwp;
    handlers = new Map();
    vi.spyOn(room, "onMessage").mockImplementation(((type: string, fn: any) => { handlers.set(type, fn); }) as any);
    vi.spyOn(room, "setFixedTimestep").mockImplementation(() => {});
    vi.spyOn(room, "broadcast").mockImplementation(() => {});
    a = { sessionId: "a", send: vi.fn() } as unknown as Client;
    b = { sessionId: "b", send: vi.fn() } as unknown as Client;
    room.clients.push(a, b);
    room.onCreate();
    room.onJoin(a); room.onJoin(b);
    internal.br();
  });
  afterEach(() => { room.onDispose(); room.clock.clear(); vi.restoreAllMocks(); });

  it("switches through the production route and preserves per-slot ammo", () => {
    fire(10);
    network.sendWeaponSwitch("shotgun");
    expect(room.state.players.get("a")!.currentWeapon).toBe("shotgun");
    expect(room.state.players.get("a")!.ammo).toBe(SHOTGUN.maxAmmo);
    network.sendWeaponSwitch("assault_rifle");
    expect(room.state.players.get("a")!.ammo).toBe(ASSAULT_RIFLE.maxAmmo - 1);
  });
  it.each([null, {}, { weaponId: "blaster" }, { weaponId: "bogus" }])("rejects invalid switches %j", payload => {
    send("two-player:weapon_switch", payload);
    expect(room.state.players.get("a")!.currentWeapon).toBe("assault_rifle");
  });
  it("rejects dead-player and out-of-phase switch/reload/fire", () => {
    fire(10);
    const p = room.state.players.get("a")!;
    p.alive = false; p.isEliminated = true;
    network.sendWeaponSwitch("shotgun"); network.sendWeaponReload(); fire(1000);
    expect(p.currentWeapon).toBe("assault_rifle"); expect(slot().reloading).toBe(false);
    expect(p.ammo).toBe(ASSAULT_RIFLE.maxAmmo - 1);
    p.alive = true; p.isEliminated = false; room.state.matchPhase = MatchPhase.COUNTDOWN;
    network.sendWeaponSwitch("shotgun"); network.sendWeaponReload();
    expect(p.currentWeapon).toBe("assault_rifle"); expect(slot().reloading).toBe(false);
  });
  it("enforces server time even when a client forges large sequence jumps", () => {
    fire(10); fire(1000000);
    expect(slot().magazineAmmo).toBe(ASSAULT_RIFLE.maxAmmo - 1);
    advance(ASSAULT_RIFLE.fireIntervalTicks);
    fire(1000001);
    expect(slot().magazineAmmo).toBe(ASSAULT_RIFLE.maxAmmo - 2);
  });
  it("does not bypass shotgun cooldown by switching weapons", () => {
    network.sendWeaponSwitch("shotgun"); fire(10);
    network.sendWeaponSwitch("assault_rifle"); advance(ASSAULT_RIFLE.fireIntervalTicks); fire(100);
    expect(slot().magazineAmmo).toBe(ASSAULT_RIFLE.maxAmmo);
  });
  it("applies rifle damage shield-first and obeys range", () => {
    const target = room.state.players.get("b")!;
    const before = target.health + target.shield;
    fire(10, Math.PI / 2);
    expect(target.health + target.shield).toBe(before - ASSAULT_RIFLE.damage);
    target.x = 100; advance(ASSAULT_RIFLE.fireIntervalTicks); fire(100, Math.PI / 2);
    expect(target.health + target.shield).toBe(before - ASSAULT_RIFLE.damage);
  });
  it("fires multiple shotgun pellets but consumes only one shell", () => {
    network.sendWeaponSwitch("shotgun");
    const target = room.state.players.get("b")!;
    target.x = -4;
    const before = target.health + target.shield;
    fire(10, Math.PI / 2);
    expect(target.health + target.shield).toBe(before - SHOTGUN_WEAPON.pellets * SHOTGUN_WEAPON.perPelletDamage);
    expect(slot("shotgun").magazineAmmo).toBe(SHOTGUN.maxAmmo - 1);
  });
  it("rejects empty fire, full/invalid/no-reserve reloads", () => {
    network.sendWeaponReload(); expect(slot().reloading).toBe(false);
    slot().magazineAmmo = 0; fire(10); expect(slot().magazineAmmo).toBe(0);
    send("two-player:weapon_reload", { weaponId: "bad" }); expect(slot().reloading).toBe(false);
    send("two-player:weapon_reload", { weaponId: "shotgun" }); expect(slot().reloading).toBe(false);
    slot().reserveAmmo = 0; network.sendWeaponReload(); expect(slot().reloading).toBe(false);
  });
  it("shotgun spread misses off-axis targets and respects its maximum range", () => {
    network.sendWeaponSwitch("shotgun");
    const target = room.state.players.get("b")!;
    target.x = -4; target.z = 3;
    const before = target.health + target.shield;
    fire(10, Math.PI / 2);
    expect(target.health + target.shield).toBe(before);
    target.x = 100; target.z = 0; advance(SHOTGUN.fireIntervalTicks); fire(100, Math.PI / 2);
    expect(target.health + target.shield).toBe(before);
    expect(slot("shotgun").magazineAmmo).toBe(SHOTGUN.maxAmmo - 2);
  });
  it("a repeated reload cannot restart the timer and cannot create reserve ammo", () => {
    slot().magazineAmmo = 0; slot().reserveAmmo = 2;
    network.sendWeaponReload(); advance(10); network.sendWeaponReload();
    expect(slot().reloadProgress).toBe(10);
    advance(ASSAULT_RIFLE.reloadTicks - 10);
    expect(slot().magazineAmmo).toBe(2); expect(slot().reserveAmmo).toBe(0);
    expect(slot().reloading).toBe(false);
  });
  it("reloads through the client route, blocks fire/switch, transfers reserve and reports completion", () => {
    fire(10); network.sendWeaponReload();
    expect(slot().reloading).toBe(true);
    expect(a.send).toHaveBeenLastCalledWith("combat:weapon_state", expect.objectContaining({ reloading: true, reloadRemainingMs: 2000 }));
    network.sendWeaponSwitch("shotgun"); fire(100);
    expect(room.state.players.get("a")!.currentWeapon).toBe("assault_rifle");
    expect(slot().magazineAmmo).toBe(ASSAULT_RIFLE.maxAmmo - 1);
    advance(ASSAULT_RIFLE.reloadTicks);
    expect(slot().reloading).toBe(false);
    expect(slot().magazineAmmo).toBe(ASSAULT_RIFLE.maxAmmo);
    expect(slot().reserveAmmo).toBe(ASSAULT_RIFLE.maxReserve - 1);
    expect(a.send).toHaveBeenLastCalledWith("combat:weapon_state", expect.objectContaining({ reloading: false, reloadRemainingMs: 0 }));
  });
  it("round reset clears pending reload, cooldown, and both weapon slots", () => {
    fire(10); network.sendWeaponReload(); internal.bc();
    expect(slot().reloading).toBe(false); expect(slot().magazineAmmo).toBe(ASSAULT_RIFLE.maxAmmo);
    expect(slot("shotgun").magazineAmmo).toBe(SHOTGUN.maxAmmo);
    expect(internal.nextFireTick.size).toBe(0);
  });

  function wall() {
    const s = new StructureStateSchema();
    s.structureId = "wall"; s.ownerId = "a"; s.buildType = "wall"; s.editType = "";
    s.maxDurability = 100; s.currentDurability = 100;
    internal.bld.structures.set("wall", s);
    return s;
  }
  it("applies and clears the client's edit pattern in authoritative state", () => {
    const s = wall();
    network.sendBuildEdit("wall", "window_center"); expect(s.editType).toBe("window");
    expect(room.broadcast).toHaveBeenCalledWith(BUILD_EDIT_EVENTS.EDIT_RESULT, expect.objectContaining({ success: true, structureId: "wall" }));
    network.sendBuildEdit("wall", "none"); expect(s.editType).toBe("");
  });
  it.each(["ownership", "phase", "dead", "damaged", "destroyed", "type", "cell", "missing"])("rejects invalid build edit: %s", reason => {
    const s = wall();
    const payload: any = { structureId: "wall", editType: "window", gridOffset: { x: 1, y: 1, z: 0 } };
    if (reason === "ownership") s.ownerId = "b";
    if (reason === "phase") room.state.matchPhase = MatchPhase.COUNTDOWN;
    if (reason === "dead") room.state.players.get("a")!.alive = false;
    if (reason === "damaged") s.currentDurability = 50;
    if (reason === "destroyed") s.currentDurability = 0;
    if (reason === "type") s.buildType = "ramp";
    if (reason === "cell") payload.gridOffset.x = 3;
    if (reason === "missing") payload.structureId = "missing";
    send("two-player:build_edit", payload);
    expect(s.editType).toBe("");
    expect(a.send).toHaveBeenLastCalledWith(BUILD_EDIT_EVENTS.EDIT_RESULT, expect.objectContaining({ success: false }));
  });
});
