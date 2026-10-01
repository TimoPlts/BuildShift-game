/**
 * Stage 2C1 — the server's authoritative movement simulation.
 *
 * This is the single source of truth for a room's player motion. It composes:
 *  - the multi-player {@link ServerPhysicsWorld} (Rapier world + character
 *    controllers), and
 *  - the shared, deterministic movement math from `@buildshift/simulation`
 *    (`movementInputToWorld`, `stepVerticalMovement`, `JumpController`) — the
 *    SAME math the browser client uses for prediction — so client and server
 *    integrate identically.
 *
 * Authority contract (task §2): the client sends ONLY intent
 * (`PlayerInputFrame`), never a position or velocity. This class owns the
 * position, gravity, jump result, collisions, grounded state, and which input
 * sequence has been authoritatively processed.
 *
 * Input/ack model (task §5):
 *  - `enqueueFrame` records a received frame: it rejects malformed and
 *    duplicate/stale/non-monotonic sequences (tracked per player via
 *    `lastReceivedSequence`) and enqueues the rest;
 *  - `runTick` consumes AT MOST ONE queued frame per player, then runs the
 *    physics substeps; only after a frame's movement has actually been
 *    simulated does its sequence become the player's `acknowledgedSequence`.
 *    A frame that is merely queued is never acknowledged.
 *
 * Jump-edge contract (task §6): a consumed frame is one 30 Hz sample that spans
 * two 60 Hz substeps. Its `jump` edge is fed to the shared `JumpController`
 * EXACTLY ONCE — on the first substep (`jumpPressed = frame.jump`); the second
 * substep always uses `jumpPressed = false`. The jump is never replayed across
 * both substeps.
 *
 * This module is framework-agnostic (no Colyseus imports) so its tick can be
 * driven deterministically in tests by passing a plain `TickInput`, while the
 * room wires Colyseus' `setFixedTimestep` real `StepContext` in.
 */
import {
  JumpController,
  movementInputToWorld,
  stepVerticalMovement,
} from "@buildshift/simulation";
import {
  JUMP_INPUT_TIMING,
  PLAYER_MOVEMENT,
  PLAYER_PHYSICS,
  PLAYER_SPAWN,
} from "@buildshift/game-config";
import type { PlayerInputFrame } from "@buildshift/protocol";

/**
 * Deterministic multiplayer spawn slots (Stage 2D, server-local for this
 * foundation stage — a proper mode-specific spawn set will live with match
 * rules later).
 *
 * Each slot is a capsule-centre position on flat, in-arena ground, clear of the
 * static arena colliders:
 *  - slot 0: the original shared baseline spawn (`PLAYER_SPAWN`, south-east
 *    open area, z = +6);
 *  - slot 1: mirrored east of centre (x = +6, z = +6) — same flat ground,
 *    clear of the reference platform (x ≤ -1.5) and the centre box
 *    (|x| ≤ 1.25).
 *
 * Slots are distinct and non-overlapping at spawn. Beyond the defined slots the
 * allocator falls back to the shared baseline spawn (slot 0), preserving the
 * prior single-spawn behaviour for the foundation room.
 */
export const SPAWN_SLOTS: readonly { x: number; y: number; z: number }[] = [
  { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y, z: PLAYER_SPAWN.z },
  { x: 6, y: PLAYER_SPAWN.y, z: PLAYER_SPAWN.z },
] as const;

import {
  ServerPhysicsWorld,
  type Translation3,
} from "./serverPhysicsWorld.js";

/**
 * The minimal per-tick cadence the simulation needs. Colyseus' `StepContext`
 * structurally satisfies this, and tests can supply a plain literal.
 */
export interface TickInput {
  /** Number of physics substeps to run for this tick. */
  readonly subSteps: number;
  /** Duration of each physics substep, in seconds. */
  readonly subDt: number;
}

/** The authoritative movement state of one player. */
export interface AuthoritativePlayerState {
  /** Capsule-centre world position (metres, Y-up), from the Rapier body. */
  position: Translation3;
  /** Horizontal facing, radians (the runtime look-yaw, exposed to clients). */
  yaw: number;
  /**
   * True when the player's character is on the ground (as reported by the
   * physics character controller after the most recent substep).
   */
  landed: boolean;
  /**
   * Highest input sequence whose movement has actually been processed by the
   * authoritative simulation (`-1` = none yet).
   */
  acknowledgedSequence: number;
}

/** Outcome of {@link AuthoritativeMovement.enqueueFrame}. */
export type EnqueueResult =
  | "accepted"
  | "rejected-malformed"
  | "rejected-sequence"
  | "rejected-unknown-player";

/**
 * Per-player runtime input/simulation state. Intentionally separate from the
 * wire `PlayerState`: pitch is server-runtime only (never synced), and the
 * input queue + jump/grounded history are simulation-internal.
 */
interface PlayerRuntime {
  /** Highest sequence RECEIVED (used to reject duplicate/stale frames). */
  lastReceivedSequence: number;
  /**
   * The spawn slot index assigned to this player (`-1` when it fell back to
   * the shared baseline spawn beyond the defined slots). Freed on
   * {@link removePlayer}/{@link dispose} so a later join can reuse it.
   */
  slot: number;
  /** Queued-but-not-yet-processed frames, FIFO. */
  pending: PlayerInputFrame[];
  /**
   * The frame consumed by the most recent tick (until the next tick
   * replaces it). Used to apply the jump edge on the first substep only.
   */
  consumed: PlayerInputFrame | null;
  /** Held movement/facing, updated ONLY when a frame is consumed. */
  held: {
    moveX: number;
    moveZ: number;
    yaw: number;
    /** Server-runtime look pitch; never synced to clients. */
    pitch: number;
  };
  /** Vertical (world-Y) velocity, m/s, carried between substeps. */
  verticalVelocity: number;
  /** Grounded reported by the previous substep (lags by one step). */
  lastGrounded: boolean;
  /** Highest sequence whose movement has been processed (= the ack). */
  acknowledgedSequence: number;
  /** Shared jump buffer / coyote-time decision. */
  jumpController: JumpController;
}

/**
 * The authoritative movement simulation for one room.
 */
export class AuthoritativeMovement {
  private readonly physics: ServerPhysicsWorld;
  private readonly runtimes = new Map<string, PlayerRuntime>();
  /**
   * Spawn slots currently occupied by a live player (slot index → true).
   * Bounded by `SPAWN_SLOTS.length`; entries are released on leave/dispose so
   * bookkeeping never leaks past the slot count.
   */
  private readonly occupiedSlots = new Set<number>();

  private constructor(physics: ServerPhysicsWorld) {
    this.physics = physics;
  }

  /**
   * Deterministically assigns the lowest free spawn slot, or `-1` when none of
   * the defined slots is free (caller then falls back to the shared baseline
   * spawn). The chosen index is recorded as occupied atomically with the
   * assignment.
   */
  private allocateSlot(): number {
    for (let i = 0; i < SPAWN_SLOTS.length; i++) {
      if (!this.occupiedSlots.has(i)) {
        this.occupiedSlots.add(i);
        return i;
      }
    }
    return -1;
  }

  /**
   * Creates the simulation. Async because the compat Rapier build must load
   * its WASM before the world can be constructed.
   */
  public static async create(): Promise<AuthoritativeMovement> {
    const physics = await ServerPhysicsWorld.create();
    return new AuthoritativeMovement(physics);
  }

  /**
   * Registers a player's simulation. The physics body is placed at the
   * deterministically-allocated spawn slot (the lowest free slot; the shared
   * baseline spawn once the defined slots are all taken). Runtime input state
   * is initialised alongside.
   *
   * Idempotent: an existing runtime is left untouched (no new slot is
   * allocated, so a double-join cannot double-book a slot).
   */
  public createPlayer(playerId: string): void {
    if (this.runtimes.has(playerId)) {
      return;
    }
    const slot = this.allocateSlot();
    const spawn = slot >= 0 ? SPAWN_SLOTS[slot] : SPAWN_SLOTS[0];
    this.physics.createPlayer(playerId, spawn);
    this.runtimes.set(playerId, {
      lastReceivedSequence: -1,
      slot,
      pending: [],
      consumed: null,
      held: { moveX: 0, moveZ: 0, yaw: 0, pitch: 0 },
      verticalVelocity: 0,
      lastGrounded: true,
      acknowledgedSequence: -1,
      jumpController: new JumpController(JUMP_INPUT_TIMING),
    });
  }

  /**
   * Removes a player's simulation (physics body + runtime input state).
   * Idempotent.
   */
  public removePlayer(playerId: string): void {
    const runtime = this.runtimes.get(playerId);
    if (!runtime) {
      return;
    }
    if (runtime.slot >= 0) {
      this.occupiedSlots.delete(runtime.slot);
    }
    this.physics.disposePlayer(playerId);
    this.runtimes.delete(playerId);
  }

  /**
   * True if a player's simulation exists.
   */
  public hasPlayer(playerId: string): boolean {
    return this.runtimes.has(playerId);
  }

  /**
   * Enqueues one received input frame for a player.
   *
   *  - unknown player → `rejected-unknown-player`;
   *  - malformed sequence → `rejected-malformed` and the frame is not stored;
   *  - `sequence <= lastReceivedSequence` → `rejected-sequence` (duplicate or
   *    stale / non-monotonic received sequence);
   *  - otherwise the frame is enqueued and its sequence becomes the new
   *    `lastReceivedSequence`.
   *
   * Enqueuing does NOT acknowledge the frame; acknowledgement happens only
   * once {@link runTick} has actually simulated it.
   */
  public enqueueFrame(playerId: string, frame: PlayerInputFrame): EnqueueResult {
    const runtime = this.runtimes.get(playerId);
    if (!runtime) {
      return "rejected-unknown-player";
    }

    // Sequence is a non-negative safe integer (protocol validator guarantees
    // finite number). Reject anything that is not a usable non-negative
    // integer before trusting it.
    if (!Number.isSafeInteger(frame.sequence) || frame.sequence < 0) {
      return "rejected-malformed";
    }

    if (frame.sequence <= runtime.lastReceivedSequence) {
      return "rejected-sequence";
    }

    runtime.lastReceivedSequence = frame.sequence;
    runtime.pending.push(frame);
    return "accepted";
  }

  /**
   * Runs one authoritative tick:
   *   1. consume AT MOST ONE queued frame per player (updating held axes /
   *      yaw / pitch and remembering the jump edge);
   *   2. run `subSteps` physics substeps at `subDt` — for each substep, apply
   *      EVERY player's desired character-controller movement, then advance
   *      the Rapier world exactly once;
   *   3. publish each player's ack to the sequence of the frame it processed.
   *
   * If a player has no queued frame this tick, the held movement/yaw persist
   * and the jump edge is `false` (movement continues, no new jump).
   */
  public runTick(input: TickInput): void {
    const ids = [...this.runtimes.keys()];

    // 1) Consume at most one frame per player.
    for (const id of ids) {
      const runtime = this.runtimes.get(id)!;
      const frame = runtime.pending.shift();
      if (frame) {
        runtime.held.moveX = frame.moveX;
        runtime.held.moveZ = frame.moveZ;
        runtime.held.yaw = frame.lookYaw;
        runtime.held.pitch = frame.lookPitch;
        runtime.consumed = frame;
      } else {
        // No new frame this tick: continue held input; jump edge is false.
        runtime.consumed = null;
      }
    }

    // 2) Substeps: per substep, move every player then step the world once.
    for (let i = 0; i < input.subSteps; i++) {
      for (const id of ids) {
        this.advancePlayerSubstep(id, i === 0, input.subDt);
      }
      this.physics.step();
    }

    // 3) Publish acknowledgement for the frame actually processed.
    for (const id of ids) {
      const runtime = this.runtimes.get(id)!;
      if (runtime.consumed) {
        runtime.acknowledgedSequence = runtime.consumed.sequence;
      }
    }
  }

  /**
   * Advances one player by a single physics substep, resolving the desired
   * translation through that player's character controller (no world step —
   * the caller steps the world once per substep after all players).
   *
   * @param firstSubstep when true (the first substep of the tick) the
   *   consumed frame's `jump` edge is forwarded to the jump controller; on
   *   later substeps the jump press is always false (task §6).
   */
  private advancePlayerSubstep(
    playerId: string,
    firstSubstep: boolean,
    subDt: number,
  ): void {
    const runtime = this.runtimes.get(playerId)!;

    // Jump edge: forwarded exactly once, on the first substep.
    const jumpPressed = firstSubstep ? (runtime.consumed?.jump ?? false) : false;
    const jumpRequested = runtime.jumpController.step(
      subDt,
      runtime.lastGrounded,
      jumpPressed,
    );

    // Horizontal: camera-relative desired world displacement, using the
    // shared movement math + main's corrected strafe convention.
    const world = movementInputToWorld(
      { x: runtime.held.moveX, z: runtime.held.moveZ },
      runtime.held.yaw,
    );
    const inputLength = Math.hypot(world.x, world.z);
    const normalization = inputLength > 1 ? 1 / inputLength : 1;
    const distance = PLAYER_MOVEMENT.moveSpeed * subDt;
    const dx = world.x * normalization * distance;
    const dz = world.z * normalization * distance;

    // Vertical: integrate gravity; launch at jump speed when requested.
    const nextVelocity = stepVerticalMovement(
      runtime.verticalVelocity,
      jumpRequested,
      runtime.lastGrounded,
      subDt,
      PLAYER_PHYSICS,
    );
    const dy = nextVelocity * subDt;
    runtime.verticalVelocity = nextVelocity;

    // Physics: resolve the desired translation against the arena; the server
    // position comes ONLY from the resulting Rapier body.
    const grounded = this.physics.movePlayer(playerId, { x: dx, y: dy, z: dz });
    runtime.lastGrounded = grounded;
  }

  /**
   * The authoritative state to publish for a player (position from the Rapier
   * body, yaw from the held look-yaw, the landed/grounded flag, and the
   * processed-sequence ack).
   */
  public getPublishable(playerId: string): AuthoritativePlayerState | null {
    const runtime = this.runtimes.get(playerId);
    if (!runtime) {
      return null;
    }
    return {
      position: this.physics.getPosition(playerId),
      yaw: runtime.held.yaw,
      landed: runtime.lastGrounded,
      acknowledgedSequence: runtime.acknowledgedSequence,
    };
  }

  /**
   * Disposes the underlying physics world and clears all runtimes. Idempotent.
   */
  public dispose(): void {
    this.physics.dispose();
    this.runtimes.clear();
    this.occupiedSlots.clear();
  }
}
