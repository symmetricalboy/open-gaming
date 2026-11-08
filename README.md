# Open Gaming (`games.opengaming.*`)

Shared AT Protocol Lexicons, TypeScript SDK & CLI (`@opengaming/sdk`), Reference Documentation, and Viewer App (`opengaming.games`) for interoperable **Game Achievements**, **Leaderboards**, **Rotating Challenges**, and **PvP Match Results** — prototyped under `games.opengaming.*` (with [Flappysky](https://flappysky.symmetricalboy.com) as the first reference game) and designed for 1:1 adoption by the [ATProto Games Working Group](https://discourse.atmosphere.community/c/wg/games-wg/51).

---

## Core Design Principles

1. **Canonical Definitions on the Game's PDS, Lightweight Signed Receipts on the Player's PDS**
   - Games publish achievement, leaderboard, and challenge metadata (`title`, `description`, `icon` blob, `tier`, `scoreFormat` / `components`, `dimensions`, `timeframes`, `recordPolicy`, optional BCP-47 `translations`) once in the game publisher's repository.
   - Players store compact, dated unlock, progress, score, and match records in their own PDS referencing the game's definition via `at-uri` — with a symmetric, **optional `definitionCid`** across `unlock`, `progress`, and `score` so fixing typos or updating art never orphans existing player awards.
2. **Spoiler-Proof Hidden Achievements, Non-Penalizing DLC/Jam Badges & Unlock Memories**
   - When `hidden: true`, `achievement.definition` allows omitting `title`, `description`, and `icon` on the public PDS so Firehose / `pds.ls` scrapers never leak unreleased narrative spoilers, pointing to an access-controlled `hiddenSpace` URI revealed upon unlock.
   - `countsTowardCompletion: false` supports DLC, seasonal events, and game-jam "Feats of Strength" (`bonusUnlockedCount`) without revoking existing players' `100%` Perfect Game status; `repeatable: true` supports multi-earn accolades.
   - `achievement.unlock` supports optional commemorative `media` blobs (`<= 2 MB`), player `note`, co-op `participants` + `runId`, and open-union `details` (`games.opengaming.defs#unlockContext`) for RPG Hall-of-Fame party/loadout snapshots.
3. **Local Component Maps, Sub-Board Dimensions, Speedrun PB History & Co-op Squads**
   - Classic boards use `score` (`integer`) + `scoreFormat` (`numeric | time | currency`, including `signedPrefix: true` for golf to-par and rating deltas).
   - Multi-factor boards (rhythm games, action stages) declare local `leaderboard.definition#*` components (`#points`, `#percentage`, `#time`, `#enum`, `#text`) and `leaderboard.score#*` values via the forward-compatible `$keyFormat`/`$valueType` dictionary convention + `componentOrder` — positioned for a **zero-migration schema upgrade** to the proposed [Lexicon `map` type](https://bnewbold.leaflet.pub/3mimokt4o5c2f) without altering PDS records or DAG-CBOR attestation CIDs.
   - Parameterized sub-board `dimensions` (`mode=4k`, `character=mario,difficulty=hard`) avoid multiplying leaderboard definitions; `recordPolicy` (`overwriteBest`, `personalBests`, `perWindowBest`, `everyRun`) + `includeObsolete` + `player` power speedrun.com-style PB progression timelines; `participants` + `runId` deduplicate co-op/raid runs into a single leaderboard rank.
4. **Daily Seeds, Rotating Quests & Serverless P2P Co-Signed PvP Matches**
   - `games.opengaming.challenge.definition` models daily/weekly seeded runs and rotating quests linked to leaderboards and reward achievements.
   - `games.opengaming.match.result` captures 1v1, team, and free-for-all PvP matches (`ratingBefore` / `ratingAfter`, `#setBreakdown`), verifying **both** server-attested ladders (`rankingMode: "latest"`) and **serverless peer-to-peer multi-participant DID co-signing**.
5. **Infinite-Scale Mode A Attestations, EoS Fault Tolerance, Publisher Revocations & ATProto Labelers**
   - Player records carry inline ECDSA signatures (`games.opengaming.defs#inlineSignature`) bound to `repository` (`<playerDid>`) and optional `rkey` (`$sig.rkey`), scaling with **zero Game-PDS writes** during normal gameplay.
   - **End-of-Service (EoS) Continuity & Co-Equal Moderation**: Optional `signatures`, `trustedIssuers` revival federation, `replay` blobs (`<= 2 MB`) + `verified-replay` labels, surgical `games.opengaming.revocation` records, and ATProto Labeler folding (`!cheat`, `neg: true` appeals).
6. **Per-Game Appreciation Over Global Gamerscore / XP**
   - Achievements intentionally **carry no XP / gamerscore value** and **have no cap on how many achievements a game can define**, spotlighting per-game `100%` completion, custom artwork, tiers, and global rarity.

---

## Monorepo Layout

- [`lexicons/`](lexicons/) — Canonical `games.opengaming.*` ATProto Lexicon v1 JSON schemas (11 schemas)
- [`packages/sdk/`](packages/sdk/) — `@opengaming/sdk` TypeScript library & `opengaming` CLI
- [`docs/`](docs/) — Reference specifications & integration guides:
  - [`docs/ATTESTATION_AND_REVOCATION.md`](docs/ATTESTATION_AND_REVOCATION.md)
  - [`docs/ACHIEVEMENTS.md`](docs/ACHIEVEMENTS.md)
  - [`docs/LEADERBOARDS.md`](docs/LEADERBOARDS.md)
  - [`docs/MATCHES_AND_CHALLENGES.md`](docs/MATCHES_AND_CHALLENGES.md)
  - [`docs/SDK_AND_CLI.md`](docs/SDK_AND_CLI.md)
- [`examples/`](examples/) — End-to-end sample records ([`flappysky.examples.json`](examples/flappysky.examples.json))
- [`apps/web/`](apps/web/) — The **`opengaming.games`** AppView, Jetstream/PDS Indexer, XRPC Server, and Achievement & Leaderboard Viewer web app

---

## Lexicon Suite (11 Schemas)

| NSID | Type | Lives On | Purpose |
| :--- | :--- | :--- | :--- |
| [`games.opengaming.defs`](lexicons/games.opengaming.defs.json) | `defs` | Shared | `#inlineSignature` (`rkey`-capable), `#scoreFormat` (`signedPrefix`), `#participant`, `#optionItem`, `#stringMap`, `#translation` / `#translationMap`, `#unlockContext`, and `#judgmentBreakdown` |
| [`games.opengaming.achievement.definition`](lexicons/games.opengaming.achievement.definition.json) | `record` | Game PDS | Canonical achievement metadata (`hiddenSpace`, `countsTowardCompletion`, `repeatable`, `availableFrom`/`Until`, `retired`, `translations`, `trustedIssuers`, `tier`, `stepsNeeded`) |
| [`games.opengaming.achievement.unlock`](lexicons/games.opengaming.achievement.unlock.json) | `record` | Player PDS | Unlock receipt supporting co-op `participants` + `runId`, open-union `details` (`#unlockContext`), commemorative `media` blob, and `note` |
| [`games.opengaming.achievement.progress`](lexicons/games.opengaming.achievement.progress.json) | `record` | Player PDS | Partial step count (`currentSteps / stepsNeeded`) with optional `definitionCid` & `signatures` |
| [`games.opengaming.leaderboard.definition`](lexicons/games.opengaming.leaderboard.definition.json) | `record` | Game PDS | Canonical leaderboard config with local `#points`/`#percentage`/`#time`/`#enum`/`#text` `#componentMap`, `#dimensionMap`, `rankingMode`, `startsAt`/`endsAt`, `rankedVersions`, `timeframes`, and `recordPolicy` |
| [`games.opengaming.leaderboard.score`](lexicons/games.opengaming.leaderboard.score.json) | `record` | Player PDS | Score submission supporting integer `score` or local `#componentMap`, `dimensions`, `seed`, co-op `participants` + `runId`, open-union `details`, `version` hash, and `replay` blob |
| [`games.opengaming.challenge.definition`](lexicons/games.opengaming.challenge.definition.json) | `record` | Game PDS | Daily/weekly/event challenges & quests (`cadence`, `seed`, `targetSteps`, `leaderboard`, `rewardAchievement`, `dimensions`, `startsAt`/`endsAt`) |
| [`games.opengaming.match.result`](lexicons/games.opengaming.match.result.json) | `record` | Player PDS | PvP / competitive match outcome (`participants` with `outcome` & `ratingBefore`/`ratingAfter`, `#setBreakdown`, host attestation OR P2P multi-participant DID co-signing) |
| [`games.opengaming.revocation`](lexicons/games.opengaming.revocation.json) | `record` | Game PDS | Revokes compromised, exploited, or mistakenly signed attestations (`attestation`, `leaderboard`, `achievement`, `match`, `challenge`, or `game` scope) |
| [`games.opengaming.leaderboard.getScores`](lexicons/games.opengaming.leaderboard.getScores.json) | `query` | AppView / Game | Ranked query supporting `timeframe` (`daily | weekly | monthly | allTime`), `scope`, `player`, `includeObsolete` (`obsolete: boolean`), `sortBy`, `dimensions`, `seed`, and `version` |
| [`games.opengaming.actor.getProfile`](lexicons/games.opengaming.actor.getProfile.json) | `query` | AppView | Player Gamercard summary (`gamesPlayed`, `completedGames`, `totalUnlocks`, `tiers`, per-game completion + `bonusUnlockedCount`) |

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
