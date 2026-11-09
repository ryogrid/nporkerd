// A seat at the table (design/07 §2.4, §5): username, stack, state, dealer
// button, this street's bet in front of the player, and a turn highlight
// that is both a ring and a label. Folded seats are dimmed *and* labelled.
// Everything comes from `getTableState.seats[]` — this component never
// learns anything about hidden cards (00 §5).

import { CardPair } from "./CardView";
import { formatChips, actionLabel, countdownLabel } from "../lib/format";

export type SeatRow = {
  seatIndex: number;
  username: string;
  stack: number;
  betStreet: number;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  sittingOut: boolean;
  isDealer: boolean;
  isCurrentTurn: boolean;
  holeCards: number[] | undefined;
  lastAction: { kind: string; amount: number | undefined } | undefined;
  online: boolean;
  /** Whichever seat the viewer sits in (bigger face-up cards, accent border). */
  mine: boolean;
  /** Presentational countdown for this seat's turn (from `turnDeadline`). */
  turnRemainingMs: number | undefined;
  turnTotalMs: number | undefined;
  /** The projection's hand number: alternates the deal-in animation (07 §3). */
  handNumber: number | undefined;
  /** This seat appears in `lastHandResult.winners` (winner pulse + label). */
  isWinner: boolean;
};

/** The state sentence: colour is never the only signal (07 §5). */
function stateText(row: SeatRow): string {
  if (row.sittingOut) {
    return "sitting out";
  }
  if (row.folded) {
    return "folded";
  }
  if (row.allIn) {
    return "all-in";
  }
  if (!row.inHand) {
    return "not in this hand";
  }
  return "";
}

export function SeatView({ row }: { row: SeatRow }) {
  const classes = ["np-seat"];
  if (row.mine) {
    classes.push("you");
  }
  if (row.folded) {
    classes.push("folded");
  }
  if (row.isCurrentTurn) {
    classes.push("turn");
  }
  if (row.isWinner) {
    classes.push("winner");
  }
  const ringStyle = ringFor(row);
  return (
    <span className={classes.join(" ")}>
      <span className="np-seat-name">{row.username}</span>
      <span className="np-seat-stack">{formatChips(row.stack)}</span>
      {row.betStreet > 0 ? <span className="np-seat-bet">{formatChips(row.betStreet)}</span> : null}
      {stateText(row) === "" ? null : <span className="np-seat-state">{stateText(row)}</span>}
      {row.online ? null : <span className="np-seat-state">away</span>}
      {row.isCurrentTurn ? <span className="np-seat-turn">{turnText(row)}</span> : null}
      <CardPair cards={row.holeCards} mine={row.mine} revealed={shownAtShowdown(row)} hand={row.handNumber} />
      {shownAtShowdown(row) ? <span className="np-seat-state">shown at showdown</span> : null}
      {row.isWinner ? <span className="np-seat-state">wins this hand</span> : null}
      {row.isDealer ? <span className="np-dealerchip">D</span> : null}
      {ringStyle === undefined ? null : <span className="np-ring" style={ringStyle} />}
      {row.lastAction === undefined ? null : <span className="np-seat-state">{actionLabel(row.lastAction.kind, row.lastAction.amount)}</span>}
    </span>
  );
}

/**
 * The projection only hands an opponent's hole cards over when they were
 * revealed at showdown (00 §5), so "cards present and not mine" is exactly the
 * reveal — the client never infers anything hidden (07 §3).
 */
function shownAtShowdown(row: SeatRow): boolean {
  return row.holeCards !== undefined && !row.mine;
}

function turnText(row: SeatRow): string {
  return row.turnRemainingMs === undefined
    ? "to act"
    : `to act · ${countdownLabel(row.turnRemainingMs as number)}`;
}

/** Countdown ring: a conic bar over the seat, driven by the server deadline. */
function ringFor(row: SeatRow): Record<string, string> | undefined {
  if (row.turnRemainingMs === undefined || row.turnTotalMs === undefined || row.turnTotalMs <= 0) {
    return undefined;
  }
  const pct = Math.max(0, Math.min(100, Math.round((row.turnRemainingMs / row.turnTotalMs) * 100)));
  return {
    background: `conic-gradient(var(--accent) ${pct}%, rgba(255,255,255,.14) ${pct}% 100%)`,
  };
}
