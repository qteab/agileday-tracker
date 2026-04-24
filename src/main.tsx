import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "./store/context";
import { App } from "./App";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>
);
