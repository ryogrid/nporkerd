// BalanceBadge (design/01 §3): the bankroll header shown on lobby/room, with
// the faucet hint so it is obvious when a broke player can top up (02 §8).
import { FAUCET_AMOUNT } from "../../convex/lib/constants";
import { formatChips } from "../lib/format";

export function BalanceBadge({ balance }: { balance: number }) {
  return (
    <span className="np-panel">
      <span className="np-seat-name">{formatChips(balance)} chips</span>
      <span className="np-muted">{faucetHint(balance)}</span>
    </span>
  );
}

/** Whether the faucet button may appear (02 §8 global rule). */
export function faucetEligible(balance: number): boolean {
  return balance < FAUCET_AMOUNT;
}

function faucetHint(balance: number): string {
  return faucetEligible(balance)
    ? `under ${FAUCET_AMOUNT} chips: the faucet can top you up`
    : `the faucet needs a bankroll under ${FAUCET_AMOUNT} chips`;
}
