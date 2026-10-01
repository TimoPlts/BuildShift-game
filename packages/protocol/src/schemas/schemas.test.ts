/**
 * Unit tests for the Stage 2D Colyseus movement schemas.
 *
 * Verifies:
 *  1. PlayerStateSchema can be instantiated, all fields can be read/written.
 *  2. RoomStateSchema can hold players in its `players` map (set/get/delete).
 *  3. MovementInput is a plain interface with the correct shape.
 *  4. The schemas integrate correctly (a player instance stored in the map
 *     is the same reference and reflects mutations).
 */
import { describe, expect, it } from "vitest";
import {
  PlayerStateSchema,
  RoomStateSchema,
  type MovementInput,
  type PlayerStateSchemaInstance,
  type RoomStateSchemaInstance,
} from "../index.js";

describe("PlayerStateSchema", () => {
  it("is a constructible class (function)", () => {
    expect(typeof PlayerStateSchema).toBe("function");
  });

  it("supports reading and writing all fields after explicit initialization", () => {
    const p = new (PlayerStateSchema as any)() as PlayerStateSchemaInstance;

    p.x = 1.5;
    p.y = 2.0;
    p.z = -3.25;
    p.yaw = Math.PI / 4;
    p.velocityY = 9.8;
    p.grounded = true;
    p.lastInputSequence = 42;

    expect(p.x).toBe(1.5);
    expect(p.y).toBe(2.0);
    expect(p.z).toBe(-3.25);
    expect(p.yaw).toBeCloseTo(Math.PI / 4);
    expect(p.velocityY).toBe(9.8);
    expect(p.grounded).toBe(true);
    expect(p.lastInputSequence).toBe(42);
  });

  it("supports the negative lastInputSequence sentinel (-1 = no input processed)", () => {
    const p = new (PlayerStateSchema as any)() as PlayerStateSchemaInstance;
    p.lastInputSequence = -1;
    expect(p.lastInputSequence).toBe(-1);
  });

  it("supports updating fields (simulating a server tick)", () => {
    const p = new (PlayerStateSchema as any)() as PlayerStateSchemaInstance;

    // Initial state
    p.x = 0;
    p.y = 0;
    p.z = 0;
    p.yaw = 0;
    p.velocityY = 0;
    p.grounded = true;
    p.lastInputSequence = 0;

    // Simulate a jump
    p.velocityY = 12;
    p.grounded = false;

    expect(p.velocityY).toBe(12);
    expect(p.grounded).toBe(false);

    // Simulate landing
    p.velocityY = 0;
    p.grounded = true;

    expect(p.velocityY).toBe(0);
    expect(p.grounded).toBe(true);
  });
});

describe("RoomStateSchema", () => {
  it("is a constructible class (function)", () => {
    expect(typeof RoomStateSchema).toBe("function");
  });

  it("has an empty players map on construction", () => {
    const room = new (RoomStateSchema as any)() as RoomStateSchemaInstance;
    expect(room.players).toBeDefined();
    expect(room.players.size).toBe(0);
  });

  it("supports adding, reading, and removing players from the map", () => {
    const room = new (RoomStateSchema as any)() as RoomStateSchemaInstance;

    // Simulate player A joining
    const playerA = new (PlayerStateSchema as any)() as PlayerStateSchemaInstance;
    playerA.x = 10;
    playerA.y = 0;
    playerA.z = 5;
    playerA.yaw = Math.PI;
    playerA.velocityY = 0;
    playerA.grounded = true;
    playerA.lastInputSequence = 0;
    room.players.set("session-a", playerA);

    // Simulate player B joining
    const playerB = new (PlayerStateSchema as any)() as PlayerStateSchemaInstance;
    playerB.x = -5;
    playerB.y = 3;
    playerB.z = 2;
    playerB.yaw = 0;
    playerB.velocityY = 9.8;
    playerB.grounded = false;
    playerB.lastInputSequence = 7;
    room.players.set("session-b", playerB);

    // Verify both are present
    expect(room.players.size).toBe(2);
    expect(room.players.get("session-a")).toBe(playerA);
    expect(room.players.get("session-b")).toBe(playerB);
    expect(playerA.x).toBe(10);
    expect(playerB.velocityY).toBe(9.8);

    // Simulate player A leaving
    room.players.delete("session-a");
    expect(room.players.size).toBe(1);
    expect(room.players.has("session-a")).toBe(false);
    expect(room.players.has("session-b")).toBe(true);
  });

  it("supports iterating over players (forEach)", () => {
    const room = new (RoomStateSchema as any)() as RoomStateSchemaInstance;

    const p1 = new (PlayerStateSchema as any)() as PlayerStateSchemaInstance;
    p1.x = 1;
    const p2 = new (PlayerStateSchema as any)() as PlayerStateSchemaInstance;
    p2.x = 2;

    room.players.set("id-1", p1);
    room.players.set("id-2", p2);

    const keys: string[] = [];
    const xs: number[] = [];
    room.players.forEach((value, key) => {
      keys.push(key);
      xs.push(value.x);
    });

    expect(keys.sort()).toEqual(["id-1", "id-2"]);
    expect(xs.sort()).toEqual([1, 2]);
  });

  it("reflects mutations to a player stored in the map (live reference)", () => {
    const room = new (RoomStateSchema as any)() as RoomStateSchemaInstance;

    const player = new (PlayerStateSchema as any)() as PlayerStateSchemaInstance;
    player.x = 0;
    player.y = 0;
    player.z = 0;
    player.yaw = 0;
    player.velocityY = 0;
    player.grounded = true;
    player.lastInputSequence = 0;
    room.players.set("s1", player);

    // Mutate through the stored reference
    player.x = 42;
    player.lastInputSequence = 5;

    // Read back through the map — should reflect the mutation
    const retrieved = room.players.get("s1")!;
    expect(retrieved.x).toBe(42);
    expect(retrieved.lastInputSequence).toBe(5);
  });
});

describe("MovementInput (plain interface)", () => {
  it("has the correct shape (structural verification)", () => {
    const input: MovementInput = {
      sequence: 3,
      moveX: 1,
      moveZ: -1,
      yaw: Math.PI / 2,
      pitch: -Math.PI / 4,
      jump: true,
      crouch: false,
    };

    expect(input.sequence).toBe(3);
    expect(input.moveX).toBe(1);
    expect(input.moveZ).toBe(-1);
    expect(input.yaw).toBeCloseTo(Math.PI / 2);
    expect(input.pitch).toBeCloseTo(-Math.PI / 4);
    expect(input.jump).toBe(true);
    expect(input.crouch).toBe(false);
  });

  it("supports boundary values for movement axes (-1 and 1)", () => {
    const input: MovementInput = {
      sequence: 0,
      moveX: -1,
      moveZ: 1,
      yaw: 0,
      pitch: 0,
      jump: false,
      crouch: true,
    };

    expect(input.moveX).toBe(-1);
    expect(input.moveZ).toBe(1);
    expect(input.crouch).toBe(true);
    expect(input.jump).toBe(false);
  });
});
