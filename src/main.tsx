import { createRoot } from "react-dom/client";
import { ConvexReactClient, ConvexProvider } from "convex/react";
import { App } from "./App";
import { SessionProvider } from "./lib/auth";
import { ToastProvider } from "./lib/toast";
import "./styles.css";

// Production builds get VITE_CONVEX_URL from the static-hosting CLI; in dev
// `convex dev` writes CONVEX_URL to .env.local (exposed via envPrefix).
const convexUrl = import.meta.env.VITE_CONVEX_URL || import.meta.env.CONVEX_URL || "";

const convex = new ConvexReactClient(convexUrl, { unsavedChangesWarning: false });

const mountPoint = document.getElementById("nporkerd-root") ?? document.body;

createRoot(mountPoint).render(
  <ConvexProvider client={convex}>
    <ToastProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </ToastProvider>
  </ConvexProvider>,
);
