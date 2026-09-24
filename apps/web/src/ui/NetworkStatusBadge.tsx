import { useFoundationNetworkUiState } from "./useFoundationNetworkUiState";

/**
 * A small, non-intrusive development status readout for the browser network
 * layer (Stage 2B2).
 *
 * It mirrors the live {@link NetworkUiState} — connection status, the resolved
 * server URL, the room/session ids, the current player count, and any error —
 * so a developer can watch two browser clients enter/leave the same foundation
 * room from the UI.
 *
 * This component is **presentation-only**: it observes the shared network
 * singleton and renders it. It does not own the connection, read the keyboard,
 * or touch any game/prediction state.
 */
export function NetworkStatusBadge() {
  const ui = useFoundationNetworkUiState();

  return (
    <section className="network-status" aria-label="Network status">
      <header className="network-status__header">
        <span
          className={`network-status__dot network-status__dot--${ui.status}`}
          aria-hidden="true"
        />
        <strong className="network-status__title">Network</strong>
        <span className="network-status__status">{ui.status}</span>
      </header>

      <dl className="network-status__list">
        <div className="network-status__row">
          <dt>Server</dt>
          <dd title={ui.serverUrl}>{ui.serverUrl}</dd>
        </div>
        <div className="network-status__row">
          <dt>Players</dt>
          <dd>{ui.playerCount}</dd>
        </div>
        <div className="network-status__row">
          <dt>Room</dt>
          <dd>{ui.roomId ?? "—"}</dd>
        </div>
        <div className="network-status__row">
          <dt>Session</dt>
          <dd>{ui.sessionId ?? "—"}</dd>
        </div>
      </dl>

      {ui.error !== null && (
        <p className="network-status__error" role="status">
          {ui.error}
        </p>
      )}
    </section>
  );
}
