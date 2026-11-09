// /room/:id — the table. `rooms.getRoom` gives room metadata + membership,
// `game.getTableState` the per-viewer hand projection, chat is separate.
// Opening a public table joins it as a spectator automatically; private
// tables ask for the passphrase first. Sitting down is one click on a chair.
import { FormEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQuery_experimental } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { ActionBar } from "../components/ActionBar";
import { ChatPanel } from "../components/ChatPanel";
import { PokerTable, potTotal } from "../components/PokerTable";
import { TableSounds } from "../components/TableSounds";
import { errorCodeOf, errorCopyFor } from "../lib/errorCopy";
import { formatChips, secondsLeft } from "../lib/format";
import { RoomProfile, TableState } from "../lib/projection";
import { MeProfile, usePresence } from "../lib/auth";
import { Navigate } from "../lib/router";
import { useToast } from "../lib/toast";
import { useNow } from "../lib/useNow";
import { playCue } from "../lib/sound";

export function RoomPage({ roomId, token, me, navigate }: {
  roomId: Id<"rooms">;
  token: string;
  me: MeProfile;
  navigate: Navigate;
}) {
  const toast = useToast();
  const roomQuery = useQuery_experimental({
    query: api.rooms.getRoom,
    args: { sessionToken: token, roomId },
    throwOnError: false,
  });
  const room: RoomProfile | undefined = roomQuery.status === "success" ? roomQuery.data : undefined;
  const member = room !== undefined && room.yourSeatIndex !== undefined;

  const tableQuery = useQuery_experimental({
    query: api.game.getTableState,
    args: member ? { sessionToken: token, roomId } : "skip",
    throwOnError: false,
  });
  const table: TableState | undefined = tableQuery.status === "success" ? tableQuery.data : undefined;

  const joinRoom = useMutation(api.rooms.joinRoom);
  const sitDown = useMutation(api.rooms.sitDown);
  const standUp = useMutation(api.rooms.standUp);
  const toggleSitOut = useMutation(api.rooms.toggleSitOut);
  const topUp = useMutation(api.rooms.topUp);
  const leaveRoom = useMutation(api.rooms.leaveRoom);
  const startGame = useMutation(api.game.startGame);
  const endGame = useMutation(api.rooms.endGame);
  const closeRoom = useMutation(api.rooms.closeRoom);

  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [passphrase, setPassphrase] = useState("");
  const [joinError, setJoinError] = useState<string | undefined>(undefined);
  const autoJoined = useRef(false);
  const selfToggled = useRef(false);
  const wasSittingOut = useRef<boolean | undefined>(undefined);

  usePresence(token, member ? roomId : undefined);

  const ticking = table !== undefined && (table.turnDeadline !== undefined || table.nextHandAt !== undefined);
  const now = useNow(ticking, 250);

  // Tell the player when the server sat them out (e.g. after timing out).
  const sittingOutNow = room?.seats?.find((s) => s.userId === me.userId)?.state === "sittingOut";
  useEffect(() => {
    if (wasSittingOut.current === false && sittingOutNow && !selfToggled.current) {
      toast.push("You were sat out after running out of time. Press “I'm back” to keep playing.", "info");
    }
    wasSittingOut.current = sittingOutNow;
    selfToggled.current = false;
  }, [sittingOutNow, toast]);

  // Public table, not yet a member: join as a spectator right away.
  useEffect(() => {
    if (room === undefined) return;
    if (member) { autoJoined.current = true; return; }
    if (autoJoined.current) return;
    if (room.exists !== true || room.closed === true || room.requiresPassphrase === true) return;
    autoJoined.current = true;
    joinRoom({ sessionToken: token, roomId }).catch((e: unknown) => setJoinError(errorCopyFor(e)));
  }, [room, member, joinRoom, token, roomId]);

  async function run(label: string, call: () => Promise<unknown>, okCue?: string): Promise<boolean> {
    if (busy !== undefined) return false;
    setBusy(label);
    try {
      await call();
      if (okCue !== undefined) playCue(okCue);
      return true;
    } catch (e) {
      toast.push(errorCopyFor(e));
      playCue("deny");
      return false;
    } finally {
      setBusy(undefined);
    }
  }

  async function submitPassphrase(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (passphrase === "") return;
    setJoinError(undefined);
    setBusy("join");
    try {
      await joinRoom({ sessionToken: token, roomId, passphrase });
    } catch (err) {
      setJoinError(errorCodeOf(err) === "JOIN_DENIED" ? "Wrong passphrase (or the table is closed)." : errorCopyFor(err));
    } finally {
      setBusy(undefined);
    }
  }

  // ───────── gates ─────────
  if (roomQuery.status === "error") {
    return <RoomGone navigate={navigate} text="This table link doesn't look right." />;
  }
  if (room === undefined) {
    return <div className="center-screen"><div className="spinner" /><div className="muted">Opening the table…</div></div>;
  }
  if (room.exists !== true) {
    return <RoomGone navigate={navigate} text="This table doesn't exist." />;
  }
  if (room.closed === true) {
    return <RoomGone navigate={navigate} text="This table has closed." />;
  }
  if (room.requiresPassphrase === true && !member) {
    return (
      <div className="auth-wrap">
        <form className="panel panel-pad stack" onSubmit={(e) => void submitPassphrase(e)}>
          <h1 className="panel-title">🔒 Private table</h1>
          <p className="muted" style={{ margin: 0 }}>Enter the passphrase the host shared with you.</p>
          <input className="input" autoFocus type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} aria-label="Passphrase" />
          {joinError === undefined ? null : <div className="error-text" role="alert">{joinError}</div>}
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy !== undefined || passphrase === ""}>Join table</button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate("/lobby")}>Back to lobby</button>
          </div>
        </form>
      </div>
    );
  }
  if (!member) {
    return joinError === undefined
      ? <div className="center-screen"><div className="spinner" /><div className="muted">Taking you to the table…</div></div>
      : <RoomGone navigate={navigate} text={joinError} />;
  }

  // ───────── the table ─────────
  const heroSeat = room.yourSeatIndex !== undefined && room.yourSeatIndex >= 0 ? room.yourSeatIndex : undefined;
  const heroRoomSeat = room.seats?.find((s) => s.userId === me.userId);
  const heroTableSeat = table?.seats.find((s) => s.userId === me.userId);
  const sittingOut = heroRoomSeat?.state === "sittingOut";
  const isHost = room.isHost === true;
  const stage = table?.stage ?? "waiting";
  const live = stage !== "waiting" && stage !== "finished";
  const heroInHand = heroTableSeat !== undefined && heroTableSeat.inHand && live;
  const heroDealtIn = heroTableSeat !== undefined && (heroTableSeat.inHand || heroTableSeat.folded) && live;
  const stopping = room.stopAfterHand === true;
  const buyIn = room.buyIn ?? 0;
  const bigBlind = room.bigBlind ?? 0;
  const seatedPlayers = (room.seats ?? []).filter((s) => s.seatIndex >= 0 && s.state !== "left");
  const readyPlayers = seatedPlayers.filter((s) => s.state === "seated" && s.stack > 0);
  const actor = table?.seats.find((s) => s.isCurrentTurn);
  const canAfford = me.balance >= buyIn;

  async function sit(seatIndex: number): Promise<void> {
    await run("sit", () => sitDown({ sessionToken: token, roomId, seatIndex }), "action-call");
  }

  async function leave(): Promise<void> {
    if (heroInHand && !window.confirm("Leaving now folds your hand. Leave the table?")) return;
    const ok = await run("leave", () => leaveRoom({ sessionToken: token, roomId }));
    if (ok) navigate("/lobby");
  }

  async function stand(): Promise<void> {
    if (heroInHand && !window.confirm("Standing up now folds your hand. Stand up?")) return;
    await run("stand", () => standUp({ sessionToken: token, roomId }), "action-fold");
  }

  function copyLink(): void {
    const url = `${window.location.origin}/room/${roomId}`;
    navigator.clipboard.writeText(url).then(
      () => toast.push(room?.visibility === "private" ? "Link copied — share the passphrase too." : "Table link copied.", "success"),
      () => toast.push(url, "info"),
    );
  }

  // ───────── dock (the hero's area under the table) ─────────
  let dock;
  if (heroSeat === undefined) {
    dock = (
      <div className="dock-status">
        <span>👀 You're watching.</span>
        <span className="faint">
          {canAfford
            ? `Click an open chair to buy in for ${formatChips(buyIn)}.`
            : `You need ${formatChips(buyIn)} chips to sit here — you have ${formatChips(me.balance)}.`}
        </span>
      </div>
    );
  } else if (table !== undefined && table.yourTurn && table.legal !== undefined) {
    dock = (
      <ActionBar
        key={`${table.handNumber ?? 0}-${stage}-${table.legal.toCall}-${table.legal.minRaiseTo}-${table.legal.maxRaiseTo}`}
        legal={table.legal}
        roomId={roomId}
        sessionToken={token}
        myBet={heroTableSeat?.betStreet ?? 0}
        pot={potTotal(table)}
        bigBlind={bigBlind}
      />
    );
  } else {
    let status: string;
    let detail = "";
    if (sittingOut && !heroDealtIn) {
      status = "☕ You're sitting out.";
      detail = "You won't be dealt in until you come back.";
    } else if (live) {
      if (heroTableSeat?.folded === true) status = "You folded.";
      else if (heroTableSeat?.allIn === true) status = "You're all-in. 🤞";
      else if (!heroInHand) status = "You'll be dealt in next hand.";
      else status = "Waiting…";
      if (actor !== undefined) {
        detail = `${actor.username} is acting${table?.turnDeadline !== undefined ? ` · ${secondsLeft(table.turnDeadline, now)}s` : ""}`;
      } else {
        detail = "Dealing the rest of the board…";
      }
    } else if (stage === "finished") {
      status = "Hand complete.";
      detail = table?.nextHandAt !== undefined ? `Next hand in ${secondsLeft(table.nextHandAt, now)}s` : stopping ? "The host ended the game." : "";
    } else if (table?.nextHandAt !== undefined) {
      status = "Starting again…";
      detail = `Next hand in ${secondsLeft(table.nextHandAt, now)}s`;
    } else {
      status = readyPlayers.length < 2 ? "Waiting for more players." : isHost ? "Ready when you are." : `Waiting for ${room.hostUsername ?? "the host"} to deal.`;
      detail = readyPlayers.length < 2 ? "Share the table link to invite friends." : "";
    }
    const canStart = isHost && stage === "waiting" && room.status !== "playing" && table?.nextHandAt === undefined;
    if (stopping && live) detail = detail === "" ? "Last hand — the host is ending the game." : `${detail} · last hand`;
    dock = (
      <div className="dock-row">
        <div className="dock-status grow" aria-live="polite">
          <span>{status}</span>
          {detail === "" ? null : <span className="faint">{detail}</span>}
        </div>
        {canStart ? (
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={busy !== undefined || readyPlayers.length < 2}
            title={readyPlayers.length < 2 ? "Needs two seated players with chips" : undefined}
            onClick={() => void run("start", () => startGame({ sessionToken: token, roomId }))}
          >
            ▶ Deal
          </button>
        ) : null}
      </div>
    );
  }

  const heroStack = heroRoomSeat?.stack ?? 0;

  return (
    <div className="room">
      <TableSounds table={table} heroName={me.username} now={now} />
      <div>
        <div className="room-header">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate("/lobby")} aria-label="Back to lobby">← Lobby</button>
          <h1>{room.name}</h1>
          <div className="room-stats">
            {room.status === "playing" ? <span className="badge badge-live">Live</span> : <span className="badge">Waiting</span>}
            {room.visibility === "private" ? <span className="badge badge-lock">🔒 Private</span> : null}
            <span className="badge badge-gold">{formatChips(room.smallBlind ?? 0)}/{formatChips(bigBlind)}</span>
          </div>
          <span className="grow" />
          <button type="button" className="btn btn-sm" onClick={copyLink}>🔗 Invite</button>
          <button type="button" className="btn btn-sm btn-danger" disabled={busy !== undefined} onClick={() => void leave()}>Leave</button>
        </div>

        {tableQuery.status === "error" ? (
          <div className="empty-state">{errorCopyFor(tableQuery.error)}</div>
        ) : (
          <PokerTable
            room={room}
            table={table}
            heroSeat={heroSeat}
            heroName={me.username}
            now={now}
            onSit={heroSeat === undefined ? (i) => void sit(i) : undefined}
            sitBusy={busy !== undefined}
          />
        )}

        <div className="dock">
          {dock}
          {heroSeat !== undefined ? (
            <div className="hint-row" style={{ alignItems: "center" }}>
              <span>Stack <b className="nums" style={{ color: "var(--gold)" }}>{formatChips(heroStack)}</b></span>
              <span>Bankroll <b className="nums">{formatChips(me.balance)}</b></span>
              <span className="grow" />
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy !== undefined}
                onClick={() => { selfToggled.current = true; void run("sitout", () => toggleSitOut({ sessionToken: token, roomId, sittingOut: !sittingOut }), "click"); }}
              >
                {sittingOut ? "▶ I'm back" : "☕ Sit out"}
              </button>
              {heroStack < buyIn && me.balance > 0 ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy !== undefined || heroDealtIn}
                  title={heroDealtIn ? "Available once this hand is over" : undefined}
                  onClick={() => void run("topup", () => topUp({ sessionToken: token, roomId }), "action-call")}
                >
                  ＋ Top up to {formatChips(buyIn)}
                </button>
              ) : null}
              <button type="button" className="btn btn-sm" disabled={busy !== undefined} onClick={() => void stand()}>
                Stand up
              </button>
            </div>
          ) : null}
        </div>
        {heroSeat !== undefined && table?.yourTurn === true ? (
          <div className="hint-row"><span>Keys: <span className="kbd">F</span> fold · <span className="kbd">C</span> check/call · <span className="kbd">R</span> bet/raise · <span className="kbd">Shift+A</span> all-in</span></div>
        ) : null}
      </div>

      <aside className="side">
        <div className="panel">
          <ChatPanel roomId={roomId} sessionToken={token} me={me} />
        </div>
        <div className="panel stack">
          <h3 className="section-title" style={{ margin: 0 }}>Table</h3>
          <dl className="info-list">
            <dt>Blinds</dt><dd>{formatChips(room.smallBlind ?? 0)} / {formatChips(bigBlind)}</dd>
            <dt>Buy-in</dt><dd>{formatChips(buyIn)}</dd>
            <dt>Turn clock</dt><dd>{room.turnSeconds === 0 ? "off" : `${room.turnSeconds ?? 0}s`}</dd>
            <dt>Host</dt><dd>{room.hostUsername}{isHost ? " (you)" : ""}</dd>
          </dl>
          <PlayersList room={room} meId={me.userId} />
          {isHost ? <HostControls room={room} stage={stage} pendingRestart={table?.nextHandAt !== undefined && stage === "waiting"} busy={busy !== undefined} run={run} endGame={() => endGame({ sessionToken: token, roomId })} closeRoom={() => closeRoom({ sessionToken: token, roomId })} onClosed={() => navigate("/lobby")} /> : null}
        </div>
      </aside>
    </div>
  );
}

function PlayersList({ room, meId }: { room: RoomProfile; meId: Id<"users"> }) {
  const seats = [...(room.seats ?? [])].sort((a, b) => (a.seatIndex < 0 ? 99 : a.seatIndex) - (b.seatIndex < 0 ? 99 : b.seatIndex));
  return (
    <div className="players">
      {seats.map((s) => (
        <div key={s.userId} className="player-row">
          <span className={`dot${s.online ? " on" : ""}`} />
          <span className="grow">{s.username}{s.userId === meId ? " (you)" : ""}</span>
          <span className="faint nums">
            {s.seatIndex < 0 || s.state === "left" ? "watching" : s.state === "sittingOut" ? `away · ${formatChips(s.stack)}` : formatChips(s.stack)}
          </span>
        </div>
      ))}
    </div>
  );
}

function HostControls({ room, stage, pendingRestart, busy, run, endGame, closeRoom, onClosed }: {
  room: RoomProfile;
  stage: string;
  pendingRestart: boolean;
  busy: boolean;
  run: (label: string, call: () => Promise<unknown>, okCue?: string) => Promise<boolean>;
  endGame: () => Promise<unknown>;
  closeRoom: () => Promise<unknown>;
  onClosed: () => void;
}) {
  const playing = room.status === "playing" || pendingRestart;
  return (
    <div className="stack" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
      <h3 className="section-title" style={{ margin: 0 }}>Host controls</h3>
      <div className="row">
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy || !playing || room.stopAfterHand === true}
          title={playing ? "Stop after the current hand" : "No game running"}
          onClick={() => void run("end", endGame)}
        >
          {room.stopAfterHand === true ? "Ending after this hand" : "⏹ End game"}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          disabled={busy || (stage !== "finished" && stage !== "waiting")}
          title={stage !== "finished" && stage !== "waiting" ? "Available between hands" : undefined}
          onClick={() => {
            if (!window.confirm("Close this table for everyone? Seated players get their chips back.")) return;
            void run("close", closeRoom).then((ok) => { if (ok) onClosed(); });
          }}
        >
          Close table
        </button>
      </div>
      {playing && stage !== "finished" && stage !== "waiting" && room.stopAfterHand !== true ? (
        <span className="faint">Ending lets the current hand finish first.</span>
      ) : null}
    </div>
  );
}

function RoomGone({ navigate, text }: { navigate: Navigate; text: string }) {
  return (
    <div className="center-screen">
      <div style={{ fontSize: 44 }}>🚪</div>
      <div className="muted">{text}</div>
      <button type="button" className="btn btn-primary" onClick={() => navigate("/lobby")}>Back to the lobby</button>
    </div>
  );
}
