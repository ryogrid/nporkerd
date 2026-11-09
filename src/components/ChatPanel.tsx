// ChatPanel (design/06 §2, 07 §2.4 chat panel, 07 §3 optimistic updates): the
// message list is the reactive `chat.listMessages` query (the latest 100,
// oldest-to-newest) and sending is the only place the SPA uses an optimistic
// update, so a typed message appears immediately and the reactive query
// confirms it. Bodies are rendered as text nodes — never HTML (06 §3).
import { useRef, useState } from "react";
import { useMutation, useQuery_experimental } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { ChatRow } from "../lib/projection";
import { MeProfile } from "../lib/auth";
import { CHAT_MAX_LENGTH, CHAT_WINDOW } from "../../convex/lib/constants";
import { errorCopyFor } from "../lib/errorCopy";
import { playCue } from "../lib/sound";

/** Rendered tail of the window: the newest stay visible (07 §2.4 auto-scroll). */
const RENDERED = 16;

/**
 * 07 §3: chat send is the *only* optimistic update in the SPA ("append the
 * message locally; the reactive query confirms it"). The row carries a
 * fixed placeholder id so a replay of this update (the client may call it
 * again while the mutation is in flight) can never duplicate it; the real
 * document arrives with the server's own id when queries converge.
 */
const OPTIMISTIC_ID = "local-optimistic-message";

export function ChatPanel({ roomId, sessionToken, me }: {
  roomId: Id<"rooms">;
  sessionToken: string;
  /** The signed-in profile, only used to label the optimistic row. */
  me: MeProfile | undefined;
}) {
  const loaded = useQuery_experimental({
    query: api.chat.listMessages,
    args: { sessionToken, roomId },
    throwOnError: false,
  });
  const send = useMutation(api.chat.sendMessage).withOptimisticUpdate(
    (localStore, { body }) => {
      if (me === undefined) {
        return;
      }
      const trimmed = body.trim();
      if (trimmed === "") {
        return;
      }
      const current = localStore.getQuery(api.chat.listMessages, { sessionToken, roomId });
      if (current === undefined) {
        return; // the query is still loading: there is nothing to append to
      }
      const optimistic: ChatRow = {
        id: OPTIMISTIC_ID as Id<"chatMessages">,
        userId: me.userId,
        username: me.username,
        body: trimmed,
        createdAt: Date.now(),
      };
      const merged = [...current.filter((m) => m.id !== OPTIMISTIC_ID), optimistic];
      localStore.setQuery(
        api.chat.listMessages,
        { sessionToken, roomId },
        merged.length > CHAT_WINDOW ? merged.slice(merged.length - CHAT_WINDOW) : merged,
      );
    },
  );
  const typed = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  async function post(body: string): Promise<void> {
    setNotice(undefined);
    try {
      await send({ sessionToken, roomId, body });
      // Phase 10: the softest cue on the page, and only after the server
      // accepted the message
      playCue("action-chat");
    } catch (e) {
      setNotice(errorCopyFor(e));
    }
  }

  function submit(): void {
    const body = (typed.current?.value ?? "").trim();
    if (body !== "") {
      void post(body);
    }
  }

  if (loaded.status === "error") {
    // 06 §2: non-members and closed rooms simply get no chat surface.
    return <div className="np-chat np-muted">{errorCopyFor(loaded.error)}</div>;
  }
  if (loaded.status === "pending") {
    return <div className="np-chat np-muted">Loading chat…</div>;
  }

  const messages = loaded.data;
  const tail = messages.length > RENDERED ? messages.slice(messages.length - RENDERED) : messages;
  const draft = (typed.current?.value ?? "").trim();

  return (
    <div className="np-chat">
      <div className="np-chat-list">
        {tail.map((m: ChatRow) => (
          <div key={m.id} className="np-chat-row">
            <span className="np-chat-name">{m.username}</span>
            {": "}
            {m.body}
          </div>
        ))}
      </div>
      <div className="np-chat-input">
        <input
          ref={typed}
          type="text"
          className="np-field"
          aria-label={`chat message, ${draft.length} of ${CHAT_MAX_LENGTH} characters`}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" onClick={() => void submit()}>Send</button>
        <span className="np-chat-counter">
          {draft.length}/{CHAT_MAX_LENGTH} chars · showing the newest {tail.length} of{" "}
          {Math.min(messages.length, CHAT_WINDOW)}
        </span>
      </div>
      {notice === undefined ? null : <div className="np-error">{notice}</div>}
      {messages.length > tail.length ? (
        <div className="np-chat-hint">
          older messages scroll up — the newest are pinned at the bottom
        </div>
      ) : null}
    </div>
  );
}
