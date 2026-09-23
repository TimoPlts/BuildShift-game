/** Player-local input: +X is right and -Z is forward. */
export interface LocalMovementInput {
  x: number;
  z: number;
}

/** World-space movement intent: +X is right and -Z is forward at yaw zero. */
export interface WorldMovementInput {
  x: number;
  z: number;
}

export interface Position2D {
  x: number;
  z: number;
}

export interface HorizontalMovementConfig {
  moveSpeed: number;
}
