import { PROTOCOL_VERSION } from "@buildshift/protocol";
import { GameCanvas } from "./game/GameCanvas";

export function App() {
  return (
    <main className="game-shell">
      <GameCanvas />
      <aside className="foundation-overlay" aria-label="Development scene status">
        <strong>BuildShift</strong>
        <p>Third-person camera prototype</p>
        <small>Protocol {PROTOCOL_VERSION}</small>
      </aside>
    </main>
  );
}
