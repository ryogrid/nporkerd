// Cryptographic RNG for dealing — design/02 §8 helper table + design/04 §2.
// `crypto.getRandomValues` is available synchronously in the Convex edge
// runtime, Node, and browsers.
const TWO_POW_31 = 0x8000_0000;

/** Uniform integer in [0, maxExclusive) via rejection sampling (no modulo bias). */
export function randomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error(`randomInt: maxExclusive=${maxExclusive} must be a positive integer`);
  }
  if (maxExclusive >= TWO_POW_31) {
    throw new Error("randomInt: maxExclusive must be < 2^31");
  }
  const mask = (1 << (32 - Math.clz32(maxExclusive - 1))) - 1;
  let value: number;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0] & mask;
  } while (value >= maxExclusive);
  return value;
}

/** Fisher-Yates, using randomInt by default (shuffleInPlace(deck, randomInt)). */
export function shuffleInPlace<T>(items: T[], random: (maxExclusive: number) => number = randomInt): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = random(i + 1);
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
}
