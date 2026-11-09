// Sound cue mount (Phase 10): plays one synthesized cue at most once per cue
// token. `RoomPage` mounts it with a token derived from the projection (stage +
// hand number), so "the flop was dealt" fires once while the many re-renders
// that happen while the flop is showing fire never (07 §3: no timers here).
import { useState } from "react";
import { playCue } from "../lib/sound";

/**
 * Fire `cue` at most once per cue token (07 §3: no client-side timers here —
 * the token is derived from the projection, so a stage change re-renders this
 * component and the many re-renders while a stage is showing play nothing).
 */
export function SoundCue({ cue, token }: { cue: string | undefined; token: string }) {
  const [last, setLast] = useState<string>("");
  if (cue !== undefined && cue !== "" && token !== last) {
    setLast(token);
    playCue(cue);
  }
  return null;
}
