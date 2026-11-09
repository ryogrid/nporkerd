// The SPA's stylesheet (design/07 §1: CSS only, no image assets; §5 keeps it
// usable at 360 px, where the chat collapses below the table). Rendered once
// by App as a <style> element so the built bundle needs no extra asset.

export const THEME_CSS = `
:root {
  --felt: #1d5c3f;
  --felt-2: #164a33;
  --rim: #6b4a2f;
  --ink: #17251f;
  --paper: #f6f3ea;
  --red: #b3382f;
  --accent: #d8a94a;
  --muted: #8ea08f;
}
* { box-sizing: border-box; }
body { margin: 0; background: #10201a; color: var(--paper); font-family: system-ui, sans-serif; }
.np-app { max-width: 1100px; margin: 0 auto; padding: 12px; }
.np-title { font-size: 20px; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
.np-page { margin: 16px 0 0 0; }
.np-card { background: #1b2d24; border: 1px solid #2c4436; border-radius: 10px; padding: 12px; }
.np-muted { color: var(--muted); font-size: 13px; }
.np-error { color: #f0b0aa; }
.np-hidden { display: none; }
.np-rows { display: grid; gap: 10px; }
.np-field { margin: 8px 0; }
.np-field label { display: block; font-size: 13px; color: var(--muted); }
.np-field input, .np-field textarea {
  background: #16261f; color: var(--paper); border: 1px solid #3b5748; border-radius: 6px;
  padding: 8px; font: inherit; width: 100%;
}
.np-field input[readonly], .np-key-area {
  font-family: ui-monospace, monospace; background: #0d1712; color: #cfe8d8;
}
.np-key-area { border: 1px solid #3b5748; border-radius: 6px; padding: 10px; white-space: pre; word-break: break-all; }
.np-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.np-actions button { font: inherit; cursor: pointer; border-radius: 8px; border: 1px solid #4c6b57; background: #24382d; color: var(--paper); padding: 8px 12px; }
.np-actions button:disabled { color: var(--muted); background: #1c2a22; cursor: default; }
.np-actions button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.np-actions .allin { background: var(--accent); color: var(--ink); border: 2px solid #8c6a2e; font-weight: 700; }

/* the table: one aspect-ratio box, seats positioned by inline --x/--y */
.np-table { position: relative; aspect-ratio: 16 / 10; width: 100%; margin: 0 auto; }
.np-felt {
  position: absolute; left: 14%; right: 14%; top: 16%; bottom: 18%;
  border-radius: 50%; background: radial-gradient(ellipse at 50% 40%, var(--felt) 45%, var(--felt-2));
  border: 10px solid var(--rim); box-shadow: 0 10px 22px rgba(0,0,0,.35);
}
/* seat anchors sit on the felt rim; the anchor is positioned, the seat box
   flows inside it (so SeatView never needs a CSS custom property) */
.np-seatanchor { position: absolute; transform: translate(-50%, -50%); }
.np-seat {
  position: relative;
  min-width: 96px;
  background: #12261c; border: 1px solid #33513f; border-radius: 10px; padding: 8px;
}
.np-seat.you { border: 2px solid var(--accent); }
.np-seat.folded { opacity: .45; }
.np-seat.turn { box-shadow: 0 0 0 3px var(--accent); }
.np-seat-name { font-size: 14px; }
.np-seat-stack { font-size: 13px; color: #d9e8dc; }
.np-seat-bet { font-size: 12px; color: var(--accent); }
.np-seat-state { font-size: 12px; color: var(--muted); }
.np-seat-turn { font-size: 12px; color: var(--paper); background: var(--ink); padding: 2px 6px; border-radius: 6px; }
.np-ring { position: absolute; right: -6px; top: -6px; width: 18px; height: 18px; border-radius: 50%; }
.np-dealerchip { position: absolute; right: 2px; bottom: 2px; width: 22px; height: 22px; border-radius: 50%;
  background: #f4f1e6; color: #14251c; display: grid; place-items: center; font-weight: 700; font-size: 13px; }
.np-center { position: absolute; left: 50%; top: 46%; transform: translate(-50%,-50%); text-align: center; }
.np-stage { font-size: 13px; color: var(--muted); letter-spacing: .08em; text-transform: uppercase; }
.np-boardrow { display: flex; gap: 6px; justify-content: center; }
.np-pots { display: flex; gap: 10px; justify-content: center; }
.np-pot { background: #0f1e17; border: 1px solid #3b5748; border-radius: 8px; padding: 3px 8px; font-size: 13px; }
.np-ticker { font-size: 13px; color: #dcead6; margin: 6px 0 0 0; }

/* cards: pure CSS, rank + suit glyph, red suits per 04 §2 (07 §4: no images) */
.np-card-face { position: relative; width: 42px; height: 58px; background: var(--paper);
  border: 1px solid #9aa6a0; border-radius: 6px; display: grid; place-items: center; font-size: 18px; }
.np-card-face.red { color: var(--red); }
.np-card-back { display: block; position: relative; width: 42px; height: 58px; border-radius: 6px; border: 1px solid #9aa6a0;
  background: repeating-linear-gradient(45deg, #26456b 0 6px, #1b3350 6px 12px); }
/* hole-card pairs overlap slightly so the pair reads as one hand */
.np-cardslot { display: inline-flex; align-items: end; position: relative; }
.np-cardslot > :nth-child(2) { margin-left: -12px; }
.np-cardslot.you { width: 66px; }
.np-cardslot.reveal { width: 66px; }
/* 07 §2.4 and the Phase 10 animations: CSS only, and every one of them is
   paired with a text label (07 §5: colour/motion are never the only signal) */
.np-card-flip { transform-origin: 50% 50%; animation: np-flip 700ms ease-out 1 both; }
@keyframes np-flip {
  from { transform: rotateY(170deg) scale(.92); opacity: .4; }
  to { transform: rotateY(0deg) scale(1); opacity: 1; }
}
/* deal-in. Two keyframe sets that differ only in where the card slides from:
   CardPair alternates them on the projection's handNumber, which restarts the
   animation on an element React reuses across hands. */
.np-card-deal { animation: np-deal 420ms ease-out 1 both; }
.np-card-deal-alt { animation: np-deal-alt 420ms ease-out 1 both; }
@keyframes np-deal {
  from { transform: translate(-38%,-170%) rotate(-14deg); opacity: 0; }
  to { transform: none; opacity: 1; }
}
@keyframes np-deal-alt {
  from { transform: translate(38%,-170%) rotate(14deg); opacity: 0; }
  to { transform: none; opacity: 1; }
}
/* winners pulse twice; SeatView also says "wins this hand" */
.np-seat.winner { border: 2px solid var(--accent); animation: np-win 760ms ease-out 2 both; }
@keyframes np-win {
  from { box-shadow: 0 0 0 0 rgba(216,169,74,0); }
  45% { box-shadow: 0 0 0 7px rgba(216,169,74,.45); }
  to { box-shadow: 0 0 0 0 rgba(216,169,74,0); }
}
/* motion is never required: the OS preference turns all of it off */
@media (prefers-reduced-motion: reduce) {
  .np-card-flip, .np-card-deal, .np-card-deal-alt, .np-seat.winner { animation: none; }
}
/* board cards get their own slot so they never overlap */
.np-cardslot-wide { display: inline-block; position: relative; width: 46px; height: 58px; }

.np-raise-slider { display: block; position: relative; height: 26px; min-width: 60px; max-width: 260px;
  background: #223449; border: 1px solid #4c6b57; border-radius: 13px; color: var(--paper); }
.np-raise-slider::after { content: ""; position: absolute; inset: 0; border-radius: 13px;
  background: rgba(216,169,74,.35); pointer-events: none; }
.np-raise-input { width: 110px; font-family: ui-monospace, monospace; }

.np-chat { display: flex; flex-direction: column; gap: 6px; }
/* the newest stay visible at the bottom (07 §2.4 auto-scroll, CSS-only) */
.np-chat-list { overflow-y: auto; max-height: 260px; display: flex; flex-direction: column; justify-content: end; gap: 4px; }
.np-chat-row { font-size: 13px; }
.np-chat-name { color: var(--accent); }
.np-chat-input { display: flex; flex-direction: column; gap: 4px; }
.np-chat-hint { font-size: 12px; color: var(--muted); }
.np-chat-counter { font-size: 12px; color: var(--muted); }

.np-room-grid { display: grid; grid-template-columns: 1fr 320px; gap: 14px; align-items: start; }
.np-panel { background: #1b2d24; border: 1px solid #2c4436; border-radius: 10px; padding: 10px; }

@media (max-width: 860px) {
  .np-room-grid { grid-template-columns: 1fr; }
  .np-seat { min-width: 84px; padding: 5px; }
  .np-card-face, .np-card-back { width: 32px; height: 44px; font-size: 15px; }
  .np-cardslot > :nth-child(2) { margin-left: -8px; }
  .np-cardslot-wide { width: 36px; height: 44px; }
  .np-table { aspect-ratio: 16 / 12; }
}
@media (max-width: 360px) {
  .np-seat { min-width: 72px; padding: 4px; font-size: 11px; }
  .np-seat-name { font-size: 12px; }
  .np-actions button { padding: 6px 8px; }
}
`;
