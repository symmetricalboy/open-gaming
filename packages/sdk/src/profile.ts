import type {
  AchievementDefinitionRecord,
  AchievementUnlockRecord,
  ActorProfileSummary,
  GameAchievementSummary,
  TierCounts,
  Translation,
  TranslationMap,
} from './types.js';

export interface DefinitionEntry {
  uri: string;
  record: AchievementDefinitionRecord;
}

const RESERVED_TRANSLATION_KEYS = new Set(['$keyFormat', '$valueType', '.', '..']);

/**
 * Resolve localized text fields (`title`, `name`, `description`, `requirement`) for an
 * achievement, leaderboard, or challenge definition using BCP-47 fallback matching
 * (e.g. `ja-JP` -> `ja` -> base record fields).
 */
export function resolveTranslation<
  T extends {
    title?: string;
    name?: string;
    description?: string;
    requirement?: string;
    translations?: TranslationMap;
  },
>(entity: T, locale?: string): Translation {
  const base: Translation = {
    ...(entity.title !== undefined ? { title: entity.title } : {}),
    ...(entity.name !== undefined ? { name: entity.name } : {}),
    ...(entity.description !== undefined ? { description: entity.description } : {}),
    ...(entity.requirement !== undefined ? { requirement: entity.requirement } : {}),
  };

  if (!locale || !entity.translations || typeof entity.translations !== 'object') {
    return base;
  }

  const normalizedRequested = locale.trim().toLowerCase();
  if (!normalizedRequested) return base;

  const entries = Object.entries(entity.translations).filter(
    ([k, v]) => !RESERVED_TRANSLATION_KEYS.has(k) && v && typeof v === 'object'
  );
  if (entries.length === 0) return base;

  let matched: Translation | undefined;
  // 1. Exact case-insensitive BCP-47 match (e.g. `ja-latn` === `ja-Latn`)
  for (const [tag, val] of entries) {
    if (tag.toLowerCase() === normalizedRequested) {
      matched = val;
      break;
    }
  }
  // 2. Primary language subtag fallback (e.g. `ja-JP` -> `ja`)
  if (!matched) {
    const baseLang = normalizedRequested.split('-')[0];
    for (const [tag, val] of entries) {
      if (tag.toLowerCase() === baseLang) {
        matched = val;
        break;
      }
    }
  }

  if (!matched) return base;

  return {
    title: matched.title ?? base.title,
    name: matched.name ?? base.name,
    description: matched.description ?? base.description,
    requirement: matched.requirement ?? base.requirement,
  };
}

/**
 * Deterministic display sort for a game's achievement definitions:
 * `listOrder` ascending (with omitted `listOrder` placed after ordered items), then canonical AT-URI.
 */
export function sortAchievementDefinitions(definitions: DefinitionEntry[]): DefinitionEntry[] {
  return [...definitions].sort((a, b) => {
    const orderA = a.record.listOrder ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.record.listOrder ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.uri.localeCompare(b.uri);
  });
}

/**
 * Compute per-game achievement completion for a single game (with no XP values or achievement count cap).
 * - Achievements with `countsTowardCompletion === false` (Game Jam badges, Feats of Strength, DLC extras)
 *   are counted in `bonusUnlockedCount` and never penalize `completionPercent` or `completed`.
 * - `completionPercent` is floored so `100` is reached strictly when `unlockedCount === totalAchievements`.
 */
export function calculateGameCompletion({
  game,
  verifiedUnlocks,
  definitions,
}: {
  game: string;
  verifiedUnlocks: AchievementUnlockRecord[];
  definitions: DefinitionEntry[];
}): GameAchievementSummary {
  const gameDefs = definitions.filter((d) => d.record.game === game);
  const baseDefs = gameDefs.filter((d) => d.record.countsTowardCompletion !== false);
  const bonusDefMap = new Map(
    gameDefs
      .filter((d) => d.record.countsTowardCompletion === false)
      .map((d) => [d.uri, d.record] as const)
  );
  const baseUriSet = new Set(baseDefs.map((d) => d.uri));
  const allUriSet = new Set(gameDefs.map((d) => d.uri));

  const unlockedBaseSet = new Set<string>();
  const unlockedBonusDistinct = new Set<string>();
  let repeatableBonusExtra = 0;
  let latestUnlockAt: string | undefined;

  for (const unlock of verifiedUnlocks) {
    if (!allUriSet.has(unlock.achievement)) continue;

    if (!latestUnlockAt || Date.parse(unlock.unlockedAt) > Date.parse(latestUnlockAt)) {
      latestUnlockAt = unlock.unlockedAt;
    }

    if (baseUriSet.has(unlock.achievement)) {
      unlockedBaseSet.add(unlock.achievement);
    } else if (bonusDefMap.has(unlock.achievement)) {
      const bonusDef = bonusDefMap.get(unlock.achievement)!;
      if (unlockedBonusDistinct.has(unlock.achievement) && bonusDef.repeatable) {
        repeatableBonusExtra += 1;
      } else {
        unlockedBonusDistinct.add(unlock.achievement);
      }
    }
  }

  const totalAchievements = baseDefs.length;
  const unlockedCount = unlockedBaseSet.size;
  const bonusUnlockedCount = unlockedBonusDistinct.size + repeatableBonusExtra;
  const completed = totalAchievements > 0 && unlockedCount === totalAchievements;
  const completionPercent =
    totalAchievements === 0 ? 0 : Math.min(100, Math.floor((unlockedCount * 100) / totalAchievements));

  return {
    game,
    unlockedCount,
    totalAchievements,
    ...(bonusUnlockedCount > 0 ? { bonusUnlockedCount } : {}),
    completionPercent,
    completed,
    ...(latestUnlockAt ? { latestUnlockAt } : {}),
  };
}

/**
 * Aggregate a player's verified, non-revoked achievement unlocks into a per-game focused
 * `ActorProfileSummary` matching `games.opengaming.actor.getProfile`.
 *
 * Games are uncapped in achievement count, carry no XP/gamerscore values, celebrate non-completion
 * Feats of Strength via `bonusUnlockedCount`, and are ordered by most recently unlocked achievement descending.
 */
export function summarizeActorProfile({
  playerDid,
  handle,
  verifiedUnlocks,
  definitions,
}: {
  playerDid: string;
  handle?: string;
  /** Pre-verified, non-revoked achievement unlock records for `playerDid`. */
  verifiedUnlocks: AchievementUnlockRecord[];
  /** Known achievement definitions indexed by their canonical AT-URI. */
  definitions: DefinitionEntry[];
}): ActorProfileSummary {
  const defsByGame = new Map<string, DefinitionEntry[]>();
  const defByUri = new Map<string, AchievementDefinitionRecord>();

  for (const d of definitions) {
    defByUri.set(d.uri, d.record);
    const list = defsByGame.get(d.record.game) ?? [];
    list.push(d);
    defsByGame.set(d.record.game, list);
  }

  const tiers: TierCounts = {
    platinum: 0,
    gold: 0,
    silver: 0,
    bronze: 0,
    untiered: 0,
  };

  const seenNonRepeatableUris = new Set<string>();
  let totalUnlocks = 0;

  for (const u of verifiedUnlocks) {
    const def = defByUri.get(u.achievement);
    if (!def) continue;

    if (!def.repeatable) {
      if (seenNonRepeatableUris.has(u.achievement)) continue;
      seenNonRepeatableUris.add(u.achievement);
    }

    totalUnlocks += 1;
    switch (def.tier) {
      case 'platinum':
        tiers.platinum += 1;
        break;
      case 'gold':
        tiers.gold += 1;
        break;
      case 'silver':
        tiers.silver += 1;
        break;
      case 'bronze':
        tiers.bronze += 1;
        break;
      default:
        tiers.untiered += 1;
        break;
    }
  }

  const games: GameAchievementSummary[] = [];
  for (const [gameUri, gameDefs] of defsByGame.entries()) {
    const summary = calculateGameCompletion({
      game: gameUri,
      verifiedUnlocks,
      definitions: gameDefs,
    });
    if (summary.unlockedCount > 0 || (summary.bonusUnlockedCount ?? 0) > 0) {
      games.push(summary);
    }
  }

  games.sort((a, b) => {
    const timeA = a.latestUnlockAt ? Date.parse(a.latestUnlockAt) : 0;
    const timeB = b.latestUnlockAt ? Date.parse(b.latestUnlockAt) : 0;
    if (timeB !== timeA) return timeB - timeA;
    return a.game.localeCompare(b.game);
  });

  const completedGames = games.filter((g) => g.completed).length;

  return {
    did: playerDid,
    ...(handle ? { handle } : {}),
    gamesPlayed: games.length,
    completedGames,
    totalUnlocks,
    tiers,
    games,
  };
}
