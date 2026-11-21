import type {
  AchievementDefinitionRecord,
  AchievementUnlockRecord,
  ActorProfileSummary,
  GameAchievementSummary,
  TierCounts,
  TimeRange,
  Translation,
  TranslationMap,
} from './types.js';

export interface DefinitionEntry {
  uri: string;
  record: AchievementDefinitionRecord;
}

const RESERVED_TRANSLATION_KEYS = new Set(['$keyFormat', '$valueType', '.', '..']);
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const VALID_FREQS = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);

interface ParsedRrule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  byMonth?: Set<number>;
  byDay?: Set<string>;
  untilMs?: number;
  count?: number;
}

function parseRruleTimestamp(raw: string): number {
  const clean = raw.trim();
  const compactMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/i.exec(clean);
  if (compactMatch) {
    const [, y, mo, d, h, mi, s] = compactMatch;
    return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  }
  return Date.parse(clean);
}

function parseRrule(raw: string): ParsedRrule | null {
  const body = raw.trim().replace(/^RRULE:/i, '');
  if (!body) return null;

  let freq: ParsedRrule['freq'] | undefined;
  let interval = 1;
  let byMonth: Set<number> | undefined;
  let byDay: Set<string> | undefined;
  let untilMs: number | undefined;
  let count: number | undefined;

  for (const part of body.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) return null;
    const key = trimmed.slice(0, eqIdx).trim().toUpperCase();
    const val = trimmed.slice(eqIdx + 1).trim();

    switch (key) {
      case 'FREQ': {
        const up = val.toUpperCase();
        if (!VALID_FREQS.has(up)) return null;
        freq = up as ParsedRrule['freq'];
        break;
      }
      case 'INTERVAL': {
        const parsed = Number.parseInt(val, 10);
        if (!Number.isInteger(parsed) || parsed < 1) return null;
        interval = parsed;
        break;
      }
      case 'BYMONTH': {
        const months = val
          .split(',')
          .map((m) => Number.parseInt(m.trim(), 10))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
        if (months.length === 0) return null;
        byMonth = new Set(months);
        break;
      }
      case 'BYDAY': {
        const days: string[] = [];
        for (const token of val.split(',')) {
          const code = token.trim().toUpperCase().slice(-2);
          if (!(DAY_CODES as readonly string[]).includes(code)) return null;
          days.push(code);
        }
        if (days.length === 0) return null;
        byDay = new Set(days);
        break;
      }
      case 'UNTIL': {
        const ts = parseRruleTimestamp(val);
        if (!Number.isFinite(ts)) return null;
        untilMs = ts;
        break;
      }
      case 'COUNT': {
        const parsed = Number.parseInt(val, 10);
        if (!Number.isInteger(parsed) || parsed < 1) return null;
        count = parsed;
        break;
      }
      default:
        break;
    }
  }

  if (!freq) return null;
  return { freq, interval, byMonth, byDay, untilMs, count };
}

/**
 * Determine whether an achievement definition is optional for 100% completion (`completionOptional: true`).
 * Undeclared defaults to `false` (required for completion). Also honors legacy `countsTowardCompletion: false`
 * if encountered on pre-migration JSON payloads.
 */
export function isCompletionOptional(record: AchievementDefinitionRecord): boolean {
  if (typeof record.completionOptional === 'boolean') {
    return record.completionOptional;
  }
  const legacy = (record as unknown as { countsTowardCompletion?: boolean }).countsTowardCompletion;
  return legacy === false;
}

/**
 * Validate `achievement.definition#timelocked` ranges (`from` and `until` both present, valid ISO
 * datetimes with `until > from`, and valid optional `recurrence` RRULE).
 */
export function validateTimelockRanges(timelocked?: TimeRange[]): string | null {
  if (timelocked === undefined) return null;
  if (!Array.isArray(timelocked) || timelocked.length === 0) {
    return 'Achievement "timelocked" must be a non-empty array of time ranges when provided.';
  }
  if (timelocked.length > 64) {
    return `Achievement "timelocked" exceeds maximum of 64 ranges (got ${timelocked.length}).`;
  }

  for (let i = 0; i < timelocked.length; i++) {
    const item = timelocked[i];
    if (!item || typeof item !== 'object') {
      return `timelocked[${i}] must be an object containing both "from" and "until".`;
    }
    if (typeof item.from !== 'string' || typeof item.until !== 'string') {
      return `timelocked[${i}] requires both "from" and "until" datetime strings.`;
    }
    const fromMs = Date.parse(item.from);
    const untilMs = Date.parse(item.until);
    if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs)) {
      return `timelocked[${i}] contains an invalid ISO datetime.`;
    }
    if (untilMs <= fromMs) {
      return `timelocked[${i}] "until" (${item.until}) must be strictly after "from" (${item.from}).`;
    }
    if (item.recurrence !== undefined) {
      if (typeof item.recurrence !== 'string' || item.recurrence.length > 256 || !parseRrule(item.recurrence)) {
        return `timelocked[${i}] has invalid RFC 5545 recurrence rule "${String(item.recurrence)}".`;
      }
    }
  }
  return null;
}

/**
 * Check whether `timestampIso` falls inside at least one active `[from, until]` window (including
 * optional RFC 5545 `recurrence` schedules such as `FREQ=WEEKLY;BYMONTH=7;BYDAY=FR` for every Friday
 * night in July) in `timelocked`. Returns `true` when `timelocked` is omitted or empty.
 */
export function isWithinTimelock(timestampIso: string, timelocked?: TimeRange[]): boolean {
  if (!timelocked || timelocked.length === 0) return true;
  const ts = Date.parse(timestampIso);
  if (!Number.isFinite(ts)) return false;

  const DAY_MS = 86_400_000;

  for (const range of timelocked) {
    if (!range || typeof range.from !== 'string' || typeof range.until !== 'string') continue;
    const fromMs = Date.parse(range.from);
    const untilMs = Date.parse(range.until);
    if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs) || untilMs <= fromMs) continue;

    if (ts >= fromMs && ts <= untilMs) {
      return true;
    }

    if (!range.recurrence || ts < fromMs) continue;
    const rule = parseRrule(range.recurrence);
    if (!rule) continue;

    const durationMs = untilMs - fromMs;
    const baseDate = new Date(fromMs);
    const baseDayStartMs = Date.UTC(
      baseDate.getUTCFullYear(),
      baseDate.getUTCMonth(),
      baseDate.getUTCDate()
    );
    const timeOfDayMs = fromMs - baseDayStartMs;

    const earliestStartMs = Math.max(fromMs, ts - durationMs);
    const earliestDate = new Date(earliestStartMs);
    const latestDate = new Date(ts);

    const startDayMs = Date.UTC(
      earliestDate.getUTCFullYear(),
      earliestDate.getUTCMonth(),
      earliestDate.getUTCDate()
    );
    const endDayMs = Date.UTC(
      latestDate.getUTCFullYear(),
      latestDate.getUTCMonth(),
      latestDate.getUTCDate()
    );

    const baseMondayOffset = (baseDate.getUTCDay() + 6) % 7;
    const baseWeekMondayMs = baseDayStartMs - baseMondayOffset * DAY_MS;

    for (let dayMs = startDayMs; dayMs <= endDayMs; dayMs += DAY_MS) {
      const candStartMs = dayMs + timeOfDayMs;
      if (candStartMs < fromMs) continue;
      if (ts < candStartMs || ts > candStartMs + durationMs) continue;
      if (rule.untilMs !== undefined && candStartMs > rule.untilMs) continue;

      const candDate = new Date(candStartMs);
      const candMonth = candDate.getUTCMonth() + 1;
      const candDayCode = DAY_CODES[candDate.getUTCDay()];

      if (rule.byMonth && !rule.byMonth.has(candMonth)) continue;
      if (rule.byDay && !rule.byDay.has(candDayCode)) continue;

      let matchesFreq = false;
      switch (rule.freq) {
        case 'DAILY': {
          const daysDiff = Math.round((dayMs - baseDayStartMs) / DAY_MS);
          matchesFreq = daysDiff >= 0 && daysDiff % rule.interval === 0;
          if (matchesFreq && rule.count !== undefined && !rule.byMonth && !rule.byDay) {
            matchesFreq = Math.floor(daysDiff / rule.interval) < rule.count;
          }
          break;
        }
        case 'WEEKLY': {
          if (!rule.byDay && candDate.getUTCDay() !== baseDate.getUTCDay()) {
            matchesFreq = false;
            break;
          }
          const candMondayOffset = (candDate.getUTCDay() + 6) % 7;
          const candWeekMondayMs = dayMs - candMondayOffset * DAY_MS;
          const weeksDiff = Math.round((candWeekMondayMs - baseWeekMondayMs) / (7 * DAY_MS));
          matchesFreq = weeksDiff >= 0 && weeksDiff % rule.interval === 0;
          if (matchesFreq && rule.count !== undefined && !rule.byMonth && !rule.byDay) {
            matchesFreq = Math.floor(weeksDiff / rule.interval) < rule.count;
          }
          break;
        }
        case 'MONTHLY': {
          if (!rule.byDay && candDate.getUTCDate() !== baseDate.getUTCDate()) {
            matchesFreq = false;
            break;
          }
          const monthsDiff =
            (candDate.getUTCFullYear() - baseDate.getUTCFullYear()) * 12 +
            (candDate.getUTCMonth() - baseDate.getUTCMonth());
          matchesFreq = monthsDiff >= 0 && monthsDiff % rule.interval === 0;
          break;
        }
        case 'YEARLY': {
          if (!rule.byMonth && candDate.getUTCMonth() !== baseDate.getUTCMonth()) {
            matchesFreq = false;
            break;
          }
          if (!rule.byDay && candDate.getUTCDate() !== baseDate.getUTCDate()) {
            matchesFreq = false;
            break;
          }
          const yearsDiff = candDate.getUTCFullYear() - baseDate.getUTCFullYear();
          matchesFreq = yearsDiff >= 0 && yearsDiff % rule.interval === 0;
          break;
        }
      }

      if (matchesFreq) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Resolve localized text fields (`title`, `name`, `description`, `requirement`, `tooltip`) for an
 * achievement, leaderboard, or challenge definition using BCP-47 fallback matching
 * (e.g. `ja-JP` -> `ja` -> base record fields).
 */
export function resolveTranslation<
  T extends {
    title?: string;
    name?: string;
    description?: string;
    requirement?: string;
    tooltip?: string;
    translations?: TranslationMap;
  },
>(entity: T, locale?: string): Translation {
  const base: Translation = {
    ...(entity.title !== undefined ? { title: entity.title } : {}),
    ...(entity.name !== undefined ? { name: entity.name } : {}),
    ...(entity.description !== undefined ? { description: entity.description } : {}),
    ...(entity.requirement !== undefined ? { requirement: entity.requirement } : {}),
    ...(entity.tooltip !== undefined ? { tooltip: entity.tooltip } : {}),
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
    tooltip: matched.tooltip ?? base.tooltip,
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
 * - Standard achievements (`completionOptional` omitted or `false`) count toward `totalAchievements` and `100%` `completed`.
 * - Outlier achievements with `completionOptional: true` (seasonal events, Game Jam badges, DLC extras)
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
  const baseDefs = gameDefs.filter((d) => !isCompletionOptional(d.record));
  const bonusDefMap = new Map(
    gameDefs
      .filter((d) => isCompletionOptional(d.record))
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
      case undefined:
      case '':
        tiers.untiered += 1;
        break;
      default:
        tiers.custom = (tiers.custom ?? 0) + 1;
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
