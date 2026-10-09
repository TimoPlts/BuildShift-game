/**
 * BuildEditHud — a presentation-only HUD overlay for the BuildShift
 * build-edit system (editing an already-placed, owned structure).
 *
 * Displays, while build-edit mode is active:
 *  - an "EDIT MODE" indicator and the targeted structure (or a prompt to
 *    aim at an owned wall, roof, or floor),
 *  - a selector row of the edits the targeted structure allows
 *    (door / window / half_top / half_bottom / clear), each with its
 *    number-key hint, the chosen one highlighted,
 *  - a contextual control hint that reflects the valid/invalid state
 *    (apply when a target is aimed and connected; a "Not connected"
 *    warning otherwise),
 *  - the accepted/rejected feedback banner once the server replies, plus
 *    brief "Edit mode on" / "Edit mode off" informational banners.
 *
 * The panel renders nothing when edit mode is off and no feedback is
 * pending (keeps the HUD uncluttered); after a result it briefly shows just
 * the feedback banner.
 *
 * This component is purely presentational. All data arrives as plain props
 * (a snapshot of the {@link BuildEditHudState} from the runtime); it performs
 * no networking, no runtime queries, and no side effects beyond rendering.
 */
import type { BuildEditSelection } from "../../game/buildEdit/buildEditInputController";

/** The structure the aim ray currently selects (presentation data). */
export interface BuildEditTargetView {
  structureId: string;
  buildType: string;
  grid: { x: number; y: number; z: number };
}

/** An accepted/rejected/informational build-edit feedback banner. */
export interface BuildEditFeedbackView {
  kind: "accepted" | "rejected" | "info";
  message: string;
}

/** Explicit props for the build-edit HUD. */
export interface BuildEditHudProps {
  /** Whether build-edit mode is active (drives the panel's visibility). */
  mode: boolean;
  /** The targeted structure, or `null` when nothing is selected. */
  target: BuildEditTargetView | null;
  /** The currently chosen edit (door / window / half_top / half_bottom / clear). */
  selectedEdit: BuildEditSelection;
  /** The edit types the target allows (drives the selector row). */
  allowedEdits: readonly string[];
  /** The accepted/rejected feedback banner, or `null` when none is pending. */
  feedback: BuildEditFeedbackView | null;
  /**
   * Whether the chosen edit can be applied right now (edit mode on, a
   * structure aimed, connection live) — drives the contextual hint.
   */
  applyReady: boolean;
}

/** Human-readable labels for each build-edit choice (including `clear`). */
const EDIT_LABELS: Readonly<Record<BuildEditSelection, string>> = {
  door: "Door",
  window: "Window",
  half_top: "Top half",
  half_bottom: "Bottom half",
  clear: "Clear",
};

/** The number-key hint shown under each edit (matches the input controller). */
const EDIT_KEY_HINTS: Readonly<Record<BuildEditSelection, string>> = {
  door: "5",
  window: "6",
  half_top: "7",
  half_bottom: "8",
  clear: "9",
};

/** A short display name for the targeted structure's build type. */
const BUILD_TYPE_LABELS: Readonly<Record<string, string>> = {
  wall: "Wall",
  floor: "Floor",
  ramp: "Ramp",
  cone: "Cone",
  roof: "Roof",
};

/**
 * A presentation-only build-edit HUD overlay.
 *
 * Renders a fixed-position overlay (above the build HUD) showing the targeted
 * owned structure, a selector row of the allowed edits with key hints, and the
 * accepted/rejected feedback.
 */
export function BuildEditHud(props: BuildEditHudProps): JSX.Element | null {
  const { mode, target, selectedEdit, allowedEdits, feedback, applyReady } =
    props;

  // Render nothing when out of edit mode and no feedback is pending — the
  // build HUD already owns the bottom-centre real estate.
  if (!mode && !feedback) {
    return null;
  }

  const feedbackEl = feedback !== null ? (
    <div
      className={`build-edit-hud__feedback build-edit-hud__feedback--${feedback.kind}`}
      role="status"
    >
      <span aria-hidden="true">{feedback.kind === "accepted" ? "✓ " : feedback.kind === "rejected" ? "✕ " : ""}</span>
      {feedback.message}
    </div>
  ) : null;

  // After the mode has ended (or was never on), show only the brief feedback.
  if (!mode) {
    return (
      <div className="build-edit-hud build-edit-hud--feedback-only" aria-live="polite">
        {feedbackEl}
      </div>
    );
  }

  const targetName = target
    ? (BUILD_TYPE_LABELS[target.buildType] ?? target.buildType)
    : null;

  // The selector row lists every edit the target allows plus "clear".
  const options: BuildEditSelection[] = target
    ? [...(allowedEdits as readonly BuildEditSelection[]), "clear"]
    : [];

  return (
    <div className="build-edit-hud" aria-live="polite">
      {/* ── Mode + targeted structure ── */}
      <div className="build-edit-hud__top-row">
        <span className="build-edit-hud__mode-label build-edit-hud__mode-label--active">
          EDIT MODE
        </span>
        <span className="build-edit-hud__target">
          {target && targetName
            ? `Aim: ${targetName} (${target.grid.x}, ${target.grid.y}, ${target.grid.z})`
            : "Aim at an owned wall, roof, or floor"}
        </span>
      </div>

      {/* ── Edit selector row (key-hinted chips) ── */}
      <div
        className="build-edit-hud__edits"
        role="listbox"
        aria-label="Edit selection"
      >
        {options.length === 0 ? (
          <div className="build-edit-hud__edit build-edit-hud__edit--empty">
            <span className="build-edit-hud__edit-label">No target</span>
          </div>
        ) : (
          options.map((edit) => (
            <div
              key={edit}
              role="option"
              aria-selected={edit === selectedEdit}
              className={`build-edit-hud__edit ${
                edit === selectedEdit ? "build-edit-hud__edit--selected" : ""
              }`}
            >
              <span className="build-edit-hud__edit-key" aria-hidden="true">
                {EDIT_KEY_HINTS[edit]}
              </span>
              <span className="build-edit-hud__edit-label">
                {EDIT_LABELS[edit]}
              </span>
            </div>
          ))
        )}
      </div>

      {/* ── Accepted/rejected feedback ── */}
      {feedbackEl}

      {/* ── Contextual control hint (valid/invalid state) ── */}
      <div
        className={`build-edit-hud__hint ${
          target !== null && !applyReady ? "build-edit-hud__hint--warn" : ""
        }`}
      >
        {target === null ? (
          <>
            <span>F</span> exit
          </>
        ) : applyReady ? (
          <>
            <span>5-9</span> choose · <span>Enter</span> apply · <span>F</span>
            exit
          </>
        ) : (
          "Not connected"
        )}
      </div>
    </div>
  );
}
