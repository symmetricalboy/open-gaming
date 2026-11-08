import crypto from 'node:crypto';
import type {
  LeaderboardDefinitionRecord,
  LeaderboardScoreRecord,
  LeaderboardSortOrder,
  ScoreFormat,
  Timeframe,
} from './types.js';

/**
 * Deterministic record key (`rkey`) for a player's achievement unlock or progress record,
 * preventing accidental duplicate unlocks for the same achievement definition.
 */
export function getUnlockRkey(achievementDefinitionUri: string): string {
  const hash = crypto.createHash('sha256').update(achievementDefinitionUri).digest('hex').slice(0, 20);
  const slug = achievementDefinitionUri.split('/').pop() ?? 'ach';
  const safeSlug = slug.replace(/[^a-zA-Z0-9._~-]/g, '-').slice(0, 32);
  return `${safeSlug}-${hash}`;
}

/**
 * Deterministic record key (`rkey`) for a `recordPolicy: "bestOnly"` leaderboard score record.
 */
export function getBestOnlyScoreRkey(leaderboardDefinitionUri: string): string {
  const hash = crypto.createHash('sha256').update(leaderboardDefinitionUri).digest('hex').slice(0, 20);
  const slug = leaderboardDefinitionUri.split('/').pop() ?? 'lb';
  const safeSlug = slug.replace(/[^a-zA-Z0-9._~-]/g, '-').slice(0, 32);
  return `${safeSlug}-best-${hash}`;
}

/**
 * Compare whether `candidate` beats `existing` according to `sortOrder`.
 */
export function isBetterScore(
  candidate: number,
  existing: number,
  sortOrder: LeaderboardSortOrder
): boolean {
  if (sortOrder === 'smallerIsBetter') {
    return candidate < existing;
  }
  return candidate > existing;
}

/**
 * Format a raw integer leaderboard score according to its `ScoreFormat` definition.
 */
export function formatScore(rawScore: number, format: ScoreFormat, locale = 'en-US'): string {
  if (!Number.isFinite(rawScore)) {
    throw new Error(`Score must be a finite integer, got ${rawScore}.`);
  }
  const intScore = Math.trunc(rawScore);

  if (format.kind === 'time') {
    const totalMs = format.timeUnit === 'seconds' ? intScore * 1000 : intScore;
    const sign = totalMs < 0 ? '-' : '';
    const absMs = Math.abs(totalMs);
    const hours = Math.floor(absMs / 3_600_000);
    const minutes = Math.floor((absMs % 3_600_000) / 60_000);
    const seconds = Math.floor((absMs % 60_000) / 1000);
    const hundredths = Math.floor((absMs % 1000) / 10);

    const secPadded = String(seconds).padStart(2, '0');
    const frac = format.timeUnit === 'seconds' ? '' : `.${String(hundredths).padStart(2, '0')}`;
    if (hours > 0) {
      return `${sign}${hours}:${String(minutes).padStart(2, '0')}:${secPadded}${frac}`;
    }
    return `${sign}${minutes}:${secPadded}${frac}`;
  }

  const decimals = Math.max(0, Math.min(6, format.decimalPlaces ?? 0));
  const scaled = intScore / Math.pow(10, decimals);

  if (format.kind === 'currency') {
    const currency = format.currencyCode || 'USD';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals === 6 ? 2 : decimals,
      maximumFractionDigits: decimals === 6 ? 2 : decimals,
    }).format(scaled);
  }

  const formattedNum = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(scaled);

  if (Math.abs(scaled) === 1 && format.unitSingular) {
    return `${formattedNum} ${format.unitSingular}`;
  }
  if (format.unitPlural) {
    return `${formattedNum} ${format.unitPlural}`;
  }
  if (format.unitSingular) {
    return `${formattedNum} ${format.unitSingular}`;
  }
  return formattedNum;
}

/**
 * Compute the UTC start timestamp (epoch ms) for a given leaderboard `timeframe`.
 * - `daily`: 00:00:00.000 UTC of `now`'s day
 * - `weekly`: 00:00:00.000 UTC of Monday in `now`'s ISO week
 * - `allTime`: `-Infinity`
 */
export function getTimeframeStartMs(timeframe: Timeframe, now: Date = new Date()): number {
  if (timeframe === 'allTime') {
    return Number.NEGATIVE_INFINITY;
  }
  if (timeframe === 'daily') {
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
  }
  // weekly: Monday 00:00:00 UTC
  const dayOfWeek = now.getUTCDay(); // 0 = Sun, 1 = Mon, ...
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysSinceMonday,
    0,
    0,
    0,
    0
  );
}

export interface ScoreSubmissionDecision {
  validBounds: boolean;
  shouldWrite: boolean;
  writeMode: 'putRecord' | 'createRecord' | 'none';
  recommendedRkey?: string;
  beatenTimeframes: Timeframe[];
  reason?: string;
}

/**
 * Decide whether and how a completed run's score should be written to the player's PDS,
 * honoring the game leaderboard's `scoreMin`/`scoreMax`, `sortOrder`, `timeframes`, and `recordPolicy`.
 */
export function evaluateScoreSubmission({
  leaderboardUri,
  score,
  definition,
  existingPlayerScores,
  now = new Date(),
}: {
  leaderboardUri: string;
  score: number;
  definition: LeaderboardDefinitionRecord;
  existingPlayerScores: LeaderboardScoreRecord[];
  now?: Date;
}): ScoreSubmissionDecision {
  if (!Number.isInteger(score)) {
    return {
      validBounds: false,
      shouldWrite: false,
      writeMode: 'none',
      beatenTimeframes: [],
      reason: 'Score must be an integer.',
    };
  }

  if (definition.scoreMin !== undefined && score < definition.scoreMin) {
    return {
      validBounds: false,
      shouldWrite: false,
      writeMode: 'none',
      beatenTimeframes: [],
      reason: `Score ${score} is below leaderboard minimum ${definition.scoreMin}.`,
    };
  }

  if (definition.scoreMax !== undefined && score > definition.scoreMax) {
    return {
      validBounds: false,
      shouldWrite: false,
      writeMode: 'none',
      beatenTimeframes: [],
      reason: `Score ${score} exceeds leaderboard maximum ${definition.scoreMax}.`,
    };
  }

  const activeTimeframes: Timeframe[] =
    definition.timeframes?.length > 0 ? definition.timeframes : ['allTime'];

  const beatenTimeframes: Timeframe[] = [];

  for (const tf of activeTimeframes) {
    const startMs = getTimeframeStartMs(tf, now);
    const windowScores = existingPlayerScores.filter((s) => {
      const t = Date.parse(s.recordedAt);
      return Number.isFinite(t) && t >= startMs;
    });

    if (windowScores.length === 0) {
      beatenTimeframes.push(tf);
    } else {
      const bestInWindow = windowScores.reduce((best, cur) =>
        isBetterScore(cur.score, best.score, definition.sortOrder) ? cur : best
      );
      if (isBetterScore(score, bestInWindow.score, definition.sortOrder)) {
        beatenTimeframes.push(tf);
      }
    }
  }

  if (definition.recordPolicy === 'everyRun') {
    return {
      validBounds: true,
      shouldWrite: true,
      writeMode: 'createRecord',
      beatenTimeframes,
    };
  }

  if (definition.recordPolicy === 'bestOnly') {
    const beatsAllTime =
      existingPlayerScores.length === 0 ||
      existingPlayerScores.every((s) => isBetterScore(score, s.score, definition.sortOrder));

    if (!beatsAllTime) {
      return {
        validBounds: true,
        shouldWrite: false,
        writeMode: 'none',
        beatenTimeframes,
        reason: 'Does not beat existing All-Time personal best under `bestOnly` policy.',
      };
    }
    return {
      validBounds: true,
      shouldWrite: true,
      writeMode: 'putRecord',
      recommendedRkey: getBestOnlyScoreRkey(leaderboardUri),
      beatenTimeframes,
    };
  }

  // `perWindowBest`: write a new timestamped record whenever ANY enabled timeframe's PB is beaten
  if (beatenTimeframes.length === 0) {
    return {
      validBounds: true,
      shouldWrite: false,
      writeMode: 'none',
      beatenTimeframes: [],
      reason: 'Does not beat personal best in any enabled timeframe.',
    };
  }

  return {
    validBounds: true,
    shouldWrite: true,
    writeMode: 'createRecord',
    beatenTimeframes,
  };
}
