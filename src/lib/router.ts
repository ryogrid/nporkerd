// Tiny History-API router: real paths (/room/<id>, /help) that survive reloads (the
// static host falls back to index.html) and work with the back button.
import { useCallback, useEffect, useState } from "react";

export type Route =
  | { page: "home" }
  | { page: "register" }
  | { page: "login" }
  | { page: "lobby" }
  | { page: "help" }
  | { page: "room"; roomId: string };

export type Navigate = (path: string, options?: { replace?: boolean }) => void;

export function normalizePath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function parseRoute(path: string): Route {
  const parts = normalizePath(path).split("/").filter((p) => p !== "");
  const head = (parts[0] ?? "").toLowerCase();
  if (head === "room" && parts.length >= 2) {
    return { page: "room", roomId: parts[1] };
  }
  if (head === "register") return { page: "register" };
  if (head === "login") return { page: "login" };
  if (head === "lobby") return { page: "lobby" };
  if (head === "help") return { page: "help" };
  return { page: "home" };
}

export function usePath(): [string, Navigate] {
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));

  useEffect(() => {
    const onPop = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback<Navigate>((next, options) => {
    const target = normalizePath(next);
    if (target !== normalizePath(window.location.pathname)) {
      if (options?.replace === true) {
        window.history.replaceState(null, "", target);
      } else {
        window.history.pushState(null, "", target);
      }
    }
    setPath(target);
    window.scrollTo(0, 0);
  }, []);

  return [path, navigate];
}
