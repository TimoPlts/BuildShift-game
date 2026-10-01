/**
 * A locally-captured, not-yet-acknowledged input, tagged with the monotonic
 * network sequence assigned when it was sent.
 *
 * `moveX` / `moveZ` are the normalised LOCAL (camera-relative) movement axes
 * (exactly what `InputManager.getMovementInput` produces); `lookYaw` is the
 * camera yaw (radians) captured for this tick. Reconciliation rotates the local
 * axes into world space (via `movementInputToWorld`) and then advances the
 * predicted position with `stepHorizontalMovement` — the identical path the
 * authoritative server takes.
 */
export interface BufferedLocalInput {
  /** Monotonic network input sequence (non-negative safe integer). */
  sequence: number;
  /** Normalised local movement, X axis (camera-right). */
  moveX: number;
  /** Normalised local movement, Z axis (camera-forward is -Z). */
  moveZ: number;
  /** Camera yaw in radians (0 faces -Z, positive rotates toward +X). */
  lookYaw: number;
}

/**
 * A bounded FIFO ring buffer of buffered local inputs.
 *
 * Entries are always stored oldest→newest in ascending sequence order (the
 * runtime appends in order). When the buffer is full the OLDEST entry is dropped
 * on insert (bounded memory under a stalled server). Reconciliation prunes
 * acknowledged entries (sequence <= ack) from the front.
 *
 * Implemented as a fixed-capacity ring so both insert-on-overflow and
 * prune-from-front are O(1). Pure (no browser / physics / network), so it is
 * fully unit-testable in node.
 */
export class InputRingBuffer {
  private readonly slots: (BufferedLocalInput | null)[];
  private readonly capacity: number;
  private head = 0; // index of the oldest entry
  private tail = 0; // index to write next
  private count = 0;

  constructor(capacity: number) {
    if (capacity < 1) {
      throw new Error("InputRingBuffer capacity must be >= 1.");
    }
    this.capacity = capacity;
    this.slots = new Array<BufferedLocalInput | null>(capacity).fill(null);
  }

  /** Number of buffered (unacknowledged) inputs currently held. */
  public get size(): number {
    return this.count;
  }

  /** True when the buffer is holding its maximum number of entries. */
  public get isFull(): boolean {
    return this.count === this.capacity;
  }

  /**
   * Appends an input. If the buffer is full, the oldest entry is dropped first
   * (bounded memory under a stalled server).
   */
  public push(input: BufferedLocalInput): void {
    if (this.count === this.capacity) {
      this.slots[this.head] = null;
      this.head = (this.head + 1) % this.capacity;
      this.count -= 1;
    }
    this.slots[this.tail] = input;
    this.tail = (this.tail + 1) % this.capacity;
    this.count += 1;
  }

  /** Yields every buffered input in oldest→newest (ascending sequence) order. */
  public *entries(): Generator<BufferedLocalInput> {
    let index = this.head;
    for (let n = 0; n < this.count; n += 1) {
      yield this.slots[index]!;
      index = (index + 1) % this.capacity;
    }
  }

  /**
   * Removes (from the front) every entry with sequence <= `acknowledgedSequence`,
   * returning the number removed. These are the confirmed inputs reconciliation
   * must never replay again.
   */
  public pruneUpTo(acknowledgedSequence: number): number {
    let removed = 0;
    while (this.count > 0) {
      const front = this.slots[this.head]!;
      if (front.sequence <= acknowledgedSequence) {
        this.slots[this.head] = null;
        this.head = (this.head + 1) % this.capacity;
        this.count -= 1;
        removed += 1;
      } else {
        break;
      }
    }
    return removed;
  }

  /** Drops all entries. */
  public clear(): void {
    for (let i = 0; i < this.slots.length; i += 1) {
      this.slots[i] = null;
    }
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }
}
