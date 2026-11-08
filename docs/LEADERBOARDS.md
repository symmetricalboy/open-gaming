# Leaderboards Specification

Schemas:
- [`games.opengaming.leaderboard.definition`](../lexicons/games.opengaming.leaderboard.definition.json) (Game PDS)
- [`games.opengaming.leaderboard.score`](../lexicons/games.opengaming.leaderboard.score.json) (Player PDS)
- [`games.opengaming.leaderboard.getScores`](../lexicons/games.opengaming.leaderboard.getScores.json) (AppView XRPC Query)

---

## 1. Leaderboard Definitions (`games.opengaming.leaderboard.definition`)

Published in the game publisher's PDS (`key: "any"`, e.g. `high-score`, `fastest-clear`).

### Required Fields
- `game` (`at-uri`): Link to the game's `games.atmosphere.define` record.
- `name` (`string`, ≤ 100 graphemes): Display name of the leaderboard.
- `icon` (`blob`, ≤ 1 MB): Required square icon (512×512 PNG/WebP recommended; avoid localized text inside artwork).
- `sortOrder`: `"largerIsBetter"` (points/collectibles) or `"smallerIsBetter"` (speedruns/elapsed time). Should not be changed after publication.
- `scoreFormat` (`games.opengaming.defs#scoreFormat`): Formatting rules for ATProto integer scores:
  - `kind: "numeric"`: Optional `decimalPlaces` (`0..6`) and `unitSingular` / `unitPlural` (e.g. `42 pts`, `3,141.59 meters`).
  - `kind: "time"`: `timeUnit: "milliseconds" | "seconds"` (e.g. `66032` ms → `1:06.03`).
  - `kind: "currency"`: `currencyCode` (ISO 4217, e.g. `USD`) + `decimalPlaces` (e.g. `19950000` with `decimalPlaces: 6` → `\$19.95`).
- `timeframes` (`array` of `"daily" | "weekly" | "allTime"`, 1–3 entries): Developer-selected timeframes displayed for this leaderboard.
- `recordPolicy`:
  - `"bestOnly"`: Maintains a single overwritten Personal Best record per player (`rkey = getBestOnlyScoreRkey(leaderboardUri)`). Best for games that only display `["allTime"]`.
  - `"perWindowBest"`: Appends a new timestamped record whenever a run beats the player's active Daily, Weekly, or All-Time personal best — preserving historical window rankings without spamming every failed attempt.
  - `"everyRun"`: Appends a timestamped record for every completed run.
- `createdAt` (`datetime`).

### Optional Guardrails
- `scoreMin` / `scoreMax` (`integer`): Sanity bounds enforced by `@opengaming/sdk` and AppViews to discard out-of-range scores.
- `description`, `iconAlt`, `listOrder`, `updatedAt`.

---

## 2. Player Score Records & Social Leaderboards

- **`games.opengaming.leaderboard.score`**: Stored in the player's PDS with `leaderboard` (`at-uri`), `score` (`integer`), `recordedAt` (`datetime`), optional `displayScore`, optional `tag` (up to 64 bytes, e.g. `"posts:30,likes:12"`), `player` (`did`), and inline `signatures[]`.
- **Global vs. Social Scope (`leaderboard.getScores`)**:
  - `scope: "public"` ranks all verified, non-revoked entries in the requested `timeframe`.
  - `scope: "social"` intersects entries with the `viewer` DID and accounts `viewer` follows via `app.bsky.graph.follow`, giving every ATProto game instant Friends Leaderboards with zero proprietary friend lists.
