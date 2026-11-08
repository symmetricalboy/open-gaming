# `@opengaming/web` — `opengaming.games` AppView & Viewer

The official AT Protocol AppView, real-time Jetstream indexer, XRPC server, and Achievement & Leaderboard Viewer web application for `games.opengaming.*`.

## Features

- **Real-Time Jetstream Ingestion (`src/jetstream.ts`)**: Streams `games.atmosphere.define` and all `games.opengaming.*` records live from Bluesky Jetstream with cursor persistence (`sync_state` in `node:sqlite`).
- **On-Demand PDS Sync (`POST /api/sync-repo`)**: Resolves any ATProto handle or DID, discovers its `#atproto_pds` service endpoint, and backfills & verifies published definitions, unlocks, progress, scores, and revocations.
- **Cryptographic Verification & Reactive Revocation (`src/indexer.ts`)**: Verifies Mode A `#inlineSignature` attestations via `@opengaming/sdk`, enforces `scoreMin` / `scoreMax` bounds, and immediately re-evaluates affected unlocks and scores whenever a `games.opengaming.revocation` record is created, updated, or deleted (`unrevoke`).
- **Standard XRPC Endpoints (`src/server.ts` & `src/queries.ts`)**:
  - `GET /xrpc/games.opengaming.actor.getProfile?actor=<handle-or-did>`
  - `GET /xrpc/games.opengaming.leaderboard.getScores?leaderboard=<at-uri>&timeframe=allTime|weekly|daily&scope=public|social&viewer=<did-or-handle>`
- **Safe PDS Blob Mirroring (`GET /api/blob`)**: Fetches and caches square achievement & leaderboard icons via `com.atproto.sync.getBlob` with strict MIME validation and `Content-Security-Policy: default-src 'none'`.
- **Viewer Web App (`public/`)**: Games Catalog, Game Hubs (global unlock rarity `%`, incremental `<progress>` bars, `hidden` spoiler masking), Global & Following Social Leaderboards, XP-free Per-Game Player Gamercards, Verification & Revocation Audit Ledger, and interactive Cryptographic Proof `<dialog>` inspector.

## Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | HTTP listen port (binds `0.0.0.0` for Railway / Docker) |
| `DATABASE_PATH` | `apps/web/data/opengaming.sqlite` | SQLite database file path (`:memory:` supported) |
| `JETSTREAM_URL` | `wss://jetstream2.us-east.bsky.network/subscribe` | Upstream ATProto Jetstream WebSocket endpoint |
| `ENABLE_JETSTREAM` | `true` | Set to `false` to disable live firehose streaming |
| `SEED_DEMO_DATA` | `true` | Seeds ECDSA-signed reference records if database is empty |
| `OPENGAMING_DID` | `did:plc:33d7gnwiagm6cimpiepefp72` | DID served at `/.well-known/atproto-did` |

## Running Locally

```bash
# From monorepo root:
npm run dev
# Or build & run compiled production server:
npm run build
npm start
```
