import type {
  HorizontalMovementConfig,
  MovementInput,
  Position2D,
} from "./types.js";

/**
 * Advances a world-space X/Z position from explicit inputs only.
 * Inputs longer than one unit are normalized so diagonals keep the same speed.
 */
export function stepHorizontalMovement(
  position: Readonly<Position2D>,
  input: Readonly<MovementInput>,
  deltaSeconds: number,
  config: Readonly<HorizontalMovementConfig>,
): Position2D {
  const inputLength = Math.hypot(input.x, input.z);
  const normalization = inputLength > 1 ? 1 / inputLength : 1;
  const distance = config.moveSpeed * deltaSeconds;

  return {
    x: position.x + input.x * normalization * distance,
    z: position.z + input.z * normalization * distance,
  };
}
