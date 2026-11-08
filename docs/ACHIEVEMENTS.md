# Achievements & Per-Game Completion Specification

Schemas:
- [`games.opengaming.achievement.definition`](../lexicons/games.opengaming.achievement.definition.json) (Game PDS)
- [`games.opengaming.achievement.unlock`](../lexicons/games.opengaming.achievement.unlock.json) (Player PDS)
- [`games.opengaming.achievement.progress`](../lexicons/games.opengaming.achievement.progress.json) (Player PDS)
- [`games.opengaming.actor.getProfile`](../lexicons/games.opengaming.actor.getProfile.json) (AppView XRPC Query)

---

## 1. Philosophy: Per-Game Appreciation, No Global XP / Gamerscore

Open Gaming intentionally **omits XP / gamerscore point values** and **places no cap on how many achievements a game can define**:

- **Zero Clout-Chasing or Shovelware Inflation**: Without cross-game XP totals, games have no incentive to pad out trivial point-farming achievements, and AppViews need no arbitrary clamping formulas.
- **Freedom of Game Design**: Minimalist jam games with 3 handcrafted achievements and sprawling RPGs with 500+ milestones are both first-class citizens.
- **Rich Per-Game Signals**: Appreciation comes from custom artwork (`icon`), author-chosen trophy tiers (`bronze | silver | gold | platinum`), per-game completion progress (`unlockedCount / totalAchievements`, `bonusUnlockedCount`, and `100%` Perfect Game showcases), and global unlock rarity (`unlockedPlayers / totalPlayers` computed by AppViews).

---

## 2. Achievement Definitions (`games.opengaming.achievement.definition`)

Published in the game publisher's own PDS (`key: "any"`, using a stable slug `rkey` like `first-flight` or `secret-ending`).

### Required Fields
- `game` (`at-uri`): Link to the game's `games.atmosphere.define` (or catalog) record in the same publisher repository.
- `createdAt` (`datetime`).
- **For visible (`hidden: false`) achievements**:
  - `title` (`string`, <= 100 graphemes): Display name of the achievement. Mutable for typo fixes without breaking unlock `at-uri` links.
  - `description` (`string`, <= 500 graphemes): Summary of the achievement.
  - `icon` (`blob`, <= 1 MB, `image/png | image/jpeg | image/webp`): Square icon (512x512 PNG/WebP with alpha recommended).

### Spoiler-Proof Hidden Achievements & ATProto Spaces (`hidden: true` + `hiddenSpace`)
Because public PDS repositories and Firehose/Jetstream streams can be inspected directly (e.g. on `pds.ls`), Open Gaming supports **two tiers of hidden achievements**:

1. **Casual UI Masking (`hidden: true` with `title`/`description`)**: Compliant AppViews mask `title`, `description`, `requirement`, and `icon` until unlocked by the viewing player.
2. **Cryptographically Spoiler-Proof Stubs (`hidden: true` omitting `title`, `description`, and `icon` + `hiddenSpace`)**:
   - The public PDS record contains **only** `game`, `hidden: true`, optional `lockedIcon`, `tier`, `listOrder`, `hiddenSpace`, and `createdAt` — leaking zero narrative spoilers prior to or after launch.
   - `hiddenSpace` (`uri`) points to an access-controlled **ATProto Space** (or authenticated reveal endpoint) holding the real title, description, and artwork.

### Non-Penalizing DLC, Seasonal & Game Jam Badges (`countsTowardCompletion`, `repeatable`, Availability Windows)
- `countsTowardCompletion` (`boolean`, default `true`): When `false`, marks the achievement as a **Bonus / DLC / Feat of Strength** milestone. It is excluded from base-game `totalAchievements` and `100%` `completed` calculations so post-launch DLC or time-limited Game Jam badges never revoke existing players' `100%` status, while still surfacing in `actor.getProfile` under `bonusUnlockedCount` and `totalUnlocks`.
- `repeatable` (`boolean`, default `false`): Allows a player to earn an accolade multiple times (e.g. seasonal mastery, Prestige resets, multi-class clears) using timestamped/TID `rkey`s (`getUnlockRecordPlan`).
- `availableFrom` / `availableUntil` (`datetime`) & `retired` (`boolean`): Communicates time-limited or sunsetted achievements cleanly.
- `translations` (`games.opengaming.defs#translationMap`): Optional BCP-47 locale map (`ja`, `es`, `pt-BR`) overriding `title`, `description`, and `requirement` (`resolveTranslation` in `@opengaming/sdk`).

### Additional Optional Fields
- `requirement` (`string`), `iconAlt` (`string`), `lockedIcon` (`blob`), `tier` (`"bronze" | "silver" | "gold" | "platinum"`), `trustedIssuers` (`did[]`), `stepsNeeded` (`integer`, `>= 2`), `group` (`string`), `listOrder` (`integer`), `badge` (`at-uri`), `updatedAt` (`datetime`).

---

## 3. Symmetric `definitionCid` vs. `strongRef`

Across `achievement.unlock`, `achievement.progress`, and `leaderboard.score`, the target definition is referenced via a plain `at-uri` paired with an **optional** `definitionCid` (`cid`) rather than a mandatory `com.atproto.repo.strongRef`, so benign edits (typos, translations, unredacting a `hidden` stub) never orphan earlier awards while preserving optional snapshot provenance.

---

## 4. Rich Unlock Memories, Co-op Unlocks & Gamercards (`games.opengaming.achievement.unlock`)

- **Deterministic vs. Repeatable `rkey`**: Non-repeatable achievements use `getUnlockRkey(achievementUri)` (`putRecord` idempotency); `repeatable: true` definitions use `createRecord` (`getUnlockRecordPlan` in `@opengaming/sdk`).
- **RPG Hall-of-Fame & Narrative Memories**:
  - `details` (`open union`, built-in `games.opengaming.defs#unlockContext`): Captures `summary`, `playtimeMs`, `seed`, `loadout` (`string[]`, e.g. party/deck/relics), and `attributes` (`stringMap`, e.g. `{ character: "Paladin", ending: "Starlight" }`), or any custom game `$type`.
  - `media` (`blob`, <= 2 MB, `image/png | image/jpeg | image/webp`) + `mediaAlt`: Optional commemorative unlock screenshot, photo-mode card, or clear certificate stored in the player's PDS.
  - `note` (`string`, <= 300 graphemes): Optional player reflection or caption.
- **Co-op / Raid Unlocks**: `participants` (`games.opengaming.defs#participant[]`) + `runId` credit the full party or raid group that earned the achievement together.
- **`games.opengaming.actor.getProfile`**: Aggregates verified, non-revoked achievements per game (`unlockedCount`, core `totalAchievements`, `bonusUnlockedCount`, floored `completionPercent`, `completed`, `latestUnlockAt`), `gamesPlayed`, `completedGames`, `totalUnlocks`, and `tiers`.
