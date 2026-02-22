import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./app/App.tsx";
import { initializeTheme } from "./design-system/theme/index.ts";
import "./design-system/tokens/theme.css";
import "./styles/global.css";

initializeTheme();

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element for React mount.");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
