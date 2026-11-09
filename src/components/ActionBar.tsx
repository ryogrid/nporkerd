// The hero's controls, rendered only from the server's `legal` block (the
// client duplicates no rules; the server re-validates). One request at a time:
// buttons lock while an action is in flight so double clicks can't misfire.
// Shortcuts: F fold · C check/call · R bet/raise · Shift+A all-in (ignored while typing).
import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { errorCopyFor } from "../lib/errorCopy";
import { formatChips } from "../lib/format";
import { playCue } from "../lib/sound";
import { useToast } from "../lib/toast";

export type LegalBlock = {
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  minRaiseTo: number;
  maxRaiseTo: number;
  toCall: number;
};

type ActionKind = "fold" | "check" | "call" | "raiseTo" | "allIn";

export function ActionBar({ legal, roomId, sessionToken, myBet, pot, bigBlind }: {
  legal: LegalBlock;
  roomId: Id<"rooms">;
  sessionToken: string;
  /** Hero's chips already in front this street. */
  myBet: number;
  /** Everything in the middle, including this street's bets. */
  pot: number;
  bigBlind: number;
}) {
  const act = useMutation(api.game.act);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const currentBet = myBet + legal.toCall;
  const allInTo = legal.maxRaiseTo;
  // A full raise is possible; otherwise only all-in (if it beats the call).
  const canRaise = legal.maxRaiseTo >= legal.minRaiseTo && legal.maxRaiseTo > currentBet;
  const callIsAllIn = legal.canCall && legal.callAmount >= allInTo - myBet;
  const [target, setTargetRaw] = useState(() => legal.minRaiseTo);
  const [text, setText] = useState(() => String(legal.minRaiseTo));
  const setTarget = (v: number) => { setTargetRaw(v); setText(String(Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(v))))); };

  const clamp = (v: number) => Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(v)));
  const betWord = currentBet === 0 ? "Bet" : "Raise to";

  async function fire(kind: ActionKind, amount?: number): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      if (kind === "raiseTo" && amount !== undefined && amount >= allInTo) {
        await act({ sessionToken, roomId, kind: "allIn" });
      } else if (amount === undefined) {
        await act({ sessionToken, roomId, kind });
      } else {
        await act({ sessionToken, roomId, kind, amount });
      }
    } catch (e) {
      toast.push(errorCopyFor(e));
      playCue("deny");
      setBusy(false);
    }
    // on success the component unmounts (it is no longer our turn)
  }

  const primary = legal.canCheck ? () => fire("check") : legal.canCall ? () => fire("call") : undefined;
  const raiseNow = () => fire("raiseTo", clamp(target));
  const canAllIn = allInTo > myBet;
  const handlers = useRef({ primary, raiseNow, fold: () => fire("fold"), allIn: () => fire("allIn"), canRaise, canAllIn });
  handlers.current = { primary, raiseNow, fold: () => fire("fold"), allIn: () => fire("allIn"), canRaise, canAllIn };

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const el = e.target as HTMLElement | null;
      const typing = el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el?.isContentEditable === true ||
        (el instanceof HTMLInputElement && !["range", "checkbox", "radio", "button", "submit"].includes(el.type));
      if (typing) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const k = e.key.toLowerCase();
      const h = handlers.current;
      if (k === "f") { e.preventDefault(); void h.fold(); }
      else if (k === "c" || k === "k") { if (h.primary !== undefined) { e.preventDefault(); void h.primary(); } }
      else if (k === "r" || k === "b") { if (h.canRaise) { e.preventDefault(); void h.raiseNow(); } }
      else if (k === "a" && e.shiftKey && h.canAllIn) { e.preventDefault(); void h.allIn(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // pot-sized raise: call first, then raise by the pot that results
  const potRaise = (fraction: number) => clamp(currentBet + fraction * (pot + legal.toCall));
  const presets: Array<[string, number]> = [
    ["Min", legal.minRaiseTo],
    ["½ Pot", potRaise(0.5)],
    ["¾ Pot", potRaise(0.75)],
    ["Pot", potRaise(1)],
  ];
  const span = Math.max(1, legal.maxRaiseTo - legal.minRaiseTo);
  const shown = clamp(target);
  const fill = `${(((shown - legal.minRaiseTo) / span) * 100).toFixed(1)}%`;
  const step = Math.max(1, Math.round(bigBlind / 2));

  return (
    <div className="stack" style={{ gap: 12 }}>
      {canRaise ? (
        <div className="raise-panel">
          <input
            className="range"
            type="range"
            min={legal.minRaiseTo}
            max={legal.maxRaiseTo}
            step={1}
            value={shown}
            style={{ ["--fill" as string]: fill }}
            onChange={(e) => setTarget(Number(e.target.value))}
            aria-label={`${betWord} amount`}
          />
          <input
            className="input amount-input"
            type="number"
            inputMode="numeric"
            min={legal.minRaiseTo}
            max={legal.maxRaiseTo}
            step={step}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value !== "" && Number.isFinite(n)) setTargetRaw(n);
            }}
            onBlur={() => setText(String(clamp(target)))}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setText(String(clamp(target))); void raiseNow(); } }}
            aria-label="amount in chips"
          />
          <div className="presets">
            {presets.map(([label, value]) => (
              <button key={label} type="button" className="btn btn-sm" disabled={busy} onClick={() => { setTarget(value); playCue("click"); }}>
                {label}
              </button>
            ))}
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => { setTarget(legal.maxRaiseTo); playCue("click"); }}>
              Max
            </button>
          </div>
        </div>
      ) : null}
      <div className="act-btns" style={{ gridTemplateColumns: `repeat(${2 + (canRaise ? 1 : 0) + (callIsAllIn ? 0 : 1)}, minmax(0, 1fr))` }}>
        <button type="button" className="act act-fold" disabled={busy} onClick={() => void fire("fold")}>
          Fold <small><span className="kbd">F</span></small>
        </button>
        {legal.canCheck ? (
          <button type="button" className="act act-call" disabled={busy} onClick={() => void fire("check")}>
            Check <small><span className="kbd">C</span></small>
          </button>
        ) : (
          <button type="button" className="act act-call" disabled={busy || !legal.canCall} onClick={() => void fire("call")}>
            {callIsAllIn ? "Call all-in" : "Call"} <small>{formatChips(legal.callAmount)} <span className="kbd">C</span></small>
          </button>
        )}
        {canRaise ? (
          <button type="button" className="act act-raise" disabled={busy} onClick={() => void raiseNow()}>
            {shown >= allInTo ? "All-in" : betWord} <small>{formatChips(shown)} <span className="kbd">R</span></small>
          </button>
        ) : null}
        {callIsAllIn ? null : (
          <button type="button" className="act act-allin" disabled={busy || !canAllIn} onClick={() => void fire("allIn")}>
            All-in <small>{formatChips(allInTo)} <span className="kbd">⇧A</span></small>
          </button>
        )}
      </div>
    </div>
  );
}
