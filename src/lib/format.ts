// Display-only helpers. Card encoding mirrors convex/game/cards.ts:
// card = suit * 13 + rank, rank 0 = "2" … 12 = "A", suits s h d c.

export const RANK_CHARS = "23456789TJQKA";
export const SUIT_GLYPHS = ["♠", "♥", "♦", "♣"];

export function rankOf(card: number): number {
  return card % 13;
}

export function suitOf(card: number): number {
  return Math.floor(card / 13);
}

export function rankText(card: number): string {
  const ch = RANK_CHARS[rankOf(card)];
  return ch === "T" ? "10" : ch;
}

export function suitGlyph(card: number): string {
  return SUIT_GLYPHS[suitOf(card)];
}

export function cardLabel(card: number): string {
  return rankText(card) + suitGlyph(card);
}

export function isRedSuit(card: number): boolean {
  const suit = suitOf(card);
  return suit === 1 || suit === 2;
}

export function formatChips(amount: number): string {
  const whole = Math.trunc(amount);
  const grouped = Math.abs(whole).toLocaleString("en-US");
  return whole < 0 ? `−${grouped}` : grouped;
}

export function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    preflop: "Pre-flop",
    flop: "Flop",
    turn: "Turn",
    river: "River",
    showdown: "Showdown",
    finished: "Hand complete",
    waiting: "Waiting for players",
  };
  return labels[stage] ?? stage;
}

export function actionLabel(kind: string, amount: number | undefined): string {
  switch (kind) {
    case "fold":
      return "Fold";
    case "check":
      return "Check";
    case "call":
      return amount === undefined ? "Call" : `Call ${formatChips(amount)}`;
    case "raiseTo":
      return amount === undefined ? "Raise" : `Raise ${formatChips(amount)}`;
    case "allIn":
      return "All-in";
    case "timeout-check":
      return "Check (time)";
    case "timeout-fold":
      return "Fold (time)";
    default:
      return kind;
  }
}

/** CSS modifier for an action chip. */
export function actionClass(kind: string): string {
  if (kind === "fold" || kind === "timeout-fold") return "fold";
  if (kind === "raiseTo") return "raise";
  if (kind === "allIn") return "allin";
  return "";
}

export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function timeOfDay(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
