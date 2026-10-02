/**
 * InputBatcher — manages the local input sequence and sends PlayerNetworkInput
 * frames to the server each simulation tick.
 *
 * Responsibilities:
 *  - Maintains a monotonically increasing sequence counter starting at 0.
 *  - Each simulation tick, constructs a PlayerNetworkInput from the captured
 *    input sample and sends it via the NetworkClient.
 *  - Stores the sent input in a local ring buffer for reconciliation
 *    (re-applying unacknowledged inputs after a server correction).
 *
 * The InputBatcher is a pure networking concern: it reads a plain input
 * sample handed to it by the caller and converts it into a protocol
 * PlayerNetworkInput. It does NOT read the browser keyboard or mouse directly.
 */
import type { PlayerNetworkInput } from "@buildshift/protocol";
import type { NetworkClient } from "./NetworkClient";

/**
 * Ring buffer capacity: number of recent inputs retained for reconciliation.
 * At 30 Hz, 30 entries ≈ 1 second of inputs — more than enough for any
 * reasonable RTT.
 */
export const INPUT_BUFFER_SIZE = 30;

/**
 * A plain input sample — the fields the caller captures from the input
 * system and hands to the batcher each tick. The batcher adds the sequence
 * to produce the full PlayerNetworkInput.
 */
export interface InputSample {
  /** Local movement X, normalised to [-1, 1] (+X is right). */
  moveX: number;
  /** Local movement Z, normalised to [-1, 1] (-Z is forward). */
  moveZ: number;
  /** Camera yaw in radians (0 faces -Z, positive → +X). */
  yaw: number;
  /** Camera pitch in radians (0 = horizontal, positive = looking up). */
  pitch: number;
  /** Jump intent edge (true on the tick the player pressed jump). */
  jump: boolean;
  /** Crouch intent (true while holding crouch). */
  crouch: boolean;
  /**
   * Primary fire intent (true while the player is holding the fire button).
   * The batcher treats a missing value as `false` (no fire intent this tick).
   */
  primaryFire?: boolean;
}

/**
 * A buffered entry: the full PlayerNetworkInput that was sent, plus the
 * predicted state after applying it (for reconciliation comparison).
 */
export interface BufferedInput {
  /** The full PlayerNetworkInput that was sent to the server. */
  input: PlayerNetworkInput;
  /** Predicted position after this input was applied (x, y, z). */
  predictedX: number;
  /** Predicted Y after this input was applied. */
  predictedY: number;
  /** Predicted Z after this input was applied. */
  predictedZ: number;
  /** Predicted vertical velocity after this input. */
  predictedVelocityY: number;
  /** Predicted grounded state after this input was applied. */
  predictedGrounded: boolean;
}

/**
 * Sends sequenced PlayerNetworkInput messages to the server and maintains a
 * buffer of the last N sent inputs for reconciliation.
 */
export class InputBatcher {
  private sequence = 0;
  /**
   * Ring buffer of the most recently sent inputs (newest last).
   * Entries are removed once they exceed INPUT_BUFFER_SIZE.
   */
  private buffer: BufferedInput[] = [];

  /**
   * Reset the sequence counter and input buffer. Called on (re)connect so
   * sequences restart from 0 for the new session.
   */
  public reset(): void {
    this.sequence = 0;
    this.buffer = [];
  }

  /**
   * The sequence number that will be assigned to the NEXT input.
   */
  public get nextSequence(): number {
    return this.sequence;
  }

  /**
   * The most recently sent input's sequence, or -1 if none has been sent.
   */
  public get lastSentSequence(): number {
    return this.buffer.length > 0
      ? this.buffer[this.buffer.length - 1].input.sequence
      : -1;
  }

  /**
   * Capture an input sample, assign the next sequence, build the
   * PlayerNetworkInput, send it to the server, and store it in the buffer.
   *
   * @param sample the captured input (without sequence).
   * @param client the NetworkClient to send through.
   * @param predictedState the predicted state after applying this input
   *        (captured by the caller right after prediction).
   * @returns the full PlayerNetworkInput that was sent (with sequence).
   */
  public send(
    sample: InputSample,
    client: NetworkClient,
    predictedState: {
      x: number;
      y: number;
      z: number;
      velocityY: number;
      grounded: boolean;
    },
  ): PlayerNetworkInput {
    const input: PlayerNetworkInput = {
      sequence: this.sequence,
      moveX: sample.moveX,
      moveZ: sample.moveZ,
      lookYaw: sample.yaw,
      lookPitch: sample.pitch,
      jump: sample.jump,
      sprint: false,
      crouch: sample.crouch,
      primaryFire: sample.primaryFire === true,
      secondaryFire: false,
    };
    this.sequence += 1;

    // Store in buffer, evicting the oldest when full.
    this.buffer.push({
      input,
      predictedX: predictedState.x,
      predictedY: predictedState.y,
      predictedZ: predictedState.z,
      predictedVelocityY: predictedState.velocityY,
      predictedGrounded: predictedState.grounded,
    });
    if (this.buffer.length > INPUT_BUFFER_SIZE) {
      this.buffer.shift();
    }

    // Send to the server (no-op when disconnected).
    client.sendInput(input);

    return input;
  }

  /**
   * Return all buffered inputs with sequence > afterSequence, in ascending
   * order. Used by the PredictionOrchestrator for reconciliation (re-applying
   * unacknowledged inputs).
   */
  public getInputsAfter(afterSequence: number): BufferedInput[] {
    return this.buffer.filter((entry) => entry.input.sequence > afterSequence);
  }

  /**
   * Discard all buffered entries with sequence <= acknowledgedSequence.
   * Returns the number of entries removed.
   */
  public pruneUpTo(acknowledgedSequence: number): number {
    const first = this.buffer.findIndex(
      (entry) => entry.input.sequence > acknowledgedSequence,
    );
    if (first === 0) {
      return 0;
    }
    const kept = first === -1 ? [] : this.buffer.slice(first);
    const removed = this.buffer.length - kept.length;
    this.buffer.length = 0;
    for (const entry of kept) {
      this.buffer.push(entry);
    }
    return removed;
  }

  /** The number of buffered inputs currently retained. */
  public get bufferLength(): number {
    return this.buffer.length;
  }
}
