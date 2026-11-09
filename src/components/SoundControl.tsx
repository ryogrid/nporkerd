// Mute toggle + volume slider. Preferences live in localStorage (lib/sound).
import { useState } from "react";
import { getVolume, playCue, setSoundOn, setVolume, soundOn } from "../lib/sound";
import { commonMessages } from "../i18n/common";
import { useT } from "../i18n/core";

export function SoundControl() {
  const t = useT(commonMessages);
  const [on, setOn] = useState(() => soundOn());
  const [volume, setVol] = useState(() => getVolume());

  function toggle(): void {
    const next = !on;
    setSoundOn(next);
    setOn(next);
    if (next) playCue("chip");
  }

  return (
    <span className="sound-ctl">
      <button
        type="button"
        className="icon-btn"
        onClick={toggle}
        aria-pressed={on}
        title={on ? t("muteSound") : t("soundOn")}
        aria-label={on ? t("muteSound") : t("soundOn")}
      >
        {on ? "🔊" : "🔇"}
      </button>
      {on ? (
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          aria-label={t("volume")}
          onChange={(e) => {
            const v = Number(e.target.value);
            setVol(v);
            setVolume(v);
          }}
          onPointerUp={() => playCue("chip")}
        />
      ) : null}
    </span>
  );
}
