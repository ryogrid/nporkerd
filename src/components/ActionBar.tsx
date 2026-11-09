// ActionBar (design/07 §2.4, 07 §4, 07 §5): controls are rendered **only**
// from the projection's `legal` block, so the raise range shown here is
// literally the server's — the client duplicates no poker rules. Buttons are
// real <button>s (keyboard reachable); the raise amount takes a typed number
// ("Set amount" reads it), fine/coarse nudges, and a slider-style fill bar.
// A rejected action shows transient copy — it is never drawn as if it ran —
// and only an accepted act gets its sound cue, so a denial never plays the
// chip sound (Phase 10).
import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { errorCopyFor } from "../lib/errorCopy";
import { formatChips } from "../lib/format";
import { playCue } from "../lib/sound";

export type LegalBlock = {
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  minRaiseTo: number;
  maxRaiseTo: number;
  toCall: number;
};

type ActionKind = "fold" | "check" | "call" | "raiseTo" | "allIn";

export function ActionBar({ legal, roomId, sessionToken }: {
  legal: LegalBlock | undefined;
  roomId: Id<"rooms">;
  sessionToken: string;
}) {
  const act = useMutation(api.game.act);
  const typed = useRef<HTMLInputElement>(null);
  const [wanted, setWanted] = useState<number | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  async function fire(kind: ActionKind, raiseTo?: number): Promise<void> {
    setNotice(undefined);
    try {
      if (raiseTo === undefined) {
        await act({ sessionToken, roomId, kind });
      } else {
        await act({ sessionToken, roomId, kind, amount: raiseTo });
      }
      // Phase 10 sound: the cue only plays once the server accepted the act,
      // so it never celebrates a move that did not happen (07 §2.4).
      playCue(`action-${kind === "raiseTo" ? "raise" : kind === "allIn" ? "allin" : kind}`);
    } catch (e) {
      setNotice(errorCopyFor(e));
      playCue("deny");
    }
  }

  function clamp(value: number): number {
    if (legal === undefined) {
      return 0;
    }
    if (value > legal.maxRaiseTo) {
      return legal.maxRaiseTo;
    }
    if (value < legal.minRaiseTo) {
      return legal.minRaiseTo;
    }
    return Math.trunc(value);
  }

  if (legal === undefined) {
    // Not our turn: nothing is offered (the server re-validates regardless).
    return <div className="np-actions np-hidden" aria-hidden="true" />;
  }

  const canRaise = legal.maxRaiseTo >= legal.minRaiseTo;
  const target = wanted === undefined ? legal.minRaiseTo : clamp(wanted);
  const fill = canRaise
    ? `${Math.round(((target - legal.minRaiseTo) / Math.max(1, legal.maxRaiseTo - legal.minRaiseTo)) * 100)}%`
    : "0%";

  return (
    <div className="np-actions">
      <button type="button" onClick={() => void fire("fold")}>Fold</button>
      <button type="button" disabled={!legal.canCheck} onClick={() => void fire("check")}>Check</button>
      <button type="button" disabled={!legal.canCall} onClick={() => void fire("call")}>
        Call {formatChips(legal.callAmount)}
      </button>
      <button type="button" disabled={!canRaise} onClick={() => void fire("raiseTo", target)}>
        Raise to {formatChips(target)}
      </button>
      <button type="button" className="allin" onClick={() => void fire("allIn")}>All in</button>
      <span className="np-chat-hint">
        legal raise {formatChips(legal.minRaiseTo)}–{formatChips(legal.maxRaiseTo)}
      </span>
      <span className="np-raise-slider" style={{ width: fill }}>
        {formatChips(target)}
      </span>
      <input ref={typed} type="text" className="np-raise-input" aria-label="raise amount in chips" />
      <button
        type="button"
        onClick={() => setWanted(clamp(parseAmount(typed.current?.value)))}
      >
        Set amount
      </button>
      <button type="button" onClick={() => setWanted(clamp(target - 1))}>−1</button>
      <button type="button" onClick={() => setWanted(clamp(target + 1))}>+1</button>
      <button type="button" onClick={() => setWanted(clamp(target + 10))}>+10</button>
      {notice === undefined ? null : <span className="np-error">{notice}</span>}
    </div>
  );
}

function parseAmount(value: string | undefined): number {
  if (value === undefined) {
    return 0;
  }
  const digits = value.replace(/[^0-9]/g, "");
  return digits === "" ? 0 : Number.parseInt(digits, 10);
}
