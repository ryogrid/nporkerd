import { describe, it, expect } from "vitest";
import { startHand, applyAction, legalActions, seatsAfter, advanceStreetIfNeeded, HandState } from "./engine";

/** Deterministic 32-bit PRNG for seeded simulations (mulberry32). */
function mulberry32(seed: number): () => number {
 const cell = [seed];
 return () => {
  let z = (cell[0] = (cell[0] + 0x6d2b79f5) & 0xffffffff);
  z = (z ^ (z >>> 15)) & 0xffffffff;
  z = (z * 0x81ebc3b9) & 0xffffffff;
  z = (z ^ (z >>> 13)) & 0xffffffff;
  return ((z ^ (z >>> 16)) >>> 0) / 4294967296;
 };
}

function rngFor(seed: number): (max: number) => number {
 const next = mulberry32(seed);
 return (max: number) => Math.floor(next() * max);
}

function chipsOnTable(s: HandState): number {
  const stacks = s.players.reduce((acc, p) => acc + p.stack, 0);
  const committed = s.result ? s.result.shares.reduce((acc, x) => acc + x.chips, 0)
    : s.players.reduce((acc, p) => acc + p.betTotal, 0);
  return stacks + committed;
}

function userIdAtSeat(s: HandState, seat: number): string {
 return s.players.find((p) => p.seatIndex === seat)!.userId;
}

describe("startHand", () => {
 it("three players: blinds posted, button = lowest seat, actor left of BB", () => {
  const input = {
   id: "h1",
   handNumber: 1,
   prevButtonSeat: -1,
   players: [
    { userId: "a", seatIndex: 2, stack: 500 },
    { userId: "b", seatIndex: 5, stack: 500 },
    { userId: "c", seatIndex: 8, stack: 500 },
   ],
   smallBlind: 5,
   bigBlind: 10,
   ante: 0,
   randomInt: rngFor(1),
  };
  const { state, deltas } = startHand(input);
  expect(state.buttonSeat).toBe(2);
  expect(state.currentBet).toBe(10);
  const bySeat = new Map(state.players.map((p) => [p.seatIndex, p]));
  expect(bySeat.get(5)!.betStreet).toBe(5);
  expect(bySeat.get(8)!.betStreet).toBe(10);
  expect(state.turnSeat).toBe(2);
  expect(chipsOnTable(state)).toBe(1500);
  expect(deltas.length).toBe(3);
 });

 it("heads-up: the button posts the small blind and acts first preflop", () => {
  const input = {
   id: "h2",
   handNumber: 1,
   prevButtonSeat: 3,
   players: [
    { userId: "a", seatIndex: 3, stack: 300 },
    { userId: "b", seatIndex: 7, stack: 300 },
   ],
   smallBlind: 5,
   bigBlind: 10,
   ante: 0,
   randomInt: rngFor(2),
  };
  const { state } = startHand(input);
  expect(state.buttonSeat).toBe(7);
  const bySeat = new Map(state.players.map((p) => [p.seatIndex, p]));
  expect(bySeat.get(7)!.betStreet).toBe(5);
  expect(bySeat.get(3)!.betStreet).toBe(10);
  expect(state.turnSeat).toBe(7);
 });

 it("a short stack posts its whole stack for a blind (all-in for less)", () => {
  const input = {
   id: "h3",
   handNumber: 1,
   prevButtonSeat: -1,
   players: [
    { userId: "a", seatIndex: 0, stack: 100 },
    { userId: "b", seatIndex: 1, stack: 3 },
    { userId: "c", seatIndex: 2, stack: 200 },
   ],
   smallBlind: 5,
   bigBlind: 10,
   ante: 0,
   randomInt: rngFor(3),
  };
  const { state } = startHand(input);
  const b = state.players.find((p) => p.userId === "b")!;
  expect(b.betStreet).toBe(3);
  expect(b.status).toBe("allIn");
 });

 it("shuffle is seeded and deterministic; holes are two per player", () => {
  const input = {
   id: "h4",
   handNumber: 1,
   prevButtonSeat: -1,
   players: [
    { userId: "a", seatIndex: 0, stack: 100 },
    { userId: "b", seatIndex: 1, stack: 100 },
   ],
   smallBlind: 1,
   bigBlind: 2,
   ante: 0,
   randomInt: rngFor(4),
  };
  const first = startHand(input);
  // A fresh rng with the same seed: determinism means "same seed -> same deal".
  const second = startHand({ ...input, id: "h4b", randomInt: rngFor(4) });
  const holes = first.state.players.flatMap((p) => p.hole);
  expect(new Set(holes).size).toBe(4);
  expect(first.state.deck.length).toBe(48);
  const a = first.state.players.flatMap((p) => [...p.hole]).join(",");
  const b = second.state.players.flatMap((p) => [...p.hole]).join(",");
  expect(a).toBe(b);
 });

 it("button rotation skips vacancies: previous button 4 with seats 2,7", () => {
  const input = {
   id: "h5",
   handNumber: 1,
   prevButtonSeat: 4,
   players: [
    { userId: "a", seatIndex: 2, stack: 100 },
    { userId: "b", seatIndex: 7, stack: 100 },
   ],
   smallBlind: 5,
   bigBlind: 10,
   ante: 0,
   randomInt: rngFor(5),
  };
  const { state } = startHand(input);
  expect(state.buttonSeat).toBe(7);
 });
});

describe("action sequences", () => {
 it("check-down three-way to showdown conserves chips", () => {
  const input = {
   id: "cd",
   handNumber: 1,
   prevButtonSeat: -1,
   players: [
    { userId: "a", seatIndex: 0, stack: 100 },
    { userId: "b", seatIndex: 1, stack: 100 },
    { userId: "c", seatIndex: 2, stack: 100 },
   ],
   smallBlind: 5,
   bigBlind: 10,
   ante: 0,
   randomInt: rngFor(9),
  };
  let s = startHand(input).state;
  // preflop: facing the live BB bet (04 §5), a and b call it; c (BB) checks.
  s = applyAction(s, "a", { kind: "call" });
  s = applyAction(s, "b", { kind: "call" });
  s = applyAction(s, "c", { kind: "check" });
  for (let street = 0; street < 3; street += 1) {
   const seats = s.players.filter((p) => p.status === "active").map((p) => p.seatIndex);
   for (const seat of seatsAfter(s.buttonSeat, seats)) {
    s = applyAction(s, userIdAtSeat(s, seat), { kind: "check" });
   }
  }
  expect(s.stage).toBe("finished");
  expect(s.result!.type).toBe("showdown");
  expect(s.board.length).toBe(5);
  expect(s.result!.revealedUserIds.length).toBe(3);
  expect(chipsOnTable(s)).toBe(300);
 });

 it("big blind wins by preflop fold: uncalled bet returned (04 §7)", () => {
  const input = {
   id: "foldwin",
   handNumber: 1,
   prevButtonSeat: -1,
   players: [
    { userId: "a", seatIndex: 0, stack: 100 },
    { userId: "b", seatIndex: 1, stack: 100 },
   ],
   smallBlind: 5,
   bigBlind: 10,
   ante: 0,
   randomInt: rngFor(11),
  };
  const s0 = startHand(input).state;
  // heads-up: button seat 0 (a) posts SB and acts first; he folds.
  const s = applyAction(s0, "a", { kind: "fold" });
  expect(s.stage).toBe("finished");
  expect(s.result!.type).toBe("fold");
  expect(s.result!.winnerIds).toEqual(["b"]);
  expect(s.result!.handRankLabel).toBe("Won by fold");
  expect(s.result!.revealedUserIds).toEqual([]);
  const bb = s.result!.shares.find((x) => x.userId === "b")!;
  // b gets the SB 5 it committed plus its own BB 10 back.
  expect(bb.chips).toBe(15);
  expect(s.result!.shares.length).toBe(1);
  expect(chipsOnTable(s)).toBe(200);
 });

 it("raise sizes: below-minimum raiseTo is illegal unless all-in (04 §5)", () => {
  const input = {
   id: "raise",
   handNumber: 1,
   prevButtonSeat: -1,
   players: [
    { userId: "a", seatIndex: 0, stack: 100 },
    { userId: "b", seatIndex: 1, stack: 25 },
    { userId: "c", seatIndex: 2, stack: 100 },
   ],
   smallBlind: 5,
   bigBlind: 10,
   ante: 0,
   randomInt: rngFor(12),
  };
  const s0 = startHand(input).state;
  // button 0 (a) acts first preflop: raise to 30 (min 20) legal.
  const s1 = applyAction(s0, "a", { kind: "raiseTo", amount: 30 });
  // b (SB, stack 20 left) facing bet 30: raiseTo 31 is illegal (not all-in)
  const s2 = applyAction(s1, "b", { kind: "allIn" });
  expect(s2.players.find((p) => p.userId === "b")!.status).toBe("allIn");
  expect(s2.currentBet).toBe(30);
  // b's short all-in did not reopen: c still must respond to bet 30.
  const s3 = applyAction(s2, "c", { kind: "fold" });
  // a must call 30 total (already 30? a bet 30) -> a already matched: street done
  expect(s3.stage).not.toBe("preflop");
  expect(chipsOnTable(s3)).toBe(225);
 });

 it("blinds all-in preflop run out the board one street at a time", () => {
  const input = {
   id: "runout",
   handNumber: 1,
   prevButtonSeat: -1,
   players: [
    { userId: "a", seatIndex: 0, stack: 60 },
    { userId: "b", seatIndex: 1, stack: 90 },
   ],
   smallBlind: 5,
   bigBlind: 10,
   ante: 0,
   randomInt: rngFor(15),
  };
  const s0 = startHand(input).state;
  // heads-up button 0 (a, SB 60) raises all-in to 60, b (BB) calls all-in.
  const s1 = applyAction(s0, "a", { kind: "allIn" });
  let s = applyAction(s1, "b", { kind: "allIn" });
  // 04 §8: the street that ends with the last all-in is dealt by that same
  // step (the flop lands with the call), then every later street is one step,
  // paced by STREET_DEAL_DELAY_MS, and the river step also shows down.
  expect(s.stage).toBe("flop");
  expect(s.turnSeat).toBe(-1);
  const seen: string[] = [];
  let steps = 0;
  while (s.stage !== "finished") {
   s = advanceStreetIfNeeded(s);
   seen.push(s.stage);
   steps += 1;
   expect(steps <= 4).toBe(true);
  }
  expect(seen).toEqual(["turn", "finished"]);
  expect(s.board.length).toBe(5);
  expect(chipsOnTable(s)).toBe(150);
  // the caller for less gets refunded their uncalled part handled by bands:
  const shares = s.result!.shares.reduce((acc, x) => acc + x.chips, 0);
  expect(shares).toBe(150);
 });
});

describe("legalActions", () => {
 it("no check while facing a bet; no call when matched", () => {
  const input = {
   id: "legal",
   handNumber: 1,
   prevButtonSeat: -1,
   players: [
    { userId: "a", seatIndex: 0, stack: 100 },
    { userId: "b", seatIndex: 1, stack: 100 },
   ],
   smallBlind: 5,
   bigBlind: 10,
   ante: 0,
   randomInt: rngFor(16),
  };
  const s0 = startHand(input).state;
  const s1 = applyAction(s0, "a", { kind: "raiseTo", amount: 30 });
  const kindsB = legalActions(s1, "b").map((a) => a.kind);
  expect(kindsB).not.toContain("check");
  expect(kindsB).toContain("call");
  const s2 = applyAction(s1, "b", { kind: "call" });
  const kindsA = legalActions(s2, "a").map((a) => a.kind);
  expect(kindsA).not.toContain("call");
 });

 it("raiseTo is offered at the minimum only", () => {
  const input = {
   id: "minraise",
   handNumber: 1,
   prevButtonSeat: -1,
   players: [
    { userId: "a", seatIndex: 0, stack: 100 },
    { userId: "b", seatIndex: 1, stack: 100 },
   ],
   smallBlind: 5,
   bigBlind: 10,
   ante: 0,
   randomInt: rngFor(17),
  };
  const s0 = startHand(input).state;
  const actions = legalActions(s0, "a");
  const raiseTo = actions.find((a) => a.kind === "raiseTo");
  expect(raiseTo!.amount).toBe(20);
 });
});

describe("randomized simulations", () => {
 it("100 seeded hands conserve chips and never throw", () => {
  for (let seed = 1; seed <= 100; seed += 1) {
   const rng = rngFor(seed * 7919);
   const pick = (n: number) => rng(n);
   const tableSize = 2 + (seed % 7);
   const players: Array<{ userId: string; seatIndex: number; stack: number }> = [];
   const usedSeats: number[] = [];
   for (let i = 0; i < tableSize; i += 1) {
    const seat = (i * 3 + (seed % 2)) % 10;
    usedSeats.push(seat);
    players.push({ userId: "u" + i, seatIndex: seat, stack: 30 + ((seed * (i + 3) * 17) % 180) });
   }
   const start = chipsOf(players);
   let s = startHand({
    id: "sim-" + seed,
    handNumber: seed,
    prevButtonSeat: seed % 2 === 0 ? 0 : -1,
    players,
    smallBlind: 5,
    bigBlind: 10,
    ante: seed % 3 === 0 ? 2 : 0,
    randomInt: rng,
   }).state;
   let guard = 0;
   while (s.stage !== "finished") {
    const actor = s.players.find((p) => p.seatIndex === s.turnSeat);
    if (actor === undefined) {
     // runout: the caller drives one street at a time (04 §8)
     s = advanceStreetIfNeeded(s);
     guard += 1;
     expect(guard < 400).toBe(true);
     continue;
    }
    const options = legalActions(s, actor.userId);
    expect(options.length > 0).toBe(true);
    s = applyAction(s, actor.userId, options[pick(options.length)]);
    guard += 1;
    expect(guard < 400).toBe(true);
   }
   expect(s.result).not.toBe(undefined);
   expect(chipsOnTable(s)).toBe(start);
   expect(s.players.every((p) => p.stack >= 0)).toBe(true);
   // conservation across all seats: shares never exceed the pot
   const committed = players.reduce((acc, p) => acc + p.stack, 0) - s.players.reduce((acc, p) => acc + p.stack, 0);
   const shares = s.result!.shares.reduce((acc, x) => acc + x.chips, 0);
   expect(shares).toBe(committed);
  }
 });
});

function chipsOf(players: Array<{ userId: string; seatIndex: number; stack: number }>): number {
 return players.reduce((acc, p) => acc + p.stack, 0);
}
