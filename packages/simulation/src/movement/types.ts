/** World-space movement intent. +X is right and -Z is forward. */
export interface MovementInput {
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
