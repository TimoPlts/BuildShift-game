import { PROTOCOL_VERSION } from "@buildshift/protocol";

/**
 * Minimal placeholder UI to verify the React + Vite + TypeScript toolchain.
 * Replaced by the real menus / lobby / HUD in a later stage.
 */
export function App() {
  return (
    <main className="app">
      <h1>BuildShift</h1>
      <p>Competitive browser building shooter — foundation scaffold.</p>
      <p className="status">Protocol {PROTOCOL_VERSION}</p>
    </main>
  );
}
