import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import "bootstrap/dist/js/bootstrap.bundle.min.js";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
