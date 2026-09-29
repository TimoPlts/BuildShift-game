import type { LocalMovementInput } from "@buildshift/simulation";

export interface LiveInputSample {
  moveX: number;
  moveZ: number;
  lookYaw: number;
  lookPitch: number;
  jump: boolean;
}

/** Samples local intent once for every two 60 Hz fixed-step updates. */
export class LiveInputSampler {
  private fixedStepsSinceSend = 0;
  private jumpLatched = false;

  public constructor(private readonly substepsPerSample = 2) {
    if (!Number.isInteger(substepsPerSample) || substepsPerSample < 1) {
      throw new Error("substepsPerSample must be a positive integer");
    }
  }

  public observeFixedStep(
    jumpPressed: boolean,
    movement: Readonly<LocalMovementInput>,
    lookYaw: number,
    lookPitch: number,
  ): LiveInputSample | null {
    this.fixedStepsSinceSend += 1;
    this.jumpLatched ||= jumpPressed;

    if (this.fixedStepsSinceSend < this.substepsPerSample) {
      return null;
    }

    const sample: LiveInputSample = {
      moveX: movement.x,
      moveZ: movement.z,
      lookYaw,
      lookPitch,
      jump: this.jumpLatched,
    };
    this.reset();
    return sample;
  }

  /** Clears cadence and jump state after raw input is cleared. */
  public reset(): void {
    this.fixedStepsSinceSend = 0;
    this.jumpLatched = false;
  }
}