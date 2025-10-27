import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import { BrowserRouter } from "react-router-dom";

// Apply the user's browser color-scheme preference to the document root.
// This sets both a data-theme attribute and the `dark` class (useful if
// some parts of the app use Tailwind's `dark:` variants).
function applyPreferredColorScheme() {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const mq = window.matchMedia("(prefers-color-scheme: dark)");

  const set = (isDark: boolean) => {
    try {
      document.documentElement.setAttribute(
        "data-theme",
        isDark ? "dark" : "light"
      );
      if (isDark) document.documentElement.classList.add("dark");
      else document.documentElement.classList.remove("dark");
    } catch {
      // ignore
    }
  };

  set(mq.matches);

  // listen for changes
  try {
    // modern browsers: addEventListener on MediaQueryList
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", (ev: MediaQueryListEvent) =>
        set(ev.matches)
      );
    } else if (typeof mq.addListener === "function") {
      // older API
      // older API on some browsers
      const maybe = mq as unknown as {
        addListener?: (cb: (ev: MediaQueryListEvent) => void) => void;
      };
      maybe.addListener?.((ev: MediaQueryListEvent) => set(ev.matches));
    }
  } catch {
    // ignore
  }
}

applyPreferredColorScheme();

// Register the service worker (injected by vite-plugin-pwa).
try {
  registerSW();
} catch {
  // noop if PWA plugin is not installed in dev or during build steps
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
