import type {
  AchievementDefinitionRecord,
  AchievementUnlockRecord,
  ActorProfileSummary,
  GameAchievementSummary,
  TierCounts,
} from './types.js';

export interface DefinitionEntry {
  uri: string;
  record: AchievementDefinitionRecord;
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
 * `completionPercent` is floored so `100` is reached strictly when `unlockedCount === totalAchievements`.
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
  const defUriSet = new Set(gameDefs.map((d) => d.uri));

  // Deduplicate unlocks by achievement AT-URI while tracking earliest unlock per achievement & latest overall
  const earliestByAch = new Map<string, string>();
  for (const unlock of verifiedUnlocks) {
    if (!defUriSet.has(unlock.achievement)) continue;
    const prev = earliestByAch.get(unlock.achievement);
    if (!prev || Date.parse(unlock.unlockedAt) < Date.parse(prev)) {
      earliestByAch.set(unlock.achievement, unlock.unlockedAt);
    }
  }

  let latestUnlockAt: string | undefined;
  for (const ts of earliestByAch.values()) {
    if (!latestUnlockAt || Date.parse(ts) > Date.parse(latestUnlockAt)) {
      latestUnlockAt = ts;
    }
  }

  const totalAchievements = gameDefs.length;
  const unlockedCount = earliestByAch.size;
  const completed = totalAchievements > 0 && unlockedCount === totalAchievements;
  const completionPercent =
    totalAchievements === 0 ? 0 : Math.min(100, Math.floor((unlockedCount * 100) / totalAchievements));

  return {
    game,
    unlockedCount,
    totalAchievements,
    completionPercent,
    completed,
    ...(latestUnlockAt ? { latestUnlockAt } : {}),
  };
}

/**
 * Aggregate a player's verified, non-revoked achievement unlocks into a per-game focused
 * `ActorProfileSummary` matching `games.opengaming.actor.getProfile`.
 *
 * Games are uncapped in achievement count, carry no XP/gamerscore values, and are ordered by
 * most recently unlocked achievement descending (then game AT-URI).
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

  // Deduplicate unlocks per achievement AT-URI
  const unlockedUris = new Set<string>();
  for (const u of verifiedUnlocks) {
    if (defByUri.has(u.achievement)) {
      unlockedUris.add(u.achievement);
    }
  }

  const tiers: TierCounts = {
    platinum: 0,
    gold: 0,
    silver: 0,
    bronze: 0,
    untiered: 0,
  };

  for (const achUri of unlockedUris) {
    const def = defByUri.get(achUri)!;
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
    if (summary.unlockedCount > 0) {
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
    totalUnlocks: unlockedUris.size,
    tiers,
    games,
  };
}
