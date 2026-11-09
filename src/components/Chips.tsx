// Casino chips, colour-coded by denomination, drawn with CSS.
import { formatChips } from "../lib/format";

const DENOMS: Array<[number, string]> = [
  [5000, "c-gold"],
  [1000, "c-purple"],
  [500, "c-black"],
  [100, "c-green"],
  [25, "c-blue"],
  [5, "c-red"],
  [1, "c-white"],
];

/** Up to `max` chip colours that roughly decompose `amount`, biggest first. */
export function chipColors(amount: number, max = 4): string[] {
  const out: string[] = [];
  let left = Math.max(0, Math.trunc(amount));
  for (const [value, color] of DENOMS) {
    while (left >= value && out.length < max) {
      out.push(color);
      left -= value;
      if (out.length >= 2 && out[out.length - 2] === color) break; // keep colours varied
    }
    if (out.length >= max) break;
  }
  return out.length === 0 ? ["c-white"] : out;
}

export function Chip({ color, large }: { color: string; large?: boolean }) {
  return <span className={`chip ${color}${large === true ? " lg" : ""}`} aria-hidden="true" />;
}

export function ChipStack({ amount, max = 4 }: { amount: number; max?: number }) {
  const colors = chipColors(amount, max).reverse();
  return (
    <span className="chip-stack" aria-hidden="true">
      {colors.map((c, i) => <Chip key={i} color={c} />)}
    </span>
  );
}

/** A bet / pot amount: a little chip stack next to the number. */
export function ChipAmount({ amount, className }: { amount: number; className?: string }) {
  return (
    <span className={className ?? "bet"}>
      <ChipStack amount={amount} max={3} />
      <span>{formatChips(amount)}</span>
    </span>
  );
}
