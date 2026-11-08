# Open Gaming (`games.opengaming.*`)

Shared AT Protocol Lexicons, TypeScript SDK & CLI (`@opengaming/sdk`), Reference Documentation, and Viewer App (`opengaming.games`) for interoperable **Game Achievements** and **Leaderboards** — prototyped under `games.opengaming.*` (with [Flappysky](https://flappysky.symmetricalboy.com) as the first reference game) and designed for 1:1 compatibility with `games.atmosphere.*` via the [ATProto Games Working Group](https://discourse.atmosphere.community/c/wg/games-wg/51).

---

## Core Design Principles

1. **Canonical Definitions on the Game's PDS, Lightweight Signed Receipts on the Player's PDS**
   - Games publish achievement and leaderboard metadata (`title`, `description`, required square `icon` blob, `tier`, `scoreFormat`, `timeframes`, `recordPolicy`) once in the game publisher's repository.
   - Players store compact, dated unlock and score records in their own PDS referencing the game's definition via `at-uri` (with an optional `definitionCid` snapshot so fixing typos or updating art never orphans existing player awards).
2. **Infinite-Scale Mode A Inline Attestations + Standard Revocations (`games.opengaming.revocation`)**
   - `achievement.unlock`, `achievement.progress`, and `leaderboard.score` carry inline ECDSA signatures (`games.opengaming.defs#inlineSignature`) signed by the game publisher's `#attestations` DID key over a repository-bound DAG-CBOR CID (`repository: <playerDid>` prevents cross-repo replay with **zero Game-PDS writes** during normal gameplay).
   - To revoke cheated or exploited records, the game publisher writes a **`games.opengaming.revocation`** record in the game's own PDS — either surgically by `attestationCid` (`rkey = <attestationCid>` for O(1) lookup and protection against moving records to a new `rkey`) or scoped by `player` + `leaderboard` / `achievement` / `game` (with optional `before` patch-cutoff timestamps). Deleting the revocation record reinstates validity.
3. **Per-Game Appreciation Over Global Gamerscore / XP**
   - Achievements intentionally **carry no XP / gamerscore value** and **have no cap on how many achievements a game can define**.
   - Removing cross-game XP eliminates shovelware point inflation and clout-chasing while putting the spotlight on each game's custom icons, trophy tiers (`bronze | silver | gold | platinum`), incremental milestones, per-game completion (`100%` Perfect Games), and global unlock rarity percentages.
4. **Developer-Configurable Leaderboards (`timeframes` & `recordPolicy`)**
   - Each `leaderboard.definition` chooses which `timeframes` (`daily`, `weekly`, `allTime`) it offers and which `recordPolicy` (`bestOnly`, `perWindowBest`, `everyRun`) governs player score records.
   - Integer-only raw scores formatted via `scoreFormat` (`numeric`, `time`, or `currency`), `largerIsBetter` / `smallerIsBetter` ordering, `scoreMin` / `scoreMax` bounds, and automatic **Social Leaderboards** via `app.bsky.graph.follow`.

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

## Lexicon Suite (v0.1)

| NSID (`games.opengaming.*` -> `games.atmosphere.*`) | Type | Lives On | Purpose |
| :--- | :--- | :--- | :--- |
| [`games.opengaming.defs`](lexicons/games.opengaming.defs.json) | `defs` | Shared | `#inlineSignature` (`badge.blue`-compatible) and `#scoreFormat` |
| [`games.opengaming.achievement.definition`](lexicons/games.opengaming.achievement.definition.json) | `record` | Game PDS | Canonical achievement metadata (`title`, `description`, `requirement`, required `icon`, optional `tier`, `hidden`, `stepsNeeded`; uncapped & XP-free) |
| [`games.opengaming.achievement.unlock`](lexicons/games.opengaming.achievement.unlock.json) | `record` | Player PDS | Inline-signed receipt confirming a player unlocked an achievement |
| [`games.opengaming.achievement.progress`](lexicons/games.opengaming.achievement.progress.json) | `record` | Player PDS | Partial step count (`currentSteps / stepsNeeded`) for incremental achievements |
| [`games.opengaming.leaderboard.definition`](lexicons/games.opengaming.leaderboard.definition.json) | `record` | Game PDS | Canonical leaderboard config (`name`, required `icon`, `sortOrder`, `scoreFormat`, `timeframes`, `recordPolicy`, `scoreMin`/`scoreMax`) |
| [`games.opengaming.leaderboard.score`](lexicons/games.opengaming.leaderboard.score.json) | `record` | Player PDS | Inline-signed personal-best / high-score submission |
| [`games.opengaming.revocation`](lexicons/games.opengaming.revocation.json) | `record` | Game PDS | Revokes compromised, exploited, or mistakenly signed attestations (`attestation`, `leaderboard`, `achievement`, or `game` scope) |
| [`games.opengaming.leaderboard.getScores`](lexicons/games.opengaming.leaderboard.getScores.json) | `query` | AppView / Game | Ranked leaderboard query supporting `allTime | weekly | daily` & `public | social` |
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
