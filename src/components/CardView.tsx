// One playing card, drawn with CSS only (design/07 §4: no image assets, red
// suits for hearts/diamonds). `card === undefined` is the face-down card: the
// projection never sends a number we should hide (00 §5), so a missing value
// means "this player's cards are not visible to me".
//
// Animation is likewise CSS-only (Phase 10): `flip` is the 07 §2.4 showdown
// turn, `deal` slides a freshly dealt card in from the box. `deal` alternates
// between two identical-in-spirit keyframe sets keyed on the projection's
// `handNumber`, which is what restarts the animation for every hand — a
// reused DOM element would otherwise keep its finished animation (the client
// tracks no state of its own, 07 §3).
import { cardLabel, isRedSuit } from "../lib/format";

export function CardView({ card, faceDown, flip, deal }: {
  card: number | undefined;
  faceDown?: boolean;
  flip?: boolean;
  deal?: "a" | "b";
}) {
  const dealClass = deal === "a" ? "np-card-deal" : deal === "b" ? "np-card-deal-alt" : undefined;
  if (card === undefined || faceDown === true) {
    const back = dealClass === undefined ? "np-card-back" : `np-card-back ${dealClass}`;
    return <span className={back} aria-label="hidden card" />;
  }
  const red = isRedSuit(card);
  const classes = [red ? "np-card-face red" : "np-card-face"];
  if (flip === true) {
    classes.push("np-card-flip");
  }
  if (dealClass !== undefined) {
    classes.push(dealClass);
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
 * — the server decides visibility, this only decides whether to flip); `hand`
 * is the projection's hand number, used only to alternate the deal-in
 * animation so each hand re-deals visibly.
 */
export function CardPair({
  cards,
  mine,
  revealed,
  hand,
}: { cards: number[] | undefined; mine: boolean; revealed?: boolean; hand?: number }) {
  const shown = revealed === true && !mine;
  const visible = mine || revealed === true;
  const slotClass = visible
    ? mine ? "np-cardslot you" : "np-cardslot reveal"
    : "np-cardslot";
  const deal = hand === undefined ? undefined : hand % 2 === 0 ? "a" : "b";
  return (
    <span className={slotClass}>
      <CardView card={visible ? cards?.[0] : undefined} faceDown={!visible} flip={shown} deal={deal} />
      <CardView card={visible ? cards?.[1] : undefined} faceDown={!visible} flip={shown} deal={deal} />
    </span>
  );
}
