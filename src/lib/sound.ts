// Sound cues — design/TODO Phase 10. Deliberately **synthesized in the
// browser**: the SPA ships no audio files, so the static-hosting upload stays a
// single small bundle (07 §1's "no image assets" rule extended to sound) and
// there is nothing to preload or cache. Every cue is short (< 0.5 s), low volume
// and never loops; each one has a visual counterpart on screen (actions, stage
// labels, winner text), so sound is never the only signal (07 §5).
//
// Preference is remembered in `localStorage` (not `sessionStorage`: 07 §1's
// D-04 discussion is about the session token, and a mute preference that reset
// on every reload would be hostile).
export const SOUND_STORAGE_KEY = "nporkerd.sound";

/** The user's mute switch (default on: the game is meant to be played). */
export function soundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean): void {
  try {
    void localStorage.setItem(SOUND_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // private-mode storage failures are simply ignored: the toggle still works
    // for the rest of this render
  }
}

/** A cue: a handful of tiny tones, each a `start`/`duration` in seconds. */
type Tone = { at: number; dur: number; from: number; to: number; gain: number; sweep: boolean };

const CUES: Record<string, Tone[]> = {
  // cards sliding off the box: three short descending swishes
  deal: [
    { at: 0, dur: 0.12, from: 900, to: 420, gain: 0.06, sweep: true },
    { at: 0.09, dur: 0.12, from: 820, to: 380, gain: 0.05, sweep: true },
    { at: 0.18, dur: 0.12, from: 740, to: 340, gain: 0.045, sweep: true },
  ],
  // community cards: swishes plus a soft centre chime
  flop: [
    { at: 0, dur: 0.11, from: 880, to: 430, gain: 0.06, sweep: true },
    { at: 0.08, dur: 0.11, from: 800, to: 390, gain: 0.05, sweep: true },
    { at: 0.16, dur: 0.11, from: 720, to: 350, gain: 0.045, sweep: true },
    { at: 0.2, dur: 0.16, from: 660, to: 660, gain: 0.05, sweep: false },
  ],
  turn: [
    { at: 0, dur: 0.11, from: 820, to: 400, gain: 0.055, sweep: true },
    { at: 0.1, dur: 0.16, from: 720, to: 720, gain: 0.05, sweep: false },
  ],
  river: [
    { at: 0, dur: 0.11, from: 760, to: 380, gain: 0.055, sweep: true },
    { at: 0.1, dur: 0.18, from: 560, to: 560, gain: 0.05, sweep: false },
  ],
  // showdown: rising arpeggio, the reveal cue
  showdown: [
    { at: 0, dur: 0.1, from: 420, to: 640, gain: 0.05, sweep: true },
    { at: 0.07, dur: 0.1, from: 520, to: 760, gain: 0.05, sweep: true },
    { at: 0.14, dur: 0.14, from: 640, to: 880, gain: 0.06, sweep: true },
  ],
  // hand over: one low, respectful note
  "hand-over": [
    { at: 0, dur: 0.3, from: 320, to: 240, gain: 0.05, sweep: true },
    { at: 0.06, dur: 0.22, from: 480, to: 480, gain: 0.04, sweep: false },
  ],
  // the player's own actions (a chip sound, then the shape of the action)
  "action-check": [{ at: 0, dur: 0.07, from: 300, to: 300, gain: 0.045, sweep: false }],
  "action-call": [
    { at: 0, dur: 0.06, from: 340, to: 300, gain: 0.05, sweep: false },
    { at: 0.07, dur: 0.06, from: 300, to: 270, gain: 0.04, sweep: false },
  ],
  "action-raise": [
    { at: 0, dur: 0.06, from: 340, to: 300, gain: 0.05, sweep: false },
    { at: 0.07, dur: 0.09, from: 520, to: 700, gain: 0.055, sweep: true },
    { at: 0.15, dur: 0.06, from: 380, to: 340, gain: 0.04, sweep: false },
  ],
  "action-allin": [
    { at: 0, dur: 0.08, from: 340, to: 300, gain: 0.06, sweep: false },
    { at: 0.05, dur: 0.22, from: 420, to: 900, gain: 0.07, sweep: true },
  ],
  // a card-to-table fold: quiet, slightly dull
  "action-fold": [{ at: 0, dur: 0.14, from: 480, to: 220, gain: 0.05, sweep: true }],
  // chat: a tiny tick, deliberately the softest thing on the page
  "action-chat": [{ at: 0, dur: 0.05, from: 520, to: 480, gain: 0.035, sweep: false }],
  // rejected: two low blips, never a punishing sound
  deny: [
    { at: 0, dur: 0.07, from: 220, to: 200, gain: 0.05, sweep: false },
    { at: 0.1, dur: 0.07, from: 200, to: 180, gain: 0.05, sweep: false },
  ],
};

/** One browser-wide audio graph, created on the first cue that is played. */
let audio: AudioContext | undefined = undefined;

export function playCue(cue: string): void {
  if (!soundOn()) {
    return;
  }
  const tones = CUES[cue];
  if (tones === undefined) {
    return;
  }
  try {
    if (audio === undefined) {
      audio = new AudioContext();
    }
    const ctx = audio!;
    if (ctx === undefined) {
      return;
    }
    if (ctx.state === "closed") {
      audio = undefined;
      return;
    }
    for (const tone of tones) {
      playTone(ctx, tone);
    }
  } catch {
    // no audio graph (unsupported context, tab taken elsewhere): stay silent
    audio = undefined;
  }
}

function playTone(ctx: AudioContext, tone: Tone): void {
  const start = ctx.currentTime + tone.at;
  const stop = start + tone.dur;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = tone.sweep ? "sine" : "triangle";
  osc.frequency.setValueAtTime(Math.max(1, tone.from), start);
  if (tone.to !== tone.from) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, tone.to), start + tone.dur * 0.8);
  }
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(tone.gain, start + tone.dur * 0.25);
  gain.gain.linearRampToValueAtTime(0.0001, stop);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(stop);
}
