// Lobby: the reactive list of public tables, a way into private tables by
// link, the faucet when the bankroll runs low, and the "host a table" form.
import { FormEvent, useState } from "react";
import { useMutation, useQuery_experimental } from "convex/react";
import { api } from "../../convex/_generated/api";
import { CreateRoomDialog } from "../components/CreateRoomDialog";
import { errorCopyFor, faucetHint } from "../lib/errorCopy";
import { formatChips } from "../lib/format";
import { LobbyRow } from "../lib/projection";
import { MeProfile, usePresence } from "../lib/auth";
import { Navigate } from "../lib/router";
import { useToast } from "../lib/toast";
import { playCue } from "../lib/sound";
import { FAUCET_AMOUNT } from "../../convex/lib/constants";

/** Accepts a full room link, a /room/<id> path, or a bare id. */
export function roomIdFromInput(text: string): string | undefined {
  const t = text.trim();
  if (t === "") return undefined;
  const m = /\/room\/([A-Za-z0-9_-]+)/.exec(t);
  if (m !== null) return m[1];
  return /^[A-Za-z0-9_-]+$/.test(t) ? t : undefined;
}

export function LobbyPage({ token, me, navigate }: { token: string; me: MeProfile; navigate: Navigate }) {
  const toast = useToast();
  const claimFaucet = useMutation(api.users.claimFaucet);
  const [link, setLink] = useState("");
  const [claiming, setClaiming] = useState(false);
  usePresence(token);

  const listed = useQuery_experimental({
    query: api.rooms.listPublicRooms,
    args: { sessionToken: token },
    throwOnError: false,
  });

  async function claim(): Promise<void> {
    setClaiming(true);
    try {
      await claimFaucet({ sessionToken: token });
      playCue("win");
      toast.push(`+${formatChips(FAUCET_AMOUNT)} chips added to your bankroll.`, "success");
    } catch (e) {
      const hint = faucetHint(e);
      toast.push(hint === undefined ? errorCopyFor(e) : `${errorCopyFor(e)} ${hint}`);
    } finally {
      setClaiming(false);
    }
  }

  function openLink(e: FormEvent): void {
    e.preventDefault();
    const id = roomIdFromInput(link);
    if (id === undefined) {
      toast.push("Paste a table link like …/room/abc123.");
      return;
    }
    navigate(`/room/${id}`);
  }

  const rooms: LobbyRow[] = listed.status === "success" ? listed.data : [];

  return (
    <div className="lobby">
      <div className="stack" style={{ gap: 20 }}>
        <div className="lobby-head">
          <div>
            <div className="faint">Welcome back, {me.username}</div>
            <h1>Tables</h1>
          </div>
          {me.balance < FAUCET_AMOUNT ? (
            <button type="button" className="btn btn-primary" disabled={claiming} onClick={() => void claim()}>
              🎁 Claim {formatChips(FAUCET_AMOUNT)} free chips
            </button>
          ) : null}
        </div>

        {listed.status === "pending" ? (
          <div className="center-screen" style={{ minHeight: 200 }}><div className="spinner" /></div>
        ) : listed.status === "error" ? (
          <div className="empty-state">{errorCopyFor(listed.error)}</div>
        ) : rooms.length === 0 ? (
          <div className="empty-state">
            <div className="big">🃏</div>
            <div>No public tables are open right now.</div>
            <div className="faint">Host one — it shows up here for everyone instantly.</div>
          </div>
        ) : (
          <div className="room-list">
            {rooms.map((row) => (
              <button key={row.roomId} type="button" className="room-card" onClick={() => navigate(`/room/${row.roomId}`)}>
                <div className="room-felt" />
                <div>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="room-name">{row.name}</span>
                    {row.status === "playing" ? <span className="badge badge-live">Live</span> : <span className="badge">Waiting</span>}
                  </div>
                  <div className="room-meta">
                    <span>Blinds <b>{formatChips(row.smallBlind)}/{formatChips(row.bigBlind)}</b></span>
                    <span>Buy-in <b>{formatChips(row.buyIn)}</b></span>
                    <span>Clock <b>{row.turnSeconds === 0 ? "off" : `${row.turnSeconds}s`}</b></span>
                    <span>Host <b>{row.hostUsername}</b></span>
                  </div>
                  <div className="seat-dots" aria-label={`${row.seatedCount} of ${row.maxSeats} seats taken`}>
                    {Array.from({ length: row.maxSeats }, (_, i) => <i key={i} className={i < row.seatedCount ? "on" : ""} />)}
                  </div>
                </div>
                <div className="stack" style={{ alignItems: "end", gap: 4 }}>
                  <span className="nums" style={{ fontWeight: 700 }}>{row.seatedCount}/{row.maxSeats}</span>
                  <span className="btn btn-sm">{row.seatedCount >= row.maxSeats ? "Watch" : "Join"}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        <form className="panel panel-pad stack" onSubmit={openLink}>
          <h3 className="section-title" style={{ margin: 0 }}>Got an invite?</h3>
          <div className="join-code">
            <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a table link" aria-label="Table link" />
            <button type="submit" className="btn">Open</button>
          </div>
        </form>
      </div>

      <CreateRoomDialog
        sessionToken={token}
        defaultName={`${me.username}'s table`.slice(0, 40)}
        onCreated={(roomId) => navigate(`/room/${roomId}`)}
      />
    </div>
  );
}
