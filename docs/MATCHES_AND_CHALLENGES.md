# Rotating Challenges & Competitive PvP Matches Specification

Schemas:
- [`games.opengaming.challenge.definition`](../lexicons/games.opengaming.challenge.definition.json) (Game PDS)
- [`games.opengaming.match.result`](../lexicons/games.opengaming.match.result.json) (Player PDS)

---

## 1. Daily Seeds, Bounded Events & Rotating Quests (`games.opengaming.challenge.definition`)

Games like *Spelunky*, *Balatro*, *Slay the Spire*, puzzle dailies, and live-service RPGs feature daily/weekly seeded runs and rotating quests without wanting to pollute permanent achievement lists or mint 365 separate leaderboard definitions per year.

### Core Fields
- `game` (`at-uri`): Reference to the game's `games.atmosphere.define` record.
- `title` (`string`, <= 100 graphemes) & optional `description`, `translations`, `icon`.
- `cadence`: `"daily" | "weekly" | "monthly" | "seasonal" | "event" | "permanent"` (open string).
- `seed` (`string`, <= 128 chars): Optional deterministic daily/procedural seed string (e.g. `"2026-11-08"`).
- `targetSteps` (`integer`): Optional objective target for quest-style challenges.
- `leaderboard` (`at-uri`): Optional link to the `games.opengaming.leaderboard.definition` ranking runs for this challenge (queried via `?seed=<seed>&dimensions=...`).
- `rewardAchievement` (`at-uri`): Optional link to a `games.opengaming.achievement.definition` unlocked upon completion (often `countsTowardCompletion: false` or `repeatable: true`).
- `dimensions` (`games.opengaming.defs#stringMap`): Required sub-board dimension values for participating runs (e.g. `{ "character": "ironclad", "ascension": "20" }`).
- `startsAt` / `endsAt` (`datetime`): Active window for the challenge.

---

## 2. Competitive PvP & Multiplayer Match Results (`games.opengaming.match.result`)

Head-to-head fighting games, RTS, chess/tabletop, card battlers, and arena shooters revolve around **discrete multi-player match outcomes** and **moving ratings** (`Elo` / `Glicko-2` / `MMR`) rather than solo high scores.

### Core Fields
- `game` (`at-uri`): Reference to the game's `games.atmosphere.define` record.
- `matchId` (`string`): Canonical match identifier shared across participants' PDS copies so AppViews deduplicate the match cleanly.
- `leaderboard` (`at-uri`): Optional link to a rating ladder (`leaderboard.definition` with `rankingMode: "latest"`).
- `challenge` (`at-uri`), `mode` (`string`, e.g. `"1v1-ranked"`), `bestOf` (`integer`), `durationMs` (`integer`).
- `participants` (`games.opengaming.match.result#participant[]`, >= 2 entries):
  - `did` (`did`), `name` (`string`), `team`, `role`, `character`
  - `outcome`: `"win" | "loss" | "draw" | "forfeit" | "dnf" | "completed"`
  - `placement` (`integer`), `score` (`integer`), `scoreText` (`string`, e.g. `"6-4, 3-6, 7-5"`)
  - `ratingBefore`, `ratingAfter`, `ratingDeviation` (`integer`)
- `details` (`open union`, built-in `games.opengaming.match.result#setBreakdown` with per-round `stage`, `winnerDid`, `summary`, and chess/fighting `notation`).
- `version` (`string`), `replay` (`blob`, <= 2 MB), `playedAt` (`datetime`), and `signatures` (`games.opengaming.defs#inlineSignature[]`).

### Dual Trust Model: Host Attestation OR Serverless P2P Multi-Participant Co-Signing!
`verifyMatchResult` in `@opengaming/sdk` (and the `opengaming.games` AppView) supports **three** verification paths out of the box:

1. **Publisher / Federated Server Attestation (`verificationMethod: "attestation"`)**:
   - An authoritative matchmaker, game studio, or tournament server (`publisherDid` or `trustedIssuers`) signs the match record once with its `#attestations` key.
2. **Serverless Peer-to-Peer Multi-Participant DID Co-Signing (`verificationMethod: "multi-participant"`)**:
   - For serverless indie fighting games, chess, tabletop, or jam games with **zero backend server**, **every DID-bearing participant** in `participants[]` signs the canonical match record with their own `#attestations` key (`createSignedMatchResult` followed by `coSignMatchResult`)!
   - A 1-sided claim where Alice claims she beat Bob without Bob's valid signature is automatically rejected (`error: "missing_participant_signatures"`). Once both Alice and Bob co-sign, any AppView can cryptographically verify mutual consent!
3. **Community Replay Label Verification (`verificationMethod: "community-label"`)**:
   - Unsigned matches with an attached deterministic `replay` blob can be verified post-EoS by community labelers (`verified-replay`).
