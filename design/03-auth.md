# 03 — Authentication (Keypair Login)

## 1. Design summary and why it is custom

nporkerd does **not** use Convex Auth, passwords, e-mail, or OAuth. The
requirements fix a specific scheme (R3/R4):

- At registration the user chooses a **username**.
- An **Ed25519 key pair** is generated in the user's browser.
- The user is given **only the private key**. It is their password.
- The server stores **username + public key** — and nothing else
  credential-like:

  - the server **never receives, stores, or can reconstruct** the private key;
  - there is **no recovery**: a lost private key means the account is
    permanently inaccessible. Support cannot help; the user registers a new
    account. The UI must communicate this before account creation
    ([07-frontend.md](07-frontend.md) §3).

Login is a **challenge–response** signature proof: the client proves it holds
the private key by signing a fresh server nonce; the private key itself is
never transmitted, not even at login.

Library choice: **`@noble/ed25519`** (pure TypeScript, audited, works in
browsers and in Convex's V8 runtime). Enabling its synchronous SHA-512
(`ed.etc.sha512Sync`) is required for sync sign/verify in the Convex runtime;
do this once in a shared module imported by both client key code and
`convex/auth.ts`. (Alternative considered: WebCrypto Ed25519 — browser
support is still uneven, so it is rejected for v1.)

## 2. Key and token formats

| Item | Format | Size |
| --- | --- | --- |
| Ed25519 private key (user-facing) | base64url string of the 32-byte seed, prefixed `npk_` for recognisability: `npk_<43 chars>` | 32 bytes |
| Ed25519 public key (stored) | base64url, no prefix | 32 bytes |
| Public-key fingerprint (UI aid) | first 10 hex chars of `SHA-256(publicKey)` | display only |
| Login nonce | base64url | 32 random bytes |
| Signature | base64url | 64 bytes |
| Session token (client-held) | base64url, prefix `nps_` | 32 random bytes |
| Session token at rest | SHA-256 hex of the token string | — |

The prefix lets the login form (and the user's password manager) tell a
nporkerd key apart from random text, and lets the client reject an obviously
wrong paste before calling the server.

## 3. Registration

Function: `auth.register` (mutation) — full signature in
[08-api-reference.md](08-api-reference.md).

Client steps (RegisterPage):

1. User enters a username; client validates format locally (3–20 chars,
   `[A-Za-z0-9_]`).
2. Client generates the key pair locally:
   `priv = ed.utils.randomPrivateKey()`, `pub = await ed.getPublicKey(priv)`.
3. Client calls `register({ username, publicKey: base64url(pub) })`.
4. Server, inside the mutation:
   - validates username format and public key length (32 bytes decoded);
   - rejects if `usernameLower` already exists (`USERNAME_TAKEN`);
   - inserts the `users` document with `balance = STARTING_BALANCE`.
5. Client shows the **key reveal screen** (blocking, in this order):
   - the private key string (prefix `npk_`), large and copyable;
   - a **Download key file** button (`nporkerd-key-<username>.txt` containing
     username, private key, fingerprint, and a loss warning);
   - the fingerprint of the public key, so the user can later verify they
     pasted the right key on the login screen;
   - a checkbox: *"I understand this key is shown only once and cannot be
     recovered if lost."* — the **Continue** button is disabled until it is
     checked.
6. Client then logs the user in directly, without a challenge round-trip:
   registration implies possession of the key in this browser session, so the
   client calls `auth.requestLoginChallenge` + `auth.login` immediately
   (the key is still in memory) and lands in the lobby. The key is then
   dropped from memory.

The private key is **not** kept in `localStorage`/`sessionStorage` by the
app. If the user wants persistence, their password manager or the downloaded
file is the store. (Decision D-04 in [10-open-decisions.md](10-open-decisions.md)
records the alternative.)

## 4. Login

Functions: `auth.requestLoginChallenge` (mutation),
`auth.login` (mutation).

### 4.1 Protocol

```
Client                                   Server
  │  requestLoginChallenge({ username })   │
  │ ─────────────────────────────────────▶ │  find user by usernameLower
  │                                        │  delete previous challenge
  │                                        │  nonce = random 32 bytes
  │  { challengeId, nonce, expiresAt }     │  store challenge (5 min TTL)
  │ ◀───────────────────────────────────── │
  │  msg = "nporkerd-login:" + challengeId + ":" + nonce
  │  sig = ed.sign(msg, privateKey)        │
  │  login({ challengeId, signature })     │
  │ ─────────────────────────────────────▶ │  load challenge; check TTL/attempts
  │                                        │  ok = ed.verify(sig, msg, user.publicKey)
  │                                        │  delete challenge (single use)
  │                                        │  token = random 32 bytes
  │  { sessionToken, user }                │  store SHA-256(token) in sessions
  │ ◀───────────────────────────────────── │
```

Signing the challenge id together with the nonce binds the signature to
this login attempt; a captured signature cannot be replayed (challenge is
deleted on use and expires in 5 minutes).

### 4.2 Client key handling at login

- The login page has a username field and a private-key field (password-type
  input) plus an option to load the key file downloaded at registration
  (parse the `npk_…` token out of the file text).
- After parsing, the client computes the public key and its fingerprint from
  the pasted private key and displays the fingerprint ("Key fingerprint:
  a1b2c3d4e5 — matches the one shown at registration?"). This catches most
  wrong-key pastes locally.
- The key material lives only in component state during login and is cleared
  on success.

### 4.3 Anti-enumeration and abuse controls

- `requestLoginChallenge` behaves identically for unknown usernames: it
  returns a well-formed challenge bound to a non-existent user id, and
  `login` for it always fails with the generic `INVALID_CREDENTIALS`. (The
  challenge document stores `userId: null` in that case; the schema field is
  `optional(Id<"users">)` for exactly this reason — note this refines the
  field table in [02-data-model.md](02-data-model.md) §3.)
- Error messages never distinguish "no such user" from "bad signature".
- Failed `login` increments `attempts`; at 5 the challenge is deleted.
- Registration and challenge requests are additionally rate-limited at the
  application level by a simple per-username cooldown (a challenge may be
  re-requested at most once per 5 seconds per username — enforced by
  `createdAt` of the previous challenge before it is replaced; keep the
  replaced challenge's `createdAt` in a tiny `rateLimits` check via the
  challenge document itself: if the previous challenge is younger than 5 s,
  return it again instead of minting a new one).

## 5. Sessions and authorising game functions

- Every authenticated function takes `sessionToken: string` as an explicit
  argument. The shared helper `convex/lib/session.ts`:

```ts
export async function requireSession(ctx, token: string) {
  const tokenHash = await sha256Hex(token);
  const session = await ctx.db.query("sessions")
    .withIndex("by_tokenHash", q => q.eq("tokenHash", tokenHash)).unique();
  if (!session || session.expiresAt < Date.now()) throw new ConvexError("UNAUTHENTICATED");
  const user = await ctx.db.get(session.userId);
  if (!user) throw new ConvexError("UNAUTHENTICATED");
  return { session, user };
}
```

- `auth.logout` deletes the session document for the presented token.
- Sessions do not slide; at expiry the user logs in again with the private
  key. Multiple concurrent sessions per user are allowed (phone + PC).
- The `me` query returns the caller's profile (`username`, `balance`,
  fingerprint) and doubles as the client's session-validity check on load.
- Heartbeat: the client calls `users.heartbeat` every 30 s while logged in;
  it updates `users.lastSeenAt` (and the seat's `lastSeenAt` when in a room).
  Presence is display-only; game safety never depends on it (the turn timer
  is the real mechanism, [04-game-engine.md](04-game-engine.md) §9).

## 6. What is *not* protected, deliberately

- The lobby list of public rooms and room names are visible to any logged-in
  user. There is no anonymous access at all: every page except register and
  login requires a session.
- Usernames are public (shown at tables and in chat). The design treats a
  username as a pseudonym, not an identity document.

## 7. Credential inventory — who holds what (owner-facing summary)

Full operational treatment is in
[09-deployment-and-operations.md](09-deployment-and-operations.md) §3; the
summary:

| Credential | Held by | Secret? | If leaked |
| --- | --- | --- | --- |
| User private key (`npk_…`) | Each user, alone | **Yes — it *is* the account** | Account is compromised; no admin fix exists (by design). User abandons the account. |
| Session token (`nps_…`) | User's browser (`sessionStorage`) | Yes | Valid until expiry/logout; equivalent to a login for ≤ 30 days. |
| `VITE_CONVEX_URL` (SPA config) | Embedded in the public SPA build | **No** — it is just the deployment's public API URL | Nothing; it is printed on every page load. |
| Convex deploy key | Project owner only (password manager / CI secret) | **Yes — root-equivalent** | Attacker controls backend + data. Revoke in the Convex dashboard immediately and issue a new one. |
| Convex account login (owner) | Project owner | Yes; enable 2FA | Same as deploy key, plus project transfer risk. |
| Database passwords / connection strings | — | — | **Do not exist.** Convex data is reachable only via functions, the dashboard, or a deploy key. |

Key consequences for the implementation:

- The SPA needs **no secret** to talk to Convex. Do not invent one (no
  "API keys" in client code).
- There is no admin API key for the game itself in v1. Owner administration
  happens through the Convex dashboard (data browser, function runner) with
  the owner's login.
