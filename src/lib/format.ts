// Display-only helpers. Card encoding mirrors convex/game/cards.ts:
// card = suit * 13 + rank, rank 0 = "2" … 12 = "A", suits s h d c.
import { evaluate } from "../../convex/game/evaluator";
import { fill, getLang, Lang, Vars } from "../i18n/core";
import { roomMessages } from "../i18n/room";

type RoomKey = keyof typeof roomMessages.en;
function msg(lang: Lang, key: RoomKey, vars?: Vars): string {
  return fill(roomMessages[lang][key], vars);
}

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

const STAGE_KEYS = {
  preflop: "stagePreflop",
  flop: "stageFlop",
  turn: "stageTurn",
  river: "stageRiver",
  showdown: "stageShowdown",
  finished: "stageFinished",
  waiting: "stageWaiting",
} as const;

/** Street name in the given language (defaults to the current one). */
export function stageLabel(stage: string, lang: Lang = getLang()): string {
  const key = (STAGE_KEYS as Record<string, RoomKey | undefined>)[stage];
  return key === undefined ? stage : msg(lang, key);
}

/** Text for a seat's last-action chip, in the given language. */
export function actionLabel(kind: string, amount: number | undefined, lang: Lang = getLang()): string {
  const n = amount === undefined ? undefined : formatChips(amount);
  switch (kind) {
    case "fold":
      return msg(lang, "actFold");
    case "check":
      return msg(lang, "actCheck");
    case "call":
      return n === undefined ? msg(lang, "actCall") : msg(lang, "actCallN", { amount: n });
    case "raiseTo":
      return n === undefined ? msg(lang, "actRaise") : msg(lang, "actRaiseN", { amount: n });
    case "allIn":
      return msg(lang, "actAllIn");
    case "timeout-check":
      return msg(lang, "actTimeCheck");
    case "timeout-fold":
      return msg(lang, "actTimeFold");
    default:
      return kind;
  }
}

// ───────── hand names ─────────
// A hand value is the evaluator's (category, tiebreak): 8 straight flush …
// 0 high card, ranks 0 = "2" … 12 = "A". Names are rendered client-side in
// either language; the server's English winner labels are parsed back into
// a value so the result banner can be shown in Japanese too.

export type HandValue = { category: number; ranks: number[] };

const RANK_SINGLE_EN = ["Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Jack", "Queen", "King", "Ace"];
const RANK_PLURAL_EN = ["Twos", "Threes", "Fours", "Fives", "Sixes", "Sevens", "Eights", "Nines", "Tens", "Jacks", "Queens", "Kings", "Aces"];
const RANK_JA = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

/**
 * The hero's best hand from their own two hole cards plus the board. Pre-flop
 * (2 cards) a pocket pair is a pair, anything else is high card; with 5–7
 * cards it is the server's own evaluator. Only ever fed the viewer's cards.
 */
export function bestHandOf(hole: readonly number[], board: readonly number[]): HandValue | undefined {
  if (hole.length !== 2) return undefined;
  const cards = [...hole, ...board];
  if (cards.length === 2) {
    const a = rankOf(hole[0]);
    const b = rankOf(hole[1]);
    return a === b ? { category: 1, ranks: [a] } : { category: 0, ranks: [Math.max(a, b), Math.min(a, b)] };
  }
  if (cards.length < 5 || cards.length > 7) return undefined;
  const e = evaluate(cards);
  return { category: e.category, ranks: e.tiebreak };
}

/** Parse a server label (convex/game/evaluator.ts `labelFor`); "fold" for an uncontested win. */
export function parseHandLabel(label: string): HandValue | "fold" | undefined {
  if (/fold/i.test(label)) return "fold";
  const single = (w: string) => RANK_SINGLE_EN.indexOf(w);
  const plural = (w: string) => RANK_PLURAL_EN.indexOf(w);
  const tries: Array<[RegExp, number, (m: RegExpExecArray) => number[]]> = [
    [/^Straight Flush, (\w+) high/, 8, (m) => [single(m[1])]],
    [/^Four of a Kind, (\w+)/, 7, (m) => [plural(m[1])]],
    [/^Full House, (\w+) over (\w+)/, 6, (m) => [plural(m[1]), plural(m[2])]],
    [/^Flush, (\w+) high/, 5, (m) => [single(m[1])]],
    [/^Straight, (\w+) high/, 4, (m) => [single(m[1])]],
    [/^Three of a Kind, (\w+)/, 3, (m) => [plural(m[1])]],
    [/^Two Pair, (\w+) over (\w+)/, 2, (m) => [plural(m[1]), plural(m[2])]],
    [/^One Pair, (\w+)/, 1, (m) => [plural(m[1])]],
    [/^High Card, (\w+)/, 0, (m) => [single(m[1])]],
  ];
  for (const [re, category, ranks] of tries) {
    const m = re.exec(label);
    if (m !== null) {
      const r = ranks(m);
      return r.every((x) => x >= 0) ? { category, ranks: r } : undefined;
    }
  }
  return undefined;
}

/** "Pair of Kings" / 「Kのワンペア」. */
export function handName(value: HandValue, lang: Lang = getLang()): string {
  const r0 = value.ranks[0] ?? 0;
  const r1 = value.ranks[1] ?? 0;
  const vars = lang === "ja"
    ? { s0: RANK_JA[r0], p0: RANK_JA[r0], s1: RANK_JA[r1], p1: RANK_JA[r1] }
    : { s0: RANK_SINGLE_EN[r0], p0: RANK_PLURAL_EN[r0], s1: RANK_SINGLE_EN[r1], p1: RANK_PLURAL_EN[r1] };
  if (value.category === 8 && r0 === 12) return msg(lang, "handRoyal");
  const key = (["hand0", "hand1", "hand2", "hand3", "hand4", "hand5", "hand6", "hand7", "hand8"] as const)[value.category];
  return key === undefined ? "" : msg(lang, key, vars);
}

/** A server winner label in the given language (unknown shapes pass through). */
export function localizeHandLabel(label: string, lang: Lang = getLang()): string {
  const parsed = parseHandLabel(label);
  if (parsed === undefined) return label;
  if (parsed === "fold") return label;
  return handName(parsed, lang);
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
