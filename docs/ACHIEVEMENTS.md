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
- **Rich Per-Game Signals**: Appreciation comes from custom artwork (`icon`), author-chosen trophy tiers (`bronze | silver | gold | platinum`), per-game completion progress (`unlockedCount / totalAchievements` and `100%` Perfect Game showcases), and global unlock rarity (`unlockedPlayers / totalPlayers` computed by AppViews).

---

## 2. Achievement Definitions (`games.opengaming.achievement.definition`)

Published in the game publisher's own PDS (`key: "any"`, using a stable slug `rkey` like `first-flight` or `banger-collector`).

### Required Fields
- `game` (`at-uri`): Link to the game's `games.atmosphere.define` (or catalog) record in the same publisher repository.
- `title` (`string`, ≤ 100 graphemes): Display name of the achievement. Mutable for typo fixes without breaking unlock `at-uri` links.
- `description` (`string`, ≤ 500 graphemes): Summary of the achievement.
- `icon` (`blob`, ≤ 1 MB, `image/png | image/jpeg | image/webp`): Required square icon (512×512 PNG/WebP with alpha recommended).
- `createdAt` (`datetime`).

### Optional Fields
- `requirement` (`string`): Imperative hint shown *before* unlock (e.g. `"Collect 100 likes cumulatively"`) when `description` uses past tense.
- `iconAlt` (`string`) & `lockedIcon` (`blob`): Accessibility text and optional custom locked silhouette icon.
- `tier` (`"bronze" | "silver" | "gold" | "platinum"`): Author-intended trophy tier for within-game milestone prestige.
- `hidden` (`boolean`, default `false`): Masks `title`, `description`, `requirement`, and `icon` in compliant UIs until unlocked by the viewing player. *(Privacy/Spoiler Note: PDS records are public on the network; avoid putting major narrative spoilers in plaintext fields).*
- `stepsNeeded` (`integer`, `>= 2`): Marks the achievement as **Incremental**, enabling progress bars (`42 / 100`).
- `group` (`string`), `listOrder` (`integer`), `badge` (`at-uri` to `community.lexicon.badge.definition`), `updatedAt` (`datetime`).

---

## 3. Unlock Receipts, Incremental Progress & Gamercards

- **`games.opengaming.achievement.unlock`**: Stored in the player's PDS using deterministic `getUnlockRkey(achievementUri)` to prevent duplicate unlocks. Contains `achievement` (`at-uri`), optional `definitionCid` snapshot, optional `game`, `player` (`did`), `unlockedAt`, optional `stepsCompleted`, and `signatures[]`.
- **`games.opengaming.achievement.progress`**: Optional record updated in place (`getUnlockRkey(achievementUri)`) to sync partial incremental progress (`currentSteps` toward `stepsNeeded`) before final unlock.
- **`games.opengaming.actor.getProfile`**: Aggregates a player's verified, non-revoked achievements per game (`unlockedCount`, uncapped `totalAchievements`, floored `completionPercent`, `completed`, `latestUnlockAt`), `gamesPlayed`, `completedGames`, `totalUnlocks`, and `tiers`.
