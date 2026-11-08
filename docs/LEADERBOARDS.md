# Leaderboards Specification

Schemas:
- [`games.opengaming.leaderboard.definition`](../lexicons/games.opengaming.leaderboard.definition.json) (Game PDS — includes local `#points`, `#percentage`, `#time`, `#enum`, `#text`, `#componentMap`, `#dimensionMap`)
- [`games.opengaming.leaderboard.score`](../lexicons/games.opengaming.leaderboard.score.json) (Player PDS — includes local `#points`, `#percentage`, `#time`, `#enum`, `#text`, `#componentMap`)
- [`games.opengaming.leaderboard.getScores`](../lexicons/games.opengaming.leaderboard.getScores.json) (AppView XRPC Query)
- [`games.opengaming.defs`](../lexicons/games.opengaming.defs.json) (Shared `#scoreFormat`, `#participant`, `#optionItem`, `#stringMap`, `#judgmentBreakdown`)

---

## 1. Leaderboard Definitions (`games.opengaming.leaderboard.definition`)

Published in the game publisher's PDS (`key: "any"`, e.g. `high-score`, `rhythm-stage-1`). Supports **single-integer leaderboards**, **multi-component leaderboards**, **parameterized sub-board dimensions**, **speedrun PB history**, **co-op squads**, and **latest-rating ladders**.

### Core Fields, Storage Policy (`recordPolicy`), `timeframes` & `rankingMode`
Open Gaming cleanly separates PDS write retention (`recordPolicy`), query windows (`timeframes`), and competitor aggregation (`rankingMode`):

- `recordPolicy` (what records the client writes to the player's PDS):
  - `"overwriteBest"` *(legacy alias `"bestOnly"`)*: Single overwritten PB record per player (`rkey = getBestOnlyScoreRkey(leaderboardUri)`). Minimal storage; zero obsolete history.
  - `"personalBests"` *(speedrun.com model)*: Appends a new timestamped record (`createRecord`) **every time the player beats their all-time PB** (within the same `dimensions`), preserving their historical PB progression curve without flooding the PDS on failed runs!
  - `"perWindowBest"`: Appends a new timestamped record whenever a run beats the player's active `daily`, `weekly`, `monthly`, or `allTime` PB.
  - `"everyRun"`: Appends a timestamped record for every completed run or match rating update.
- `timeframes` (`array` of `"daily" | "weekly" | "monthly" | "allTime"`, 1–4 entries): Active query windows exposed for this leaderboard.
- `rankingMode` (`"best" | "latest"`, default `"best"`):
  - `"best"`: Ranks each competitor by their best non-revoked score inside the requested timeframe/filter, marking older runs as `obsolete: true`.
  - `"latest"`: Ranks each competitor by their **most recent** (`recordedAt`) verified score — essential for Elo/Glicko/MMR ladders where ratings move both up and down!
- `startsAt` / `endsAt` (`datetime`): Optional bounded contest/game-jam/season timestamps enforced by `@opengaming/sdk` and AppViews (`isWithinLeaderboardWindow`).

### Option A: Single-Integer Score Format (`scoreFormat` + `sortOrder`)
- `sortOrder`: `"largerIsBetter"` or `"smallerIsBetter"`.
- `scoreFormat` (`games.opengaming.defs#scoreFormat`):
  - `kind: "numeric"`: Optional `decimalPlaces` (`0..6`), `unitSingular` / `unitPlural`, and `signedPrefix: boolean` (formats `+3`, `-12`, `0` for golf to-par boards and rating deltas).
  - `kind: "time"`: `timeUnit: "milliseconds" | "seconds"` (e.g. `66032` ms -> `1:06.03`).
  - `kind: "currency"`: `currencyCode` (ISO 4217, e.g. `USD`) + `decimalPlaces`.

### Option B: Local Multi-Component Maps (`components` + `componentOrder` + `defaultComponent`)
Component definitions live **locally** inside `games.opengaming.leaderboard.definition` (`#componentMap`) and values live **locally** inside `games.opengaming.leaderboard.score` (`#componentMap`), giving clean, symmetric `$type` names while remaining 100% forward-compatible with the proposed Lexicon `map` type:

- `games.opengaming.leaderboard.definition#points` <-> `games.opengaming.leaderboard.score#points`
- `games.opengaming.leaderboard.definition#percentage` <-> `games.opengaming.leaderboard.score#percentage` (fixed-point integer scaled by `10^precision`, e.g. `9942` -> `99.42%`)
- `games.opengaming.leaderboard.definition#time` <-> `games.opengaming.leaderboard.score#time`
- `games.opengaming.leaderboard.definition#enum` <-> `games.opengaming.leaderboard.score#enum` (`values: [{ id, name }]`)
- `games.opengaming.leaderboard.definition#text` <-> `games.opengaming.leaderboard.score#text` (display metadata, non-sortable)

### Parameterized Sub-Board Dimensions (`dimensions` + `dimensionOrder`)
Instead of publishing $N \times M$ separate leaderboard definitions for every character, difficulty, keymode (`4K`/`7K`), or party size (`solo`/`duo`), a single `leaderboard.definition` can declare `dimensions` (`#dimensionMap`):
- Each dimension defines `name`, allowed `values` (`games.opengaming.defs#optionItem[]`), optional `required`, `allowCustomValues`, and `defaultValue`.
- Scores attach `dimensions` (`games.opengaming.defs#stringMap`, e.g. `{ "mode": "4k", "scroll": "upscroll" }`), validated at index time and filterable via `?dimensions=mode=4k,scroll=upscroll`.

---

## 2. Co-op Squads (`participants` + `runId`), Seeds, Versions & Replays (`games.opengaming.leaderboard.score`)

- **Co-op / Duo / Squad Runs**: `participants` (`games.opengaming.defs#participant[]`) lists all teammates (`did`, `name`, `role`, `team`), and `runId` (`string`) shares a canonical run identifier across teammates' PDS receipts. AppViews deduplicate verified records sharing `(leaderboard, runId)` into **one** leaderboard rank while surfacing the run on every teammate's social/player queries!
- **Daily / Procedural `seed`**: Records the deterministic seed (`seed: "2026-11-08"`), queryable via `?seed=`.
- **Open-Union `details` (`#judgmentBreakdown`)**, **`version` (`rankedVersions`)**, and **`replay` Blob (`<= 2 MB`)**.

---

## 3. Querying Rankings & Obsolete PB History (`games.opengaming.leaderboard.getScores`)

Supports:
- `timeframe`: `allTime | monthly | weekly | daily`
- `scope`: `public` or `social` (`viewer` follow graph)
- `player`: Filter entries to a specific player DID/handle (ideal with `includeObsolete=true` to render a player's full PB progression history!)
- `includeObsolete` (`boolean`, default `false`): Speedrun.com-style toggle. When `false`, returns only each competitor's active standing (`!obsolete`). When `true`, includes superseded historical runs marked with `obsolete: true`.
- `sortBy`: Rank by any sortable component key
- `dimensions`: Filter by sub-board dimension pairs (`key=val,key2=val2`)
- `seed` & `version`: Filter by daily/procedural seed or chart/build hash.
