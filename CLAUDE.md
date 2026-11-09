# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

nporkerd is an online multiplayer Texas Hold'em (play money) built entirely on Convex: database, functions, realtime sync, and SPA hosting (`@convex-dev/static-hosting`). The client is a React 19 + Vite SPA in `src/`. There is no other server.

## Commands

```bash
npm run typecheck      # tsc for the SPA (tsconfig.json) AND for convex/ (convex/tsconfig.json)
npm test               # vitest run (all projects)
npm run test:watch
npm run build          # vite build -> dist/
npm run dev            # vite on :5173 (needs CONVEX_URL in .env.local)
npm run dev:convex     # npx convex dev — owner-run; pushes to the dev deployment
npm run deploy         # static-hosting deploy — owner-run

# single file / single test
npx vitest run convex/game/engine.test.ts
npx vitest run convex/game.test.ts -t "turn clock"
npx vitest run --project convex
```

Vitest has two projects (`vitest.config.ts`): `convex` (`convex/**/*.test.ts`, edge-runtime env, uses `convex-test` against the real schema in-process) and `frontend` (node env, currently no tests). There is no runtime test harness for `src/`. Client-only changes are validated with `npm run typecheck` and `npm run build`, plus a manual or Playwright pass against `npm run dev`.

Production deploy: `npm run deploy` (`@convex-dev/static-hosting deploy`). It builds the SPA with the prod `VITE_CONVEX_URL`, runs `convex deploy`, then uploads `dist/`. The app is served at `https://<prod>.convex.site`. `npx convex dev --once` pushes functions to the dev deployment. `convex/_generated/` is committed. If you add or rename a Convex module and can't run codegen, update `api.d.ts` by hand in the same format so the typecheck still passes.

## Design docs are the spec

`design/` holds the full design (00 to 10) plus `design/TODO.md`, which lists the implementation phases with checkboxes, notes, and recorded deviations. Code comments cite sections like `04 §9` or `03 §5`; those point at `design/04-game-engine.md` §9 and so on. Read the cited section before changing behavior. When you diverge from the design, record it in TODO.md the way earlier phases did. `design/10-open-decisions.md` lists choices still open (D-xx).

## Architecture

**Backend (`convex/`)**
- `game/` holds the pure poker engine: `cards`, `evaluator` (7-card ranking), `pots` (side-pot bands), and `engine` (hand state-machine reducer). It must never import Convex APIs, so it can be unit-tested directly with an injectable RNG.
- `game.ts` is the Convex shell around the engine. It loads the `hands` doc, converts it to `HandState` (`docToState`), runs the reducer, writes the result back, syncs seat stacks, and schedules the next timer in one mutation (`persistAndSchedule`/`scheduleFromState`). Timers (turn clock, street pacing, next hand) use `ctx.scheduler.runAfter` to call internal mutations (`handleTurnTimeout`, `advanceStreet`, `startNextHand`). Each timer is guarded by `(handId, seq)`, so a stale timer does nothing. Hourly cleanup runs from `crons.ts` → `game.cleanupExpired`.
- `rooms.ts` (lobby, seating, host controls/migration, buy-in/top-up), `auth.ts`, `users.ts` (balance, faucet, heartbeat), `chat.ts`.
- `lib/` holds shared helpers: `constants.ts` (all tunables), `errors.ts` (error codes plus `fail(code, data?)`, which throws `ConvexError({code,data})`), `session.ts` (`requireSession`), `rng.ts` (crypto RNG only, never `Math.random()` for dealing), `hash.ts`, `ed5519.ts` (wires noble ed25519 sha512 for client and server).

**Auth is custom, not Convex Auth.** The browser generates an Ed25519 keypair, and the private key never leaves it. Login is a signed challenge (`requestLoginChallenge` → `login`). Every public function except register/challenge/login takes `sessionToken` explicitly and calls `requireSession` first. Only the SHA-256 of the token is stored. Challenges for unknown usernames are "phantom" (no `userId`), so the API can't be used to check which usernames exist.

**Security invariant:** Convex has no field-level security, so the only defense is never returning secret data. The `hands` table (deck, every hole card) is server-secret. No public query returns it; `game.getTableState` builds a per-viewer projection instead. `convex/security.test.ts` sweeps every client query for hands-doc keys and checks the reveal gating. Keep it passing and extend it when you add queries.

**Mutations must be retry-safe** under OCC. Write them as functions of current state (for example, reject if it isn't this player's turn). Queries must not write.

**Frontend (`src/`)**
- `main.tsx` wraps `App` in `ConvexProvider` → `I18nProvider` (`i18n/core.tsx`) → `ToastProvider` (`lib/toast.tsx`) → `SessionProvider` (`lib/auth.tsx`). `App` renders the top bar (EN/日本語 switch, Help link that opens `/help` in a new tab, sound, account) and the footer.
- `lib/router.ts` is a small History-API router (`usePath`/`parseRoute`, routes `/`, `/register`, `/login`, `/lobby`, `/room/:id`, `/help`; `/help` is public). The static host falls back to `index.html`, so deep links work. `App.tsx` gates lobby and room on a validated session, and sends a signed-out visitor who opened an invite link back to that room after login (the path is kept in sessionStorage).
- `SessionProvider` keeps the token in `localStorage` (`lib/session.ts`; kept across restarts until expiry or logout, synced across tabs through the `storage` event) and validates it with `auth.me` (the profile and balance are reactive). A rejected token is dropped. Use `useSession()`; never call queries conditionally.
- `lib/projection.ts` derives all client types from `FunctionReturnType<typeof api....>`. Never hand-copy server shapes.
- `lib/errorCopy.ts` maps server error codes to UI text and is exhaustive at compile time. Adding a code to `convex/lib/errors.ts` breaks the typecheck until you add copy for it.
- `RoomPage` auto-joins public rooms as a spectator. `PokerTable` draws seats rotated so the viewer is at the bottom, with clickable empty chairs. `ActionBar` renders only from the server's `legal` block, sends a raise ≥ `maxRaiseTo` as `allIn`, and has shortcuts (F, C, R, Shift+A). `TableSounds` derives sound cues from changes between projection snapshots.
- `getTableState` semantics the UI relies on:
  - `pots` holds completed streets only, so separate entries are real side pots.
  - `totalPot` is every chip committed to the hand.
  - `stage` is never `showdown`.
  - `lastAction` survives into the next street.
  - `nextHandAt` is also set while the room is `waiting` during an auto-resume.
  - `lastHandResult.handNumber` says which hand a result belongs to.
  - `smallBlindSeat`/`bigBlindSeat` are the seats that posted this hand's blinds (from `blindSeatsFor` in the engine).
- **i18n (English default, Japanese).** Every user-visible string goes through `src/i18n/`. Each area has a message file built with `defineMessages(en, ja)`, and a missing Japanese key is a compile error. Components use `const t = useT(areaMessages)` (`t("key", {n})`, `t.rich` for JSX). Non-React code uses `tr()`/`getLang()`, as `errorCopyFor` does. The language lives in localStorage (synced across tabs), and `?lang=ja` overrides it. The server sends English hand labels; the client maps them for display.
- **Guidance for first-timers.** `components/Guide.tsx` has `<NextStep>` (the "What to do now" banner: every screen state should have one) and `<Tip id>` (a first-visit explainer, dismissed per browser). The `attn` CSS class pulses the one control the banner talks about.
- **Help page.** `/help` is `pages/HelpPage.tsx`, with content in `i18n/help.ts`; section ids are linked from tips. Screenshots are in `public/help-img/<lang>/`. Retake them when the UI changes noticeably.
- Styling is plain CSS in `styles.css`, plus per-area files (`styles-entry.css`, `styles-room.css`, `styles-help.css`) imported by their pages: cards, chips and the table are drawn in CSS, and fonts come from Google Fonts in `index.html`. The only image assets are the Help screenshots, and there are no audio files. Sounds are synthesized with WebAudio in `lib/sound.ts`, which `App` unlocks on the first user gesture.

**Social previews (OGP):** the Open Graph and Twitter card tags are static in `index.html` (crawlers don't run JS), with absolute URLs to the production site. The image is `public/og-image.png` (1200×630), drawn as SVG in `design/og/og-image.html`; re-render it with `NODE_PATH=<playwright> node design/og/render.cjs`. If the production domain changes, update the URLs in `index.html`.

**HTTP:** `convex.config.ts` mounts static hosting at `/` and app HTTP routes under `/api`. There is no `convex/http.ts`.
