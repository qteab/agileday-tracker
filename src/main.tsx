import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "./store/context";
import { App } from "./App";
import { applyTheme } from "./utils/theme";
import "./styles/index.css";

// Apply the system theme before first paint. Stored prefs load asynchronously
// and refine this once available (see useThemeSync in context.tsx).
applyTheme("system");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>
);
