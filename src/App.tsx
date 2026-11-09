// The SPA shell — design/07 §1: four views keyed by the URL *path*, not by a
// hash (real paths like /room/<id> work on reload because the static host
// falls back to index.html). Routing is state-based: the current path lives in
// one useState, seeded from `location.pathname`, and every page gets a
// `navigate` callback so a hand-off never forces a reload. The session gate is
// `useSession()` (07 §1/03 §5): the token in sessionStorage plus `auth.me`;
// lobby and room are only rendered for a signed-in viewer, otherwise the page
// chooser is shown. The stylesheet is rendered once as a <style> element so the
// built bundle needs no extra asset (07 §1: CSS only, no image assets).
import { useState } from "react";
import { useSession, MeProfile } from "./lib/auth";
import { readSessionToken } from "./lib/session";
import { THEME_CSS } from "./lib/themeCss";
import { RegisterPage } from "./pages/RegisterPage";
import { LoginPage } from "./pages/LoginPage";
import { LobbyPage } from "./pages/LobbyPage";
import { RoomPage } from "./pages/RoomPage";
import { Id } from "../convex/_generated/dataModel";

/** One of the four views per path (07 §1). `/` falls back to the lobby gate. */
type Route = { page: "register" | "login" | "lobby" | "room"; roomId?: string };

function normalizePath(path: string): string {
  const withoutTrailing = path.replace(/\/+$/, "");
  return withoutTrailing === "" ? "/" : withoutTrailing;
}

function parseRoute(path: string): Route {
  const parts = normalizePath(path).split("/").filter((p) => p !== "");
  if (parts.length === 0) {
    return { page: "lobby" };
  }
  const head = parts[0].toLowerCase();
  if (head === "room" && parts.length >= 2) {
    return { page: "room", roomId: parts[1] };
  }
  if (head === "register") {
    return { page: "register" };
  }
  if (head === "login") {
    return { page: "login" };
  }
  return { page: "lobby" };
}

export function App() {
  const session = useSession();
  const [path, setPath] = useState<string>(() => normalizePath(location.pathname));

  function navigate(next: string): void {
    setPath(normalizePath(next));
  }

  const route = parseRoute(path);
  const profile: MeProfile | undefined = session.profile;
  const storedToken: string | undefined =
    session.token === undefined ? readSessionToken() : session.token;

  // Non-auth pages need no session; lobby and room do (07 §1, 03 §5).
  if (route.page === "register") {
    return (
      <>
        <style>{THEME_CSS}</style>
        <div className="np-app">
          <RegisterPage navigate={navigate} />
        </div>
      </>
    );
  }
  if (route.page === "login") {
    return (
      <>
        <style>{THEME_CSS}</style>
        <div className="np-app">
          <LoginPage navigate={navigate} />
        </div>
      </>
    );
  }

  // The gate: lobby and room render only for a validated session (07 §1).
  if (session.status !== "signed-in" || profile === undefined || storedToken === undefined) {
    const checking = session.status === "pending";
    return (
      <>
        <style>{THEME_CSS}</style>
        <div className="np-app">
          <div className="np-card">
            {checking ? <div className="np-muted">checking the stored session…</div> : null}
            <h1 className="np-title">nporkerd</h1>
            <div className="np-muted">
              {session.status === "invalid"
                ? "The session stored in this tab is no longer valid — sign in again."
                : "Nobody is signed in in this tab yet."}
            </div>
            <div className="np-actions">
              <a
                href="/register"
                onClick={(event) => {
                  event.preventDefault();
                  navigate("/register");
                }}
              >
                create an account
              </a>
              <a
                href="/login"
                onClick={(event) => {
                  event.preventDefault();
                  navigate("/login");
                }}
              >
                log in with a key
              </a>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (route.page === "room" && route.roomId !== undefined) {
    const roomId = route.roomId as Id<"rooms">;
    return (
      <>
        <style>{THEME_CSS}</style>
        <div className="np-app">
          <RoomPage roomId={roomId} token={storedToken} me={profile} navigate={navigate} />
        </div>
      </>
    );
  }

  return (
    <>
      <style>{THEME_CSS}</style>
      <div className="np-app">
        <LobbyPage
          token={storedToken}
          username={profile.username}
          balance={profile.balance}
          navigate={navigate}
        />
      </div>
    </>
  );
}
