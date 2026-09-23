import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));

// Vite configuration for the BuildShift web client.
// The Babylon render loop will be kept independent of React (see
// docs/TECHNICAL_ARCHITECTURE.md §3); only the React UI lives here for now.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@buildshift/game-config": path.resolve(
        here,
        "../../packages/game-config/src/index.ts",
      ),
      "@buildshift/protocol": path.resolve(here, "../../packages/protocol/src/index.ts"),
      "@buildshift/simulation": path.resolve(
        here,
        "../../packages/simulation/src/index.ts",
      ),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
