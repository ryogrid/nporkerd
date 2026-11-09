// Room chat: reactive latest-100 list, optimistic send, auto-scroll that
// respects a reader who scrolled up. Bodies render as text, never HTML.
import { FormEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQuery_experimental } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { ChatRow } from "../lib/projection";
import { MeProfile } from "../lib/auth";
import { CHAT_MAX_LENGTH, CHAT_MIN_INTERVAL_MS, CHAT_WINDOW } from "../../convex/lib/constants";
import { errorCodeOf, errorCopyFor } from "../lib/errorCopy";
import { playCue } from "../lib/sound";
import { timeOfDay } from "../lib/format";
import { useToast } from "../lib/toast";
import { useT } from "../i18n/core";
import { roomMessages } from "../i18n/room";

const OPTIMISTIC_PREFIX = "local-";

/** `retryInMs` from a RATE_LIMITED error, else undefined. */
function retryDelay(err: unknown): number | undefined {
  if (errorCodeOf(err) !== "RATE_LIMITED") return undefined;
  const payload = (err as { data?: { data?: { retryInMs?: unknown } } }).data;
  const ms = payload?.data?.retryInMs;
  return typeof ms === "number" ? Math.min(ms, 2000) : 800;
}
let optimisticSeq = 0;

export function ChatPanel({ roomId, sessionToken, me }: {
  roomId: Id<"rooms">;
  sessionToken: string;
  me: MeProfile | undefined;
}) {
  const toast = useToast();
  const t = useT(roomMessages);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const seen = useRef<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const lastSent = useRef(0);

  const loaded = useQuery_experimental({
    query: api.chat.listMessages,
    args: { sessionToken, roomId },
    throwOnError: false,
  });
  const send = useMutation(api.chat.sendMessage).withOptimisticUpdate((store, { body }) => {
    if (me === undefined) return;
    const current = store.getQuery(api.chat.listMessages, { sessionToken, roomId });
    if (current === undefined) return;
    const row: ChatRow = {
      id: `${OPTIMISTIC_PREFIX}${Date.now()}-${optimisticSeq++}` as Id<"chatMessages">,
      userId: me.userId,
      username: me.username,
      body: body.trim(),
      createdAt: Date.now(),
    };
    const merged = [...current, row];
    store.setQuery(api.chat.listMessages, { sessionToken, roomId }, merged.slice(-CHAT_WINDOW));
  });

  const messages = loaded.status === "success" ? loaded.data : [];
  const newest = messages.length === 0 ? undefined : messages[messages.length - 1];

  // keep pinned to the bottom unless the reader scrolled up; soft cue for others' messages
  useEffect(() => {
    const el = listRef.current;
    if (el !== null && stick.current) el.scrollTop = el.scrollHeight;
    if (newest !== undefined) {
      const id = String(newest.id);
      if (seen.current !== undefined && seen.current !== id && newest.userId !== me?.userId) {
        playCue("action-chat");
      }
      seen.current = id;
    }
  }, [newest, me?.userId]);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const body = draft.trim();
    if (body === "" || sending) return;
    setSending(true);
    // the server allows one message per CHAT_MIN_INTERVAL_MS: wait instead of failing
    const wait = lastSent.current + CHAT_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => window.setTimeout(r, wait));
    setDraft("");
    stick.current = true;
    try {
      // the server is the clock: if it still says "too soon", wait as told and retry
      for (let attempt = 0; ; attempt += 1) {
        try {
          await send({ sessionToken, roomId, body });
          break;
        } catch (err) {
          const retry = retryDelay(err);
          if (retry === undefined || attempt >= 2) throw err;
          await new Promise((r) => window.setTimeout(r, retry + 50));
        }
      }
      lastSent.current = Date.now();
    } catch (err) {
      setDraft((d) => (d === "" ? body : d));
      toast.push(errorCopyFor(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat">
      <h3 className="section-title">{t("chatTitle")}</h3>
      <div
        className="chat-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {loaded.status === "pending" ? <div className="chat-empty"><div className="spinner" /></div> : null}
        {loaded.status === "error" ? <div className="chat-empty">{errorCopyFor(loaded.error)}</div> : null}
        {loaded.status === "success" && messages.length === 0 ? (
          <div className="chat-empty">{t("chatEmpty")}</div>
        ) : null}
        {messages.map((m) => {
          const mine = me !== undefined && m.userId === me.userId;
          const pending = String(m.id).startsWith(OPTIMISTIC_PREFIX);
          return (
            <div key={String(m.id)} className={`chat-msg${mine ? " me" : ""}${pending ? " pending" : ""}`}>
              <span className="who">{m.username}</span>
              {m.body}
              <span className="when">{timeOfDay(m.createdAt)}</span>
            </div>
          );
        })}
      </div>
      <form className="chat-form" onSubmit={(e) => void submit(e)}>
        <input
          className="input"
          value={draft}
          maxLength={CHAT_MAX_LENGTH}
          placeholder={t("chatPlaceholder")}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={t("chatAria")}
        />
        <button type="submit" className="btn" disabled={draft.trim() === "" || sending}>{t("send")}</button>
      </form>
    </div>
  );
}
