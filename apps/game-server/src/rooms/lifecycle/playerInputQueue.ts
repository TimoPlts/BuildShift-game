/**
 * Per-player authoritative input queue for the canonical room.
 *
 * The client runs a fixed 30 Hz simulation and sends one sequenced input per
 * simulation step. A slow frame (or network batching) delivers several of
 * those inputs before the next server tick. They are queued here, in sequence
 * order, instead of overwriting each other — a one-shot edge such as a jump
 * must never disappear because a newer packet arrived first.
 *
 * Movement-time budget: `credit` counts elapsed authoritative ticks that have
 * not been simulated yet for this player. Each tick adds one; each simulated
 * input spends one. When the queue is empty the tick is NOT simulated as an
 * idle step straight away — the client's input for it is usually just late
 * (a slow frame delivers several inputs at once). Only once more than
 * {@link INPUT_CATCHUP_CREDIT} ticks are unsimulated does the room simulate
 * the oldest one as an idle (no-input) step ({@link settleIdle}). Invariant:
 *
 *   simulated steps (input + idle) = elapsed ticks − credit,
 *   0 <= credit <= INPUT_CATCHUP_CREDIT
 *
 * so a player is never simulated faster than real time, however many inputs
 * are sent, and a late input is simulated in its own step rather than after
 * an idle step already consumed that time (no doubled gravity mid-jump).
 *
 * Rejection rules (explicit, at enqueue time):
 *  - `stale`: sequence <= the player's lastProcessedSequence.
 *  - `out_of_order`: sequence <= the newest queued sequence (duplicate or
 *    replay; WebSocket delivery is ordered, so this is never legitimate).
 *  - `overflow`: the queue already holds {@link INPUT_QUEUE_LIMIT} inputs. The
 *    NEW arrival is rejected (tail drop); queued inputs are never removed
 *    from the middle, so already-accepted edges stay in order.
 *
 * Acknowledgement is unchanged: the room only advances lastProcessedSequence
 * when it actually simulates an input, never on enqueue.
 */

/**
 * Maximum queued inputs per player (~0.67 s of client simulation at 30 Hz).
 * Kept below the client's reconciliation buffer (INPUT_BUFFER_SIZE = 30 in
 * apps/web inputBatcher) so every input still queued here is also still
 * replayable by the client, with headroom for inputs in flight.
 */
export const INPUT_QUEUE_LIMIT = 20;

/**
 * Maximum unsimulated elapsed ticks per player (~333 ms at 30 Hz): how late a
 * client's inputs may arrive and still be simulated in their own time step,
 * and the most inputs one tick can catch up.
 */
export const INPUT_CATCHUP_CREDIT = 10;

export type EnqueueResult = "queued" | "stale" | "out_of_order" | "overflow";

export class PlayerInputQueue<T extends { sequence: number }> {
  private readonly items: T[] = [];
  private credit = 0;

  /** Validate and append one parsed input. */
  enqueue(input: T, lastProcessedSequence: number): EnqueueResult {
    if (input.sequence <= lastProcessedSequence) return "stale";
    const newest = this.items[this.items.length - 1];
    if (newest !== undefined && input.sequence <= newest.sequence) return "out_of_order";
    if (this.items.length >= INPUT_QUEUE_LIMIT) return "overflow";
    this.items.push(input);
    return "queued";
  }

  /** One authoritative tick elapsed (call once per tick, before take()). */
  beginTick(): void {
    this.credit += 1;
  }

  /** The oldest queued input if this tick's budget allows another step. */
  take(): T | undefined {
    if (this.credit < 1 || this.items.length === 0) return undefined;
    this.credit -= 1;
    return this.items.shift();
  }

  /**
   * After this tick's inputs: true when the unsimulated backlog exceeds the
   * catch-up window, i.e. the room must simulate one idle (no-input) step
   * now. Spends that tick's credit.
   */
  settleIdle(): boolean {
    if (this.credit <= INPUT_CATCHUP_CREDIT) return false;
    this.credit -= 1;
    return true;
  }

  /** Drop queued inputs and banked credit (authoritative boundary/leave). */
  clear(): void {
    this.items.length = 0;
    this.credit = 0;
  }

  get size(): number {
    return this.items.length;
  }
}
