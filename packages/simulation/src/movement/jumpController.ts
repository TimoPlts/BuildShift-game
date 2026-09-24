import type { JumpControllerConfig } from "./types.js";

/**
 * Pure jump-input timing state machine.
 *
 * This owns the *decision* of whether a jump launches on a given fixed step,
 * applying two small, deterministic responsiveness aids:
 *
 * - **Jump buffer:** a jump press is remembered for `jumpBufferTime` so a press
 *   that lands a fraction of a step before the character becomes grounded still
 *   triggers a jump on the following grounded step. This is what makes "tap
 *   jump just before the ground" feel responsive.
 *
 * - **Coyote time:** leaving the ground (e.g. walking off a ledge) still allows
 *   a jump for `coyoteTime` seconds, so a jump pressed just after losing ground
 *   is not rejected.
 *
 * A jump launches when a buffered press is still valid **and** the character is
 * jump-eligible (currently grounded, or still inside the coyote window).
 *
 * The controller is advanced **only by fixed simulation steps**, so its timing
 * is deterministic and independent of the render frame rate. It holds no
 * browser or physics types — only numbers and the lagged `grounded` flag the
 * physics layer reports — so it is safe to reuse for the authoritative server
 * step (see docs/TECHNICAL_ARCHITECTURE.md §7.4 / §18).
 */
export class JumpController {
  /** Remaining time (s) that the most recent press is kept in the buffer. */
  private jumpBufferRemaining = 0;
  /** Remaining time (s) that the coyote window is active. */
  private coyoteRemaining = 0;

  constructor(private readonly config: Readonly<JumpControllerConfig>) {}

  /**
   * Clears all buffered jump/coyote state. Called when input is cleared (the
   * character can no longer receive gameplay input), so a stale buffered press
   * can never fire after the pointer is released, the window blurs, or the tab
   * hides.
   */
  public reset(): void {
    this.jumpBufferRemaining = 0;
    this.coyoteRemaining = 0;
  }

  /**
   * Advances one fixed step and returns whether a jump should launch *this* step.
   *
   * @param deltaSeconds the fixed step duration (seconds).
   * @param grounded the character's grounded state available before this step's
   *   vertical integration — the physics layer's previous-step grounded flag.
   * @param jumpPressed whether a jump key-down edge arrived for this step.
   */
  public step(
    deltaSeconds: number,
    grounded: boolean,
    jumpPressed: boolean,
  ): boolean {
    // Record a fresh press into the buffer; otherwise decay the existing buffer.
    this.jumpBufferRemaining = jumpPressed
      ? this.config.jumpBufferTime
      : Math.max(0, this.jumpBufferRemaining - deltaSeconds);

    // Coyote window: refreshed while grounded, otherwise decays to zero.
    this.coyoteRemaining = grounded
      ? this.config.coyoteTime
      : Math.max(0, this.coyoteRemaining - deltaSeconds);

    const jumpEligible = grounded || this.coyoteRemaining > 0;
    const pressValid = this.jumpBufferRemaining > 0;

    if (jumpEligible && pressValid) {
      // Consume the buffer so the same press can only ever launch once, and
      // invalidate the coyote window so a fresh press while airborne (still
      // inside the coyote time that was granted while grounded) cannot launch
      // a second jump. Coyote is only meant to cover *walking/falling off a
      // ledge*, not to enable an extra jump right after a normal grounded jump.
      this.jumpBufferRemaining = 0;
      this.coyoteRemaining = 0;
      return true;
    }

    return false;
  }
}
