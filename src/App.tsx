// App shell: top bar, routing, and the session gate. Lobby and room need a
// validated session; visitors who open a table link are sent back to it after
// logging in.
import { useEffect } from "react";
import { useSession } from "./lib/auth";
import { parseRoute, usePath } from "./lib/router";
import { HomePage } from "./pages/HomePage";
import { RegisterPage } from "./pages/RegisterPage";
import { LoginPage } from "./pages/LoginPage";
import { LobbyPage } from "./pages/LobbyPage";
import { RoomPage } from "./pages/RoomPage";
import { SoundControl } from "./components/SoundControl";
import { Chip } from "./components/Chips";
import { formatChips } from "./lib/format";
import { unlockAudio } from "./lib/sound";
import { Id } from "../convex/_generated/dataModel";

const RETURN_KEY = "nporkerd.returnTo";

function readReturn(): string {
  try {
    return sessionStorage.getItem(RETURN_KEY) ?? "/lobby";
  } catch {
    return "/lobby";
  }
}

function writeReturn(path: string | undefined): void {
  try {
    if (path === undefined) sessionStorage.removeItem(RETURN_KEY);
    else sessionStorage.setItem(RETURN_KEY, path);
  } catch {
    // ignore
  }
}

export function App() {
  const session = useSession();
  const [path, navigate] = usePath();
  const route = parseRoute(path);
  const signedIn = session.status === "signed-in" && session.me !== undefined && session.token !== undefined;

  // browsers only allow audio after a gesture: unlock on the first one
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // remember where a signed-out visitor was heading (e.g. an invite link)
  useEffect(() => {
    if (session.status === "anonymous" && route.page === "room") writeReturn(path);
  }, [session.status, route.page, path]);

  // signed-in users skip the landing/auth screens
  useEffect(() => {
    if (signedIn && (route.page === "home" || route.page === "login" || route.page === "register")) {
      navigate("/lobby", { replace: true });
    }
  }, [signedIn, route.page, navigate]);

  // once signed in, honour a pending invite link
  const afterAuth = readReturn();
  useEffect(() => {
    if (signedIn) writeReturn(undefined);
  }, [signedIn]);

  useEffect(() => {
    document.title = route.page === "room" ? "Table · nporkerd" : "nporkerd — Texas Hold'em";
  }, [route.page]);

  let content;
  if (session.status === "pending") {
    content = <div className="center-screen"><div className="spinner" /></div>;
  } else if (route.page === "register" && !signedIn) {
    content = <RegisterPage navigate={navigate} afterAuth={afterAuth} />;
  } else if (route.page === "login" && !signedIn) {
    content = <LoginPage navigate={navigate} afterAuth={afterAuth} />;
  } else if (!signedIn || session.me === undefined || session.token === undefined) {
    content = <HomePage navigate={navigate} expired={session.expired} invited={route.page === "room"} />;
  } else if (route.page === "room") {
    content = <RoomPage key={route.roomId} roomId={route.roomId as Id<"rooms">} token={session.token} me={session.me} navigate={navigate} />;
  } else {
    content = <LobbyPage token={session.token} me={session.me} navigate={navigate} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => navigate(signedIn ? "/lobby" : "/")}>
          <span className="brand-mark">♠</span>
          <span className="full">npork<em>erd</em></span>
        </button>
        <span className="topbar-spacer" />
        <SoundControl />
        {signedIn && session.me !== undefined ? (
          <>
            <span className="balance-pill nums" title="Your bankroll">
              <Chip color="c-gold" />
              {formatChips(session.me.balance)}
            </span>
            <span className="user-pill"><strong>{session.me.username}</strong></span>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                void session.signOut();
                navigate("/", { replace: true });
              }}
            >
              Log out
            </button>
          </>
        ) : route.page !== "login" ? (
          <button type="button" className="btn btn-sm" onClick={() => navigate("/login")}>Log in</button>
        ) : null}
      </header>
      <main className="main">{content}</main>
    </div>
  );
}
