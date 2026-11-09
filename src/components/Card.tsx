// A playing card drawn with CSS (no images). `card === undefined` is a face-down
// card: the server never sends a hidden card, so "missing" means "not mine to see".
import { CSSProperties } from "react";
import { isRedSuit, rankText, suitGlyph } from "../lib/format";

export type CardAnim = "deal" | "board" | "flip" | undefined;

export function Card({ card, anim, delayMs, highlight, className }: {
  card: number | undefined;
  anim?: CardAnim;
  delayMs?: number;
  highlight?: boolean;
  className?: string;
}) {
  const style: CSSProperties | undefined = delayMs === undefined ? undefined : { animationDelay: `${delayMs}ms` };
  const classes = ["card"];
  if (anim !== undefined) classes.push(`anim-${anim}`);
  if (highlight === true) classes.push("highlight");
  if (className !== undefined) classes.push(className);

  if (card === undefined) {
    classes.push("back");
    return <div className={classes.join(" ")} style={style} role="img" aria-label="face-down card" />;
  }
  if (isRedSuit(card)) classes.push("red");
  const rank = rankText(card);
  const suit = suitGlyph(card);
  const isFace = rank === "J" || rank === "Q" || rank === "K";
  return (
    <div className={classes.join(" ")} style={style} role="img" aria-label={`${rank} of ${suitName(card)}`}>
      <div className="card-corner"><span>{rank}</span><span className="s">{suit}</span></div>
      <div className={`card-pip${isFace ? " card-face-letter" : ""}`}>{isFace ? rank : suit}</div>
      <div className="card-corner br"><span>{rank}</span><span className="s">{suit}</span></div>
    </div>
  );
}

function suitName(card: number): string {
  return ["spades", "hearts", "diamonds", "clubs"][Math.floor(card / 13)] ?? "";
}
