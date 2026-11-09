// The mute switch (Phase 10): a labelled button, so the sound state is legible
// without listening (07 §5's "colour is never the only signal", applied to audio
// as well). The preference lives in `localStorage` — unlike the session token
// (D-04), a mute setting that reset on every reload would be hostile.
import { useState } from "react";
import { soundOn, setSoundOn } from "../lib/sound";

export function SoundControl() {
  const [label, setLabel] = useState<string>(() => (soundOn() ? "Mute sound" : "Unmute sound"));

  function toggle(): void {
    const next = !soundOn();
    setSoundOn(next);
    setLabel(next ? "Mute sound" : "Unmute sound");
  }

  return (
    <div className="np-field np-actions">
      <button type="button" onClick={() => toggle()}>{label}</button>
      <span className="np-muted">
        sound: {soundOn() ? "on" : "off"} · cues are synthesized in the browser, so the
        app ships no audio files
      </span>
    </div>
  );
}
