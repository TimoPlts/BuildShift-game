/**
 * Resolves ownership of the shared left mouse button.
 *
 * The primary button's browser state is owned by the centralized
 * {@link InputManager}; this policy is the one runtime decision that decides
 * what the press/hold means. Exactly one side ever receives a given press or
 * hold, with a strict priority so the two always-on interaction layers never
 * fight for the button:
 *
 *  1. **edit mode** (most specific) — tile selection on the aimed piece,
 *  2. **build mode** — placement (press edge + held rapid placement),
 *  3. **weapon** (default) — fire.
 *
 * A mode is only ever "owned" by one system at a time in practice (the input
 * controllers make build/edit toggles mutually exclusive), but the policy is
 * written defensively so overlapping flags can never route a press to two
 * owners.
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
  /**
   * Whether the press edge belongs to the build-edit system (the tile
   * selection click on the aimed, owned piece).
   */
  readonly editSelectPressed: boolean;
  /**
   * Whether the held primary belongs to the build-edit system (the
   * hold-drag tile painting on the aimed piece).
   */
  readonly editSelectHeld: boolean;
}

export function routePrimaryAction(
  buildModeActive: boolean,
  editModeActive: boolean,
  firePressed: boolean,
  fireHeld: boolean,
): PrimaryActionRoute {
  const editOwnsPrimaryAction = editModeActive;
  const buildOwnsPrimaryAction = !editModeActive && buildModeActive;
  const weaponOwnsPrimaryAction = !editModeActive && !buildModeActive;
  return {
    weaponFirePressed: weaponOwnsPrimaryAction && firePressed,
    weaponFireHeld: weaponOwnsPrimaryAction && fireHeld,
    buildPlacePressed: buildOwnsPrimaryAction && firePressed,
    buildPlaceHeld: buildOwnsPrimaryAction && fireHeld,
    editSelectPressed: editOwnsPrimaryAction && firePressed,
    editSelectHeld: editOwnsPrimaryAction && fireHeld,
  };
}
