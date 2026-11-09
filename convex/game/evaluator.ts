// Hand evaluator — design/04 §6. PURE TypeScript (no Convex imports).
// evaluate(cards) for 5–7 cards → { category, tiebreak, label }:
//   categories: 8 straight flush … 0 high card. For 6/7 cards the max over
//   all 5-card subsets under lexicographic (category, tiebreak) — 21 subsets
//   for 7, cheap enough and provably correct. Wheel (A-2-3-4-5) is 5-high.

import { rankOf, suitOf } from "./cards";

interface HandEval {
  category: number;
  tiebreak: number[];
  label: string;
}

const RANK_SINGLE = [
  "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Jack", "Queen", "King", "Ace",
];
const RANK_PLURAL = [
  "Twos", "Threes", "Fours", "Fives", "Sixes", "Sevens", "Eights", "Nines",
  "Tens", "Jacks", "Queens", "Kings", "Aces",
];

/** Highest straight top-rank in a 13-bit presence mask; wheel ⇒ 5-high (3). */
function straightTop(mask: number): number {
  for (let top = 12; top >= 4; top--) {
    if (((mask >> (top - 4)) & 31) === 31) {
      return top;
    }
  }
  if ((mask & 15) === 15 && (mask & (1 << 12)) !== 0) {
    return 3; // A-2-3-4-5 valued as 5-high
  }
  return -1;
}

function labelFor(category: number, tiebreak: number[]): string {
  switch (category) {
    case 8:
      return `Straight Flush, ${RANK_SINGLE[tiebreak[0]]} high`;
    case 7:
      return `Four of a Kind, ${RANK_PLURAL[tiebreak[0]]}`;
    case 6:
      return `Full House, ${RANK_PLURAL[tiebreak[0]]} over ${RANK_PLURAL[tiebreak[1]]}`;
    case 5:
      return `Flush, ${RANK_SINGLE[tiebreak[0]]} high`;
    case 4:
      return `Straight, ${RANK_SINGLE[tiebreak[0]]} high`;
    case 3:
      return `Three of a Kind, ${RANK_PLURAL[tiebreak[0]]}`;
    case 2: {
      const kicker = tiebreak.length > 2 ? `, ${RANK_SINGLE[tiebreak[2]]}` : "";
      return `Two Pair, ${RANK_PLURAL[tiebreak[0]]} over ${RANK_PLURAL[tiebreak[1]]}${kicker}`;
    }
    case 1:
      return `One Pair, ${RANK_PLURAL[tiebreak[0]]}`;
    default:
      return `High Card, ${RANK_SINGLE[tiebreak[0]]}`;
  }
}

function mk(category: number, tiebreak: number[]): HandEval {
  return { category, tiebreak, label: labelFor(category, tiebreak) };
}

/** Evaluate exactly five cards. */
function evaluate5(cards: number[]): HandEval {
  const rankCount = new Array<number>(13).fill(0);
  const suitCount = new Array<number>(4).fill(0);
  const suitMask = new Array<number>(4).fill(0);
  let rankMask = 0;
  for (const card of cards) {
    const rank = rankOf(card);
    const suit = suitOf(card);
    rankCount[rank]++;
    suitCount[suit]++;
    suitMask[suit] |= 1 << rank;
    rankMask |= 1 << rank;
  }
  const ranksDesc: number[] = [];
  for (let rank = 12; rank >= 0; rank--) {
    if (rankCount[rank] > 0) {
      ranksDesc.push(rank);
    }
  }
  const flushSuit = suitCount.findIndex((n) => n === 5);

  if (flushSuit >= 0) {
    const sfTop = straightTop(suitMask[flushSuit]);
    if (sfTop >= 0) {
      return mk(8, [sfTop]);
    }
    const flushRanks = ranksOfSuit(rankCount, suitMask[flushSuit]);
    return mk(5, flushRanks);
  }

  const quads = ranksOfCount(rankCount, 4);
  if (quads.length > 0) {
    const quad = quads[0];
    const kicker = ranksDesc.find((r) => r !== quad) ?? 0;
    return mk(7, [quad, kicker]);
  }

  const trips = ranksOfCount(rankCount, 3); // descending
  const pairRanks = ranksOfCount(rankCount, 2);
  if (trips.length > 0) {
    const tripsRank = trips[0];
    const pair = pairRanks.find((r) => r !== tripsRank);
    if (pair !== undefined && pair !== null) {
      return mk(6, [tripsRank, pair]);
    }
    return mk(3, [tripsRank]);
  }

  const straight = straightTop(rankMask);
  if (straight >= 0) {
    return mk(4, [straight]);
  }

  if (pairRanks.length === 2) {
    const [hi, lo] = pairRanks; // descending by construction
    const kicker = ranksDesc.find((r) => r !== hi && r !== lo) ?? 0;
    return mk(2, [hi, lo, kicker]);
  }
  if (pairRanks.length === 1) {
    const pair = pairRanks[0];
    const kickers = ranksDesc.filter((r) => r !== pair);
    return mk(1, [pair, ...kickers]);
  }
  return mk(0, ranksDesc);
}

function ranksOfCount(rankCount: number[], exact: number): number[] {
  const out: number[] = [];
  for (let rank = 12; rank >= 0; rank--) {
    if (rankCount[rank] >= exact) {
      out.push(rank);
    }
  }
  return out;
}

/** Ranks present in a flush suit mask, descending. */
function ranksOfSuit(_rankCount: number[], mask: number): number[] {
  const out: number[] = [];
  for (let rank = 12; rank >= 0; rank--) {
    if ((mask & (1 << rank)) !== 0) {
      out.push(rank);
    }
  }
  return out;
}

/** lexicographic (category, tiebreak): -1/0/1 — 04 §6. */
export function compare(a: HandEval, b: HandEval): number {
  if (a.category !== b.category) {
    return a.category < b.category ? -1 : 1;
  }
  const n = Math.min(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < n; i++) {
    if (a.tiebreak[i] !== b.tiebreak[i]) {
      return a.tiebreak[i] < b.tiebreak[i] ? -1 : 1;
    }
  }
  if (a.tiebreak.length !== b.tiebreak.length) {
    return a.tiebreak.length < b.tiebreak.length ? -1 : 1;
  }
  return 0;
}

export function evaluate(cards: number[]): HandEval {
  if (cards.length === 5) {
    return evaluate5(cards);
  }
  if (cards.length !== 6 && cards.length !== 7) {
    throw new Error(`evaluate: expected 5–7 cards, got ${cards.length}`);
  }
  let best: HandEval | null = null;
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      for (let k = j + 1; k < cards.length; k++) {
        for (let l = k + 1; l < cards.length; l++) {
          for (let m = l + 1; m < cards.length; m++) {
            const e = evaluate5([cards[i], cards[j], cards[k], cards[l], cards[m]]);
            if (best === null || compare(e, best) > 0) {
              best = e;
            }
          }
        }
      }
    }
  }
  if (best === null) {
    throw new Error("evaluate: no 5-subset enumerated");
  }
  return best;
}
