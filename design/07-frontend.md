# 07 — Frontend (SPA)

## 1. Stack and shape

- **React + TypeScript + Vite**. Routing is state-based (a tiny router of
  four views keyed by URL hash or `history` paths — the static host's SPA
  fallback makes real paths like `/room/<id>` work on reload; use real
  paths).
- **Convex React client** (`convex/react`): `ConvexProvider` with a
  `ConvexReactClient(import.meta.env.VITE_CONVEX_URL)` in `main.tsx`.
  All data comes from `useQuery`; all writes from `useMutation`.
- **No client-side secrets.** The only build-time configuration is
  `VITE_CONVEX_URL` (public). See [03-auth.md](03-auth.md) §7.
- Session token: held in `localStorage` under `nporkerd.session`
  (kept across tabs and restarts until it expires or the user logs out;
  decision D-04, option B. It was `sessionStorage` before 2026-11). The private
  key is **never** stored by the app.

## 2. Pages

### 2.1 Register (`/register`)

Username field → on submit, generate the key pair in the browser
([03-auth.md](03-auth.md) §3) → `auth.register` → **key reveal screen**:

- private key in a read-only text area, Copy button, Download button;
- the loss warning, verbatim in meaning: *"This key is your password. It is
  shown only now. If you lose it, this account can never be accessed again
  and nobody can restore it."*;
- mandatory acknowledgement checkbox gating Continue;
- on Continue: automatic login (challenge round-trip with the in-memory
  key) → lobby.

Errors: `USERNAME_TAKEN` shown inline with a suggestion to pick another.

### 2.2 Login (`/login`)

Username + private key (paste or key-file upload). Show the computed key
fingerprint after paste so the user can compare with the registration
screen. On success → lobby. Generic failure message (never reveal whether
the username or the key was wrong).

### 2.3 Lobby (`/lobby`)

- Header: username, balance, faucet button (visible/enabled only when the
  faucet rule allows), logout.
- Public room list (reactive): name, host, seats occupied/total, blinds,
  buy-in, status. Click → room page (join happens there).
- "Create room" dialog with the settings from
  [05-rooms-and-lobby.md](05-rooms-and-lobby.md) §2; the passphrase field
  appears when visibility = private, with a note that it cannot be shown
  again later (it is not stored in plaintext anywhere — the host must
  remember or share it out-of-band; entering it again in the dialog is the
  only copy).

### 2.4 Room (`/room/:roomId`)

Layout: table area (left/top) + side panel with chat (right/bottom on
narrow screens).

- If the room is private and the user is not a member: passphrase prompt
  only (no other room data exists client-side, by projection design).
- Table: elliptical felt; seats positioned around it; each seat shows
  username, stack, state (sitting out / folded / all-in), dealer button,
  that player's current street bet in front of them, and a turn highlight +
  countdown ring/bar from `turnDeadline`.
- Center: board cards as they are revealed, pot total(s) (show side pots as
  separate amounts when more than one exists), stage label, and a one-line
  "last action" ticker ("Bob raised to 400").
- Own hole cards are shown face-up at the user's seat, larger, from the
  per-viewer projection. Other seats show card backs while those players
  are in the hand. At showdown, revealed hands flip face-up (from
  `result.revealedUserIds` + the projection).
- **ActionBar** (only when `getTableState.yourTurn` is true):
  Fold / Check / Call ⟨amount⟩ / Raise-to slider+number input bounded by
  the projection's `legal` ranges / All-in. Buttons disable outside legal
  ranges; the server re-validates regardless.
- Between hands: "Next hand in Ns" from the projection; sit-out toggle,
  top-up and stand-up buttons; host controls (Start game when `waiting`,
  End game, Close room) rendered only for the host.
- Joining flow on this page: Join (passphrase if needed) → click a free
  seat to sit down (confirm buy-in amount) — two explicit steps, no
  surprise chip movement.
- Chat panel: message list (auto-scroll to bottom on new message if already
  at bottom), input box with Enter to send, 500-char counter. Rate-limit
  errors surface as a transient hint.

## 3. Client data flow

One query drives the room screen: `game.getTableState` (projection in
[08-api-reference.md](08-api-reference.md)) plus `rooms.getRoom` for room
metadata/membership and `chat.listMessages`. Because Convex queries are
reactive, **no client-side polling, timers-for-refresh, or socket code**
exists in the SPA. The only client timers are presentational (turn
countdown rendering, next-hand countdown), always derived from server
timestamps in the projection, never authoritative.

Optimistic updates: use Convex's `useMutation().withOptimisticUpdate` for
chat send only (append the message locally; the reactive query confirms it).
Game actions get no optimistic update — a rejected action must never be
displayed as if it happened.

## 4. Client-side helpers (display only)

- `legal` block in the projection is computed **server-side** (the engine's
  own calculation) and merely rendered by the client. This guarantees the
  slider bounds match server legality exactly. (The client could compute
  them, but duplication risks drift; server-computed is the design.)
- Card rendering: a `CardView` component drawing rank+suit with CSS/SVG
  (no image assets needed); red suits hearts/diamonds.
- Amounts formatted with thousands separators; chip values always integers.

## 5. Accessibility / UX minimums

- Action buttons reachable by keyboard; the raise input accepts typed
  amounts.
- Colour is never the only signal: folded seats are dimmed **and** labelled,
  the current turn has a label as well as a highlight.
- The app must remain usable at 360 px width (chat collapses below the
  table).
