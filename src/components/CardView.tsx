// One playing card, drawn with CSS only (design/07 §4: no image assets, red
// suits for hearts/diamonds). `card === undefined` is the face-down card:
// the projection never sends a number we should hide (00 §5), so a missing
// value means "this player's cards are not visible to me".

import { cardLabel, isRedSuit } from "../lib/format";

/** `flip` is the 07 §2.4 showdown reveal: a CSS-only turn of the card. */
export function CardView({ card, faceDown, flip }: {
  card: number | undefined;
  faceDown?: boolean;
  flip?: boolean;
}) {
  if (card === undefined || faceDown === true) {
    return <span className="np-card-back" aria-label="hidden card" />;
  }
  const red = isRedSuit(card);
  const classes = [red ? "np-card-face red" : "np-card-face"];
  if (flip === true) {
    classes.push("np-card-flip");
  }
  return (
    <span
      className={classes.join(" ")}
      aria-label={`${cardLabel(card)}${flip === true ? ", revealed at showdown" : ""}`}
    >
      {cardLabel(card)}
    </span>
  );
}

/**
 * A player's two hole cards. `mine` styles the viewer's own pair; `revealed`
 * marks an opponent's pair that the projection handed over at showdown (00 §5
 * — the server decides visibility, this only decides whether to flip).
 */
export function CardPair({
  cards,
  mine,
  revealed,
}: { cards: number[] | undefined; mine: boolean; revealed?: boolean }) {
  const shown = revealed === true && !mine;
  const visible = mine || revealed === true;
  const slotClass = visible
    ? mine ? "np-cardslot you" : "np-cardslot reveal"
    : "np-cardslot";
  return (
    <span className={slotClass}>
      <CardView card={visible ? cards?.[0] : undefined} faceDown={!visible} flip={shown} />
      <CardView card={visible ? cards?.[1] : undefined} faceDown={!visible} flip={shown} />
    </span>
  );
}
