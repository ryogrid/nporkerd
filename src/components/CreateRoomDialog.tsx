// Host a table: stake presets plus fully editable settings, checked locally
// for friendly messages (the server re-validates everything). Every field has
// a one-line plain-language help, and the defaults (Low stakes, 6 seats, 30 s
// clock, public) are good enough to just press "Open table".
import { FormEvent, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { errorCopyFor } from "../lib/errorCopy";
import { formatChips } from "../lib/format";
import { useToast } from "../lib/toast";
import { tr, useT } from "../i18n/core";
import { createRoomMessages } from "../i18n/lobby";
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
import "../styles-entry.css";

type StakeLabel = "stakeMicro" | "stakeLow" | "stakeMid" | "stakeHigh";

const STAKES: Array<{ label: StakeLabel; sb: number; bb: number; buyIn: number }> = [
  { label: "stakeMicro", sb: 5, bb: 10, buyIn: 500 },
  { label: "stakeLow", sb: 10, bb: 20, buyIn: 1000 },
  { label: "stakeMid", sb: 25, bb: 50, buyIn: 2500 },
  { label: "stakeHigh", sb: 100, bb: 200, buyIn: 10000 },
];

export function localSettingErrors(s: {
  name: string; visibility: string; passphrase: string; maxSeats: number;
  smallBlind: number; bigBlind: number; buyIn: number; turnSeconds: number;
}): string[] {
  const m = createRoomMessages;
  const problems: string[] = [];
  const trimmed = s.name.trim();
  if (trimmed.length < 1 || trimmed.length > ROOM_NAME_MAX) problems.push(tr(m, "errName", { max: ROOM_NAME_MAX }));
  if (s.visibility === "private" && (s.passphrase.length < PASSPHRASE_MIN || s.passphrase.length > PASSPHRASE_MAX)) {
    problems.push(tr(m, "errPassphrase", { min: PASSPHRASE_MIN, max: PASSPHRASE_MAX }));
  }
  if (!Number.isInteger(s.maxSeats) || s.maxSeats < MAX_SEATS_MIN || s.maxSeats > MAX_SEATS_MAX) {
    problems.push(tr(m, "errSeats", { min: MAX_SEATS_MIN, max: MAX_SEATS_MAX }));
  }
  if (!Number.isInteger(s.smallBlind) || s.smallBlind < 1) problems.push(tr(m, "errSmallBlind"));
  if (!Number.isInteger(s.bigBlind) || s.bigBlind <= s.smallBlind) problems.push(tr(m, "errBigBlind"));
  if (!Number.isInteger(s.buyIn) || s.buyIn < s.bigBlind * BUY_IN_MIN_BIG_BLINDS) {
    problems.push(tr(m, "errBuyIn", { n: BUY_IN_MIN_BIG_BLINDS, chips: formatChips(s.bigBlind * BUY_IN_MIN_BIG_BLINDS) }));
  }
  const clockOk = s.turnSeconds === 0 || (Number.isInteger(s.turnSeconds) && s.turnSeconds >= TURN_SECONDS_MIN && s.turnSeconds <= TURN_SECONDS_MAX);
  if (!clockOk) problems.push(tr(m, "errClock", { min: TURN_SECONDS_MIN, max: TURN_SECONDS_MAX }));
  return problems;
}

const toInt = (v: string) => {
  const digits = v.replace(/[^0-9]/g, "");
  return digits === "" ? 0 : Number.parseInt(digits, 10);
};

export function CreateRoomDialog({ sessionToken, defaultName, onCreated, highlight = false, id }: {
  sessionToken: string;
  defaultName: string;
  onCreated: (roomId: Id<"rooms">) => void;
  /** Put the attention ring on "Open table" (the lobby's NextStep points here). */
  highlight?: boolean;
  id?: string;
}) {
  const t = useT(createRoomMessages);
  const createRoom = useMutation(api.rooms.createRoom);
  const toast = useToast();
  // untouched, the name follows defaultName (which is in the current language)
  const [editedName, setName] = useState<string | undefined>(undefined);
  const name = editedName ?? defaultName;
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [passphrase, setPassphrase] = useState("");
  const [maxSeats, setMaxSeats] = useState("6");
  const [smallBlind, setSmallBlind] = useState("10");
  const [bigBlind, setBigBlind] = useState("20");
  const [buyIn, setBuyIn] = useState("1000");
  const [turnSeconds, setTurnSeconds] = useState("30");
  const [busy, setBusy] = useState(false);
  // after the first submit, problems are re-derived live (and in the current language)
  const [checked, setChecked] = useState(false);

  const settings = {
    name, visibility, passphrase,
    maxSeats: toInt(maxSeats), smallBlind: toInt(smallBlind), bigBlind: toInt(bigBlind),
    buyIn: toInt(buyIn), turnSeconds: toInt(turnSeconds),
  };
  const problems = checked ? localSettingErrors(settings) : [];
  const activeStake = STAKES.find((s) => s.sb === settings.smallBlind && s.bb === settings.bigBlind && s.buyIn === settings.buyIn);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const found = localSettingErrors(settings);
    setChecked(true);
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
    <form id={id} className="panel panel-pad stack create-room" onSubmit={(e) => void submit(e)}>
      <div>
        <h2 className="panel-title" style={{ margin: 0 }}>{t("title")}</h2>
        <p className="field-help create-intro">{t("intro")}</p>
      </div>
      <label className="field">
        <span>{t("name")}</span>
        <input className="input" value={name} maxLength={ROOM_NAME_MAX} onChange={(e) => setName(e.target.value)} />
        <small>{t("nameHelp")}</small>
      </label>

      <div className="field">
        <span>{t("stakes")}</span>
        <div className="segmented stakes-presets" role="group" aria-label={t("stakesLabel")}>
          {STAKES.map((s) => (
            <button
              key={s.label}
              type="button"
              className={activeStake === s ? "on" : ""}
              aria-pressed={activeStake === s}
              title={`${formatChips(s.sb)}/${formatChips(s.bb)} · ${formatChips(s.buyIn)}`}
              onClick={() => { setSmallBlind(String(s.sb)); setBigBlind(String(s.bb)); setBuyIn(String(s.buyIn)); }}
            >
              {t(s.label)}
            </button>
          ))}
        </div>
        <small>{t("stakesHelp")}</small>
      </div>
      <div className="field">
        <div className="grid-3 chip-fields">
          <label className="field"><span>{t("smallBlind")}</span><input className="input" inputMode="numeric" value={smallBlind} onChange={(e) => setSmallBlind(e.target.value)} /></label>
          <label className="field"><span>{t("bigBlind")}</span><input className="input" inputMode="numeric" value={bigBlind} onChange={(e) => setBigBlind(e.target.value)} /></label>
          <label className="field"><span>{t("buyIn")}</span><input className="input" inputMode="numeric" value={buyIn} onChange={(e) => setBuyIn(e.target.value)} /></label>
        </div>
        <small>{t("chipsHelp", { min: BUY_IN_MIN_BIG_BLINDS })}</small>
      </div>
      <div className="grid-2 create-pair">
        <label className="field">
          <span>{t("seats")}</span>
          <select className="select input" value={maxSeats} onChange={(e) => setMaxSeats(e.target.value)}>
            {Array.from({ length: MAX_SEATS_MAX - MAX_SEATS_MIN + 1 }, (_, i) => i + MAX_SEATS_MIN).map((n) => (
              <option key={n} value={String(n)}>{n === 2 ? t("headsUp") : n}</option>
            ))}
          </select>
          <small>{t("seatsHelp")}</small>
        </label>
        <label className="field">
          <span>{t("clock")}</span>
          <select className="select input" value={turnSeconds} onChange={(e) => setTurnSeconds(e.target.value)}>
            {[15, 20, 30, 45, 60, 90, 120].map((n) => <option key={n} value={String(n)}>{t("seconds", { n })}</option>)}
            <option value="0">{t("clockOff")}</option>
          </select>
          <small>{t("clockHelp")}</small>
        </label>
      </div>

      <div className="field">
        <span>{t("visibility")}</span>
        <div className="segmented" role="group" aria-label={t("visibility")}>
          <button type="button" aria-pressed={visibility === "public"} className={visibility === "public" ? "on" : ""} onClick={() => setVisibility("public")}>{t("public")}</button>
          <button type="button" aria-pressed={visibility === "private"} className={visibility === "private" ? "on" : ""} onClick={() => setVisibility("private")}>{t("private")}</button>
        </div>
        <small>{visibility === "public" ? t("publicHelp") : t("privateHelp")}</small>
      </div>
      {visibility === "private" ? (
        <label className="field">
          <span>{t("passphrase")}</span>
          <input
            className="input"
            type="text"
            value={passphrase}
            maxLength={PASSPHRASE_MAX}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder={t("passphrasePlaceholder", { min: PASSPHRASE_MIN })}
          />
          <small>{t("passphraseHelp")}</small>
        </label>
      ) : null}

      {problems.length > 0 ? (
        <div className="error-text" role="alert">{problems.map((p) => <div key={p}>{p}</div>)}</div>
      ) : null}
      <button type="submit" className={`btn btn-primary btn-lg btn-block${highlight && !busy ? " attn" : ""}`} disabled={busy}>
        {busy ? t("opening") : t("open")}
      </button>
      <p className="field-help" style={{ margin: 0, textAlign: "center" }}>{t("afterOpen")}</p>
    </form>
  );
}
