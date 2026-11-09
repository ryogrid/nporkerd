# nporkerd — Design Documents

Detailed design for **nporkerd**, an online multiplayer Texas Hold'em poker game
built entirely on [Convex](https://www.convex.dev/) as the single backend
platform (database, server functions, realtime sync, and SPA hosting), with a
TypeScript single-page application as the client.

These documents are written so that an implementer can start coding
immediately. Where the original requirements left a choice open, the documents
either fix a concrete default (marked **Default**) or record the choice in
[10-open-decisions.md](10-open-decisions.md) with options and trade-offs.

## Document map

| File | Contents |
| --- | --- |
| [00-overview.md](00-overview.md) | Product summary, scope, non-goals, core rules, glossary |
| [01-architecture.md](01-architecture.md) | System architecture, how every concern maps to Convex, repository layout, main data flows |
| [02-data-model.md](02-data-model.md) | Complete Convex schema: tables, fields, validators, indexes, invariants |
| [03-auth.md](03-auth.md) | Keypair-based authentication protocol (registration, login, sessions), credential handling |
| [04-game-engine.md](04-game-engine.md) | Texas Hold'em engine: state machine, betting rules, side pots, hand evaluation, timers, edge cases |
| [05-rooms-and-lobby.md](05-rooms-and-lobby.md) | Rooms (public / passphrase), seating, host controls, presence, disconnects |
| [06-chat.md](06-chat.md) | In-room text chat |
| [07-frontend.md](07-frontend.md) | SPA structure: pages, components, view models, client-side rules |
| [08-api-reference.md](08-api-reference.md) | Complete Convex function surface: every query / mutation / action, arguments, returns, errors |
| [09-deployment-and-operations.md](09-deployment-and-operations.md) | What the project owner must do: Convex account, credential management, step-by-step deployment, operations |
| [10-open-decisions.md](10-open-decisions.md) | Decisions not fixed by the requirements, with options, trade-offs, and recommended defaults |
| [TODO.md](TODO.md) | Implementation task breakdown with checkboxes |

## Conventions used in these documents

- **Default** — a value or behaviour this design fixes where the requirements
  were silent. Implement as written unless the owner decides otherwise via
  [10-open-decisions.md](10-open-decisions.md).
- Function signatures are given in TypeScript using Convex's
  `query` / `mutation` / `action` builders and `v` validators.
- All timestamps stored in the database are milliseconds since the Unix epoch
  (`Date.now()`), matching Convex conventions.
- Cards are encoded as integers `0–51` internally (see
  [04-game-engine.md](04-game-engine.md) §2) and as strings like `"As"`, `"Td"`
  in logs and tests.
- "Server" always means Convex functions. There is no other server.
