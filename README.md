# Open Gaming (`games.opengaming.*`)

Shared AT Protocol Lexicons, TypeScript SDK & CLI (`@opengaming/sdk`), Reference Documentation, and Viewer App (`opengaming.games`) for interoperable **Game Achievements** and **Leaderboards** — prototyped under `games.opengaming.*` (with [Flappysky](https://flappysky.symmetricalboy.com) as the first reference game) and designed for 1:1 adoption by the [ATProto Games Working Group](https://discourse.atmosphere.community/c/wg/games-wg/51).

---

## Core Design Principles

1. **Canonical Definitions on the Game's PDS, Lightweight Signed Receipts on the Player's PDS**
   - Games publish achievement and leaderboard metadata (`title`, `description`, `icon` blob, `tier`, `scoreFormat` / `components`, `timeframes`, `recordPolicy`) once in the game publisher's repository.
   - Players store compact, dated unlock, progress, and score records in their own PDS referencing the game's definition via `at-uri` — with a symmetric, **optional `definitionCid`** across `unlock`, `progress`, and `score` so fixing typos or updating art never orphans existing player awards.
2. **Spoiler-Proof Hidden Achievements with ATProto Spaces (`hiddenSpace`)**
   - When `hidden: true`, `achievement.definition` allows omitting `title`, `description`, and `icon` on the public PDS so Firehose / `pds.ls` scrapers never leak unreleased narrative spoilers.
   - Optional `hiddenSpace` (`uri`) points to an access-controlled ATProto Space (or reveal endpoint) holding the unredacted metadata and icon, auto-granting players read access upon unlock.
3. **Single-Integer Simplicity + Forward-Compatible Component Maps & Rhythm-Game Expressiveness**
   - Classic arcade boards use `score` (`integer`) + `scoreFormat` (`numeric | time | currency`).
   - Complex boards (rhythm games, speedrun + points stages, clear lamps) declare a dictionary `components` map (`#pointsComponentDef`, `#percentageComponentDef`, `#timeComponentDef`, `#enumComponentDef`, `#textComponentDef`) using the forward-compatible `$keyFormat`/`$valueType` Lexicon `object` convention + `componentOrder` — positioned for a **zero-migration schema upgrade** to the proposed [Lexicon `map` type](https://bnewbold.leaflet.pub/3mimokt4o5c2f) without altering PDS records or DAG-CBOR attestation CIDs — plus open-union `details` (`#judgmentBreakdown`) and `rankedVersions` legal chart/patch hashes.
4. **Infinite-Scale Mode A Attestations, EoS Fault Tolerance, Publisher Revocations & ATProto Labelers**
   - `achievement.unlock`, `achievement.progress`, and `leaderboard.score` carry inline ECDSA signatures (`games.opengaming.defs#inlineSignature`) bound to `repository` (`<playerDid>`) and optional `rkey` (`$sig.rkey`), scaling with **zero Game-PDS writes** during normal gameplay.
   - **End-of-Service (EoS) Continuity**: `signatures` are optional so direct-to-PDS OAuth writes keep working if a host shuts down; `trustedIssuers` lets federated hosts or community revival servers sign for existing boards; optional `replay` blobs (`<= 2 MB`) + community `verified-replay` labels allow serverless verification.
   - **Co-Equal Moderation**: Publishers issue surgical `attestationCid` or `before`-cutoff **`games.opengaming.revocation`** records in their own PDS, while AppViews fold **ATProto Labeler** events (`com.atproto.label.defs#label`, including `!cheat` invalidation and `neg: true` appeals).
5. **Per-Game Appreciation Over Global Gamerscore / XP**
   - Achievements intentionally **carry no XP / gamerscore value** and **have no cap on how many achievements a game can define**, spotlighting per-game `100%` completion, custom artwork, tiers, and global rarity.

---

## Monorepo Layout

- [`lexicons/`](lexicons/) — Canonical `games.opengaming.*` ATProto Lexicon v1 JSON schemas
- [`packages/sdk/`](packages/sdk/) — `@opengaming/sdk` TypeScript library & `opengaming` CLI
- [`docs/`](docs/) — Reference specifications & integration guides:
  - [`docs/ATTESTATION_AND_REVOCATION.md`](docs/ATTESTATION_AND_REVOCATION.md)
  - [`docs/ACHIEVEMENTS.md`](docs/ACHIEVEMENTS.md)
  - [`docs/LEADERBOARDS.md`](docs/LEADERBOARDS.md)
  - [`docs/SDK_AND_CLI.md`](docs/SDK_AND_CLI.md)
- [`examples/`](examples/) — End-to-end sample records ([`flappysky.examples.json`](examples/flappysky.examples.json))
- [`apps/web/`](apps/web/) — The **`opengaming.games`** AppView, Jetstream/PDS Indexer, XRPC Server, and Achievement & Leaderboard Viewer web app

---

## Lexicon Suite

| NSID | Type | Lives On | Purpose |
| :--- | :--- | :--- | :--- |
| [`games.opengaming.defs`](lexicons/games.opengaming.defs.json) | `defs` | Shared | `#inlineSignature` (`rkey`-capable), `#scoreFormat`, forward-compatible `#scoreComponentDefMap` / `#scoreComponentValMap`, and `#judgmentBreakdown` (`#judgmentMap`) |
| [`games.opengaming.achievement.definition`](lexicons/games.opengaming.achievement.definition.json) | `record` | Game PDS | Canonical achievement metadata (`game`, `title`/`description`/`icon` [omittable when `hidden: true`], `hiddenSpace`, `trustedIssuers`, `tier`, `stepsNeeded`) |
| [`games.opengaming.achievement.unlock`](lexicons/games.opengaming.achievement.unlock.json) | `record` | Player PDS | Inline-signed (or post-EoS) receipt confirming a player unlocked an achievement |
| [`games.opengaming.achievement.progress`](lexicons/games.opengaming.achievement.progress.json) | `record` | Player PDS | Partial step count (`currentSteps / stepsNeeded`) with optional `definitionCid` & `signatures` |
| [`games.opengaming.leaderboard.definition`](lexicons/games.opengaming.leaderboard.definition.json) | `record` | Game PDS | Canonical leaderboard config (`scoreFormat` or `components` map + `componentOrder`, `defaultComponent`, `rankedVersions`, `trustedIssuers`, `timeframes`, `recordPolicy`) |
| [`games.opengaming.leaderboard.score`](lexicons/games.opengaming.leaderboard.score.json) | `record` | Player PDS | Score submission supporting integer `score`, multi-component `components` map, open-union `details`, `version` hash, and `replay` blob |
| [`games.opengaming.revocation`](lexicons/games.opengaming.revocation.json) | `record` | Game PDS | Revokes compromised, exploited, or mistakenly signed attestations (`attestation`, `leaderboard`, `achievement`, or `game` scope) |
| [`games.opengaming.leaderboard.getScores`](lexicons/games.opengaming.leaderboard.getScores.json) | `query` | AppView / Game | Ranked leaderboard query supporting `timeframe`, `scope` (`public | social`), `sortBy` component, `version` hash filter, and label/replay metadata |
| [`games.opengaming.actor.getProfile`](lexicons/games.opengaming.actor.getProfile.json) | `query` | AppView | Player Gamercard summary (`gamesPlayed`, `completedGames`, `totalUnlocks`, `tiers`, per-game completion) |

---

## Quick Verification

```bash
npm install
npm run build
npm test
npm run validate
```

## License

Dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) for frictionless upstream adoption.
