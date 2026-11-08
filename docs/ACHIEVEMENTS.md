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

1. **Casual UI Masking (`hidden: true` with `title`/`description`)**: Compliant AppViews mask `title`, `description`, `requirement`, and `icon` until unlocked by the viewing player. Suitable for lighthearted easter eggs where PDS inspection is harmless.
2. **Cryptographically Spoiler-Proof Stubs (`hidden: true` omitting `title`, `description`, and `icon` + `hiddenSpace`)**:
   - The public PDS record contains **only** `game`, `hidden: true`, optional `lockedIcon`, `tier`, `listOrder`, `hiddenSpace`, and `createdAt` — leaking zero narrative spoilers prior to or after launch.
   - `hiddenSpace` (`uri`) points to an access-controlled **ATProto Space** (or authenticated reveal endpoint) holding the real title, description, and artwork. When the game server signs an `achievement.unlock` for a player, it simultaneously grants that player's DID read membership to `hiddenSpace` (and post-launch/post-embargo, the publisher can optionally populate the public definition so public trophy cabinets render without extra fetches).

### Additional Optional Fields
- `requirement` (`string`): Imperative hint shown *before* unlock (e.g. `"Collect 100 likes cumulatively"`) when `description` uses past tense.
- `iconAlt` (`string`) & `lockedIcon` (`blob`): Accessibility text and optional custom locked silhouette icon.
- `tier` (`"bronze" | "silver" | "gold" | "platinum"`): Author-intended trophy tier for within-game milestone prestige.
- `trustedIssuers` (`did[]`): Additional DIDs (federated servers, tournament hosts, or post-EoS community revival servers) authorized to issue `#attestations` signatures for this achievement alongside the definition's repository owner.
- `stepsNeeded` (`integer`, `>= 2`): Marks the achievement as **Incremental**, enabling progress bars (`42 / 100`).
- `group` (`string`), `listOrder` (`integer`), `badge` (`at-uri` to `community.lexicon.badge.definition`), `updatedAt` (`datetime`).

---

## 3. Symmetric `definitionCid` vs. `strongRef`

Across `achievement.unlock`, `achievement.progress`, and `leaderboard.score`, the target definition is referenced via a plain `at-uri` (`achievement` or `leaderboard`) paired with an **optional** `definitionCid` (`cid`) rather than a mandatory `com.atproto.repo.strongRef`:

- **Why decoupled**: Game developers routinely fix typos, add translations, refresh badge art, or unredact a `hidden` stub after an embargo lifts. If player records mandated a strict `strongRef`, any benign edit to the definition on the Game's PDS would change its CID and orphan or split earlier unlocks/progress.
- **Historical provenance when desired**: Publishers or clients that want an immutable snapshot of the exact definition revision at the moment of unlock/progress/score can populate `definitionCid`.

---

## 4. Unlock Receipts, Incremental Progress & Gamercards

- **`games.opengaming.achievement.unlock`**: Stored in the player's PDS using deterministic `getUnlockRkey(achievementUri)` to prevent duplicate unlocks. Contains `achievement` (`at-uri`), optional `definitionCid`, optional `game`, `player` (`did`), `unlockedAt`, optional `stepsCompleted`, and optional `signatures[]`.
- **`games.opengaming.achievement.progress`**: Optional record updated in place (`getUnlockRkey(achievementUri)`) to sync partial incremental progress (`currentSteps` toward `stepsNeeded`, plus optional `definitionCid` and `signatures[]`) before final unlock.
- **`games.opengaming.actor.getProfile`**: Aggregates a player's verified, non-revoked achievements per game (`unlockedCount`, uncapped `totalAchievements`, floored `completionPercent`, `completed`, `latestUnlockAt`), `gamesPlayed`, `completedGames`, `totalUnlocks`, and `tiers`.
