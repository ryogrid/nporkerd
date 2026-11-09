# 06 — Chat

## 1. Requirement

Text chat among the users at the same table (R6): a message written by any
member of a room is visible to all members of that room. Chat is scoped per
room; there is no global chat, no direct messages, and no chat in the lobby.

## 2. Behaviour

- Only room members (users who have joined, seated or not) may read or post.
  Non-members get nothing (consistent with
  [05-rooms-and-lobby.md](05-rooms-and-lobby.md) §7).
- `chat.listMessages({ roomId, sessionToken })` returns the **latest 100**
  messages, oldest-to-newest, each as
  `{ id, userId, username, body, createdAt }`. It is a reactive query: new
  messages appear on all members' screens without polling.
- `chat.sendMessage({ roomId, sessionToken, body })`:
  - trims the body; rejects empty or > 500 chars (`INVALID_MESSAGE`);
  - rate limit: at most one message per `CHAT_MIN_INTERVAL_MS` (800 ms) per
    user per room — enforced by loading the user's latest message in the
    room via `by_room_createdAt` and comparing `createdAt`; violation →
    `RATE_LIMITED`. (This is a soft anti-flood control, appropriate for a
    friends-scale game; it is not a security boundary.)
  - inserts the document with the server's `Date.now()`;
  - updates the room's `lastActivityAt`.
- History: messages persist for the life of the room document. When a room
  closes, its chat is no longer reachable through the API (queries reject
  closed rooms) but documents are retained. Retention/deletion policy is an
  open decision (D-07).
- System messages (Default, recommended): game events worth announcing —
  hand winners and pot sizes — are **not** written into chat. The table UI
  shows them from `hands.result`. Keeping chat purely human-written keeps
  the table simple; a `kind` field can be added later if desired. The
  schema in [02-data-model.md](02-data-model.md) §7 therefore has no `kind`
  field in v1.

## 3. Safety and rendering

- Bodies are stored exactly as typed (after trim) and rendered by React as
  text nodes. The client must never use `dangerouslySetInnerHTML` for chat
  (or anywhere). No markdown rendering in v1.
- Usernames shown with messages are read from the `users` table at query
  time (join in the query), so they are always current and cannot be spoofed
  by message content.
- There is no profanity filter, edit, delete, or moderation tooling in v1 —
  rooms are small and host-created; the host's remedy is closing the room.
  This is a deliberate v1 scope limit, recorded so it is not mistaken for an
  oversight.
