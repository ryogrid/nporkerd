// Evaluator test vectors — 04 §6 mandatory set: wheel, steel wheel, quads vs
// full house ordering, two-pair kicker, board-plays tie, flush tiebreak,
// full-house-over-full-house.
import { describe, it, expect } from "vitest";
import { evaluate, compare } from "./evaluator";

// "As" → ace of spades; encoding per 04 §2 (rank char then suit char).
function C(s: string): number {
  const rank = "23456789TJQKA".indexOf(s[0]);
  const suit = "shdc".indexOf(s[1]);
  if (rank < 0 || suit < 0) {
    throw new Error(`bad card ${s}`);
  }
  return suit * 13 + rank;
}

function hand(cards: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < cards.length; i += 2) {
    out.push(C(cards.slice(i, i + 2)));
  }
  return out;
}

describe("evaluator", () => {
  it("wheel A2345 is a straight, valued 5-high", async () => {
    const wheel = evaluate(hand("Ah2d3c4s5h"));
    expect(wheel.category).toBe(4);
    expect(wheel.tiebreak).toEqual([3]);
    expect(wheel.label).toBe("Straight, Five high");
    const sixHigh = evaluate(hand("2c3d4h5s6c"));
    expect(sixHigh.label).toBe("Straight, Six high");
    expect(compare(wheel, sixHigh)).toBe(-1);
    expect(compare(sixHigh, wheel)).toBe(1);
  });

  it("steel wheel: lowest straight flush, loses to six-high SF", async () => {
    const steelWheel = evaluate(hand("Ah2h3h4h5h"));
    expect(steelWheel.category).toBe(8);
    expect(steelWheel.tiebreak).toEqual([3]);
    const sixHighSF = evaluate(hand("2s3s4s5s6s"));
    expect(compare(steelWheel, sixHighSF)).toBe(-1);
    // and a wheel straight flush beats any quads
    const quads = evaluate(hand("9s9h9d9c2s"));
    expect(compare(steelWheel, quads)).toBe(1);
  });

  it("quads beat full house regardless of ranks", async () => {
    const nineQuad = evaluate(hand("9s9h9d9c2s"));
    const kingsOverTens = evaluate(hand("KsKhKdTdTc"));
    expect(nineQuad.category).toBe(7);
    expect(kingsOverTens.category).toBe(6);
    expect(kingsOverTens.label).toBe("Full House, Kings over Tens");
    expect(compare(nineQuad, kingsOverTens)).toBe(1);
  });

  it("two pair: higher kicker wins", async () => {
    const withThree = evaluate(hand("KsKhQsQd3c"));
    const withTwo = evaluate(hand("KsKhQsQd2c"));
    expect(withThree.label).toBe("Two Pair, Kings over Queens, Three");
    expect(compare(withThree, withTwo)).toBe(1);
  });

  it("board plays: two players with card-equivalent best hands split", async () => {
    const board = hand("2h3h7c8dJc");
    const a = evaluate([...board, C("Ad"), C("Kd")]);
    const b = evaluate([...board, C("Ac"), C("Kc")]);
    expect(a.category).toBe(0);
    expect(a.label).toBe("High Card, Ace");
    expect(compare(a, b)).toBe(0);
  });

  it("flush: same top four cards, fifth decides", async () => {
    const withAceThree = evaluate(hand("AsKsQsJs3s"));
    const withAceTwo = evaluate(hand("AsKsQsJs2s"));
    expect(withAceThree.label).toBe("Flush, Ace high");
    expect(compare(withAceThree, withAceTwo)).toBe(1);
  });

  it("full house over full house: trips rank first", async () => {
    const kingsOverTens = evaluate(hand("KsKhKdTdTc"));
    const queensOverJacks = evaluate(hand("QsQhQdJsJc"));
    expect(compare(kingsOverTens, queensOverJacks)).toBe(1);
    expect(queensOverJacks.label).toBe("Full House, Queens over Jacks");
  });

  it("best-of-seven: straight flush detected across 7 cards", async () => {
    const royalish = evaluate(hand("AsKsQsJsTs2h3d"));
    expect(royalish.category).toBe(8);
    expect(royalish.label).toBe("Straight Flush, Ace high");
    const quads7 = evaluate(hand("9s9h9d9c2s3d4h"));
    expect(royalish.category > quads7.category).toBe(true);
  });

  it("best-of-seven: A234567 straight is seven-high, not the wheel", async () => {
    const seven = evaluate(hand("Ah2d3c4s5h6s7d"));
    expect(seven.category).toBe(4);
    expect(seven.tiebreak).toEqual([5]);
    expect(seven.label).toBe("Straight, Seven high");
  });

  it("compare: reflexive equality and antisymmetry", async () => {
    const pair = evaluate(hand("QsQh2d5c9s"));
    expect(pair.label).toBe("One Pair, Queens");
    expect(compare(pair, pair)).toBe(0);
    const high = evaluate(hand("Ks9h5d4c2s"));
    expect(compare(pair, high)).toBe(1);
    expect(compare(high, pair)).toBe(-1);
  });
});
