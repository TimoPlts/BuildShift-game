import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite configuration for the BuildShift web client.
// The Babylon render loop will be kept independent of React (see
// docs/TECHNICAL_ARCHITECTURE.md §3); only the React UI lives here for now.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
