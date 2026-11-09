import { describe, it, expect } from "vitest";
import { buildBands, awardBand, awardContributions } from "./pots";

function contrib(pairs: Array<[string, number]>): Record<string, number> {
 const map: Record<string, number> = {};
 for (const [u, n] of pairs) {
  map[u] = n;
 }
 return map;
}

function sharePairs(shares: { userId: string; chips: number }[]) {
 return shares.map((s) => [s.userId, s.chips]);
}

describe("buildBands", () => {
 it("three-way all-in at different stack sizes makes three bands", () => {
  const bands = buildBands(contrib([["a", 100], ["b", 150], ["c", 200]]), []);
  expect(bands.map((b) => [b.level, b.amount])).toEqual([[100, 300], [150, 100], [200, 50]]);
  expect(bands[0].contributions).toEqual({ a: 100, b: 100, c: 100 });
  expect(bands[0].eligible).toEqual(["a", "b", "c"]);
  expect(bands[2].eligible).toEqual(["c"]);
 });

 it("equal commitments make a single main pot", () => {
  const bands = buildBands(contrib([["a", 100], ["b", 100]]), []);
  expect(bands.map((b) => [b.level, b.amount])).toEqual([[100, 200]]);
 });

 it("folded players contribute to bands but cannot win them", () => {
  const bands = buildBands(contrib([["a", 100], ["b", 50], ["c", 50]]), ["b"]);
  expect(bands.map((b) => [b.level, b.amount, b.eligible])).toEqual([[50, 150, ["a", "c"]], [100, 50, ["a"]]]);
 });

 it("no contributions means no bands", () => {
  expect(buildBands(contrib([["a", 0]]), [])).toEqual([]);
 });
});

describe("awardBand", () => {
 it("split pot with odd chip goes to the first winner after the dealer", () => {
  const dealer = { userId: "d", seatIndex: 0 };
  const winners = [{ userId: "c", seatIndex: 5 }, { userId: "b", seatIndex: 2 }, { userId: "a", seatIndex: 8 }];
  const awarded = awardBand(100, winners, dealer);
  expect(sharePairs(awarded.shares)).toEqual([["b", 34], ["c", 33], ["a", 33]]);
  expect(awarded.leftover).toBe(0);
 });

 it("dealer's own seat is the last position clockwise", () => {
  const dealer = { userId: "d", seatIndex: 0 };
  const winners = [{ userId: "a", seatIndex: 0 }, { userId: "b", seatIndex: 9 }];
  const awarded = awardBand(11, winners, dealer);
  expect(sharePairs(awarded.shares)).toEqual([["b", 6], ["a", 5]]);
 });

 it("an uncontestable band stays unawardable", () => {
  const awarded = awardBand(50, [], { userId: "d", seatIndex: 0 });
  expect(awarded.shares).toEqual([]);
  expect(awarded.leftover).toBe(50);
 });
});

describe("awardContributions", () => {
 it("three-way all-in: the short all-in loser forfeits only its own band", () => {
  const result = awardContributions({
   contributed: contrib([["a", 100], ["b", 150], ["c", 200]]),
   folded: [],
   winners: [{ userId: "b", seatIndex: 1 }],
   dealer: { userId: "d", seatIndex: 0 },
  });
  // b takes band 1 (300) and band 2 (100); c's own top band (50) is refunded.
  expect(sharePairs(result.shares)).toEqual([["b", 400], ["c", 50]]);
  expect(result.unawardable).toBe(0);
 });

 it("uncalled bet is returned to the bettor", () => {
  const result = awardContributions({
   contributed: contrib([["a", 60]]),
   folded: [],
   winners: [{ userId: "a", seatIndex: 1 }],
   dealer: { userId: "a", seatIndex: 1 },
  });
  expect(sharePairs(result.shares)).toEqual([["a", 60]]);
  expect(result.unawardable).toBe(0);
 });

 it("two winners split each band they both covered", () => {
  // band1 300 -> 150/150; band2 covered only by b -> 100 to b; band3 refunded to c.
  const result = awardContributions({
   contributed: contrib([["a", 100], ["b", 150], ["c", 200]]),
   folded: ["c"],
   winners: [{ userId: "b", seatIndex: 1 }, { userId: "a", seatIndex: 3 }],
   dealer: { userId: "d", seatIndex: 0 },
  });
  expect(sharePairs(result.shares)).toEqual([["b", 250], ["a", 150], ["c", 50]]);
  expect(result.unawardable).toBe(0);
 });

 it("the whole pot is conserved among the shares", () => {
  const result = awardContributions({
   contributed: contrib([["a", 100], ["b", 150], ["c", 200]]),
   folded: [],
   winners: [{ userId: "b", seatIndex: 1 }],
   dealer: { userId: "d", seatIndex: 0 },
  });
  const awarded = result.shares.reduce((acc, s) => acc + s.chips, 0);
  expect(awarded).toBe(450);
 });
});
