// Cards and deck — design/04 §2. PURE TypeScript: this module (and every
// other convex/game/*.ts) must never import Convex APIs (Phase 4 acceptance
// greps the imports). A card is an integer 0–51:
//   rank = card % 13   (0=2, 1=3, …, 8=10, 9=J, 10=Q, 11=K, 12=A)
//   suit = floor(card / 13)  (0=spades, 1=hearts, 2=diamonds, 3=clubs)
// so 51 → rank 12 (A), suit 3 (clubs) → "Ac".

export const RANK_CHARS = "23456789TJQKA";
export const SUIT_CHARS = "shdc";

export function rankOf(card: number): number {
  return card % 13;
}

export function suitOf(card: number): number {
  return Math.floor(card / 13);
}

export function cardToString(card: number): string {
  return RANK_CHARS[rankOf(card)] + SUIT_CHARS[suitOf(card)];
}

/** Ordered fresh deck [0..51] (04 §2). */
export function createDeck(): number[] {
  const deck: number[] = [];
  for (let card = 0; card < 52; card++) {
    deck.push(card);
  }
  return deck;
}

export type RandomInt = (maxExclusive: number) => number;

/**
 * Fisher–Yates drawn from the end (04 §2), using the injected RNG.
 * Returns a shuffled copy; production injects `lib/rng.randomInt`,
 * tests inject a seeded PRNG.
 */
export function shuffle(deck: number[], randomInt: RandomInt): number[] {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
