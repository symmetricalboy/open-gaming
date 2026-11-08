# Leaderboards Specification

Schemas:
- [`games.opengaming.defs`](../lexicons/games.opengaming.defs.json) (Shared Components & Breakdowns)
- [`games.opengaming.leaderboard.definition`](../lexicons/games.opengaming.leaderboard.definition.json) (Game PDS)
- [`games.opengaming.leaderboard.score`](../lexicons/games.opengaming.leaderboard.score.json) (Player PDS)
- [`games.opengaming.leaderboard.getScores`](../lexicons/games.opengaming.leaderboard.getScores.json) (AppView XRPC Query)

---

## 1. Leaderboard Definitions (`games.opengaming.leaderboard.definition`)

Published in the game publisher's PDS (`key: "any"`, e.g. `high-score`, `rhythm-stage-1`). Open Gaming supports both **classic single-integer leaderboards** and **multi-component leaderboards** (e.g. rhythm games, action stages with points + clear time + rank lamp) with 100% strict ATProto Lexicon v1 compliance.

### Core Fields
- `game` (`at-uri`): Link to the game's `games.atmosphere.define` record.
- `name` (`string`, <= 100 graphemes): Display name of the leaderboard or chart.
- `icon` (`blob`, <= 1 MB): Required square icon (512x512 PNG/WebP recommended).
- `timeframes` (`array` of `"daily" | "weekly" | "allTime"`, 1–3 entries): Developer-selected timeframes displayed for this leaderboard.
- `recordPolicy`:
  - `"bestOnly"`: Maintains a single overwritten Personal Best record per player (`rkey = getBestOnlyScoreRkey(leaderboardUri)`).
  - `"perWindowBest"`: Appends a new timestamped record whenever a run beats the player's active Daily, Weekly, or All-Time personal best.
  - `"everyRun"`: Appends a timestamped record for every completed run.
- `createdAt` (`datetime`).

### Option A: Single-Integer Score Format (`scoreFormat` + `sortOrder`)
For classic arcade, distance, or speedrun boards with a single primary metric:
- `sortOrder`: `"largerIsBetter"` or `"smallerIsBetter"`.
- `scoreFormat` (`games.opengaming.defs#scoreFormat`):
  - `kind: "numeric"`: Optional `decimalPlaces` (`0..6`) and `unitSingular` / `unitPlural` (e.g. `42 pts`, `3,141.59 meters`).
  - `kind: "time"`: `timeUnit: "milliseconds" | "seconds"` (e.g. `66032` ms -> `1:06.03`).
  - `kind: "currency"`: `currencyCode` (ISO 4217, e.g. `USD`) + `decimalPlaces` (e.g. `19950000` with `decimalPlaces: 6` -> `\$19.95`).
- `scoreMin` / `scoreMax` (`integer`): Sanity bounds enforced by `@opengaming/sdk` and AppViews.

### Option B: Forward-Compatible Multi-Component Maps (`components` + `componentOrder` + `defaultComponent`)
Multi-factor leaderboards define `components` (`games.opengaming.defs#scoreComponentDefMap`) as a dictionary object keyed by component key (`format: "record-key"`, 1..32 chars, e.g. `"ex-score"`, `"accuracy"`, `"clear-time"`, `"lamp"`):

- **Zero-Migration Path to Lexicon `map`**: Following the community `$keyFormat` / `$valueType` convention (aligned with Tsunagite and bnewbold's [*Expanding the Lexicon Language*](https://bnewbold.leaflet.pub/3mimokt4o5c2f) proposal), `#scoreComponentDefMap`, `#scoreComponentValMap`, and `#judgmentMap` validate cleanly under `@atproto/lexicon` v1 today (because neither optional placeholder property is required and Lexicon `object` ignores extra keys). When `type: "map"` ships upstream, only the Lexicon schema updates—existing PDS records and **DAG-CBOR `attestationCid` signatures** remain 100% unchanged!
- **Explicit `componentOrder` (`string[]`)**: Because ATProto PDS repositories store records in DAG-CBOR (which canonically sorts map keys by UTF-8 byte length first, then lexicographically), `componentOrder` preserves the game author's intended column order (`["ex-score", "accuracy", "lamp", "clear-time"]`) across PDS round-trips.
- **Supported Component Definitions**:
  - `games.opengaming.defs#pointsComponentDef`: Integer points (`name`, `minimum`, `maximum`, `sortOrder`, `unitSingular`/`unitPlural`).
  - `games.opengaming.defs#percentageComponentDef`: Fixed-point integer scaled by `10^precision` (e.g. `9942` with `precision: 2` -> `99.42%`), avoiding ATProto float restrictions and SQLite string-sort pitfalls.
  - `games.opengaming.defs#timeComponentDef`: Elapsed time in `milliseconds` or `seconds` (defaults to `smallerIsBetter`).
  - `games.opengaming.defs#enumComponentDef`: Ordered enum (`values: [{ id, name }]`) for clear lamps / letter grades (`All Perfect > Full Combo > Clear`).
  - `games.opengaming.defs#textComponentDef`: Short display metadata (`maxGraphemes`, non-sortable).

`defaultComponent` identifies the primary ranking key when `leaderboard.getScores` is called without `?sortBy=<component-key>`.

### Legal Chart / Map / Patch Hashes (`rankedVersions`) & Multi-Issuer (`trustedIssuers`)
- `rankedVersions` (`string[]`): Optional allowlist of legal chart, map, or game-build hashes (e.g. `["md5:8a4f2c...", "sha256:e3b0c4..."]`). When non-empty, `getScores` filters active rankings to scores whose `version` is in `rankedVersions` (unless a caller queries a specific historical `?version=`), keeping pre-patch scores intact and non-revoked in players' PDSs!
- `trustedIssuers` (`did[]`): Additional federated or community revival server DIDs authorized to sign scores for this leaderboard.

---

## 2. Player Score Records, Genre `details` & Replay Blobs (`games.opengaming.leaderboard.score`)

- **Core & Multi-Component Values**: Stores `leaderboard` (`at-uri`), optional `definitionCid`, integer `score` and/or `components` map (`#scoreComponentValMap`: `#pointsComponentVal`, `#percentageComponentVal`, `#timeComponentVal`, `#enumComponentVal`, `#textComponentVal` keyed by component key), `recordedAt`, optional `displayScore`, and optional `tag`.
- **Open-Union Genre `details` (`closed: false`)**: Carries rich non-ranked telemetry without bloating leaderboard definitions. Includes built-in `games.opengaming.defs#judgmentBreakdown` (`judgments` `#judgmentMap`, optional `judgmentOrder`, `maxCombo`, `totalEarly`, `totalLate`, `mode`, `inputMethod`), while games can attach any custom `$type` object.
- **Chart/Build `version` & Deterministic `replay` Blob**:
  - `version` (`string`): Hash or build identifier of the chart/level played.
  - `replay` (`blob`, <= 2 MB): Optional deterministic input log or replay file stored directly in the player's PDS for client-side playback and serverless/post-EoS verification.

---

## 3. Querying Rankings (`games.opengaming.leaderboard.getScores`)

Supports:
- `timeframe`: `allTime | weekly | daily`
- `scope`: `public` (global) or `social` (intersects with `viewer` + `app.bsky.graph.follow`)
- `sortBy`: Rank by any sortable component `id` (e.g. `?sortBy=ex-score`, `?sortBy=accuracy`, `?sortBy=clear-time`)
- `version`: Filter to a specific chart/patch hash (defaults to `definition.rankedVersions` when defined)
- Enriched `#scoreEntry` output with `issuer`, `components`, `version`, `hasReplay`, `replayCid`, and active ATProto `labels`.
