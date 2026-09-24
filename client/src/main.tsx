import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.js";

const root_element = document.getElementById("root");
if (!root_element) {
  throw new Error("Root element not found");
}
createRoot(root_element).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
