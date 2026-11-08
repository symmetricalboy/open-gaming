import crypto from 'node:crypto';
import type {
  JudgmentBreakdown,
  LeaderboardDefinitionRecord,
  LeaderboardScoreRecord,
  LeaderboardSortOrder,
  ScoreComponentDef,
  ScoreComponentDefMap,
  ScoreComponentVal,
  ScoreComponentValMap,
  ScoreFormat,
  Timeframe,
} from './types.js';

const COMPONENT_KEY_REGEX = /^[a-zA-Z0-9_~.:-]{1,32}$/;
const RESERVED_COMPONENT_KEYS = new Set(['.', '..', '$keyFormat', '$valueType']);

const DEF_TO_VAL_TYPE: Record<ScoreComponentDef['$type'], ScoreComponentVal['$type']> = {
  'games.opengaming.defs#pointsComponentDef': 'games.opengaming.defs#pointsComponentVal',
  'games.opengaming.defs#percentageComponentDef': 'games.opengaming.defs#percentageComponentVal',
  'games.opengaming.defs#timeComponentDef': 'games.opengaming.defs#timeComponentVal',
  'games.opengaming.defs#enumComponentDef': 'games.opengaming.defs#enumComponentVal',
  'games.opengaming.defs#textComponentDef': 'games.opengaming.defs#textComponentVal',
};

/**
 * Check whether a map key satisfies our component/judgment key constraints
 * (ATProto `record-key` syntax, 1..32 chars, excluding `.` / `..` / schema placeholder keys).
 */
export function isValidComponentKey(key: string): boolean {
  return (
    typeof key === 'string' &&
    COMPONENT_KEY_REGEX.test(key) &&
    !RESERVED_COMPONENT_KEYS.has(key)
  );
}

/**
 * Return the ordered component keys for a `LeaderboardDefinitionRecord`, honoring explicit
 * `componentOrder` first (so display order survives DAG-CBOR canonical map-key sorting) and
 * appending any remaining keys present in `definition.components`.
 */
export function getOrderedComponentIds(
  definition: Pick<LeaderboardDefinitionRecord, 'components' | 'componentOrder'>
): string[] {
  const comps = definition.components;
  if (!comps || typeof comps !== 'object' || Array.isArray(comps)) {
    return [];
  }
  const availableKeys = Object.keys(comps).filter((k) => !RESERVED_COMPONENT_KEYS.has(k));
  if (availableKeys.length === 0) {
    return [];
  }
  const availableSet = new Set(availableKeys);
  const seen = new Set<string>();
  const ordered: string[] = [];

  if (Array.isArray(definition.componentOrder)) {
    for (const key of definition.componentOrder) {
      if (availableSet.has(key) && !seen.has(key)) {
        seen.add(key);
        ordered.push(key);
      }
    }
  }
  for (const key of availableKeys) {
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(key);
    }
  }
  return ordered;
}

/**
 * Return the ordered timing-judgment keys for a `#judgmentBreakdown`, honoring explicit
 * `judgmentOrder` first and appending any remaining keys in `judgments`.
 */
export function getOrderedJudgmentIds(
  breakdown: Pick<JudgmentBreakdown, 'judgments' | 'judgmentOrder'>
): string[] {
  const judgments = breakdown.judgments;
  if (!judgments || typeof judgments !== 'object' || Array.isArray(judgments)) {
    return [];
  }
  const availableKeys = Object.keys(judgments).filter((k) => !RESERVED_COMPONENT_KEYS.has(k));
  const availableSet = new Set(availableKeys);
  const seen = new Set<string>();
  const ordered: string[] = [];

  if (Array.isArray(breakdown.judgmentOrder)) {
    for (const key of breakdown.judgmentOrder) {
      if (availableSet.has(key) && !seen.has(key)) {
        seen.add(key);
        ordered.push(key);
      }
    }
  }
  for (const key of availableKeys) {
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(key);
    }
  }
  return ordered;
}

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
  sortOrder: LeaderboardSortOrder = 'largerIsBetter'
): boolean {
  if (sortOrder === 'smallerIsBetter') {
    return candidate < existing;
  }
  return candidate > existing;
}

/**
 * Check whether a score's chart/map/build `version` hash is legal under `rankedVersions`.
 * When `rankedVersions` is omitted or empty, any version (or no version) is accepted.
 */
export function isVersionLegal(version?: string, rankedVersions?: string[]): boolean {
  if (!rankedVersions || rankedVersions.length === 0) {
    return true;
  }
  if (!version) {
    return false;
  }
  return rankedVersions.includes(version);
}

/**
 * Format a raw integer leaderboard score according to its `ScoreFormat` definition.
 */
export function formatScore(rawScore: number, format: ScoreFormat = { kind: 'numeric' }, locale = 'en-US'): string {
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
 * Format a single multi-component value according to its matching `ScoreComponentDef`.
 */
export function formatComponentValue(
  val: ScoreComponentVal,
  def: ScoreComponentDef,
  locale = 'en-US'
): string {
  switch (def.$type) {
    case 'games.opengaming.defs#pointsComponentDef': {
      const num = typeof val.value === 'number' ? val.value : Number(val.value);
      return formatScore(
        num,
        {
          kind: 'numeric',
          decimalPlaces: 0,
          unitSingular: def.unitSingular,
          unitPlural: def.unitPlural,
        },
        locale
      );
    }
    case 'games.opengaming.defs#percentageComponentDef': {
      const num = typeof val.value === 'number' ? val.value : Number(val.value);
      const precision = Math.max(0, Math.min(6, def.precision ?? 2));
      const pct = Math.trunc(num) / Math.pow(10, precision);
      const formatted = new Intl.NumberFormat(locale, {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      }).format(pct);
      return `${formatted}%`;
    }
    case 'games.opengaming.defs#timeComponentDef': {
      const num = typeof val.value === 'number' ? val.value : Number(val.value);
      return formatScore(
        num,
        {
          kind: 'time',
          timeUnit: def.timeUnit ?? 'milliseconds',
        },
        locale
      );
    }
    case 'games.opengaming.defs#enumComponentDef': {
      const strVal = String(val.value);
      const opt = def.values.find((o) => o.id === strVal);
      return opt ? opt.name : strVal;
    }
    case 'games.opengaming.defs#textComponentDef':
    default:
      return String(val.value);
  }
}

export interface ExtractedSortMetric {
  sortableValue: number;
  sortOrder: LeaderboardSortOrder;
  displayValue: string;
  componentId?: string;
}

/**
 * Extract the sortable integer value, ranking direction, and formatted display string for a score
 * record—supporting both single-integer leaderboards and multi-component (`components` map) leaderboards.
 */
export function getScoreSortMetric(
  record: LeaderboardScoreRecord,
  definition: LeaderboardDefinitionRecord,
  sortByComponentId?: string,
  locale = 'en-US'
): ExtractedSortMetric | null {
  const orderedIds = getOrderedComponentIds(definition);
  if (orderedIds.length > 0 && definition.components) {
    const targetId =
      sortByComponentId ?? definition.defaultComponent ?? orderedIds[0];
    const compDef = definition.components[targetId];
    const compVal =
      record.components && !Array.isArray(record.components)
        ? record.components[targetId]
        : undefined;

    if (compDef && compVal) {
      if (compDef.$type === 'games.opengaming.defs#enumComponentDef') {
        const idx = compDef.values.findIndex((o) => o.id === String(compVal.value));
        if (idx === -1) return null;
        return {
          sortableValue: idx,
          sortOrder: compDef.sortOrder ?? 'smallerIsBetter',
          displayValue: formatComponentValue(compVal, compDef, locale),
          componentId: targetId,
        };
      }

      if (compDef.$type === 'games.opengaming.defs#textComponentDef') {
        return null;
      }

      if (typeof compVal.value !== 'number' || !Number.isInteger(compVal.value)) {
        return null;
      }

      const defaultDir: LeaderboardSortOrder =
        compDef.$type === 'games.opengaming.defs#timeComponentDef'
          ? 'smallerIsBetter'
          : 'largerIsBetter';

      return {
        sortableValue: compVal.value,
        sortOrder: compDef.sortOrder ?? defaultDir,
        displayValue: formatComponentValue(compVal, compDef, locale),
        componentId: targetId,
      };
    }
  }

  // Fallback to classic single-integer `score`
  if (typeof record.score === 'number' && Number.isInteger(record.score)) {
    const fmt = definition.scoreFormat ?? { kind: 'numeric' };
    return {
      sortableValue: record.score,
      sortOrder: definition.sortOrder ?? 'largerIsBetter',
      displayValue: record.displayScore ?? formatScore(record.score, fmt, locale),
    };
  }

  return null;
}

/**
 * Validate `definition.components` map keys, component `$type` discriminators, and `componentOrder`.
 * Provides strict application-layer map validation until the proposed Lexicon `map` schema type ships.
 */
export function validateComponentDefs(
  components: ScoreComponentDefMap | undefined,
  componentOrder?: string[]
): string | null {
  if (components === undefined) {
    return null;
  }
  if (typeof components !== 'object' || components === null || Array.isArray(components)) {
    return 'Leaderboard "components" must be a dictionary map object.';
  }
  const entries = Object.entries(components);
  if (entries.length === 0) {
    return 'Leaderboard "components" map must contain at least 1 component when provided.';
  }
  if (entries.length > 16) {
    return `Leaderboard "components" map exceeds maximum of 16 components (got ${entries.length}).`;
  }
  for (const [key, def] of entries) {
    if (!isValidComponentKey(key)) {
      return `Component definition key "${key}" is not a valid record-key (1..32 chars).`;
    }
    if (!def || typeof def !== 'object') {
      return `Component definition "${key}" must be an object.`;
    }
    if (!(def.$type in DEF_TO_VAL_TYPE)) {
      return `Component definition "${key}" has unsupported $type "${String((def as { $type?: unknown }).$type)}".`;
    }
    if (typeof def.name !== 'string' || def.name.trim().length === 0) {
      return `Component definition "${key}" must include a non-empty "name".`;
    }
    if (
      def.$type === 'games.opengaming.defs#enumComponentDef' &&
      (!Array.isArray(def.values) || def.values.length === 0)
    ) {
      return `Enum component definition "${key}" must include at least one option in "values".`;
    }
  }
  if (componentOrder !== undefined) {
    for (const key of componentOrder) {
      if (!(key in components)) {
        return `componentOrder key "${key}" is not defined in "components".`;
      }
    }
  }
  return null;
}

/**
 * Validate `record.components` dictionary map against `definition.components` keys, `$type` pairing,
 * bounds, and allowed enum options. Returns `null` if valid, or a descriptive error string otherwise.
 */
export function validateScoreComponents(
  components: ScoreComponentValMap | undefined,
  definition: LeaderboardDefinitionRecord
): string | null {
  if (components === undefined) {
    return null;
  }
  if (typeof components !== 'object' || components === null || Array.isArray(components)) {
    return 'Score "components" must be a dictionary map object.';
  }

  const entries = Object.entries(components);
  if (entries.length > 16) {
    return `Score "components" map exceeds maximum of 16 entries (got ${entries.length}).`;
  }

  const defMap =
    definition.components && typeof definition.components === 'object' && !Array.isArray(definition.components)
      ? definition.components
      : undefined;

  for (const [key, val] of entries) {
    if (!isValidComponentKey(key)) {
      return `Component key "${key}" is not a valid record-key (1..32 chars).`;
    }
    if (!val || typeof val !== 'object') {
      return `Component "${key}" must be an object with a "value" property.`;
    }

    const def = defMap?.[key];
    if (!def) continue;

    const expectedValType = DEF_TO_VAL_TYPE[def.$type];
    if (expectedValType && val.$type && val.$type !== expectedValType) {
      return `Component "${key}" has $type "${val.$type}", expected "${expectedValType}".`;
    }

    if (
      def.$type === 'games.opengaming.defs#pointsComponentDef' ||
      def.$type === 'games.opengaming.defs#percentageComponentDef' ||
      def.$type === 'games.opengaming.defs#timeComponentDef'
    ) {
      if (typeof val.value !== 'number' || !Number.isInteger(val.value)) {
        return `Component "${key}" must have an integer value.`;
      }
      if (def.minimum !== undefined && val.value < def.minimum) {
        return `Component "${key}" value ${val.value} is below minimum ${def.minimum}.`;
      }
      if (def.maximum !== undefined && val.value > def.maximum) {
        return `Component "${key}" value ${val.value} exceeds maximum ${def.maximum}.`;
      }
    } else if (def.$type === 'games.opengaming.defs#enumComponentDef') {
      const allowed = new Set(def.values.map((v) => v.id));
      if (typeof val.value !== 'string' || !allowed.has(val.value)) {
        return `Component "${key}" value "${String(val.value)}" is not in allowed enum values.`;
      }
    } else if (def.$type === 'games.opengaming.defs#textComponentDef') {
      if (typeof val.value !== 'string') {
        return `Component "${key}" must have a string value.`;
      }
    }
  }

  return null;
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
  const dayOfWeek = now.getUTCDay();
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
 * honoring `scoreMin`/`scoreMax`, `components` bounds, `rankedVersions`, `sortOrder`,
 * `timeframes`, and `recordPolicy`.
 */
export function evaluateScoreSubmission({
  leaderboardUri,
  score,
  components,
  version,
  definition,
  existingPlayerScores,
  now = new Date(),
}: {
  leaderboardUri: string;
  score?: number;
  components?: ScoreComponentValMap;
  version?: string;
  definition: LeaderboardDefinitionRecord;
  existingPlayerScores: LeaderboardScoreRecord[];
  now?: Date;
}): ScoreSubmissionDecision {
  if (!isVersionLegal(version, definition.rankedVersions)) {
    return {
      validBounds: false,
      shouldWrite: false,
      writeMode: 'none',
      beatenTimeframes: [],
      reason: `Version "${version ?? 'none'}" is not in leaderboard rankedVersions [${definition.rankedVersions?.join(', ')}].`,
    };
  }

  const compErr = validateScoreComponents(components, definition);
  if (compErr) {
    return {
      validBounds: false,
      shouldWrite: false,
      writeMode: 'none',
      beatenTimeframes: [],
      reason: compErr,
    };
  }

  if (score !== undefined) {
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
  }

  const candidateDummy: LeaderboardScoreRecord = {
    $type: 'games.opengaming.leaderboard.score',
    leaderboard: leaderboardUri,
    score,
    components,
    version,
    recordedAt: now.toISOString(),
  };

  const candidateMetric = getScoreSortMetric(candidateDummy, definition);
  if (!candidateMetric) {
    return {
      validBounds: false,
      shouldWrite: false,
      writeMode: 'none',
      beatenTimeframes: [],
      reason: 'Score submission must provide either a valid integer `score` or sortable `components`.',
    };
  }

  const activeTimeframes: Timeframe[] =
    definition.timeframes?.length > 0 ? definition.timeframes : ['allTime'];

  const legalExistingScores = existingPlayerScores.filter((s) =>
    isVersionLegal(s.version, definition.rankedVersions)
  );

  const beatenTimeframes: Timeframe[] = [];

  for (const tf of activeTimeframes) {
    const startMs = getTimeframeStartMs(tf, now);
    const windowMetrics = legalExistingScores
      .filter((s) => {
        const t = Date.parse(s.recordedAt);
        return Number.isFinite(t) && t >= startMs;
      })
      .map((s) => getScoreSortMetric(s, definition, candidateMetric.componentId))
      .filter((m): m is ExtractedSortMetric => m !== null);

    if (windowMetrics.length === 0) {
      beatenTimeframes.push(tf);
    } else {
      const bestInWindow = windowMetrics.reduce((best, cur) =>
        isBetterScore(cur.sortableValue, best.sortableValue, candidateMetric.sortOrder) ? cur : best
      );
      if (isBetterScore(candidateMetric.sortableValue, bestInWindow.sortableValue, candidateMetric.sortOrder)) {
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
    const existingMetrics = legalExistingScores
      .map((s) => getScoreSortMetric(s, definition, candidateMetric.componentId))
      .filter((m): m is ExtractedSortMetric => m !== null);

    const beatsAllTime =
      existingMetrics.length === 0 ||
      existingMetrics.every((m) =>
        isBetterScore(candidateMetric.sortableValue, m.sortableValue, candidateMetric.sortOrder)
      );

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

  // `perWindowBest`
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
