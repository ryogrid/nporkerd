import { createRoot } from "react-dom/client";
import { ConvexReactClient, ConvexProvider } from "convex/react";
import { App } from "./App";

// Resolve the Convex deployment URL at build time (design/01 §2:
// `VITE_CONVEX_URL` is a public build-time constant, never a secret).
// - Production builds: the static-hosting CLI injects `VITE_CONVEX_URL`.
// - Dev: `convex dev` writes `CONVEX_URL` into `.env.local` (gitignored);
//   vite.config.ts exposes it to the client via `envPrefix`.
const convexUrl =
  import.meta.env.VITE_CONVEX_URL || import.meta.env.CONVEX_URL || "";

const convex = new ConvexReactClient(convexUrl);

// `index.html` ships a placeholder <div> we mount the app into
// (react-dom@19.3.1 `createRoot`; the mount div must not be re-rendered by
// React, per design/07 §1.4).
const mountPoint = document.getElementById("nporkerd-root") ?? document.body;

createRoot(mountPoint).render(
  <ConvexProvider client={convex}>
    <App />
  </ConvexProvider>,
);
