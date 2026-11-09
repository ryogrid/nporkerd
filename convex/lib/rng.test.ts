import { describe, it, expect } from "vitest";
import { randomInt, shuffleInPlace } from "./rng";

describe("randomInt", () => {
  it("rejects bad arguments", () => {
    expect(() => randomInt(0)).toThrow(/positive integer/);
    expect(() => randomInt(-3)).toThrow(/positive integer/);
    expect(() => randomInt(2.5)).toThrow(/positive integer/);
    expect(() => randomInt(2 ** 31)).toThrow(/2\^31/);
  });

  it("stays within [0, maxExclusive)", () => {
    for (let i = 0; i < 20000; i++) {
      const v = randomInt(52);
      expect(v >= 0 && v < 52).toBe(true);
    }
  });

  it("hits every bucket of a small range quickly (rejection sampling is total)", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 20000; i++) seen.add(randomInt(6));
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("shuffleInPlace", () => {
  it("produces a permutation using the default crypto source", () => {
    const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const shuffled = [...original];
    shuffleInPlace(shuffled);
    expect(shuffled.length).toBe(original.length);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(original);
  });

  it("accepts an injected source; always-max is the identity", () => {
    const alwaysMax = (n: number) => n - 1;
    const shuffled = [1, 2, 3, 4, 5];
    shuffleInPlace(shuffled, alwaysMax);
    expect(shuffled).toEqual([1, 2, 3, 4, 5]);
  });

  it("always-zero source produces the known rotation", () => {
    const shuffled = [1, 2, 3, 4, 5];
    shuffleInPlace(shuffled, () => 0);
    expect(shuffled).toEqual([2, 3, 4, 5, 1]);
  });
});
