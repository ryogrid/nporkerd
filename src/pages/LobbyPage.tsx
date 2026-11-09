// /lobby — design/07 §2.3: header (username, balance, faucet button only when
// the faucet rule allows, logout), the reactive public-room list (08 §3), and
// the create-room dialog. The list is a plain reactive query: no polling and
// no refresh timers here (07 §3).
import { useState } from "react";
import { useMutation, useQuery_experimental } from "convex/react";
import { api } from "../../convex/_generated/api";
import { BalanceBadge, faucetEligible } from "../components/BalanceBadge";
import { CreateRoomDialog } from "../components/CreateRoomDialog";
import { SoundControl } from "../components/SoundControl";
import { PresenceTicker } from "../lib/auth";
import { clearSessionToken } from "../lib/session";
import { errorCopyFor, faucetHint } from "../lib/errorCopy";
import { formatChips } from "../lib/format";
import { LobbyRow } from "../lib/projection";

export function LobbyPage({ token, username, balance, navigate }: {
  token: string;
  username: string;
  balance: number;
  navigate: (path: string) => void;
}) {
  const [currentBalance, setCurrentBalance] = useState<number>(balance);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const claimFaucet = useMutation(api.users.claimFaucet);
  const logOut = useMutation(api.auth.logout);

  const listed = useQuery_experimental({
    query: api.rooms.listPublicRooms,
    args: { sessionToken: token },
    throwOnError: false,
  });

  async function claim(): Promise<void> {
    setNotice(undefined);
    try {
      const claimed = await claimFaucet({ sessionToken: token });
      setCurrentBalance(claimed.balance);
    } catch (e) {
      const hint = faucetHint(e);
      setNotice(hint === undefined ? errorCopyFor(e) : `${errorCopyFor(e)} ${hint}`);
    }
  }

  function signedOut(): void {
    clearSessionToken();
    void logOut({ sessionToken: token });
    navigate("/login");
  }

  const rooms: LobbyRow[] | undefined = listed.status === "success" ? listed.data : undefined;

  return (
    <div className="np-page">
      <div className="np-card">
        <h2 className="np-title">{username}</h2>
        <BalanceBadge balance={currentBalance} />
        <PresenceTicker token={token} />
        <SoundControl />
        <div className="np-actions">
          {faucetEligible(currentBalance) ? (
            <button type="button" onClick={() => void claim()}>Claim the faucet</button>
          ) : null}
          <button type="button" onClick={() => signedOut()}>Log out</button>
        </div>
        {notice === undefined ? null : <div className="np-error">{notice}</div>}
      </div>

      <h2 className="np-title">Public tables</h2>
      {rooms === undefined ? (
        <div className="np-muted">
          {listed.status === "error" ? errorCopyFor(listed.error) : "loading the lobby…"}
        </div>
      ) : rooms.length === 0 ? (
        <div className="np-muted">Nobody is hosting a public table right now.</div>
      ) : (
        <div className="np-rows">
          {rooms.map((row: LobbyRow) => (
            <div key={row.roomId} className="np-card">
              <span className="np-seat-name">{row.name}</span>
              <span className="np-muted">
                host {row.hostUsername} · seats {row.seatedCount}/{row.maxSeats} (members {row.memberCount}) · blinds {row.smallBlind}/{row.bigBlind} · buy-in {formatChips(row.buyIn)} · clock {row.turnSeconds}s
              </span>
              <span className="np-muted">status {row.status}</span>
              <a
                href={`/room/${row.roomId}`}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(`/room/${row.roomId}`);
                }}
              >
                open this table
              </a>
            </div>
          ))}
        </div>
      )}

      <h2 className="np-title">Host a table</h2>
      <CreateRoomDialog
        sessionToken={token}
        onCreated={(roomId) => navigate(`/room/${roomId}`)}
      />
    </div>
  );
}

/** Lobby entry when the session is still being validated. */
export function LobbyVerifying() {
  return <div className="np-muted">checking your session…</div>;
}

export function LobbyRegisterHint() {
  return (
    <div className="np-card">
      <div className="np-muted">Nobody is signed in here yet.</div>
      <a href="/register">create an account</a>
      <a href="/login">log in with an existing key</a>
    </div>
  );
}
