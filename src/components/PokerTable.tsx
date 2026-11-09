// The table area (design/07 §2.4): elliptical felt, seats positioned around
// it (2–9), board + pots at the centre, the stage label and a one-line
// "last action" ticker. Cards come from the per-viewer projection only; hidden
// hands are never asked about (00 §5 / 07 §3).
import { SeatView, SeatRow } from "./SeatView";
import { CardView } from "./CardView";
import { formatChips, stageLabel, actionLabel } from "../lib/format";
import { TableState, RoomProfile } from "../lib/projection";

/** Evenly spaced seat anchors on the felt rim, index 0 at the top. */
function seatAnchor(seatIndex: number, totalSeats: number): { left: string; top: string } {
  const total = totalSeats < 2 ? 2 : totalSeats;
  const angle = (seatIndex / total) * 2 * Math.PI - Math.PI / 2;
  const x = 50 + 42 * Math.cos(angle);
  // seats sit lower at the front so the board stays readable in the middle
  const y = 50 + 41 * Math.sin(angle);
  return { left: `${x.toFixed(1)}%`, top: `${y.toFixed(1)}%` };
}

/** Room-level state (sitting out / presence) keyed by user, from `getRoom`. */
function stateById(room: RoomProfile | undefined): Record<string, { state: string; online: boolean }> {
  const out: Record<string, { state: string; online: boolean }> = {};
  if (room === undefined || room.seats === undefined) {
    return out;
  }
  for (const s of room.seats) {
    out[s.userId] = { state: s.state, online: s.online };
  }
  return out;
}

export function PokerTable({ room, table, yourSeatIndex }: {
  room: RoomProfile | undefined;
  table: TableState | undefined;
  yourSeatIndex: number | undefined;
}) {
  if (table === undefined) {
    return <div className="np-table np-muted">Loading the table…</div>;
  }
  const now = Date.now();
  const seatsState = stateById(room);
  const totalSeats = room === undefined ? table.seats.length : room.maxSeats ?? table.seats.length;
  const turnSeconds = room === undefined ? undefined : room.turnSeconds;
  const deadline = table.turnDeadline;

  const rows: SeatRow[] = [];
  const ticker: string[] = [];
  for (const seat of table.seats) {
    const extra = seatsState[seat.userId];
    const isTurn = seat.isCurrentTurn === true;
    const remaining = deadline === undefined || deadline === null ? undefined : deadline - now;
    rows.push({
      seatIndex: seat.seatIndex,
      username: seat.username,
      stack: seat.stack,
      betStreet: seat.betStreet,
      inHand: seat.inHand,
      folded: seat.folded,
      allIn: seat.allIn,
      sittingOut: extra !== undefined && extra.state === "sittingOut",
      isDealer: seat.isDealer,
      isCurrentTurn: isTurn,
      holeCards: seat.holeCards,
      lastAction: seat.lastAction === undefined || seat.lastAction === null
        ? undefined
        : { kind: seat.lastAction.kind, amount: seat.lastAction.amount },
      online: extra === undefined ? true : extra.online,
      mine: yourSeatIndex !== undefined && seat.seatIndex === yourSeatIndex,
      turnRemainingMs: isTurn ? remaining : undefined,
      turnTotalMs: isTurn && turnSeconds !== undefined && turnSeconds !== null && turnSeconds > 0
        ? turnSeconds * 1000
        : undefined,
    });
    if (seat.lastAction !== undefined && seat.lastAction !== null) {
      ticker.push(`${seat.username} ${actionLabel(seat.lastAction.kind, seat.lastAction.amount)}`);
    }
  }

  const pots = table.pots;
  const potTotal = pots.reduce((acc, p) => acc + p.amount, 0);

  return (
    <div className="np-table">
      <span className="np-felt" />
      {rows.map((row) => (
        <span className="np-seatanchor" style={anchorStyle(row.seatIndex, totalSeats)}>
          <SeatView row={row} />
        </span>
      ))}
      <span className="np-center">
        <span className="np-stage">{stageLabel(table.stage)}</span>
        <span className="np-boardrow">
          {table.board.map((card) => (
            <span key={card} className="np-cardslot-wide">
              <CardView card={card} />
            </span>
          ))}
        </span>
        <span className="np-pots">
          {pots.length === 0 && potTotal === 0 ? null : (
            <span className="np-pot">{formatChips(potTotal)}</span>
          )}
          {pots.length > 1 ? pots.map((p, i) => (
            <span key={i} className="np-pot">side {formatChips(p.amount)}</span>
          )) : null}
        </span>
      </span>
      {ticker.length === 0 ? null : <span className="np-ticker">{ticker[ticker.length - 1]}</span>}
      {table.handNumber === undefined || table.handNumber === null
        ? null
        : <span className="np-muted">hand #{table.handNumber}</span>}
      {table.lastHandResult === undefined || table.lastHandResult === null
        ? null
        : table.lastHandResult.winners.map((w, i) => (
            <span key={i} className="np-ticker">
              {w.username} wins {formatChips(w.amount)}
              {w.handRankLabel === undefined || w.handRankLabel === null ? null : ` · ${w.handRankLabel}`}
            </span>
          ))}
    </div>
  );
}

function anchorStyle(seatIndex: number, totalSeats: number): Record<string, string> {
  return seatAnchor(seatIndex, totalSeats);
}
