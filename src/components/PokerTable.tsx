// The felt: seats around an oval (the viewer always sits at the bottom), bets
// in front of each seat, the dealer button, board + pot in the middle and a
// result banner when a hand completes. Everything is derived from the
// per-viewer projections; hidden cards are never known here.
import { CSSProperties } from "react";
import { Card } from "./Card";
import { ChipAmount } from "./Chips";
import { actionClass, actionLabel, formatChips, stageLabel } from "../lib/format";
import { RoomProfile, TableState } from "../lib/projection";

type TableSeat = TableState["seats"][number];

export type TableProps = {
  room: RoomProfile;
  table: TableState | undefined;
  /** The viewer's chair (≥ 0) or undefined when not seated. */
  heroSeat: number | undefined;
  heroName: string | undefined;
  now: number;
  /** Offer empty chairs as "sit here" buttons. */
  onSit?: (seatIndex: number) => void;
  sitBusy?: boolean;
};

/** Point on an ellipse for a chair, the viewer's chair at the bottom centre. */
function place(visual: number, total: number, rx: number, ry: number): { left: string; top: string } {
  const angle = Math.PI / 2 + (visual / total) * 2 * Math.PI;
  return {
    left: `${(50 + rx * Math.cos(angle)).toFixed(2)}%`,
    top: `${(50 + ry * Math.sin(angle)).toFixed(2)}%`,
  };
}

export function potTotal(table: TableState): number {
  if (table.totalPot !== undefined) return table.totalPot;
  return table.pots.reduce((acc, p) => acc + p.amount, 0) + table.seats.reduce((acc, s) => acc + s.betStreet, 0);
}

export function PokerTable({ room, table, heroSeat, heroName, now, onSit, sitBusy }: TableProps) {
  const total = Math.max(2, room.maxSeats ?? 9);
  const rotation = heroSeat === undefined ? 0 : heroSeat;
  const visualOf = (seatIndex: number) => (seatIndex - rotation + total) % total;

  const stage = table?.stage ?? "waiting";
  const finished = stage === "finished";
  const handNumber = table?.handNumber ?? 0;
  const live = stage !== "waiting" && stage !== "finished";

  const bySeat = new Map<number, TableSeat>();
  for (const s of table?.seats ?? []) bySeat.set(s.seatIndex, s);
  const roomBySeat = new Map<number, NonNullable<RoomProfile["seats"]>[number]>();
  for (const s of room.seats ?? []) if (s.seatIndex >= 0 && s.state !== "left") roomBySeat.set(s.seatIndex, s);

  const winners = finished ? table?.lastHandResult?.winners ?? [] : [];
  const winnerNames = new Set(winners.map((w) => w.username));
  const winnerLabel = new Map(winners.map((w) => [w.username, w.handRankLabel]));

  const turnTotalMs = (room.turnSeconds ?? 0) * 1000;
  const deadline = table?.turnDeadline;
  const remaining = deadline === undefined ? undefined : Math.max(0, deadline - now);

  // once a hand is complete the result banner shows the amounts instead
  const pot = table === undefined || stage === "waiting" || stage === "finished" ? 0 : potTotal(table);
  const dealerSeat = table?.dealerSeat;
  const sidePots = table !== undefined && stage !== "waiting" && table.pots.length > 1 ? table.pots : [];

  const chairs = [];
  for (let seatIndex = 0; seatIndex < total; seatIndex += 1) {
    const visual = visualOf(seatIndex);
    const anchor = place(visual, total, 46, 44);
    const seat = bySeat.get(seatIndex);
    const roomSeat = roomBySeat.get(seatIndex);

    if (seat === undefined && roomSeat === undefined) {
      chairs.push(
        <div key={`empty-${seatIndex}`} className="seat-anchor" style={anchor}>
          {onSit !== undefined ? (
            <button type="button" className="empty-seat" disabled={sitBusy === true} onClick={() => onSit(seatIndex)}>
              <span>SIT HERE<small>{formatChips(room.buyIn ?? 0)}</small></span>
            </button>
          ) : (
            <div className="empty-seat" aria-label={`seat ${seatIndex + 1} empty`}>
              <span style={{ opacity: 0.5 }}>OPEN</span>
            </div>
          )}
        </div>,
      );
      continue;
    }

    const username = seat?.username ?? roomSeat?.username ?? "";
    const stack = seat?.stack ?? roomSeat?.stack ?? 0;
    const sittingOut = roomSeat?.state === "sittingOut";
    const online = roomSeat?.online ?? true;
    const isHero = heroSeat !== undefined && seatIndex === heroSeat;
    const inHand = seat !== undefined && (seat.inHand || seat.folded);
    const isTurn = seat?.isCurrentTurn === true && live;
    const isWinner = winnerNames.has(username);
    const classes = ["seat"];
    if (isHero) classes.push("hero");
    if (isTurn) classes.push("turn");
    if (seat?.folded === true && stage !== "waiting") classes.push("folded");
    if (sittingOut || (!inHand && live)) classes.push("out");
    if (isWinner) classes.push("winner");

    // cards: own pair face up, opponents' backs while they are in the hand,
    // showdown-revealed pairs face up (the server only sends those)
    let cards = null;
    if (seat !== undefined && inHand && stage !== "waiting" && !(seat.folded && !isHero)) {
      const hole = seat.holeCards;
      const revealed = hole !== undefined && !isHero;
      const anim = revealed ? "flip" : "deal";
      const keyBase = `${handNumber}-${seatIndex}-${revealed ? "r" : "h"}`;
      cards = (
        <div className="seat-cards">
          <Card key={`${keyBase}-0`} card={hole?.[0]} anim={anim} delayMs={revealed ? 0 : visual * 60} />
          <Card key={`${keyBase}-1`} card={hole?.[1]} anim={anim} delayMs={revealed ? 120 : visual * 60 + total * 60} />
        </div>
      );
    } else {
      cards = <div className="seat-cards" />;
    }

    let tag = null;
    if (isWinner) tag = <span className="seat-tag win">Winner</span>;
    else if (isTurn) tag = <span className="seat-tag acting">{isHero ? "Your turn" : "Acting"}</span>;
    else if (seat?.allIn === true && stage !== "waiting") tag = <span className="seat-tag allin">All-in</span>;
    else if (sittingOut) tag = <span className="seat-tag">Sitting out</span>;
    else if (seat?.folded === true && stage !== "waiting") tag = <span className="seat-tag">Folded</span>;

    const pct = isTurn && remaining !== undefined && turnTotalMs > 0 ? Math.min(100, (remaining / turnTotalMs) * 100) : undefined;
    // lastAction survives into the next street; a chip-moving action with no
    // chips in front any more is from an earlier street, so don't show it
    const lastRaw = seat?.lastAction;
    const stale = lastRaw !== undefined && seat !== undefined && seat.betStreet === 0 &&
      (lastRaw.kind === "call" || lastRaw.kind === "raiseTo" || (lastRaw.kind === "allIn" && !seat.allIn));
    const last = stale ? undefined : lastRaw;

    chairs.push(
      <div key={`seat-${seatIndex}`} className="seat-anchor" style={anchor}>
        <div className={classes.join(" ")}>
          {cards}
          <div className="seat-plate">
            {tag}
            <span className={online ? "seat-online" : "seat-away"} title={online ? "online" : "away"} />
            <div className="seat-name">{isHero ? `${username} (you)` : username}</div>
            <div className="seat-stack">{formatChips(stack)}</div>
            {pct === undefined ? null : (
              <div className={`seat-timer${pct < 25 ? " low" : ""}`}><i style={{ width: `${pct}%` }} /></div>
            )}
          </div>
          {isWinner && winnerLabel.get(username) !== undefined && !/fold/i.test(winnerLabel.get(username) ?? "") ? (
            <div className="seat-hand">{winnerLabel.get(username)}</div>
          ) : last !== undefined && live ? (
            <div key={`${handNumber}-${last.kind}-${last.amount ?? 0}`} className={`seat-action ${actionClass(last.kind)}`}>
              {actionLabel(last.kind, last.amount)}
            </div>
          ) : null}
        </div>
      </div>,
    );

    if (seat !== undefined && seat.betStreet > 0 && live) {
      chairs.push(
        <div key={`bet-${seatIndex}`} className="bet-anchor" style={place(visual, total, 30, 25)}>
          <ChipAmount amount={seat.betStreet} />
        </div>,
      );
    }
  }

  let dealer = null;
  if (dealerSeat !== undefined && stage !== "waiting") {
    const visual = visualOf(dealerSeat);
    const angle = Math.PI / 2 + (visual / total) * 2 * Math.PI + 0.32;
    const style: CSSProperties = {
      left: `${(50 + 33 * Math.cos(angle)).toFixed(2)}%`,
      top: `${(50 + 30 * Math.sin(angle)).toFixed(2)}%`,
    };
    dealer = (
      <div className="bet-anchor dealer" style={style}>
        <div className="dealer-btn" title="Dealer">D</div>
      </div>
    );
  }

  const board = table?.board ?? [];
  const boardSlots = [];
  for (let i = 0; i < 5; i += 1) {
    const card = board[i];
    boardSlots.push(
      card === undefined ? (
        <div key={`slot-${i}`} className="board-slot" />
      ) : (
        <Card key={`b-${handNumber}-${card}`} card={card} anim="board" delayMs={i < 3 ? i * 130 : 0} />
      ),
    );
  }

  const heroWon = heroName !== undefined && winnerNames.has(heroName);

  return (
    <div className="table-zone">
      <div className="table">
        <div className="table-rail" />
        <div className="table-felt" />
        <div className="table-center">
          <div className="stage-label">
            {stageLabel(stage)}
            {handNumber > 0 && stage !== "waiting" ? ` · Hand #${handNumber}` : ""}
          </div>
          {stage === "waiting" ? (
            <div className="table-message">{waitingMessage(room, table)}</div>
          ) : (
            <div className="board">{boardSlots}</div>
          )}
          {pot > 0 ? (
            <div className="pot"><ChipAmount amount={pot} className="row" /><span className="pot-label">pot</span></div>
          ) : null}
          {sidePots.length > 0 ? (
            <div className="side-pots">
              {sidePots.map((p, i) => (
                <span key={i} className="badge">{i === 0 ? "Main" : `Side ${i}`} {formatChips(p.amount)}</span>
              ))}
            </div>
          ) : null}
        </div>
        {chairs}
        {dealer}
        {winners.length > 0 ? (
          <div key={`banner-${handNumber}`} className={`result-banner${heroWon ? " mine" : ""}`}>
            <div className="who">
              {winners.map((w) => (w.username === heroName ? "You" : w.username)).join(" & ")}
              {winners.length === 1 && winners[0].username === heroName ? " win" : winners.length > 1 ? " split" : " wins"}
            </div>
            <div className="what">
              {winners.map((w, i) => (
                <span key={i}>
                  {i > 0 ? " · " : ""}
                  {formatChips(w.amount)}
                  {w.handRankLabel === undefined ? "" : /fold/i.test(w.handRankLabel) ? " · everyone folded" : ` with ${w.handRankLabel}`}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function waitingMessage(room: RoomProfile, table: TableState | undefined): string {
  const ready = (room.seats ?? []).filter((s) => s.seatIndex >= 0 && s.state === "seated" && s.stack > 0).length;
  const seated = (table?.seats ?? []).length;
  if (seated === 0) return "Take a seat to play";
  if (ready < 2) return "Waiting for more players…";
  if (seated < 2) return seated === 0 ? "Take a seat to play" : "Waiting for another player…";
  return room.status === "playing" ? "Shuffling up…" : `Waiting for ${room.hostUsername ?? "the host"} to deal`;
}
