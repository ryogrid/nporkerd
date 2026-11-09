// /room/:id — the table. `rooms.getRoom` gives room metadata + membership,
// `game.getTableState` the per-viewer hand projection, chat is separate.
// Opening a public table joins it as a spectator automatically; private
// tables ask for the passphrase first. Sitting down is one click on a chair.
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { useMutation, useQuery_experimental } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { ActionBar } from "../components/ActionBar";
import { ChatPanel } from "../components/ChatPanel";
import { PokerTable, potTotal } from "../components/PokerTable";
import { TableSounds } from "../components/TableSounds";
import { errorCodeOf, errorCopyFor } from "../lib/errorCopy";
import { formatChips, secondsLeft } from "../lib/format";
import { RoomProfile, TableState } from "../lib/projection";
import { MeProfile, usePresence } from "../lib/auth";
import { Navigate } from "../lib/router";
import { useToast } from "../lib/toast";
import { useNow } from "../lib/useNow";
import { playCue } from "../lib/sound";
import { NextStep, NextStepTone, Tip } from "../components/Guide";
import { T, tr, useT } from "../i18n/core";
import { roomMessages } from "../i18n/room";
import { FAUCET_AMOUNT } from "../../convex/lib/constants";
import "../styles-room.css";

type RoomT = T<keyof typeof roomMessages.en>;

export function RoomPage({ roomId, token, me, navigate }: {
  roomId: Id<"rooms">;
  token: string;
  me: MeProfile;
  navigate: Navigate;
}) {
  const toast = useToast();
  const t = useT(roomMessages);
  const roomQuery = useQuery_experimental({
    query: api.rooms.getRoom,
    args: { sessionToken: token, roomId },
    throwOnError: false,
  });
  const room: RoomProfile | undefined = roomQuery.status === "success" ? roomQuery.data : undefined;
  const member = room !== undefined && room.yourSeatIndex !== undefined;

  const tableQuery = useQuery_experimental({
    query: api.game.getTableState,
    args: member ? { sessionToken: token, roomId } : "skip",
    throwOnError: false,
  });
  const table: TableState | undefined = tableQuery.status === "success" ? tableQuery.data : undefined;

  const joinRoom = useMutation(api.rooms.joinRoom);
  const sitDown = useMutation(api.rooms.sitDown);
  const standUp = useMutation(api.rooms.standUp);
  const toggleSitOut = useMutation(api.rooms.toggleSitOut);
  const topUp = useMutation(api.rooms.topUp);
  const leaveRoom = useMutation(api.rooms.leaveRoom);
  const startGame = useMutation(api.game.startGame);
  const endGame = useMutation(api.rooms.endGame);
  const closeRoom = useMutation(api.rooms.closeRoom);

  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [passphrase, setPassphrase] = useState("");
  // kept raw and translated at render, so it follows a language switch
  const [joinFailure, setJoinFailure] = useState<{ err: unknown; withPassphrase: boolean } | undefined>(undefined);
  const autoJoined = useRef(false);
  const selfToggled = useRef(false);
  const wasSittingOut = useRef<boolean | undefined>(undefined);

  usePresence(token, member ? roomId : undefined);

  const ticking = table !== undefined && (table.turnDeadline !== undefined || table.nextHandAt !== undefined);
  const now = useNow(ticking, 250);

  // Tell the player when the server sat them out (e.g. after timing out).
  const sittingOutNow = room?.seats?.find((s) => s.userId === me.userId)?.state === "sittingOut";
  useEffect(() => {
    if (wasSittingOut.current === false && sittingOutNow && !selfToggled.current) {
      toast.push(tr(roomMessages, "satOutToast"), "info");
    }
    wasSittingOut.current = sittingOutNow;
    selfToggled.current = false;
  }, [sittingOutNow, toast]);

  // Public table, not yet a member: join as a spectator right away.
  useEffect(() => {
    if (room === undefined) return;
    if (member) { autoJoined.current = true; return; }
    if (autoJoined.current) return;
    if (room.exists !== true || room.closed === true || room.requiresPassphrase === true) return;
    autoJoined.current = true;
    joinRoom({ sessionToken: token, roomId }).catch((e: unknown) => setJoinFailure({ err: e, withPassphrase: false }));
  }, [room, member, joinRoom, token, roomId]);

  async function run(label: string, call: () => Promise<unknown>, okCue?: string): Promise<boolean> {
    if (busy !== undefined) return false;
    setBusy(label);
    try {
      await call();
      if (okCue !== undefined) playCue(okCue);
      return true;
    } catch (e) {
      toast.push(errorCopyFor(e));
      playCue("deny");
      return false;
    } finally {
      setBusy(undefined);
    }
  }

  async function submitPassphrase(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (passphrase === "") return;
    setJoinFailure(undefined);
    setBusy("join");
    try {
      await joinRoom({ sessionToken: token, roomId, passphrase });
    } catch (err) {
      setJoinFailure({ err, withPassphrase: true });
    } finally {
      setBusy(undefined);
    }
  }

  const joinError = joinFailure === undefined
    ? undefined
    : joinFailure.withPassphrase && errorCodeOf(joinFailure.err) === "JOIN_DENIED"
      ? t("wrongPassphrase")
      : errorCopyFor(joinFailure.err);

  // ───────── gates ─────────
  if (roomQuery.status === "error") {
    return <RoomGone navigate={navigate} text={t("badLink")} />;
  }
  if (room === undefined) {
    return <div className="center-screen"><div className="spinner" /><div className="muted">{t("opening")}</div></div>;
  }
  if (room.exists !== true) {
    return <RoomGone navigate={navigate} text={t("notExist")} />;
  }
  if (room.closed === true) {
    return <RoomGone navigate={navigate} text={t("closedRoom")} />;
  }
  if (room.requiresPassphrase === true && !member) {
    return (
      <div className="auth-wrap">
        <form className="panel panel-pad stack" onSubmit={(e) => void submitPassphrase(e)}>
          <h1 className="panel-title">🔒 {t("privateTitle")}</h1>
          <p className="muted" style={{ margin: 0 }}>{t("privateText")}</p>
          <input className="input" autoFocus type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} aria-label={t("passphrase")} placeholder={t("passphrase")} />
          {joinError === undefined ? null : <div className="error-text" role="alert">{joinError}</div>}
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy !== undefined || passphrase === ""}>{t("joinTable")}</button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate("/lobby")}>{t("backToLobby")}</button>
          </div>
        </form>
      </div>
    );
  }
  if (!member) {
    return joinError === undefined
      ? <div className="center-screen"><div className="spinner" /><div className="muted">{t("takingYou")}</div></div>
      : <RoomGone navigate={navigate} text={joinError} />;
  }

  // ───────── the table ─────────
  const heroSeat = room.yourSeatIndex !== undefined && room.yourSeatIndex >= 0 ? room.yourSeatIndex : undefined;
  const heroRoomSeat = room.seats?.find((s) => s.userId === me.userId);
  const heroTableSeat = table?.seats.find((s) => s.userId === me.userId);
  const sittingOut = heroRoomSeat?.state === "sittingOut";
  const isHost = room.isHost === true;
  const stage = table?.stage ?? "waiting";
  const live = stage !== "waiting" && stage !== "finished";
  const heroInHand = heroTableSeat !== undefined && heroTableSeat.inHand && live;
  const heroDealtIn = heroTableSeat !== undefined && (heroTableSeat.inHand || heroTableSeat.folded) && live;
  const stopping = room.stopAfterHand === true;
  const buyIn = room.buyIn ?? 0;
  const bigBlind = room.bigBlind ?? 0;
  const seatedPlayers = (room.seats ?? []).filter((s) => s.seatIndex >= 0 && s.state !== "left");
  const readyPlayers = seatedPlayers.filter((s) => s.state === "seated" && s.stack > 0);
  const actor = table?.seats.find((s) => s.isCurrentTurn);
  const canAfford = me.balance >= buyIn;

  async function sit(seatIndex: number): Promise<void> {
    await run("sit", () => sitDown({ sessionToken: token, roomId, seatIndex }), "action-call");
  }

  async function leave(): Promise<void> {
    if (heroInHand && !window.confirm(t("confirmLeave"))) return;
    const ok = await run("leave", () => leaveRoom({ sessionToken: token, roomId }));
    if (ok) navigate("/lobby");
  }

  async function stand(): Promise<void> {
    if (heroInHand && !window.confirm(t("confirmStand"))) return;
    await run("stand", () => standUp({ sessionToken: token, roomId }), "action-fold");
  }

  function copyLink(): void {
    const url = `${window.location.origin}/room/${roomId}`;
    navigator.clipboard.writeText(url).then(
      () => toast.push(room?.visibility === "private" ? t("linkCopiedPrivate") : t("linkCopied"), "success"),
      () => toast.push(url, "info"),
    );
  }

  // ───────── dock: one "what to do now" message per state ─────────
  const heroStack = heroRoomSeat?.stack ?? 0;
  const maxSeats = Math.max(2, room.maxSeats ?? 9);
  const emptySeats = maxSeats - seatedPlayers.length;
  const turnSecs = table?.turnDeadline !== undefined ? secondsLeft(table.turnDeadline, now) : undefined;
  const hostName = room.hostUsername ?? t("theHost");
  const canStart = isHost && stage === "waiting" && room.status !== "playing" && table?.nextHandAt === undefined;
  const canSit = heroSeat === undefined && canAfford && emptySeats > 0;
  const canTopUp = heroStack < buyIn && me.balance > 0;
  const actorText = actor === undefined
    ? undefined
    : turnSecs === undefined ? t("actorPart", { name: actor.username }) : t("actorPartSecs", { name: actor.username, n: turnSecs });

  // which single control carries the pulsing "attn" ring
  let attn: "backBtn" | "topUp" | undefined;
  let tone: NextStepTone = "wait";
  let icon = "⏳";
  let title: ReactNode = "";
  let detail: ReactNode = undefined;
  let action: ReactNode = undefined;

  const dealButtonFor = (pulse: boolean) => (
    <button
      type="button"
      className={`btn btn-primary btn-lg${pulse ? " attn" : ""}`}
      disabled={busy !== undefined || readyPlayers.length < 2}
      title={readyPlayers.length < 2 ? t("dealNeeds") : t("dealTitle")}
      onClick={() => void run("start", () => startGame({ sessionToken: token, roomId }))}
    >
      {t("deal")}
    </button>
  );
  // the host can deal for the others even while not playing themselves
  const hostCanDealOthers = canStart && readyPlayers.length >= 2;

  if (heroSeat === undefined) {
    if (!canAfford) {
      tone = "do";
      icon = "💰";
      title = t("specPoorTitle", { buyIn: formatChips(buyIn) });
      detail = t(me.balance < FAUCET_AMOUNT ? "specPoorFaucet" : "specPoorOther", { balance: formatChips(me.balance) });
      action = <button type="button" className="btn btn-primary attn" onClick={() => navigate("/lobby")}>{t("goToLobby")}</button>;
    } else if (emptySeats <= 0) {
      icon = "👀";
      title = t("specFullTitle");
      detail = t("specFullDetail");
    } else {
      tone = "do";
      icon = "🪑";
      title = t("specSitTitle");
      detail = t("specSitDetail", { buyIn: formatChips(buyIn), balance: formatChips(me.balance) });
    }
    if (hostCanDealOthers && action === undefined) action = dealButtonFor(false);
  } else if (table !== undefined && table.yourTurn && table.legal !== undefined) {
    const legal = table.legal;
    const myBet = heroTableSeat?.betStreet ?? 0;
    const currentBet = myBet + legal.toCall;
    const canRaise = legal.maxRaiseTo >= legal.minRaiseTo && legal.maxRaiseTo > currentBet;
    const callIsAllIn = legal.canCall && legal.callAmount >= legal.maxRaiseTo - myBet;
    const options = [t("optFold")];
    if (legal.canCheck) options.push(t("optCheck"));
    else if (legal.canCall) options.push(callIsAllIn ? t("optCallAllIn") : t("optCall", { amount: formatChips(legal.callAmount) }));
    if (canRaise) options.push(currentBet === 0 ? t("optBet") : t("optRaise"));
    else if (!callIsAllIn && legal.maxRaiseTo > myBet) options.push(t("optAllIn"));
    tone = "turn";
    icon = "👉";
    title = t("turnTitle", { options: joinOptions(t, options) });
    detail = turnSecs === undefined
      ? t("turnNoClock")
      : t("turnClock", { n: turnSecs, auto: legal.canCheck ? t("autoCheck") : t("autoFold") });
  } else if (sittingOut && !heroDealtIn) {
    tone = "do";
    icon = "☕";
    title = t("sittingOutTitle");
    detail = t("sittingOutDetail");
    attn = "backBtn";
    if (hostCanDealOthers) action = dealButtonFor(false);
  } else if (heroStack === 0 && !heroDealtIn) {
    tone = "do";
    icon = "🪙";
    title = t("brokeTitle");
    if (canTopUp) {
      detail = t("brokeTopUp");
      attn = "topUp";
      if (hostCanDealOthers) action = dealButtonFor(false);
    } else {
      detail = t("brokeFaucet");
      action = (
        <>
          <button type="button" className="btn btn-primary attn" onClick={() => navigate("/lobby")}>{t("goToLobby")}</button>
          {hostCanDealOthers ? dealButtonFor(false) : null}
        </>
      );
    }
  } else if (live) {
    if (heroTableSeat?.folded === true) {
      icon = "🙅";
      title = t("foldedTitle");
      detail = actorText ?? t("foldedDetail");
    } else if (heroTableSeat?.allIn === true) {
      icon = "🎲";
      title = t("allInStepTitle");
      detail = t("allInStepDetail");
    } else if (!heroInHand) {
      icon = "🕒";
      title = t("nextHandTitle");
      detail = actorText ?? t("nextHandDetail");
    } else if (actor !== undefined) {
      icon = "⏳";
      title = turnSecs === undefined ? t("waitActor", { name: actor.username }) : t("waitActorSecs", { name: actor.username, n: turnSecs });
      detail = t("waitActorDetail");
    } else {
      icon = "🎴";
      title = t("runoutTitle");
      detail = t("runoutDetail");
    }
    if (stopping) detail = <>{detail}<br />{t("lastHand")}</>;
    if (sittingOut && heroDealtIn) detail = <>{detail}{detail === undefined ? null : <br />}{t("sitOutAfterHand")}</>;
  } else if (stage === "finished") {
    icon = "🏁";
    title = t("finishedTitle");
    detail = table?.nextHandAt !== undefined ? t("nextIn", { n: secondsLeft(table.nextHandAt, now) }) : stopping ? t("hostEnded") : undefined;
  } else if (table?.nextHandAt !== undefined) {
    icon = "⏱️";
    title = t("resumeTitle", { n: secondsLeft(table.nextHandAt, now) });
    detail = t("resumeDetail");
  } else if (room.status === "playing") {
    icon = "🔀";
    title = t("shuffling");
  } else if (readyPlayers.length < 2) {
    tone = "do";
    icon = "👋";
    title = t("inviteStepTitle");
    detail = t(room.visibility === "private" ? "inviteStepDetailPrivate" : "inviteStepDetail", { n: readyPlayers.length });
    action = <button type="button" className="btn btn-primary attn" onClick={copyLink}>{t("copyInvite")}</button>;
  } else if (canStart) {
    tone = "do";
    icon = "▶️";
    title = t("dealStepTitle");
    detail = t("dealStepDetail", { n: readyPlayers.length });
    action = dealButtonFor(true);
  } else {
    icon = "⏳";
    title = t("waitHostTitle", { host: hostName });
    detail = t("waitHostDetail");
  }

  const nextStep = <NextStep tone={tone} icon={icon} title={title} detail={detail} action={action} />;
  const showBar = heroSeat !== undefined && table !== undefined && table.yourTurn && table.legal !== undefined;


  return (
    <div className="room">
      <TableSounds table={table} heroName={me.username} now={now} />
      <div>
        <div className="room-header">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate("/lobby")} aria-label={t("lobbyAria")}>{t("lobbyBtn")}</button>
          <h1>{room.name}</h1>
          <div className="room-stats">
            {room.status === "playing"
              ? <span className="badge badge-live" title={t("badgeLiveTitle")}>{t("badgeLive")}</span>
              : <span className="badge" title={t("badgeWaitingTitle")}>{t("badgeWaiting")}</span>}
            {room.visibility === "private" ? <span className="badge badge-lock" title={t("badgePrivateTitle")}>🔒 {t("badgePrivate")}</span> : null}
            <span className="badge badge-gold" title={t("blindsBadgeTitle", { sb: formatChips(room.smallBlind ?? 0), bb: formatChips(bigBlind) })}>{formatChips(room.smallBlind ?? 0)}/{formatChips(bigBlind)}</span>
          </div>
          <span className="grow" />
          <button type="button" className="btn btn-sm" onClick={copyLink} title={t("inviteTitle")}>🔗 {t("invite")}</button>
          <button type="button" className="btn btn-sm btn-danger" disabled={busy !== undefined} onClick={() => void leave()} title={t("leaveTitle")}>{t("leave")}</button>
        </div>

        {tableQuery.status === "error" ? (
          <div className="empty-state">{errorCopyFor(tableQuery.error)}</div>
        ) : (
          <PokerTable
            room={room}
            table={table}
            heroSeat={heroSeat}
            heroName={me.username}
            now={now}
            onSit={canSit ? (i) => void sit(i) : undefined}
            sitBusy={busy !== undefined}
          />
        )}

        <div className="dock room-dock">
          {nextStep}
          {showBar && table?.legal !== undefined ? (
            <div className="dock-bar">
              <ActionBar
                key={`${table.handNumber ?? 0}-${stage}-${table.legal.toCall}-${table.legal.minRaiseTo}-${table.legal.maxRaiseTo}`}
                legal={table.legal}
                roomId={roomId}
                sessionToken={token}
                myBet={heroTableSeat?.betStreet ?? 0}
                pot={potTotal(table)}
                bigBlind={bigBlind}
              />
            </div>
          ) : null}
          {heroSeat !== undefined ? (
            <div className="hint-row seat-row">
              <span title={t("stackTitle")}>{t("stack")} <b className="nums" style={{ color: "var(--gold)" }}>{formatChips(heroStack)}</b></span>
              <span title={t("bankrollTitle")}>{t("bankroll")} <b className="nums">{formatChips(me.balance)}</b></span>
              <span className="grow" />
              <button
                type="button"
                className={`btn btn-sm${attn === "backBtn" ? " btn-primary attn" : ""}`}
                disabled={busy !== undefined}
                title={sittingOut ? t("imBackTitle") : t("sitOutTitle")}
                onClick={() => { selfToggled.current = true; void run("sitout", () => toggleSitOut({ sessionToken: token, roomId, sittingOut: !sittingOut }), "click"); }}
              >
                {sittingOut ? t("imBack") : t("sitOut")}
              </button>
              {canTopUp ? (
                <button
                  type="button"
                  className={`btn btn-sm${attn === "topUp" ? " btn-primary attn" : ""}`}
                  disabled={busy !== undefined || heroDealtIn}
                  title={heroDealtIn ? t("topUpLater") : t("topUpTitle", { amount: formatChips(buyIn) })}
                  onClick={() => void run("topup", () => topUp({ sessionToken: token, roomId }), "action-call")}
                >
                  {t("topUp", { amount: formatChips(buyIn) })}
                </button>
              ) : null}
              <button type="button" className="btn btn-sm" disabled={busy !== undefined} title={t("standUpTitle")} onClick={() => void stand()}>
                {t("standUp")}
              </button>
            </div>
          ) : null}
          {showBar ? (
            <div className="hint-row keys-row">
              <span>
                {t.rich("keys", {
                  f: <span className="kbd">F</span>,
                  c: <span className="kbd">C</span>,
                  r: <span className="kbd">R</span>,
                  a: <span className="kbd">Shift+A</span>,
                })}
              </span>
            </div>
          ) : null}
        </div>
        <div className="room-tip">
          <Tip id="room" title={t("tipTitle")} helpAnchor="hand">
            <ol>
              <li>{t("tip1")}</li>
              <li>{t("tip2")}</li>
              <li>{t("tip3")}</li>
              <li>{t("tip4")}</li>
            </ol>
          </Tip>
        </div>
      </div>

      <aside className="side">
        <div className="panel">
          <ChatPanel roomId={roomId} sessionToken={token} me={me} />
        </div>
        <div className="panel stack">
          <h3 className="section-title" style={{ margin: 0 }}>{t("tableTitle")}</h3>
          <dl className="info-list">
            <dt title={t("blindsTitle")}>{t("blinds")}</dt><dd title={t("blindsTitle")}>{formatChips(room.smallBlind ?? 0)} / {formatChips(bigBlind)}</dd>
            <dt title={t("buyInTitle")}>{t("buyIn")}</dt><dd title={t("buyInTitle")}>{formatChips(buyIn)}</dd>
            <dt title={t("turnClockTitle")}>{t("turnClockLabel")}</dt><dd title={t("turnClockTitle")}>{room.turnSeconds === 0 ? t("clockOff") : t("secondsShort", { n: room.turnSeconds ?? 0 })}</dd>
            <dt>{t("host")}</dt><dd>{room.hostUsername}{isHost ? t("youSuffix") : ""}</dd>
          </dl>
          <PlayersList t={t} room={room} meId={me.userId} />
          {isHost ? <HostControls t={t} room={room} stage={stage} pendingRestart={table?.nextHandAt !== undefined && stage === "waiting"} busy={busy !== undefined} run={run} endGame={() => endGame({ sessionToken: token, roomId })} closeRoom={() => closeRoom({ sessionToken: token, roomId })} onClosed={() => navigate("/lobby")} /> : null}
        </div>
      </aside>
    </div>
  );
}

/** "Fold, Check or Raise" / 「フォールド・チェック・レイズ」. */
function joinOptions(t: RoomT, options: string[]): string {
  if (options.length <= 1) return options.join("");
  if (options.length === 2) return t("optJoinTwo", { a: options[0], b: options[1] });
  return t("optJoinMany", { list: options.slice(0, -1).join(t("optSep")), last: options[options.length - 1] });
}

function PlayersList({ t, room, meId }: { t: RoomT; room: RoomProfile; meId: Id<"users"> }) {
  const seats = [...(room.seats ?? [])].sort((a, b) => (a.seatIndex < 0 ? 99 : a.seatIndex) - (b.seatIndex < 0 ? 99 : b.seatIndex));
  return (
    <div className="players">
      <h3 className="section-title" style={{ margin: "4px 0 0" }}>{t("players")}</h3>
      {seats.map((s) => (
        <div key={s.userId} className="player-row">
          <span className={`dot${s.online ? " on" : ""}`} />
          <span className="grow">{s.username}{s.userId === meId ? t("youSuffix") : ""}</span>
          <span className="faint nums">
            {s.seatIndex < 0 || s.state === "left" ? t("watching") : s.state === "sittingOut" ? t("away", { stack: formatChips(s.stack) }) : formatChips(s.stack)}
          </span>
        </div>
      ))}
    </div>
  );
}

function HostControls({ t, room, stage, pendingRestart, busy, run, endGame, closeRoom, onClosed }: {
  t: RoomT;
  room: RoomProfile;
  stage: string;
  pendingRestart: boolean;
  busy: boolean;
  run: (label: string, call: () => Promise<unknown>, okCue?: string) => Promise<boolean>;
  endGame: () => Promise<unknown>;
  closeRoom: () => Promise<unknown>;
  onClosed: () => void;
}) {
  const playing = room.status === "playing" || pendingRestart;
  return (
    <div className="stack" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
      <h3 className="section-title" style={{ margin: 0 }}>{t("hostControls")}</h3>
      <span className="faint host-help">{t("hostHelp")}</span>
      <div className="row">
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy || !playing || room.stopAfterHand === true}
          title={playing ? t("endTitle") : t("noGame")}
          onClick={() => void run("end", endGame)}
        >
          {room.stopAfterHand === true ? t("endingAfter") : t("endGame")}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          disabled={busy || (stage !== "finished" && stage !== "waiting")}
          title={stage !== "finished" && stage !== "waiting" ? t("closeBetween") : t("closeTitle")}
          onClick={() => {
            if (!window.confirm(t("confirmClose"))) return;
            void run("close", closeRoom).then((ok) => { if (ok) onClosed(); });
          }}
        >
          {t("closeTable")}
        </button>
      </div>
      {playing && stage !== "finished" && stage !== "waiting" && room.stopAfterHand !== true ? (
        <span className="faint">{t("endHelp")}</span>
      ) : null}
    </div>
  );
}

function RoomGone({ navigate, text }: { navigate: Navigate; text: string }) {
  const t = useT(roomMessages);
  return (
    <div className="center-screen">
      <div style={{ fontSize: 44 }}>🚪</div>
      <div className="muted">{text}</div>
      <button type="button" className="btn btn-primary" onClick={() => navigate("/lobby")}>{t("backToTheLobby")}</button>
    </div>
  );
}
