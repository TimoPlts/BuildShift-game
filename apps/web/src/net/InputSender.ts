/**
 * InputSender — reads from the existing input system and sends `MovementInput`
 * messages to the server each simulation frame.
 *
 * Responsibilities:
 *  - Assign a monotonically increasing `sequence` to each sent input.
 *  - Send the input via `room.send("movement-input", input)`.
 *  - Maintain a fixed-size ring buffer (N=10) of the most recently sent
 *    inputs, used by the {@link LocalPlayerPredictor} for reconciliation
 *    (re-applying unacknowledged inputs).
 *
 * The InputSender is a pure networking concern: it reads a plain input
 * sample (movement axes, yaw, pitch, jump, crouch) handed to it by the
 * caller and converts it into a protocol {@link MovementInput}. It does NOT
 * read the browser keyboard or mouse directly — the `GameRuntime` (or a
 * similar orchestrator) feeds it the captured sample each tick.
 */
import type { MovementInput } from "@buildshift/protocol";
import type { RoomLike } from "./ConnectionManager";

/**
 * The message type string sent to the server. The server's room routes
 * on this string to dispatch the input to the authoritative simulation.
 */
export const MOVEMENT_INPUT_TYPE = "movement-input";

/** Ring buffer capacity: number of recent inputs retained for reconciliation. */
export const RING_BUFFER_SIZE = 10;

/**
 * A plain input sample — the fields the caller captures from the input
 * system and hands to the sender each tick. The sender adds the `sequence`
 * to produce the full {@link MovementInput}.
 */
export interface InputSample {
  /** Local movement X, normalised to [-1, 1]. */
  moveX: number;
  /** Local movement Z, normalised to [-1, 1]. */
  moveZ: number;
  /** Camera yaw in radians (0 faces -Z, positive → +X). */
  yaw: number;
  /** Camera pitch in radians (0 = horizontal, positive = looking up). */
  pitch: number;
  /** Jump intent edge (true on the tick the player pressed jump). */
  jump: boolean;
  /** Crouch intent (true while holding crouch). */
  crouch: boolean;
}

/**
 * Sends sequenced {@link MovementInput} messages to the server and maintains
 * a ring buffer of the last N sent inputs for reconciliation.
 */
export class InputSender {
  private room: RoomLike | null = null;
  private sequence = 0;
  /**
   * Ring buffer of the most recently sent inputs (newest last).
   * Entries are removed once they exceed `RING_BUFFER_SIZE`.
   */
  private ringBuffer: MovementInput[] = [];

  /**
   * Attach the room to send inputs to. Called by the ConnectionManager
   * (or orchestrator) when the room is joined.
   */
  public attachRoom(room: RoomLike): void {
    this.room = room;
  }

  /**
   * Detach from the room (on disconnect). No further sends will occur.
   */
  public detachRoom(): void {
    this.room = null;
  }

  /**
   * Reset the sequence counter and ring buffer. Called on (re)connect so
   * sequences restart from 0 for the new session.
   */
  public reset(): void {
    this.sequence = 0;
    this.ringBuffer = [];
  }

  /**
   * Capture an input sample, assign the next sequence, send it to the
   * server, and store it in the ring buffer.
   *
   * @param sample the captured input (without sequence).
   * @returns the full {@link MovementInput} that was sent (with sequence).
   */
  public send(sample: InputSample): MovementInput {
    const input: MovementInput = {
      sequence: this.sequence,
      moveX: sample.moveX,
      moveZ: sample.moveZ,
      yaw: sample.yaw,
      pitch: sample.pitch,
      jump: sample.jump,
      crouch: sample.crouch,
    };
    this.sequence += 1;

    // Store in ring buffer, evicting the oldest when full.
    this.ringBuffer.push(input);
    if (this.ringBuffer.length > RING_BUFFER_SIZE) {
      this.ringBuffer.shift();
    }

    // Send to the server (no-op when disconnected).
    if (this.room) {
      this.room.send(MOVEMENT_INPUT_TYPE, input);
    }

    return input;
  }

  /**
   * Return all inputs in the ring buffer with `sequence > afterSequence`.
   * Used by the {@link LocalPlayerPredictor} to replay unacknowledged inputs.
   *
   * @param afterSequence the last server-acknowledged sequence.
   * @returns inputs in ascending sequence order (already in order in the buffer).
   */
  public getInputsAfter(afterSequence: number): MovementInput[] {
    return this.ringBuffer.filter((entry) => entry.sequence > afterSequence);
  }

  /**
   * The sequence number that will be assigned to the NEXT input.
   */
  public getNextSequence(): number {
    return this.sequence;
  }

  /**
   * The most recently sent input, or `null` if none has been sent yet.
   */
  public getLastInput(): MovementInput | null {
    return this.ringBuffer.length > 0
      ? this.ringBuffer[this.ringBuffer.length - 1]
      : null;
  }
}
