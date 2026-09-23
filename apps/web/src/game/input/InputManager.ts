import type { MovementInput } from "@buildshift/simulation";

const MOVEMENT_CODES = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);

/** Tracks browser input state without involving React's render cycle. */
export class InputManager {
  private readonly heldCodes = new Set<string>();
  private disposed = false;

  public constructor() {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.clearInput);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  /** World-relative convention: +X is right and -Z is forward. */
  public getMovementInput(): MovementInput {
    return {
      x: Number(this.heldCodes.has("KeyD")) - Number(this.heldCodes.has("KeyA")),
      z: Number(this.heldCodes.has("KeyS")) - Number(this.heldCodes.has("KeyW")),
    };
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.clearInput);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.clearInput();
    this.disposed = true;
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (MOVEMENT_CODES.has(event.code)) {
      this.heldCodes.add(event.code);
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.heldCodes.delete(event.code);
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.clearInput();
    }
  };

  private readonly clearInput = (): void => {
    this.heldCodes.clear();
  };
}
