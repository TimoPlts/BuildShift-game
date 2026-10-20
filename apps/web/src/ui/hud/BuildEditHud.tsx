/**
 * BuildEditHud — the presentation-only HUD panel for the piece-edit system
 * (docs/TECHNICAL_ARCHITECTURE.md §24).
 *
 * Renders (when visible):
 *
 *  - an "EDIT MODE" header,
 *  - the targeted structure read-out (or an aim prompt + "No target" chip
 *    when the aim ray is off every owned piece),
 *  - the pending tile summary (how many tiles are open on the targeted
 *    piece, or the ramp's current half),
 *  - a compact control hint row (LMB select · Enter confirm · C cancel ·
 *    ⌫ reset · F exit),
 *  - an accepted/rejected/info feedback banner (kept visible even after the
 *    edit mode has ended, until the controller clears it).
 *
 * The panel is driven entirely by the flat {@link BuildEditHudState} the
 * runtime hands in — it owns no game state and no side effects.
 */
import type {
  BuildEditTargetHud,
  BuildEditFeedbackHud,
} from "../../game/buildEdit/buildEditHudView";
import { actionLabel } from "../../game/input/actionBindings";

export interface BuildEditHudProps {
  /** Whether edit mode is active. */
  mode: boolean;
  /** The targeted structure, or `null` when the aim ray selects nothing. */
  target: BuildEditTargetHud | null;
  /** Open (removed) tiles in the pending state (`0` for ramps). */
  removedTiles: number;
  /** Total tiles on the piece's edit grid (`0` for ramps). */
  totalTiles: number;
  /** The pending ramp variant (ramp pieces only), else `null`. */
  rampVariant: string | null;
  /** The accepted/rejected/info feedback banner, or `null`. */
  feedback: BuildEditFeedbackHud | null;
  /**
   * Whether the edit interaction is available right now (mode on, a
   * structure aimed, connection live).
   */
  applyReady: boolean;
  /** Whether the edit has unconfirmed changes. */
  unconfirmed?: boolean;
  /** Why the current pattern cannot be confirmed, or `null`. */
  invalidReason?: string | null;
}

/** Human-readable labels per build type (the "Aim:" read-out). */
const BUILD_TYPE_LABELS: Readonly<Record<string, string>> = {
  wall: "Wall",
  roof: "Roof",
  ramp: "Ramp",
  cone: "Cone",
  floor: "Floor",
};

/** Human-readable labels per ramp variant (the tile summary). */
const RAMP_VARIANT_LABELS: Readonly<Record<string, string>> = {
  full: "full ramp",
  half_left: "left half",
  half_right: "right half",
};

/**
 * The build-edit HUD panel (presentation-only, driven by a flat view).
 *
 * @param {BuildEditHudProps} { mode, target, removedTiles, totalTiles, rampVariant, feedback, applyReady }
 * @returns {JSX.Element} The static build-edit panel markup.
 */
export function BuildEditHud({
  mode,
  target,
  removedTiles,
  totalTiles,
  rampVariant,
  feedback,
  applyReady,
  unconfirmed = false,
  invalidReason = null,
}: BuildEditHudProps) {
  // Idle: nothing to show.
  if (!mode && feedback === null) {
    return <></>;
  }

  // A result banner is shown even after the mode has ended.
  if (!mode) {
    return (
      <div className="build-edit-hud build-edit-hud--result-only">
        <FeedbackBanner feedback={feedback!} />
      </div>
    );
  }

  const typeName = target
    ? BUILD_TYPE_LABELS[target.buildType] ?? target.buildType
    : null;
  const tilesSummary =
    rampVariant !== null
      ? `Ramp: ${RAMP_VARIANT_LABELS[rampVariant] ?? rampVariant}`
      : totalTiles > 0
        ? `Tiles open: ${removedTiles}/${totalTiles}`
        : null;

  return (
    <div className="build-edit-hud">
      <div className="build-edit-hud__header">
        <span className="build-edit-hud__title">EDIT MODE</span>
        {target !== null ? (
          <span className="build-edit-hud__target">
            Aim: {typeName} ({target.grid.x}, {target.grid.y},{" "}
            {target.grid.z})
          </span>
        ) : (
          <>
            <span className="build-edit-hud__aim">
              Aim at an owned wall, floor, ramp, or cone
            </span>
            <span className="build-edit-hud__none">No target</span>
          </>
        )}
        {tilesSummary !== null && (
          <span className="build-edit-hud__tiles">{tilesSummary}</span>
        )}
        {invalidReason !== null ? (
          <span className="build-edit-hud__invalid">Invalid: {invalidReason}</span>
        ) : unconfirmed ? (
          <span className="build-edit-hud__pending">Unconfirmed</span>
        ) : null}
      </div>
      <div className="build-edit-hud__hint">
        {applyReady ? (
          <span className="build-edit-hud__hint--ok">
            Drag {actionLabel("editSelect")} select · {actionLabel("edit")}/{actionLabel("editConfirm")} confirm ·{" "}
            {actionLabel("editReset")} reset
          </span>
        ) : (
          target !== null && (
            <span className="build-edit-hud__hint--warn">Not connected</span>
          )
        )}
      </div>
      {feedback !== null && <FeedbackBanner feedback={feedback} />}
    </div>
  );
}

function FeedbackBanner({
  feedback,
}: {
  feedback: BuildEditFeedbackHud;
}) {
  return (
    <div className={`build-edit-hud__feedback build-edit-hud__feedback--${feedback.kind}`}>
      {feedback.kind === "accepted" ? (
        <span className="build-edit-hud__glyph">✓</span>
      ) : feedback.kind === "rejected" ? (
        <span className="build-edit-hud__glyph">✕</span>
      ) : null}
      <span className="build-edit-hud__message">{feedback.message}</span>
    </div>
  );
}
