// Sound cues, synthesized in the browser with WebAudio. No audio files ship,
// so the static bundle stays small and there is nothing to preload. Cards are
// filtered noise "snaps", chips are bright resonant transients, knocks are a
// low-mid thump. Each hit gets a little random pitch/level/timing so repeats
// don't sound robotic. All voices go through one master gain + compressor.
// Every cue has an on-screen counterpart, so sound is never the only signal.

export const SOUND_STORAGE_KEY = "nporkerd.sound";
const VOLUME_STORAGE_KEY = "nporkerd.volume";
const DEFAULT_VOLUME = 0.7;

/** The user's mute switch (default on). */
export function soundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean): void {
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // storage unavailable (private mode): ignore
  }
}

let volume: number | undefined;

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_VOLUME;
}

/** Master volume 0..1 (default 0.7), persisted in localStorage. */
export function getVolume(): number {
  if (volume === undefined) {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(VOLUME_STORAGE_KEY);
    } catch {
      stored = null;
    }
    volume = stored === null ? DEFAULT_VOLUME : clamp01(Number.parseFloat(stored));
  }
  return volume;
}

export function setVolume(v: number): void {
  volume = clamp01(v);
  try {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
  } catch {
    // ignore
  }
  if (engine !== undefined) {
    try {
      const now = engine.ctx.currentTime;
      engine.master.gain.cancelScheduledValues(now);
      engine.master.gain.setTargetAtTime(masterLevel(), now, 0.02);
    } catch {
      // ignore
    }
  }
}

/** Headroom: full volume maps to this master gain (compressor catches peaks). */
function masterLevel(): number {
  const v = getVolume();
  return v * v * 0.9; // perceptual-ish curve
}

// ---------------------------------------------------------------------------
// Engine: one AudioContext + master bus, recreated if closed.

type Engine = {
  ctx: AudioContext;
  master: GainNode;
  noise: AudioBuffer;
};

let engine: Engine | undefined;
let unsupported = false;

function audioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext;
}

function makeNoise(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 1.0);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function getEngine(): Engine | undefined {
  if (unsupported) return undefined;
  if (engine !== undefined && engine.ctx.state === "closed") engine = undefined;
  if (engine === undefined) {
    const Ctor = audioContextCtor();
    if (Ctor === undefined) {
      unsupported = true;
      return undefined;
    }
    const ctx = new Ctor();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    const master = ctx.createGain();
    master.gain.value = masterLevel();
    master.connect(comp);
    comp.connect(ctx.destination);
    engine = { ctx, master, noise: makeNoise(ctx) };
  }
  if (engine.ctx.state === "suspended") {
    void engine.ctx.resume().catch(() => undefined);
  }
  return engine;
}

/** Create/resume the AudioContext; call from a user gesture (pointerdown/keydown). */
export function unlockAudio(): void {
  try {
    getEngine();
  } catch {
    engine = undefined;
  }
}

// ---------------------------------------------------------------------------
// Voices. `t` is an absolute context time.

const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);

/** Gain node with a fast attack and exponential decay; returns it connected to master. */
function env(e: Engine, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = e.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(e.master);
  return g;
}

type NoiseOpts = {
  type: BiquadFilterType;
  freq: number;
  q: number;
  gain: number;
  attack: number;
  decay: number;
  freqEnd?: number; // optional filter sweep target
  rate?: number; // playback rate (pitch colour of the noise)
};

function noise(e: Engine, t: number, o: NoiseOpts): void {
  const src = e.ctx.createBufferSource();
  src.buffer = e.noise;
  src.playbackRate.value = o.rate ?? 1;
  const f = e.ctx.createBiquadFilter();
  f.type = o.type;
  f.Q.value = o.q;
  f.frequency.setValueAtTime(o.freq, t);
  if (o.freqEnd !== undefined) {
    f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.attack + o.decay);
  }
  const g = env(e, t, o.gain, o.attack, o.decay);
  src.connect(f);
  f.connect(g);
  const dur = o.attack + o.decay + 0.02;
  src.start(t, Math.random() * 0.5, dur);
  src.stop(t + dur);
  src.onended = () => g.disconnect();
}

type ToneOpts = {
  freq: number;
  gain: number;
  attack: number;
  decay: number;
  type?: OscillatorType;
  freqEnd?: number;
  lowpass?: number;
};

function tone(e: Engine, t: number, o: ToneOpts): void {
  const osc = e.ctx.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.attack + o.decay);
  }
  const g = env(e, t, o.gain, o.attack, o.decay);
  if (o.lowpass !== undefined) {
    const f = e.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = o.lowpass;
    osc.connect(f);
    f.connect(g);
  } else {
    osc.connect(g);
  }
  osc.start(t);
  osc.stop(t + o.attack + o.decay + 0.02);
  osc.onended = () => g.disconnect();
}

/** Clay chip clack: bright noise transient + two inharmonic high partials. */
function chip(e: Engine, t: number, level = 1): void {
  const l = level * rand(0.8, 1.05);
  const f0 = rand(2600, 3800);
  noise(e, t, { type: "bandpass", freq: rand(3500, 5500), q: 1.6, gain: 0.5 * l, attack: 0.001, decay: rand(0.02, 0.035) });
  tone(e, t, { freq: f0, gain: 0.16 * l, attack: 0.001, decay: rand(0.05, 0.08) });
  tone(e, t, { freq: f0 * rand(1.47, 1.53), gain: 0.07 * l, attack: 0.001, decay: rand(0.03, 0.05) });
  // a little body so it isn't all sizzle
  noise(e, t, { type: "bandpass", freq: rand(1100, 1500), q: 2, gain: 0.18 * l, attack: 0.001, decay: 0.03 });
}

/** Card snap on felt: crisp high noise flick + a soft low "thwap". */
function card(e: Engine, t: number, level = 1, weight = 1): void {
  const l = level * rand(0.85, 1.05);
  noise(e, t, { type: "bandpass", freq: rand(2200, 3200), q: 0.9, gain: 0.45 * l, attack: 0.002, decay: rand(0.03, 0.045), freqEnd: 1400 });
  noise(e, t + 0.006, { type: "lowpass", freq: 700 * weight, q: 0.7, gain: 0.35 * l * weight, attack: 0.002, decay: 0.05 });
}

/** Card sliding across felt: a filtered noise whoosh. */
function slide(e: Engine, t: number, dur: number, level = 1, from = 900, to = 2400): void {
  noise(e, t, { type: "bandpass", freq: from, freqEnd: to, q: 0.8, gain: 0.22 * level, attack: dur * 0.45, decay: dur * 0.55 });
}

/** Knuckle knock on the table rail. */
function knock(e: Engine, t: number, level = 1): void {
  const l = level * rand(0.9, 1.05);
  noise(e, t, { type: "bandpass", freq: rand(700, 900), q: 3, gain: 0.5 * l, attack: 0.001, decay: 0.04 });
  tone(e, t, { freq: rand(190, 230), freqEnd: 120, gain: 0.5 * l, attack: 0.002, decay: 0.09 });
}

/** Soft bell: sine fundamental + quiet upper partial. */
function bell(e: Engine, t: number, freq: number, level = 1, decay = 0.35): void {
  tone(e, t, { freq, gain: 0.16 * level, attack: 0.004, decay });
  tone(e, t, { freq: freq * 2.01, gain: 0.05 * level, attack: 0.002, decay: decay * 0.5 });
  tone(e, t, { freq: freq * 3.0, gain: 0.02 * level, attack: 0.002, decay: decay * 0.25 });
}

/** Low body thump (all-in). */
function thump(e: Engine, t: number, level = 1): void {
  tone(e, t, { freq: 95, freqEnd: 45, gain: 0.6 * level, attack: 0.004, decay: 0.28 });
  noise(e, t, { type: "lowpass", freq: 300, q: 0.7, gain: 0.3 * level, attack: 0.002, decay: 0.1 });
}

/** A run of chips, `n` hits spaced ~`gap` apart with jitter. */
function chips(e: Engine, t: number, n: number, gap: number, level = 1): void {
  let at = t;
  for (let i = 0; i < n; i++) {
    chip(e, at, level * (1 - i * 0.04));
    at += gap * rand(0.7, 1.3);
  }
}

const note = (semisFromA4: number): number => 440 * Math.pow(2, semisFromA4 / 12);

// ---------------------------------------------------------------------------
// Cues

const CUES: Record<string, (e: Engine, t: number) => void> = {
  deal: (e, t) => {
    // dealing around the table: a few quick flicks, the last one landing
    for (let i = 0; i < 4; i++) card(e, t + i * 0.085 + rand(0, 0.015), 0.75 - i * 0.05, 0.6);
  },
  flop: (e, t) => {
    slide(e, t, 0.12, 0.6);
    for (let i = 0; i < 3; i++) card(e, t + 0.08 + i * 0.1 + rand(0, 0.015), 0.9, 1);
  },
  turn: (e, t) => {
    slide(e, t, 0.1, 0.5, 1000, 2600);
    card(e, t + 0.07, 1, 1);
  },
  river: (e, t) => {
    slide(e, t, 0.11, 0.5, 800, 2200);
    card(e, t + 0.08, 1.05, 1.3);
  },
  showdown: (e, t) => {
    card(e, t, 0.8, 0.8);
    card(e, t + 0.07, 0.8, 0.8);
    bell(e, t + 0.12, note(3), 0.7, 0.4); // C5
    bell(e, t + 0.2, note(10), 0.7, 0.45); // G5
  },
  win: (e, t) => {
    // chip cascade (accelerating) under a bright major arpeggio
    let at = t;
    for (let i = 0; i < 10; i++) {
      chip(e, at, 0.75);
      at += Math.max(0.025, 0.07 - i * 0.005) * rand(0.8, 1.2);
    }
    const arp = [15, 19, 22, 27]; // C6 E6 G6 C7
    arp.forEach((s, i) => bell(e, t + 0.05 + i * 0.09, note(s), 0.8, i === arp.length - 1 ? 0.6 : 0.3));
  },
  "hand-over": (e, t) => {
    tone(e, t, { freq: note(-2), type: "triangle", lowpass: 1200, gain: 0.14, attack: 0.01, decay: 0.35 }); // G4
    tone(e, t + 0.1, { freq: note(-9), type: "triangle", lowpass: 1000, gain: 0.12, attack: 0.01, decay: 0.4 }); // C4
  },
  "your-turn": (e, t) => {
    bell(e, t, note(12), 0.9, 0.3); // A5
    bell(e, t + 0.11, note(19), 0.9, 0.4); // E6
  },
  tick: (e, t) => {
    noise(e, t, { type: "bandpass", freq: 2400, q: 4, gain: 0.18, attack: 0.001, decay: 0.012 });
    tone(e, t, { freq: 1800, gain: 0.05, attack: 0.001, decay: 0.02 });
  },
  "action-check": (e, t) => {
    knock(e, t, 1);
    knock(e, t + 0.11 + rand(0, 0.02), 0.85);
  },
  "action-call": (e, t) => chips(e, t, 3, 0.05, 0.9),
  "action-raise": (e, t) => {
    slide(e, t, 0.14, 0.5, 600, 1800);
    chips(e, t + 0.06, 5, 0.04, 0.9);
  },
  "action-allin": (e, t) => {
    slide(e, t, 0.32, 0.9, 500, 2000);
    chips(e, t + 0.05, 9, 0.03, 0.8);
    thump(e, t + 0.3, 1);
  },
  "action-fold": (e, t) => {
    noise(e, t, { type: "lowpass", freq: 2200, freqEnd: 500, q: 0.6, gain: 0.25, attack: 0.04, decay: 0.16 });
  },
  chip: (e, t) => chip(e, t, 0.8),
  "action-chat": (e, t) => {
    tone(e, t, { freq: 600, freqEnd: 1100, gain: 0.12, attack: 0.002, decay: 0.05 });
  },
  deny: (e, t) => {
    tone(e, t, { freq: note(-12), type: "triangle", lowpass: 900, gain: 0.18, attack: 0.005, decay: 0.1 }); // A3
    tone(e, t + 0.12, { freq: note(-16), type: "triangle", lowpass: 800, gain: 0.18, attack: 0.005, decay: 0.14 }); // F3
  },
  click: (e, t) => {
    noise(e, t, { type: "highpass", freq: 3500, q: 0.7, gain: 0.12, attack: 0.001, decay: 0.008 });
  },
};

/** Play a named cue. Unknown names are ignored; never throws. */
export function playCue(cue: string): void {
  try {
    if (!soundOn()) return;
    if (!Object.hasOwn(CUES, cue)) return;
    const fn = CUES[cue];
    const e = getEngine();
    if (e === undefined) return;
    // small lookahead so scheduled envelopes start cleanly
    fn(e, e.ctx.currentTime + 0.01);
  } catch {
    // broken graph: drop it so the next cue starts fresh
    engine = undefined;
  }
}
