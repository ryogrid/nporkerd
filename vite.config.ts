import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The built SPA is uploaded by the static-hosting component and served at
// https://<deployment>.convex.site; SPA fallback makes /room/:id routes work
// on reload (see design/09-deployment-and-operations.md §5).
export default defineConfig({
  plugins: [react()],
  // Also expose the exact variable `CONVEX_URL` (written into .env.local by
  // `convex dev`) to client code via import.meta.env in addition to VITE_*.
  envPrefix: ["VITE_", "CONVEX_URL"],
});
