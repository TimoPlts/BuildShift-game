/**
 * Resolves ownership of the shared left mouse button.
 *
 * Building retains its existing placement-input listener. This policy is the
 * one runtime decision that prevents the weapon path from also consuming the
 * same press or hold while build mode is active.
 */
export interface PrimaryActionRoute {
  /** Whether the press edge belongs to the weapon controller. */
  readonly weaponFirePressed: boolean;
  /** Whether held primary fire belongs in the authoritative movement input. */
  readonly weaponFireHeld: boolean;
}

export function routePrimaryAction(
  buildModeActive: boolean,
  firePressed: boolean,
  fireHeld: boolean,
): PrimaryActionRoute {
  const weaponOwnsPrimaryAction = !buildModeActive;
  return {
    weaponFirePressed: weaponOwnsPrimaryAction && firePressed,
    weaponFireHeld: weaponOwnsPrimaryAction && fireHeld,
  };
}
