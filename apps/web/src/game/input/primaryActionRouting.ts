/**
 * Resolves ownership of the shared left mouse button.
 *
 * The primary button's browser state is owned by the centralized
 * {@link InputManager}; this policy is the one runtime decision that decides
 * what the press/hold means: weapon fire when build mode is off, placement
 * (press edge + held rapid placement) when build mode is active. Exactly one
 * side ever receives a given press or hold.
 */
export interface PrimaryActionRoute {
  /** Whether the press edge belongs to the weapon controller. */
  readonly weaponFirePressed: boolean;
  /** Whether held primary fire belongs in the authoritative movement input. */
  readonly weaponFireHeld: boolean;
  /** Whether the placement press edge belongs to the building system. */
  readonly buildPlacePressed: boolean;
  /**
   * Whether held primary placement belongs to the building system (the
   * held-primary "turbo building" rapid-placement loop).
   */
  readonly buildPlaceHeld: boolean;
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
    buildPlacePressed: buildModeActive && firePressed,
    buildPlaceHeld: buildModeActive && fireHeld,
  };
}
