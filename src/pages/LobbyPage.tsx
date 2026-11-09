// Lobby: the reactive list of public tables, a way into private tables by
// link, the faucet when the bankroll runs low, and the "host a table" form.
// A NextStep banner says what to do (claim chips / create a table / pick one),
// a first-visit Tip explains bankroll, buy-in and blinds, and each table card
// labels its numbers and shows an explicit "Join →" / "Watch →".
import { FormEvent, useState } from "react";
import { useMutation, useQuery_experimental } from "convex/react";
import { api } from "../../convex/_generated/api";
import { CreateRoomDialog } from "../components/CreateRoomDialog";
import { NextStep, Tip } from "../components/Guide";
import { errorCopyFor, faucetHint } from "../lib/errorCopy";
import { formatChips } from "../lib/format";
import { LobbyRow } from "../lib/projection";
import { MeProfile, usePresence } from "../lib/auth";
import { Navigate } from "../lib/router";
import { useToast } from "../lib/toast";
import { playCue } from "../lib/sound";
import { tr, useT } from "../i18n/core";
import { lobbyMessages } from "../i18n/lobby";
import { FAUCET_AMOUNT, STARTING_BALANCE } from "../../convex/lib/constants";
import "../styles-entry.css";

const HOST_FORM_ID = "host-table";

/** Accepts a full room link, a /room/<id> path, or a bare id. */
export function roomIdFromInput(text: string): string | undefined {
  const t = text.trim();
  if (t === "") return undefined;
  const m = /\/room\/([A-Za-z0-9_-]+)/.exec(t);
  if (m !== null) return m[1];
  return /^[A-Za-z0-9_-]+$/.test(t) ? t : undefined;
}

export function LobbyPage({ token, me, navigate }: { token: string; me: MeProfile; navigate: Navigate }) {
  const t = useT(lobbyMessages);
  const toast = useToast();
  const claimFaucet = useMutation(api.users.claimFaucet);
  const [link, setLink] = useState("");
  const [claiming, setClaiming] = useState(false);
  // a refused claim (cooldown) stops the banner from insisting on it
  const [claimRefused, setClaimRefused] = useState(false);
  usePresence(token);

  const listed = useQuery_experimental({
    query: api.rooms.listPublicRooms,
    args: { sessionToken: token },
    throwOnError: false,
  });

  async function claim(): Promise<void> {
    setClaiming(true);
    try {
      await claimFaucet({ sessionToken: token });
      playCue("win");
      toast.push(tr(lobbyMessages, "faucetClaimed", { chips: formatChips(FAUCET_AMOUNT) }), "success");
    } catch (e) {
      setClaimRefused(true);
      const hint = faucetHint(e);
      toast.push(hint === undefined ? errorCopyFor(e) : `${errorCopyFor(e)} ${hint}`);
    } finally {
      setClaiming(false);
    }
  }

  function openLink(e: FormEvent): void {
    e.preventDefault();
    const id = roomIdFromInput(link);
    if (id === undefined) {
      toast.push(t("badLink"));
      return;
    }
    navigate(`/room/${id}`);
  }

  function jumpToHostForm(): void {
    const form = document.getElementById(HOST_FORM_ID);
    if (form === null) return;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    form.querySelector("input")?.focus({ preventScroll: true });
  }

  const rooms: LobbyRow[] = listed.status === "success" ? listed.data : [];
  const faucetEligible = me.balance < FAUCET_AMOUNT;
  const nudgeFaucet = faucetEligible && !claimRefused;
  const noTables = listed.status === "success" && rooms.length === 0;

  let nextStep = null;
  if (nudgeFaucet) {
    nextStep = (
      <NextStep
        icon="🎁"
        title={t("nextLowTitle", { chips: formatChips(FAUCET_AMOUNT) })}
        detail={t("nextLowDetail", { balance: formatChips(me.balance) })}
      />
    );
  } else if (noTables) {
    nextStep = (
      <NextStep
        icon="🃏"
        title={t("nextEmptyTitle")}
        detail={t("nextEmptyDetail")}
        action={<button type="button" className="btn btn-sm lobby-jump" onClick={jumpToHostForm}>{t("nextEmptyJump")}</button>}
      />
    );
  } else if (listed.status === "success") {
    nextStep = <NextStep icon="👉" title={t("nextPickTitle")} detail={t("nextPickDetail")} />;
  }

  return (
    <div className="lobby">
      <div className="stack" style={{ gap: 20 }}>
        <div className="lobby-head">
          <div>
            <div className="faint">{t("welcome", { name: me.username })}</div>
            <h1>{t("tables")}</h1>
          </div>
          {faucetEligible ? (
            <div className="faucet">
              <button
                type="button"
                className={`btn btn-primary${nudgeFaucet && !claiming ? " attn" : ""}`}
                disabled={claiming}
                onClick={() => void claim()}
              >
                {t("claim", { chips: formatChips(FAUCET_AMOUNT) })}
              </button>
              <small>{t("faucetExplain", { chips: formatChips(FAUCET_AMOUNT) })}</small>
            </div>
          ) : null}
        </div>

        {nextStep}

        <Tip id="lobby" helpAnchor="lobby" title={t("tipTitle")}>
          <ul>
            <li>{t.rich("tipBankroll", { b: <b>{t("tipBankrollB")}</b>, chips: formatChips(STARTING_BALANCE) })}</li>
            <li>{t.rich("tipBuyIn", { b: <b>{t("tipBuyInB")}</b> })}</li>
            <li>{t.rich("tipBlinds", { b: <b>{t("tipBlindsB")}</b> })}</li>
          </ul>
        </Tip>

        {listed.status === "pending" ? (
          <div className="center-screen" style={{ minHeight: 200 }}><div className="spinner" /></div>
        ) : listed.status === "error" ? (
          <div className="empty-state">{t("loadError")} {errorCopyFor(listed.error)}</div>
        ) : rooms.length === 0 ? (
          <div className="empty-state">
            <div className="big">🃏</div>
            <div>{t("emptyTitle")}</div>
            <div className="faint">{t("emptyHint")}</div>
          </div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <div className="room-legend faint">
              <span>{t("legend")}</span>
              <span>{t("legendBlinds")}</span>
              <span>{t("legendBuyIn")}</span>
              <span>{t("legendSeats")}</span>
            </div>
            <div className="room-list">
              {rooms.map((row) => {
                const full = row.seatedCount >= row.maxSeats;
                const cantAfford = !full && me.balance < row.buyIn;
                const seatsTitle = t("seatsTitle", { taken: row.seatedCount, max: row.maxSeats });
                return (
                  <button
                    key={row.roomId}
                    type="button"
                    className="room-card room-card-entry"
                    aria-label={t("cardLabel", {
                      name: row.name,
                      sb: formatChips(row.smallBlind),
                      bb: formatChips(row.bigBlind),
                      buyIn: formatChips(row.buyIn),
                      taken: row.seatedCount,
                      max: row.maxSeats,
                    })}
                    onClick={() => navigate(`/room/${row.roomId}`)}
                  >
                    <div className="room-felt" />
                    <div className="room-body">
                      <div className="row" style={{ gap: 8 }}>
                        <span className="room-name">{row.name}</span>
                        {row.status === "playing"
                          ? <span className="badge badge-live" title={t("liveTitle")}>{t("live")}</span>
                          : <span className="badge" title={t("waitingTitle")}>{t("waiting")}</span>}
                      </div>
                      <div className="room-meta">
                        <span title={t("blindsTitle")}>{t("blinds")} <b>{formatChips(row.smallBlind)}/{formatChips(row.bigBlind)}</b></span>
                        <span title={t("buyInTitle")}>{t("buyIn")} <b>{formatChips(row.buyIn)}</b></span>
                        <span title={t("clockTitle")}>{t("clock")} <b>{row.turnSeconds === 0 ? t("clockOff") : t("clockSeconds", { n: row.turnSeconds })}</b></span>
                        <span title={t("hostTitle")}>{t("host")} <b>{row.hostUsername}</b></span>
                      </div>
                      <div className="seat-dots" title={seatsTitle}>
                        {Array.from({ length: row.maxSeats }, (_, i) => <i key={i} className={i < row.seatedCount ? "on" : ""} />)}
                      </div>
                      {cantAfford ? <div className="room-warn">{t("cantAfford", { chips: formatChips(row.buyIn) })}</div> : null}
                    </div>
                    <div className="room-side">
                      <span className="nums room-count" title={seatsTitle}>
                        {row.seatedCount}/{row.maxSeats} <span className="room-count-unit">{t("seats")}</span>
                      </span>
                      <span className="btn btn-sm room-cta">{full || cantAfford ? t("watch") : t("join")}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <form className="panel panel-pad stack" onSubmit={openLink}>
          <div>
            <h3 className="section-title" style={{ margin: 0 }}>{t("inviteTitle")}</h3>
            <p className="field-help" style={{ margin: "4px 0 0" }}>{t("inviteHint")}</p>
          </div>
          <div className="join-code">
            <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder={t("invitePlaceholder")} aria-label={t("inviteLabel")} />
            <button type="submit" className="btn">{t("open")}</button>
          </div>
        </form>
      </div>

      <CreateRoomDialog
        id={HOST_FORM_ID}
        sessionToken={token}
        highlight={noTables && !nudgeFaucet}
        defaultName={tr(lobbyMessages, "defaultTableName", { name: me.username }).slice(0, 40)}
        onCreated={(roomId) => navigate(`/room/${roomId}`)}
      />
    </div>
  );
}
