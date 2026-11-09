/**
 * Pot construction and awarding (design 04, "Side pots and splits").
 *
 * Bands run from the chip contributions of the hand: the chips each player
 * actually put in are stacked in bands whose boundaries are those players'
 * totals; a band is winnable by non-folded players who covered it in full.
 * Bands are awarded independently; odd chips go to the first winner
 * clockwise from the dealer.
 */

export interface Share {
 /** The player to award the chips to. */
 userId: string;
 /** Whole chips awarded. */
 chips: number;
}

export interface Band {
 /** Upper boundary of the band in cumulative chips. */
 level: number;
 /** Total chips in the band. */
 amount: number;
 /** Chips each player contributed to this band. */
 contributions: Record<string, number>;
 /** Players who may win it. */
 eligible: string[];
}

interface Winner {
 userId: string;
 seatIndex: number;
}

interface Dealer {
 userId: string;
 seatIndex: number;
}

/** Number of seats at a table; distances wrap clockwise modulo this. */
export const SEATS = 10;

/** Position clockwise from the seat left of the reference (the dealer is last). */
function distanceAfter(seat: number, from: number): number {
 return (seat - from - 1 + SEATS) % SEATS;
}

/**
 * Build side-pot bands from the chips each player committed (design 04,
 * "Band reconstruction"): distinct contribution totals give the band
 * boundaries in ascending order; the chips of a band are the slice between
 * one boundary and the next, times the number of players who covered the
 * band. A band is winnable by the non-folded players who covered it.
 */
export function buildBands(contributed: Record<string, number>, folded: string[]): Band[] {
 const levels = Array.from(new Set(Object.values(contributed)))
  .filter((n) => n > 0)
  .sort((a, b) => a - b);
 const bands: Band[] = [];
 let prev = 0;
 for (const level of levels) {
  const width = level - prev;
  const covering = Object.keys(contributed).filter((u) => contributed[u] >= level);
  const amount = width * covering.length;
  const contributions: Record<string, number> = {};
  for (const u of covering) {
   contributions[u] = width;
  }
  const eligible = covering.filter((u) => !folded.includes(u));
  bands.push({ level, amount, contributions, eligible });
  prev = level;
 }
 return bands;
}

/**
 * Award one band to its winners (design 04, "Split pots" and "The odd-chip
 * rule"): evenly in whole chips; each leftover chip goes to the earliest
 * winner clockwise from the dealer.
 */
export function awardBand(amount: number, winners: Winner[], dealer: Dealer): { shares: Share[]; leftover: number } {
 if (winners.length === 0) {
  return { shares: [], leftover: amount };
 }
 const base = Math.trunc(amount / winners.length);
 const remainder = amount - base * winners.length;
 const ordered = [...winners].sort((a, b) => distanceAfter(a.seatIndex, dealer.seatIndex) - distanceAfter(b.seatIndex, dealer.seatIndex));
 const shares: Share[] = ordered.map((w) => ({ userId: w.userId, chips: base }));
 for (let i = 0; i < remainder; i += 1) {
  shares[i].chips += 1;
 }
 return { shares, leftover: 0 };
}

interface AwardInput {
 contributed: Record<string, number>;
 folded: string[];
 winners: Winner[];
 dealer: Dealer;
}

interface AwardResult {
 shares: Share[];
 unawardable: number;
}

/**
 * Reconstruct bands from contributions and award them to the given winners.
 * Chips in bands none of the winners covered stay unawardable (they remain
 * with the players who covered them, design 04: dead chips stay in their
 * band).
 */
export function awardContributions(input: AwardInput): AwardResult {
 const bands = buildBands(input.contributed, input.folded);
 const shares: Share[] = [];
 let unawardable = 0;
 for (const band of bands) {
  const winners = input.winners.filter((w) => band.eligible.includes(w.userId));
  if (winners.length === 0) {
   // no winner covered this band: each contributor gets their slice back
   // MKRrefund
   for (const entry of Object.entries(band.contributions)) {
    shares.push({ userId: entry[0], chips: entry[1] });
   }
   continue;
  }
  const awarded = awardBand(band.amount, winners, input.dealer);
  unawardable += awarded.leftover;
  for (const share of awarded.shares) {
   const existing = shares.find((s) => s.userId === share.userId);
   if (existing) {
    existing.chips += share.chips;
   } else {
    shares.push({ userId: share.userId, chips: share.chips });
   }
  }
 }
 return { shares, unawardable };
}
