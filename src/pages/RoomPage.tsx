// /room/:roomId — design/07 §2.4 (+ 03 §5 for the passphrase gate). One
// reactive query drives the table (`game.getTableState`), `rooms.getRoom`
// supplies room metadata/membership/host powers (07 §3), chat is its own
// query (06 §2). Private rooms show only a passphrase prompt to non-members:
// the projection literally has no other room data for them (05 §7), so this
// page cannot leak anything either. Join → pick a seat → sit down are
// separate explicit steps (07 §2.4: "no surprise chip movement").
import { useRef, useState } from "react";
import { useMutation, useQuery_experimental } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ActionBar } from "../components/ActionBar";
import { ChatPanel } from "../components/ChatPanel";
import { PokerTable } from "../components/PokerTable";
import { SoundControl } from "../components/SoundControl";
import { SoundCue } from "../components/SoundCue";
import { errorCopyFor } from "../lib/errorCopy";
import { formatChips, countdownLabel, secondsLeft } from "../lib/format";
import { RoomProfile, TableState } from "../lib/projection";
import { MeProfile, PresenceTicker } from "../lib/auth";
import { Id } from "../../convex/_generated/dataModel";
import { NEXT_HAND_DELAY_MS } from "../../convex/lib/constants";

export function RoomPage({ roomId, token, me, navigate }: {
  roomId: Id<"rooms">;
  token: string;
  /** The signed-in profile (labels the optimistic chat row only). */
  me: MeProfile | undefined;
  navigate: (path: string) => void;
}) {
  const roomQuery = useQuery_experimental({
    query: api.rooms.getRoom,
    args: { sessionToken: token, roomId },
    throwOnError: false,
  });
  const [joined, setJoined] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const passphraseField = useRef<HTMLInputElement>(null);

  const joinRoom = useMutation(api.rooms.joinRoom);
  const sitDown = useMutation(api.rooms.sitDown);
  const standUp = useMutation(api.rooms.standUp);
  const toggleSitOut = useMutation(api.rooms.toggleSitOut);
  const topUp = useMutation(api.rooms.topUp);
  const leaveRoom = useMutation(api.rooms.leaveRoom);
  const startGame = useMutation(api.game.startGame);
  const endGame = useMutation(api.rooms.endGame);
  const closeRoom = useMutation(api.rooms.closeRoom);

  const room: RoomProfile | undefined = roomQuery.status === "success" ? roomQuery.data : undefined;
  // 05 §3: membership ⇔ a seat document for (room, user); `getRoom` only sets
  // `yourSeatIndex` for members.
  const member = room !== undefined && room.yourSeatIndex !== undefined && room.yourSeatIndex !== null;

  // The table query runs only for members (non-members would get NOT_A_MEMBER,
  // and 05 §7 says they see no table state at all).
  const tableQuery = useQuery_experimental({
    query: api.game.getTableState,
    args: member || joined ? { sessionToken: token, roomId } : "skip",
    throwOnError: false,
  });
  const table: TableState | undefined = tableQuery.status === "success" ? tableQuery.data : undefined;

  async function run(label: string, call: () => Promise<unknown>): Promise<void> {
    setNotice(undefined);
    try {
      await call();
    } catch (e) {
      setNotice(`${label}: ${errorCopyFor(e)}`);
    }
  }

  async function doJoin(): Promise<void> {
    const passphrase = passphraseField.current?.value;
    if (passphrase === undefined || passphrase === "") {
      await run("joining", () => joinRoom({ sessionToken: token, roomId }));
    } else {
      await run("joining", () => joinRoom({ sessionToken: token, roomId, passphrase }));
    }
    setJoined(true);
  }

  async function doSitDown(seatIndex: number): Promise<void> {
    await run("sitting down", () => sitDown({ sessionToken: token, roomId, seatIndex }));
  }

  async function doStandUp(): Promise<void> {
    await run("standing up", () => standUp({ sessionToken: token, roomId }));
  }

  async function doToggleSitOut(sittingOut: boolean): Promise<void> {
    await run("changing seat state", () => toggleSitOut({ sessionToken: token, roomId, sittingOut }));
  }

  async function doTopUp(): Promise<void> {
    await run("topping up", () => topUp({ sessionToken: token, roomId }));
  }

  async function doLeave(): Promise<void> {
    await run("leaving", () => leaveRoom({ sessionToken: token, roomId }));
    navigate("/lobby");
  }

  async function doStartGame(): Promise<void> {
    await run("starting", () => startGame({ sessionToken: token, roomId }));
  }

  async function doEndGame(): Promise<void> {
    await run("ending the game", () => endGame({ sessionToken: token, roomId }));
  }

  async function doCloseRoom(): Promise<void> {
    await run("closing", () => closeRoom({ sessionToken: token, roomId }));
  }

  if (roomQuery.status === "error") {
    return <div className="np-page np-error">{errorCopyFor(roomQuery.error)}</div>;
  }
  if (roomQuery.status === "pending") {
    return <div className="np-page np-muted">opening the room…</div>;
  }
  if (room === undefined) {
    return <div className="np-page np-muted">this room no longer exists</div>;
  }
  if (room.closed === true) {
    // 05 §7: a closed room is redacted to everyone; 06 §2 keeps its chat.
    return (
      <div className="np-page">
        <div className="np-error">{errorCopyFor({ code: "ROOM_CLOSED", data: null })}</div>
        <div className="np-muted">its hand history and chat stay in the server, just not reachable</div>
      </div>
    );
  }

  // Private room, non-member: passphrase prompt only (05 §7 — even the name is
  // not in this projection).
  if (room.requiresPassphrase === true && !member && !joined) {
    return (
      <div className="np-page">
        <div className="np-card">
          <h2 className="np-title">This table is private</h2>
          <div className="np-muted">
            nothing about it is visible until you prove the passphrase — the link
            locates the table, the passphrase lets you in (05 §2).
          </div>
          <div className="np-field">
            <label>Passphrase</label>
            <input ref={passphraseField} type="text" />
          </div>
          {notice === undefined ? null : <div className="np-error">{notice}</div>}
          <button type="button" onClick={() => void doJoin()}>Join</button>
        </div>
      </div>
    );
  }

  // Public room, non-member: summary + join (no passphrase), no chat (05 §7).
  if (!member && !joined) {
    const freeSeats = seatsAvailable(room);
    return (
      <div className="np-page">
        <div className="np-card">
          <h2 className="np-title">{room.name}</h2>
          <div className="np-muted">
            host {room.hostUsername} · seats {seatedCount(room)}/{room.maxSeats} · blinds {room.smallBlind}/{room.bigBlind} · buy-in {formatChips(room.buyIn ?? 0)} · clock {room.turnSeconds}s · status {room.status}
          </div>
          {notice === undefined ? null : <div className="np-error">{notice}</div>}
          <button type="button" onClick={() => void doJoin()}>Join this table</button>
          <button type="button" onClick={() => void doLeave()}>Back to the lobby</button>
          <div className="np-muted">
            {freeSeats.map((index) => (
              <button key={index} type="button" onClick={() => void doSitDown(index)}>
                join and sit at seat {index}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const freeSeats = seatsAvailable(room);
  const atTable = room.yourSeatIndex !== undefined && room.yourSeatIndex !== null && room.yourSeatIndex >= 0;
  const handOver = table !== undefined && (table.stage === "finished" || table.stage === "waiting");
  const nextHandAt = table === undefined || table.nextHandAt === undefined || table.nextHandAt === null
    ? undefined
    : table.nextHandAt;
  const isHost = room.isHost === true;
  // Phase 10 audio: one cue per stage transition, keyed (token) by stage **and**
  // hand number so each new hand gets its own deal cue. Everything is derived
  // from the projection — the page keeps no game state of its own (07 §3).
  const stageName = table === undefined ? "" : table.stage;
  const handNo = table === undefined || table.handNumber === undefined || table.handNumber === null
    ? 0
    : table.handNumber;

  return (
    <div className="np-page">
      <div className="np-room-grid">
        <div className="np-panel">
          <h2 className="np-title">{room.name}</h2>
          <PokerTable room={room} table={table} yourSeatIndex={room.yourSeatIndex} />
          <SoundCue cue={audioCue(stageName)} token={`${stageName}:${handNo}`} />
          {table !== undefined && table.yourTurn === true ? (
            <ActionBar legal={table.legal} roomId={roomId} sessionToken={token} />
          ) : (
            <div className="np-muted">{table === undefined ? "loading the table…" : "waiting for the other players"}</div>
          )}
        </div>
        <div className="np-panel">
          <ChatPanel roomId={roomId} sessionToken={token} me={me} />
        </div>
      </div>

      <div className="np-card">
        <h2 className="np-title">Between hands</h2>
        <div className="np-muted">
          {nextHandAt === undefined
            ? handOver && table !== undefined && room.status === "playing"
              ? `next hand in ${countdownLabel(NEXT_HAND_DELAY_MS)}`
              : "the host starts the next game when the table is waiting"
            : `next hand in ${secondsLeft(nextHandAt, Date.now())}s`}
        </div>
        {notice === undefined ? null : <div className="np-error">{notice}</div>}
        <div className="np-actions">
          {atTable ? (
            <button type="button" onClick={() => void doStandUp()}>Stand up</button>
          ) : freeSeats.length === 0 ? null : (
            freeSeats.map((index) => (
              <button key={index} type="button" onClick={() => void doSitDown(index)}>
                Sit down at seat {index} (buy-in {formatChips(room.buyIn ?? 0)})
              </button>
            ))
          )}
          {atTable ? (
            <button
              type="button"
              onClick={() => void doToggleSitOut(!isSittingOut(room))}
            >
              {isSittingOut(room) ? "Come back to the table" : "Sit out (keep my seat)"}
            </button>
          ) : null}
          {atTable ? <button type="button" onClick={() => void doTopUp()}>Top up to the buy-in</button> : null}
          <button type="button" onClick={() => void doLeave()}>Leave room</button>
          {isHost ? <button type="button" onClick={() => void doStartGame()}>Start game</button> : null}
          {isHost ? <button type="button" onClick={() => void doEndGame()}>End game</button> : null}
          {isHost ? <button type="button" onClick={() => void doCloseRoom()}>Close room</button> : null}
        </div>
        <SoundControl />
        <PresenceTicker token={token} roomId={roomId} />
      </div>
    </div>
  );
}

/**
 * Which synthesized cue (see `src/lib/sound.ts`) matches a stage. Unknown or
 * `waiting` means nothing to play.
 */
function audioCue(stage: string): string | undefined {
  if (stage === "preflop") {
    return "deal";
  }
  if (stage === "flop" || stage === "turn" || stage === "river" || stage === "showdown") {
    return stage;
  }
  if (stage === "finished") {
    return "hand-over";
  }
  return undefined;
}

/** Free seat indices from `getRoom.seats` (05 §3: `seatIndex -1` = unseated). */
function seatsAvailable(room: RoomProfile | undefined): number[] {
  if (room === undefined || room.maxSeats === undefined || room.maxSeats === null) {
    return [];
  }
  const taken: number[] = [];
  if (room.seats !== undefined) {
    for (const s of room.seats) {
      if (s.seatIndex >= 0) {
        taken.push(s.seatIndex);
      }
    }
  }
  const free: number[] = [];
  for (let index = 0; index < room.maxSeats; index += 1) {
    if (!taken.includes(index)) {
      free.push(index);
    }
  }
  return free;
}

function seatedCount(room: RoomProfile | undefined): number {
  if (room === undefined || room.seats === undefined) {
    return 0;
  }
  return room.seats.filter((s) => s.seatIndex >= 0 && s.state === "seated").length;
}

function isSittingOut(room: RoomProfile | undefined): boolean {
  if (room === undefined || room.seats === undefined || room.yourSeatIndex === undefined || room.yourSeatIndex === null) {
    return false;
  }
  const mine = room.seats.find((s) => s.seatIndex === room.yourSeatIndex);
  return mine !== undefined && mine.state === "sittingOut";
}
