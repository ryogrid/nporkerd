// Host a table: stake presets plus fully editable settings, checked locally
// for friendly messages (the server re-validates everything).
import { FormEvent, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { errorCopyFor } from "../lib/errorCopy";
import { formatChips } from "../lib/format";
import { useToast } from "../lib/toast";
import {
  BUY_IN_MIN_BIG_BLINDS,
  MAX_SEATS_MAX,
  MAX_SEATS_MIN,
  PASSPHRASE_MAX,
  PASSPHRASE_MIN,
  ROOM_NAME_MAX,
  TURN_SECONDS_MAX,
  TURN_SECONDS_MIN,
} from "../../convex/lib/constants";

const STAKES: Array<{ label: string; sb: number; bb: number; buyIn: number }> = [
  { label: "Micro", sb: 5, bb: 10, buyIn: 500 },
  { label: "Low", sb: 10, bb: 20, buyIn: 1000 },
  { label: "Mid", sb: 25, bb: 50, buyIn: 2500 },
  { label: "High", sb: 100, bb: 200, buyIn: 10000 },
];

export function localSettingErrors(s: {
  name: string; visibility: string; passphrase: string; maxSeats: number;
  smallBlind: number; bigBlind: number; buyIn: number; turnSeconds: number;
}): string[] {
  const problems: string[] = [];
  const trimmed = s.name.trim();
  if (trimmed.length < 1 || trimmed.length > ROOM_NAME_MAX) problems.push(`Name must be 1–${ROOM_NAME_MAX} characters.`);
  if (s.visibility === "private" && (s.passphrase.length < PASSPHRASE_MIN || s.passphrase.length > PASSPHRASE_MAX)) {
    problems.push(`Passphrase must be ${PASSPHRASE_MIN}–${PASSPHRASE_MAX} characters.`);
  }
  if (!Number.isInteger(s.maxSeats) || s.maxSeats < MAX_SEATS_MIN || s.maxSeats > MAX_SEATS_MAX) problems.push(`Seats: ${MAX_SEATS_MIN}–${MAX_SEATS_MAX}.`);
  if (!Number.isInteger(s.smallBlind) || s.smallBlind < 1) problems.push("Small blind must be at least 1.");
  if (!Number.isInteger(s.bigBlind) || s.bigBlind <= s.smallBlind) problems.push("Big blind must be above the small blind.");
  if (!Number.isInteger(s.buyIn) || s.buyIn < s.bigBlind * BUY_IN_MIN_BIG_BLINDS) {
    problems.push(`Buy-in must be at least ${BUY_IN_MIN_BIG_BLINDS} big blinds (${formatChips(s.bigBlind * BUY_IN_MIN_BIG_BLINDS)}).`);
  }
  const clockOk = s.turnSeconds === 0 || (Number.isInteger(s.turnSeconds) && s.turnSeconds >= TURN_SECONDS_MIN && s.turnSeconds <= TURN_SECONDS_MAX);
  if (!clockOk) problems.push(`Turn clock: 0 (off) or ${TURN_SECONDS_MIN}–${TURN_SECONDS_MAX} seconds.`);
  return problems;
}

const toInt = (v: string) => {
  const digits = v.replace(/[^0-9]/g, "");
  return digits === "" ? 0 : Number.parseInt(digits, 10);
};

export function CreateRoomDialog({ sessionToken, defaultName, onCreated }: {
  sessionToken: string;
  defaultName: string;
  onCreated: (roomId: Id<"rooms">) => void;
}) {
  const createRoom = useMutation(api.rooms.createRoom);
  const toast = useToast();
  const [name, setName] = useState(defaultName);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [passphrase, setPassphrase] = useState("");
  const [maxSeats, setMaxSeats] = useState("6");
  const [smallBlind, setSmallBlind] = useState("10");
  const [bigBlind, setBigBlind] = useState("20");
  const [buyIn, setBuyIn] = useState("1000");
  const [turnSeconds, setTurnSeconds] = useState("30");
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const settings = {
    name, visibility, passphrase,
    maxSeats: toInt(maxSeats), smallBlind: toInt(smallBlind), bigBlind: toInt(bigBlind),
    buyIn: toInt(buyIn), turnSeconds: toInt(turnSeconds),
  };
  const activeStake = STAKES.find((s) => s.sb === settings.smallBlind && s.bb === settings.bigBlind && s.buyIn === settings.buyIn);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const found = localSettingErrors(settings);
    setProblems(found);
    if (found.length > 0 || busy) return;
    setBusy(true);
    try {
      const base = {
        sessionToken,
        name: name.trim(),
        maxSeats: settings.maxSeats,
        smallBlind: settings.smallBlind,
        bigBlind: settings.bigBlind,
        buyIn: settings.buyIn,
        turnSeconds: settings.turnSeconds,
      };
      const created = visibility === "private"
        ? await createRoom({ ...base, visibility: "private", passphrase })
        : await createRoom({ ...base, visibility: "public" });
      onCreated(created.roomId);
    } catch (err) {
      toast.push(errorCopyFor(err));
      setBusy(false);
    }
  }

  return (
    <form className="panel panel-pad stack" onSubmit={(e) => void submit(e)}>
      <h2 className="panel-title" style={{ margin: 0 }}>Host a table</h2>
      <label className="field">
        <span>Table name</span>
        <input className="input" value={name} maxLength={ROOM_NAME_MAX} onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="field">
        <span>Stakes</span>
        <div className="segmented" role="group" aria-label="Stakes presets">
          {STAKES.map((s) => (
            <button
              key={s.label}
              type="button"
              className={activeStake === s ? "on" : ""}
              onClick={() => { setSmallBlind(String(s.sb)); setBigBlind(String(s.bb)); setBuyIn(String(s.buyIn)); }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid-3">
        <label className="field"><span>Small blind</span><input className="input" inputMode="numeric" value={smallBlind} onChange={(e) => setSmallBlind(e.target.value)} /></label>
        <label className="field"><span>Big blind</span><input className="input" inputMode="numeric" value={bigBlind} onChange={(e) => setBigBlind(e.target.value)} /></label>
        <label className="field"><span>Buy-in</span><input className="input" inputMode="numeric" value={buyIn} onChange={(e) => setBuyIn(e.target.value)} /></label>
      </div>
      <div className="grid-2">
        <label className="field">
          <span>Seats</span>
          <select className="select input" value={maxSeats} onChange={(e) => setMaxSeats(e.target.value)}>
            {Array.from({ length: MAX_SEATS_MAX - MAX_SEATS_MIN + 1 }, (_, i) => i + MAX_SEATS_MIN).map((n) => (
              <option key={n} value={String(n)}>{n === 2 ? "2 (heads-up)" : n}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Turn clock</span>
          <select className="select input" value={turnSeconds} onChange={(e) => setTurnSeconds(e.target.value)}>
            {[15, 20, 30, 45, 60, 90, 120].map((n) => <option key={n} value={String(n)}>{n} seconds</option>)}
            <option value="0">Off</option>
          </select>
        </label>
      </div>

      <div className="field">
        <span>Visibility</span>
        <div className="segmented" role="group" aria-label="Visibility">
          <button type="button" className={visibility === "public" ? "on" : ""} onClick={() => setVisibility("public")}>🌐 Public</button>
          <button type="button" className={visibility === "private" ? "on" : ""} onClick={() => setVisibility("private")}>🔒 Private</button>
        </div>
      </div>
      {visibility === "private" ? (
        <label className="field">
          <span>Passphrase</span>
          <input className="input" type="text" value={passphrase} maxLength={PASSPHRASE_MAX} onChange={(e) => setPassphrase(e.target.value)} placeholder={`${PASSPHRASE_MIN}+ characters`} />
          <small>Share the link and the passphrase with friends. It's stored hashed and can't be shown again.</small>
        </label>
      ) : null}

      {problems.length > 0 ? (
        <div className="error-text" role="alert">{problems.map((p) => <div key={p}>{p}</div>)}</div>
      ) : null}
      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
        {busy ? "Opening table…" : "Open table"}
      </button>
    </form>
  );
}
