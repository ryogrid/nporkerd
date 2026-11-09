// CreateRoomDialog (design/07 §2.3, settings table in 05 §2): every setting is
// a labelled field with the documented default; the passphrase field appears
// only when visibility is private, with the "cannot be shown again" note (05
// §2/07 §2.3). Values are read from the fields at submit time (they are plain
// <input>s, keyboard reachable), checked locally for friendlier UX, and the
// server re-validates everything regardless.
import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { errorCopyFor } from "../lib/errorCopy";

const DEFAULTS = {
  name: "Kitchen table",
  maxSeats: "9",
  smallBlind: "10",
  bigBlind: "20",
  buyIn: "1000",
  turnSeconds: "30",
};

/** Client-side mirror of 05 §2 (the server stays the authority). */
export function localSettingErrors(
  name: string,
  visibility: string,
  passphrase: string,
  maxSeats: number,
  smallBlind: number,
  bigBlind: number,
  buyIn: number,
  turnSeconds: number,
): string[] {
  const problems: string[] = [];
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 40) {
    problems.push("the room name must be 1–40 characters");
  }
  if (visibility === "private" && (passphrase.length < 4 || passphrase.length > 64)) {
    problems.push("a private room needs a passphrase of 4–64 characters");
  }
  if (!Number.isInteger(maxSeats) || maxSeats < 2 || maxSeats > 9) {
    problems.push("seats must be a whole number 2–9");
  }
  if (!Number.isInteger(smallBlind) || smallBlind < 1) {
    problems.push("the small blind must be a whole number ≥ 1");
  }
  if (!Number.isInteger(bigBlind) || bigBlind <= smallBlind) {
    problems.push("the big blind must be a whole number above the small blind");
  }
  if (!Number.isInteger(buyIn) || buyIn < bigBlind * 10) {
    problems.push("buy-in must be at least 10 big blinds");
  }
  const clockOk = turnSeconds === 0 || (Number.isInteger(turnSeconds) && turnSeconds >= 10 && turnSeconds <= 120);
  if (!clockOk) {
    problems.push("turn clock: 0 (off) or 10–120 seconds");
  }
  return problems;
}

function wholeNumber(value: string | undefined): number {
  const digits = (value ?? "").replace(/[^0-9]/g, "");
  return digits === "" ? 0 : Number.parseInt(digits, 10);
}

export function CreateRoomDialog({ sessionToken, onCreated }: {
  sessionToken: string;
  onCreated: (roomId: Id<"rooms">) => void;
}) {
  const createRoom = useMutation(api.rooms.createRoom);
  const name = useRef<HTMLInputElement>(null);
  const visibility = useRef<HTMLSelectElement>(null);
  const passphrase = useRef<HTMLInputElement>(null);
  const maxSeats = useRef<HTMLInputElement>(null);
  const smallBlind = useRef<HTMLInputElement>(null);
  const bigBlind = useRef<HTMLInputElement>(null);
  const buyIn = useRef<HTMLInputElement>(null);
  const turnSeconds = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const chosenVisibility: "public" | "private" =
    (visibility.current?.value ?? "public") === "private" ? "private" : "public";

  async function create(): Promise<void> {
    setNotice(undefined);
    const problems = localSettingErrors(
      name.current?.value ?? DEFAULTS.name,
      chosenVisibility,
      passphrase.current?.value ?? "",
      wholeNumber(maxSeats.current?.value),
      wholeNumber(smallBlind.current?.value),
      wholeNumber(bigBlind.current?.value),
      wholeNumber(buyIn.current?.value),
      wholeNumber(turnSeconds.current?.value),
    );
    if (problems.length > 0) {
      setNotice(problems.join("; "));
      return;
    }
    const settings = {
      sessionToken,
      name: (name.current?.value ?? DEFAULTS.name).trim(),
      maxSeats: wholeNumber(maxSeats.current?.value),
      smallBlind: wholeNumber(smallBlind.current?.value),
      bigBlind: wholeNumber(bigBlind.current?.value),
      buyIn: wholeNumber(buyIn.current?.value),
      turnSeconds: wholeNumber(turnSeconds.current?.value),
    };
    try {
      const created = chosenVisibility === "private"
        ? await createRoom({
            ...settings,
            visibility: "private",
            passphrase: passphrase.current?.value ?? "",
          })
        : await createRoom({ ...settings, visibility: "public" });
      onCreated(created.roomId);
    } catch (e) {
      setNotice(errorCopyFor(e));
    }
  }

  return (
    <div className="np-card">
      <h2 className="np-title">Create a room</h2>
      <div className="np-field">
        <label>Room name (1–40 chars)</label>
        <input ref={name} type="text" value={DEFAULTS.name} />
      </div>
      <div className="np-field">
        <label>Visibility</label>
        <select ref={visibility} value="public">
          <option value="public">public</option>
          <option value="private">private</option>
        </select>
      </div>
      {chosenVisibility === "private" ? (
        <div className="np-field">
          <label>
            Passphrase, 4–64 chars — it is hashed at once and can never be shown
            again: remember it, or keep the room link and passphrase together
          </label>
          <input ref={passphrase} type="text" />
        </div>
      ) : null}
      <div className="np-field">
        <label>Seats (2–9)</label>
        <input ref={maxSeats} type="text" value={DEFAULTS.maxSeats} />
      </div>
      <div className="np-field">
        <label>Small blind (≥ 1)</label>
        <input ref={smallBlind} type="text" value={DEFAULTS.smallBlind} />
      </div>
      <div className="np-field">
        <label>Big blind (&gt; small blind)</label>
        <input ref={bigBlind} type="text" value={DEFAULTS.bigBlind} />
      </div>
      <div className="np-field">
        <label>Buy-in (≥ 10 big blinds)</label>
        <input ref={buyIn} type="text" value={DEFAULTS.buyIn} />
      </div>
      <div className="np-field">
        <label>Turn clock seconds (0 = off, else 10–120)</label>
        <input ref={turnSeconds} type="text" value={DEFAULTS.turnSeconds} />
      </div>
      <div className="np-muted">
        defaults: {DEFAULTS.maxSeats} seats · blinds {DEFAULTS.smallBlind}/{DEFAULTS.bigBlind} · buy-in {DEFAULTS.buyIn} · clock {DEFAULTS.turnSeconds}s
      </div>
      {notice === undefined ? null : <div className="np-error">{notice}</div>}
      <button type="button" onClick={() => void create()}>Create room</button>
    </div>
  );
}
