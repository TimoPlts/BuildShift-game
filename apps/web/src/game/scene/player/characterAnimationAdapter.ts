/**
 * characterAnimationAdapter — live wiring (Batch 2B, Task B) between the
 * existing {@link CharacterAnimationController} (Batch 2A) and the visual
 * live-player state: idle / run / jump / fall / crouch, for BOTH the local
 * and remote players.
 *
 * Two pieces:
 *
 *  1. {@link mapCharacterClips} — pure, deterministic clip-name → slot
 *     mapping for the AnimationGroups produced by the character loader.
 *     Names are normalised (lowercase, non-alphanumerics dropped) and matched
 *     against the per-slot keyword table below, so "Idle", "Running",
 *     "Jump_Start", and "fire_01" all land on the right slot. Unknown names
 *     are reported as `unmappedNames`; persistent states without a clip are
 *     reported as `missingStates` — nothing ever throws. Explicit
 *     `nameOverrides` let a loader pin exact names per slot.
 *
 *  2. {@link CharacterAnimationDriver} — one per rendered player:
 *      - `attachClips(groups)` — maps the loader's groups and hands them to
 *        the controller. Idempotent: re-calling with the same groups never
 *        re-attaches and never adds duplicate AnimationGroup observers.
 *      - `sync(input)` — once per render frame. Feeds the SAME canonical
 *        position stream the presentation mirrors (`setTransform` values:
 *        predicted for the local player, interpolated for remote players)
 *        into the existing {@link PlayerPoseModel} kinematics and pushes the
 *        derived locomotion state (idle / run / jump / fall, plus the
 *        already-smoothed crouch presentation blend) into the controller.
 *        A derived state with no attached clip falls back to `idle` when an
 *        idle clip exists, so missing clips never freeze the body.
 *      - `triggerFire()` / `reset()` / `dispose()` — lifecycle.
 *
 * Presentation-only guarantees (same boundary as the controller):
 *  - Reads ONLY the position values the presentation already receives and
 *    the crouch presentation blend. Never writes positions, velocities,
 *    colliders, input, prediction/reconciliation, networking, or authority.
 *  - Zero root motion: the controller strips root position animations at
 *    attach; the driver passes the gameplay-mirror root as the strip target.
 *
 * Runtime seam (isolated, for future integration): the caller (the game
 * runtime's render frame, or the CharacterModel consumer) owns the driver,
 * constructs it with the character's gameplay-mirror `root`, and calls
 * `sync` with the same stream it feeds `setTransform`. Nothing in this
 * module is coupled to `GameRuntime`, networking, or the loader beyond the
 * public Babylon `AnimationGroup` / `Node` interfaces.
 */
import type { AnimationGroup, Node } from "@babylonjs/core";
import {
  CHARACTER_ANIM_STATES,
  CharacterAnimationController,
  type CharacterAnimClip,
  type CharacterAnimState,
} from "./characterAnimationController";
import {
  DEFAULT_PLAYER_POSE_CONFIG,
  PlayerPoseModel,
  type PlayerPoseConfig,
} from "./playerPoseModel";

/** The outcome of mapping a set of loaded clips onto the controller slots. */
export interface CharacterClipMapping {
  /** Clips attached to a slot (any subset; only matched slots are present). */
  readonly clips: Readonly<Partial<Record<CharacterAnimClip, AnimationGroup>>>;
  /** Names of groups that matched no slot (never played; reported, not lost). */
  readonly unmappedNames: readonly string[];
  /** Persistent states with no mapped clip (safe: playback falls back). */
  readonly missingStates: readonly CharacterAnimState[];
}

/** Options for {@link mapCharacterClips}. */
export interface CharacterClipMappingOptions {
  /**
   * Explicit overrides: slot → exact clip name (compared after the same
   * normalisation). Overrides take precedence over keyword matching, so a
   * loader can pin an ambiguous asset deterministically.
   */
  readonly nameOverrides?: Readonly<Partial<Record<CharacterAnimClip, string>>>;
}

/**
 * Keyword table for clip-name matching, in priority order. A normalised
 * clip name maps to the FIRST slot whose keyword is a prefix of the name.
 * More specific slots are listed before broader ones; locomotion names
 * fold naturally ("Running" → run, "Crouch_Idle" → crouch, "FallLoop" →
 * fall, "Fire_01" → fire).
 */
const SLOT_KEYWORDS: ReadonlyArray<readonly [CharacterAnimClip, readonly string[]]> = [
  ["crouch", ["crouch", "crawl", "sneak"]],
  ["jump", ["jump", "leap", "airstart"]],
  ["fall", ["fall"]],
  ["fire", ["fire", "shoot", "attack"]],
  ["aim", ["aim"]],
  ["build", ["build"]],
  ["edit", ["edit"]],
  ["run", ["run", "walk"]],
  ["idle", ["idle", "stand", "breath"]],
];

/** Lowercase and drop every non-alphanumeric character. */
export function normalizeClipName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Maps a set of loaded AnimationGroups onto the controller's clip slots.
 * Pure and total: any subset (or none) of the states may match; unmatched
 * groups are reported, never played.
 */
export function mapCharacterClips(
  groups: readonly AnimationGroup[],
  options: CharacterClipMappingOptions = {},
): CharacterClipMapping {
  const clips: Partial<Record<CharacterAnimClip, AnimationGroup>> = {};
  const claimed = new Set<AnimationGroup>();
  const nameOf = (group: AnimationGroup) => normalizeClipName(group.name ?? "");

  // 1. Explicit overrides first (deterministic pinning per slot).
  const overrides = options.nameOverrides ?? {};
  for (const [clip, exactName] of Object.entries(overrides)) {
    if (!exactName) continue;
    const target = normalizeClipName(exactName);
    const group = groups.find((g) => !claimed.has(g) && nameOf(g) === target);
    if (group) {
      clips[clip as CharacterAnimClip] = group;
      claimed.add(group);
    }
  }

  // 2. Keyword matching on the remaining groups, first slot wins.
  for (const group of groups) {
    if (claimed.has(group)) continue;
    const name = nameOf(group);
    if (name === "") {
      continue; // unnamed clip: never guessed
    }
    for (const [clip, keywords] of SLOT_KEYWORDS) {
      if (clips[clip]) continue;
      if (keywords.some((keyword) => name.startsWith(keyword))) {
        clips[clip] = group;
        claimed.add(group);
        break;
      }
    }
  }

  return {
    clips,
    unmappedNames: groups.filter((g) => !claimed.has(g)).map((g) => g.name ?? "(unnamed)"),
    missingStates: CHARACTER_ANIM_STATES.filter((state) => clips[state] === undefined),
  };
}

/** Options for {@link CharacterAnimationDriver}. */
export interface CharacterAnimationDriverOptions {
  /** Kinematic tuning; defaults to the shared pose config. */
  readonly poseConfig?: PlayerPoseConfig;
  /** Forwarded to the controller (cross-fade speed, per-clip speed ratio). */
  readonly transitionSpeed?: number;
  readonly speedRatio?: Partial<Record<CharacterAnimClip, number>>;
  /**
   * Crouch presentation blend (0..1) at/above which the crouch state wins
   * while grounded. Default 0.5 (midway of the eased blend).
   */
  readonly crouchThreshold?: number;
}

/**
 * One render-frame input for {@link CharacterAnimationDriver.sync}: the same
 * canonical values the presentation mirrors — predicted (local) or
 * interpolated (remote) position plus the crouch presentation blend.
 */
export interface CharacterAnimationSyncInput {
  /** Canonical player position (same values as `setTransform`). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Monotonic clock in ms (e.g. `performance.now()`; injectable in tests). */
  readonly timeMs: number;
  /** Render-frame delta in seconds (advances the pose kinematics). */
  readonly deltaSeconds: number;
  /** Crouch presentation blend 0..1 (0 when no crouch data, e.g. offline). */
  readonly crouchBlend?: number;
}

/**
 * Per-player live driver: derives the visual locomotion state from the
 * existing canonical position stream and pushes it into the
 * {@link CharacterAnimationController}. Presentation-only — it cannot
 * change positions, velocities, colliders, input, prediction, networking,
 * or authority, and it never moves the gameplay-mirror root (the
 * controller strips root-motion animations).
 */
export class CharacterAnimationDriver {
  /** The owned playback controller (clips, state, fire one-shot). */
  public readonly controller: CharacterAnimationController;

  private readonly _poseModel: PlayerPoseModel;
  private readonly _crouchThreshold: number;
  private readonly _attachedGroups = new Set<AnimationGroup>();
  private _mapping: CharacterClipMapping | null = null;
  private _disposed = false;

  /**
   * @param rootNode the character's gameplay-mirror root (e.g.
   *   `CharacterModel.root`): position animations targeting it are stripped
   *   by the controller so animation can never move the character.
   */
  public constructor(rootNode: Node, options: CharacterAnimationDriverOptions = {}) {
    this._crouchThreshold = options.crouchThreshold ?? 0.5;
    this._poseModel = new PlayerPoseModel(
      options.poseConfig ?? DEFAULT_PLAYER_POSE_CONFIG,
    );
    this.controller = new CharacterAnimationController(rootNode, {
      transitionSpeed: options.transitionSpeed,
      speedRatio: options.speedRatio,
    });
  }

  /** True once {@link dispose} has run. */
  public get isDisposed(): boolean {
    return this._disposed;
  }

  /** The latest clip mapping report (null until the first `attachClips`). */
  public get mapping(): CharacterClipMapping | null {
    return this._mapping;
  }

  /** The clip slot currently actually playing (controller passthrough). */
  public activeClip(): CharacterAnimClip | null {
    return this.controller.activeClip();
  }

  /**
   * Maps the loader's AnimationGroups onto the controller slots and attaches
   * the matched clips. Idempotent per group: groups already attached are
   * skipped, so repeated calls never restart clips or add duplicate
   * AnimationGroup observers. Unmatched groups are reported, not played.
   */
  public attachClips(groups: readonly AnimationGroup[]): CharacterClipMapping {
    const mapping = mapCharacterClips(groups);
    if (!this._disposed) {
      for (const [clip, group] of Object.entries(
        mapping.clips,
      ) as Array<[CharacterAnimClip, AnimationGroup]>) {
        if (this._attachedGroups.has(group)) continue;
        this._attachedGroups.add(group);
        this.controller.attach(clip, group);
      }
    }
    this._mapping = mapping;
    return mapping;
  }

  /**
   * One render frame: feed the canonical position sample and advance the
   * kinematics. Derives the locomotion state (idle/run/jump/fall/crouch),
   * falls back to `idle` when the derived state has no clip, and pushes the
   * result into the controller (a strict no-op there unless it changed).
   * Returns the playable state that was pushed.
   */
  public sync(input: CharacterAnimationSyncInput): CharacterAnimState {
    if (this._disposed) return "idle";
    this._poseModel.sample(input.x, input.y, input.z, input.timeMs);
    if (input.deltaSeconds > 0) {
      this._poseModel.advance(input.deltaSeconds);
    }
    const state = this._deriveState(input.crouchBlend ?? 0);
    const playable = this._resolvePlayable(state);
    this.controller.setState(playable);
    return playable;
  }

  /** Play the fire one-shot once, if a fire clip is attached. */
  public triggerFire(): void {
    if (this._disposed) return;
    this.controller.triggerFire();
  }

  /** Back to the idle baseline (round reset / reconnect). */
  public reset(): void {
    if (this._disposed) return;
    this._poseModel.reset();
    this.controller.reset();
  }

  /**
   * Idempotent teardown: disposes the controller (stops the active group and
   * detaches its observers). The AnimationGroups are loader/model-owned and
   * are NOT disposed here. Every method is a no-op afterwards.
   */
  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._attachedGroups.clear();
    this.controller.dispose();
  }

  // --- internals -----------------------------------------------------------

  /**
   * Derives the visual locomotion state from the existing kinematics:
   * airborne wins (jump vs fall per vertical velocity), then a grounded
   * crouch past the threshold, then speed (idle / walk→run — the gait
   * state maps onto the run clip).
   */
  private _deriveState(crouchBlend: number): CharacterAnimState {
    const pose = this._poseModel.pose;
    if (pose.airborne) {
      return pose.state === "fall" ? "fall" : "jump";
    }
    if (crouchBlend >= this._crouchThreshold) return "crouch";
    switch (pose.state) {
      case "run":
      case "walk":
        return "run";
      default:
        return "idle";
    }
  }

  /**
   * Missing-clip safety: when the derived state has no attached clip, fall
   * back to `idle` if one exists so the body keeps animating instead of
   * freezing; with no clips at all the state is passed through and the
   * controller safely plays nothing.
   */
  private _resolvePlayable(state: CharacterAnimState): CharacterAnimState {
    if (this.controller.hasClip(state)) return state;
    if (state !== "idle" && this.controller.hasClip("idle")) return "idle";
    return state;
  }
}
