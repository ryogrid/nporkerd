// Display-only helpers — design/07 §4 (amounts, card labels) plus the
// presentational countdowns of 07 §2.4. Nothing here is authoritative: the
// server owns rules, these merely render what the projection already decided.
// Card encoding mirrors convex/game/cards.ts (04 §2) exactly.

export const RANK_CHARS = "23456789TJQKA";
export const SUIT_CHARS = "shdc";
export const SUIT_GLYPHS = ["♠", "♥", "♦", "♣"];

export function rankOf(card: number): number {
  return card % 13;
}

export function suitOf(card: number): number {
  return Math.floor(card / 13);
}

/** Rank glyph + suit glyph for a card ("A♠"); `back` renders the face-down card. */
export function cardLabel(card: number): string {
  return RANK_CHARS[rankOf(card)] + SUIT_GLYPHS[suitOf(card)];
}

export function isRedSuit(card: number): boolean {
  const suit = suitOf(card);
  return suit === 1 || suit === 2;
}

/** Thousands separators; chip values are always integers (07 §4). */
export function formatChips(amount: number): string {
  const whole = Math.trunc(amount);
  const grouped = whole.toLocaleString("en-US");
  return whole < 0 ? `−${grouped.replace("-", "")}` : grouped;
}

/** Street label shown at the table centre (04 §4 stage names). */
export function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    preflop: "Preflop",
    flop: "Flop",
    turn: "Turn",
    river: "River",
    showdown: "Showdown",
    finished: "Hand over",
    waiting: "Waiting",
  };
  return labels[stage] ?? stage;
}

/** One-line last-action ticker text, e.g. "raised to 400" (07 §2.4). */
export function actionLabel(kind: string, amount: number | undefined): string {
  switch (kind) {
    case "fold":
      return "folded";
    case "check":
      return "checked";
    case "call":
      return amount === undefined ? "called" : `called ${formatChips(amount)}`;
    case "raiseTo":
      return amount === undefined ? "raised" : `raised to ${formatChips(amount)}`;
    case "allIn":
      return amount === undefined ? "moved all-in" : `moved all-in to ${formatChips(amount)}`;
    case "timeout-check":
      return "timed out, checked";
    case "timeout-fold":
      return "timed out, folded";
    default:
      return kind;
  }
}

/** Countdown copy derived from a server deadline (never authoritative). */
export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function countdownLabel(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${seconds}s`;
}
