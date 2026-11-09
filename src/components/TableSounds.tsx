// Plays sound cues for what changed in the table projection: new hand, each
// street, every player's action, the hero's turn, the last seconds of the
// hero's clock and the hand result. Pure observer: renders nothing.
import { useEffect, useRef } from "react";
import { playCue } from "../lib/sound";
import { TableState } from "../lib/projection";

const ACTION_CUES: Record<string, string> = {
  fold: "action-fold",
  "timeout-fold": "action-fold",
  check: "action-check",
  "timeout-check": "action-check",
  call: "action-call",
  raiseTo: "action-raise",
  allIn: "action-allin",
};

export function TableSounds({ table, heroName, now }: {
  table: TableState | undefined;
  heroName: string | undefined;
  now: number;
}) {
  const prev = useRef<{ hand: number; stage: string; action: string; turnKey: string; turnSeat: number | undefined } | undefined>(undefined);
  const lastTick = useRef<number>(-1);

  useEffect(() => {
    if (table === undefined) return;
    const hand = table.handNumber ?? 0;
    const stage = table.stage;
    const actor = table.seats.find((s) => s.lastAction !== undefined);
    const action = actor?.lastAction === undefined
      ? ""
      : `${hand}:${actor.seatIndex}:${actor.lastAction.kind}:${actor.lastAction.amount ?? 0}:${actor.betStreet}`;
    // one key per hero turn, so a turn that starts a new street still pings
    const turnKey = table.yourTurn ? `${hand}:${stage}` : "";
    const before = prev.current;
    prev.current = { hand, stage, action, turnKey, turnSeat: table.currentTurnSeat };
    if (before === undefined) return; // first snapshot: nothing "happened"

    // someone must have been on the clock for an action to have happened
    // (runout streets advance with nobody to act and keep the old lastAction)
    if (action !== "" && action !== before.action && before.turnSeat !== undefined && actor?.lastAction !== undefined) {
      const cue = ACTION_CUES[actor.lastAction.kind];
      if (cue !== undefined) playCue(cue);
    }
    if (hand !== before.hand && stage === "preflop") {
      window.setTimeout(() => playCue("deal"), 250);
    } else if (stage !== before.stage) {
      if (stage === "flop" || stage === "turn" || stage === "river") {
        window.setTimeout(() => playCue(stage), 200);
      } else if (stage === "finished") {
        const winners = table.lastHandResult?.winners ?? [];
        const shown = table.seats.some((s) => s.holeCards !== undefined && s.username !== heroName);
        const heroWon = heroName !== undefined && winners.some((w) => w.username === heroName);
        if (shown) playCue("showdown");
        window.setTimeout(() => playCue(heroWon ? "win" : "hand-over"), shown ? 450 : 150);
      }
    }
    if (turnKey !== "" && turnKey !== before.turnKey) {
      window.setTimeout(() => playCue("your-turn"), 120);
    }
  }, [table, heroName]);

  // the clock: one tick per second through the hero's last five seconds
  useEffect(() => {
    if (table === undefined || !table.yourTurn || table.turnDeadline === undefined) {
      lastTick.current = -1;
      return;
    }
    const left = Math.ceil((table.turnDeadline - now) / 1000);
    if (left >= 1 && left <= 5 && left !== lastTick.current) {
      lastTick.current = left;
      playCue("tick");
    }
  }, [table, now]);

  return null;
}
