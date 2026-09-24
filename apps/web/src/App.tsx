import { PROTOCOL_VERSION } from "@buildshift/protocol";
import { GameCanvas } from "./game/GameCanvas";
import { NetworkStatusBadge } from "./ui/NetworkStatusBadge";

export function App() {
  return (
    <main className="game-shell">
      <GameCanvas />
      <aside className="foundation-overlay" aria-label="Development scene status">
        <strong>BuildShift</strong>
        <p>Physics playground (Stage 1E)</p>
        <small>Protocol {PROTOCOL_VERSION}</small>
      </aside>
      <NetworkStatusBadge />
    </main>
  );
}
