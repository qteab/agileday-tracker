import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { AppProvider } from "./store/context";
import { applyTheme } from "./utils/theme";

import "./styles/index.css";

// Apply the system theme before first paint. Stored prefs load asynchronously
// and refine this once available (see useThemeSync in context.tsx).
applyTheme("system");

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");

createRoot(rootElement).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>
);
