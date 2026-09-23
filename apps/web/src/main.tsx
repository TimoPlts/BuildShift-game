import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// Application entry point.
// The Babylon render loop will be mounted separately and kept independent of
// React (see docs/TECHNICAL_ARCHITECTURE.md §3). For now, only the React UI
// bootstrap lives here.
const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container #root was not found.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
