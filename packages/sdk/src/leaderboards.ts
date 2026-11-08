import crypto from 'node:crypto';
import type {
  DimensionDefMap,
  JudgmentBreakdown,
  LeaderboardDefinitionRecord,
  LeaderboardScoreRecord,
  LeaderboardSortOrder,
  ScoreComponentDef,
  ScoreComponentDefMap,
  ScoreComponentVal,
  ScoreComponentValMap,
  ScoreFormat,
  StringMap,
  Timeframe,
} from './types.js';

const COMPONENT_KEY_REGEX = /^[a-zA-Z0-9_~.:-]{1,32}$/;
const RESERVED_MAP_KEYS = new Set(['.', '..', '$keyFormat', '$valueType']);

const DEF_TO_VAL_TYPE: Record<ScoreComponentDef['$type'], ScoreComponentVal['$type']> = {
  'games.opengaming.leaderboard.definition#points': 'games.opengaming.leaderboard.score#points',
  'games.opengaming.leaderboard.definition#percentage': 'games.opengaming.leaderboard.score#percentage',
  'games.opengaming.leaderboard.definition#time': 'games.opengaming.leaderboard.score#time',
  'games.opengaming.leaderboard.definition#enum': 'games.opengaming.leaderboard.score#enum',
  'games.opengaming.leaderboard.definition#text': 'games.opengaming.leaderboard.score#text',
};

/**
 * Check whether a map key satisfies our component/dimension/judgment key constraints
 * (ATProto `record-key` syntax, 1..32 chars, excluding `.` / `..` / schema placeholder keys).
 */
export function isValidComponentKey(key: string): boolean {
  return (
    typeof key === 'string' &&
    COMPONENT_KEY_REGEX.test(key) &&
    !RESERVED_MAP_KEYS.has(key)
  );
}

function orderMapKeys(
  mapObj: Record<string, unknown> | undefined,
  explicitOrder?: string[]
): string[] {
  if (!mapObj || typeof mapObj !== 'object' || Array.isArray(mapObj)) {
    return [];
  }
  const availableKeys = Object.keys(mapObj).filter((k) => !RESERVED_MAP_KEYS.has(k));
  if (availableKeys.length === 0) {
    return [];
  }
  const availableSet = new Set(availableKeys);
  const seen = new Set<string>();
  const ordered: string[] = [];

  if (Array.isArray(explicitOrder)) {
    for (const key of explicitOrder) {
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
 * Return the ordered component keys for a `LeaderboardDefinitionRecord`, honoring explicit
 * `componentOrder` first (so display order survives DAG-CBOR canonical map-key sorting) and
 * appending any remaining keys present in `definition.components`.
 */
export function getOrderedComponentIds(
  definition: Pick<LeaderboardDefinitionRecord, 'components' | 'componentOrder'>
): string[] {
  return orderMapKeys(definition.components, definition.componentOrder);
}

/**
 * Return the ordered sub-board dimension keys for a `LeaderboardDefinitionRecord`, honoring
 * explicit `dimensionOrder` first and appending any remaining keys in `definition.dimensions`.
 */
export function getOrderedDimensionIds(
  definition: Pick<LeaderboardDefinitionRecord, 'dimensions' | 'dimensionOrder'>
): string[] {
  return orderMapKeys(definition.dimensions, definition.dimensionOrder);
}

/**
 * Return the ordered timing-judgment keys for a `#judgmentBreakdown`, honoring explicit
 * `judgmentOrder` first and appending any remaining keys in `judgments`.
 */
export function getOrderedJudgmentIds(
  breakdown: Pick<JudgmentBreakdown, 'judgments' | 'judgmentOrder'>
): string[] {
  return orderMapKeys(breakdown.judgments, breakdown.judgmentOrder);
}

/**
 * Deterministic record key (`rkey`) for a player's achievement unlock or progress record,
 * preventing accidental duplicate unlocks for standard achievements while allowing unique tokens
 * for `repeatable: true` achievements.
 */
export function getUnlockRkey(
  achievementDefinitionUri: string,
  options?: { repeatable?: boolean; uniqueToken?: string }
): string {
  const tokenSuffix =
    options?.repeatable && options?.uniqueToken ? `:${options.uniqueToken}` : '';
  const hash = crypto
    .createHash('sha256')
    .update(`${achievementDefinitionUri}${tokenSuffix}`)
    .digest('hex')
    .slice(0, 20);
  const slug = achievementDefinitionUri.split('/').pop() ?? 'ach';
  const safeSlug = slug.replace(/[^a-zA-Z0-9._~-]/g, '-').slice(0, 32);
  return `${safeSlug}-${hash}`;
}

function canonicalDimensionSeedSuffix(dimensions?: StringMap, seed?: string): string {
  const parts: string[] = [];
  if (dimensions && typeof dimensions === 'object' && !Array.isArray(dimensions)) {
    const keys = Object.keys(dimensions)
      .filter((k) => !RESERVED_MAP_KEYS.has(k))
      .sort();
    for (const k of keys) {
      parts.push(`d:${k}=${dimensions[k]}`);
    }
  }
  if (seed) {
    parts.push(`s:${seed}`);
  }
  return parts.join('|');
}

/**
 * Deterministic record key (`rkey`) for a `recordPolicy: "overwriteBest"` leaderboard score record
 * (scoped by optional `dimensions` and `seed` so distinct sub-categories don't overwrite each other).
 */
export function getOverwriteBestScoreRkey(
  leaderboardDefinitionUri: string,
  dimensions?: StringMap,
  seed?: string
): string {
  const suffix = canonicalDimensionSeedSuffix(dimensions, seed);
  const input = suffix ? `${leaderboardDefinitionUri}|${suffix}` : leaderboardDefinitionUri;
  const hash = crypto.createHash('sha256').update(input).digest('hex').slice(0, 20);
  const slug = leaderboardDefinitionUri.split('/').pop() ?? 'lb';
  const safeSlug = slug.replace(/[^a-zA-Z0-9._~-]/g, '-').slice(0, 32);
  return `${safeSlug}-best-${hash}`;
}

/** Alias retained for backward compatibility with `recordPolicy: "bestOnly"`. */
export const getBestOnlyScoreRkey = getOverwriteBestScoreRkey;

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
 * Check whether a timestamp falls within optional `startsAt` / `endsAt` bounds on a leaderboard
 * or challenge definition.
 */
export function isWithinLeaderboardWindow(
  timestampIso: string,
  bounds: { startsAt?: string; endsAt?: string }
): boolean {
  const ts = Date.parse(timestampIso);
  if (!Number.isFinite(ts)) return false;
  if (bounds.startsAt) {
    const startMs = Date.parse(bounds.startsAt);
    if (Number.isFinite(startMs) && ts < startMs) return false;
  }
  if (bounds.endsAt) {
    const endMs = Date.parse(bounds.endsAt);
    if (Number.isFinite(endMs) && ts > endMs) return false;
  }
  return true;
}

/**
 * Parse a `getScores` `dimensions` query filter (accepting either JSON `{"mode":"4k"}` or
 * `mode=4k,inputMethod=keyboard`) into a normalized `StringMap`.
 */
export function parseDimensionsFilter(raw?: string | StringMap): StringMap {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const clean: StringMap = {};
    for (const [k, v] of Object.entries(raw)) {
      if (isValidComponentKey(k) && typeof v === 'string' && v.length > 0) {
        clean[k] = v;
      }
    }
    return clean;
  }
  const trimmed = String(raw).trim();
  if (!trimmed) return {};
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parseDimensionsFilter(parsed as StringMap);
    }
    return {};
  }
  const out: StringMap = {};
  for (const pair of trimmed.split(',')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = pair.slice(0, eqIdx).trim();
    const val = pair.slice(eqIdx + 1).trim();
    if (isValidComponentKey(key) && val.length > 0) {
      out[key] = val;
    }
  }
  return out;
}

/**
 * Serialize a `StringMap` into compact `key=value,key2=value2` query format.
 */
export function serializeDimensionsFilter(filter?: StringMap): string {
  if (!filter) return '';
  return Object.entries(filter)
    .filter(([k, v]) => isValidComponentKey(k) && typeof v === 'string' && v.length > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
}

/**
 * Check whether a score's `dimensions` map satisfies all requested filter entries.
 */
export function matchesDimensionFilter(
  scoreDimensions: StringMap | undefined,
  filter: StringMap | undefined
): boolean {
  if (!filter) return true;
  const entries = Object.entries(filter).filter(
    ([k, v]) => !RESERVED_MAP_KEYS.has(k) && typeof v === 'string' && v.length > 0
  );
  if (entries.length === 0) return true;
  if (!scoreDimensions || typeof scoreDimensions !== 'object') return false;
  for (const [k, expected] of entries) {
    if (scoreDimensions[k] !== expected) return false;
  }
  return true;
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
    const sign = totalMs < 0 ? '-' : format.signedPrefix && totalMs > 0 ? '+' : '';
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

  const formattedBase = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(scaled);
  const formattedNum =
    format.signedPrefix && scaled > 0 && !formattedBase.startsWith('+')
      ? `+${formattedBase}`
      : formattedBase;

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
    case 'games.opengaming.leaderboard.definition#points': {
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
    case 'games.opengaming.leaderboard.definition#percentage': {
      const num = typeof val.value === 'number' ? val.value : Number(val.value);
      const precision = Math.max(0, Math.min(6, def.precision ?? 2));
      const pct = Math.trunc(num) / Math.pow(10, precision);
      const formatted = new Intl.NumberFormat(locale, {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      }).format(pct);
      return `${formatted}%`;
    }
    case 'games.opengaming.leaderboard.definition#time': {
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
    case 'games.opengaming.leaderboard.definition#enum': {
      const strVal = String(val.value);
      const opt = def.values.find((o) => o.id === strVal);
      return opt ? opt.name : strVal;
    }
    case 'games.opengaming.leaderboard.definition#text':
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
 * record—supporting both single-integer leaderboards and local multi-component leaderboards.
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
      if (compDef.$type === 'games.opengaming.leaderboard.definition#enum') {
        const idx = compDef.values.findIndex((o) => o.id === String(compVal.value));
        if (idx === -1) return null;
        return {
          sortableValue: idx,
          sortOrder: compDef.sortOrder ?? 'smallerIsBetter',
          displayValue: formatComponentValue(compVal, compDef, locale),
          componentId: targetId,
        };
      }

      if (compDef.$type === 'games.opengaming.leaderboard.definition#text') {
        return null;
      }

      if (typeof compVal.value !== 'number' || !Number.isInteger(compVal.value)) {
        return null;
      }

      const defaultDir: LeaderboardSortOrder =
        compDef.$type === 'games.opengaming.leaderboard.definition#time'
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
 * Validate `definition.components` map keys, local component `$type` discriminators, and `componentOrder`.
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
      def.$type === 'games.opengaming.leaderboard.definition#enum' &&
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
 * Validate `definition.dimensions` map keys, option structures, and `dimensionOrder`.
 */
export function validateDimensionDefs(
  dimensions: DimensionDefMap | undefined,
  dimensionOrder?: string[]
): string | null {
  if (dimensions === undefined) {
    return null;
  }
  if (typeof dimensions !== 'object' || dimensions === null || Array.isArray(dimensions)) {
    return 'Leaderboard "dimensions" must be a dictionary map object.';
  }
  const entries = Object.entries(dimensions);
  if (entries.length === 0) {
    return 'Leaderboard "dimensions" map must contain at least 1 dimension when provided.';
  }
  if (entries.length > 16) {
    return `Leaderboard "dimensions" map exceeds maximum of 16 dimensions (got ${entries.length}).`;
  }
  for (const [key, dim] of entries) {
    if (!isValidComponentKey(key)) {
      return `Dimension key "${key}" is not a valid record-key (1..32 chars).`;
    }
    if (!dim || typeof dim !== 'object' || typeof dim.name !== 'string' || !dim.name.trim()) {
      return `Dimension "${key}" must include a non-empty "name".`;
    }
    if (dim.values !== undefined) {
      if (!Array.isArray(dim.values) || dim.values.length === 0) {
        return `Dimension "${key}" values must be a non-empty array when provided.`;
      }
      for (const opt of dim.values) {
        if (!opt || !isValidComponentKey(opt.id) || typeof opt.name !== 'string') {
          return `Dimension "${key}" contains an invalid option.`;
        }
      }
    }
  }
  if (dimensionOrder !== undefined) {
    for (const key of dimensionOrder) {
      if (!(key in dimensions)) {
        return `dimensionOrder key "${key}" is not defined in "dimensions".`;
      }
    }
  }
  return null;
}

/**
 * Validate `record.dimensions` against `definition.dimensions` (`required`, allowed `values`, and
 * `allowCustomValues`).
 */
export function validateScoreDimensions(
  dimensions: StringMap | undefined,
  definition: LeaderboardDefinitionRecord
): string | null {
  const defDims =
    definition.dimensions && typeof definition.dimensions === 'object' && !Array.isArray(definition.dimensions)
      ? definition.dimensions
      : undefined;

  if (dimensions !== undefined) {
    if (typeof dimensions !== 'object' || dimensions === null || Array.isArray(dimensions)) {
      return 'Score "dimensions" must be a dictionary map of string values.';
    }
    const entries = Object.entries(dimensions);
    if (entries.length > 16) {
      return `Score "dimensions" exceeds maximum of 16 entries (got ${entries.length}).`;
    }
    for (const [key, val] of entries) {
      if (!isValidComponentKey(key)) {
        return `Score dimension key "${key}" is not a valid record-key (1..32 chars).`;
      }
      if (typeof val !== 'string' || val.length === 0 || val.length > 256) {
        return `Score dimension "${key}" must be a non-empty string (<= 256 chars).`;
      }
      const dDef = defDims?.[key];
      if (dDef && Array.isArray(dDef.values) && dDef.values.length > 0 && !dDef.allowCustomValues) {
        const allowed = new Set(dDef.values.map((o) => o.id));
        if (!allowed.has(val)) {
          return `Dimension "${key}" value "${val}" is not in allowed options [${[...allowed].join(', ')}].`;
        }
      }
    }
  }

  if (defDims) {
    for (const [key, dDef] of Object.entries(defDims)) {
      if (RESERVED_MAP_KEYS.has(key)) continue;
      if (dDef.required && (!dimensions || !dimensions[key])) {
        return `Required dimension "${key}" is missing from score record.`;
      }
    }
  }

  return null;
}

/**
 * Validate `record.components` dictionary map against `definition.components` keys, local `$type`
 * pairing, bounds, and allowed enum options.
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
      def.$type === 'games.opengaming.leaderboard.definition#points' ||
      def.$type === 'games.opengaming.leaderboard.definition#percentage' ||
      def.$type === 'games.opengaming.leaderboard.definition#time'
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
    } else if (def.$type === 'games.opengaming.leaderboard.definition#enum') {
      const allowed = new Set(def.values.map((v) => v.id));
      if (typeof val.value !== 'string' || !allowed.has(val.value)) {
        return `Component "${key}" value "${String(val.value)}" is not in allowed enum values.`;
      }
    } else if (def.$type === 'games.opengaming.leaderboard.definition#text') {
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
 * - `monthly`: 00:00:00.000 UTC of the 1st of `now`'s UTC month
 * - `allTime`: `-Infinity`
 */
export function getTimeframeStartMs(timeframe: Timeframe, now: Date = new Date()): number {
  if (timeframe === 'allTime') {
    return Number.NEGATIVE_INFINITY;
  }
  if (timeframe === 'daily') {
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
  }
  if (timeframe === 'monthly') {
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
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
  beatenComponents?: string[];
  reason?: string;
}

/**
 * Decide whether and how a completed run's score should be written to the player's PDS,
 * honoring `startsAt`/`endsAt`, `rankedVersions`, `scoreMin`/`scoreMax`, `components`,
 * `dimensions`, `seed`, `rankingMode`, `timeframes`, and `recordPolicy` (`overwriteBest`,
 * `personalBests`, `perWindowBest`, `everyRun`).
 */
export function evaluateScoreSubmission({
  leaderboardUri,
  score,
  components,
  dimensions,
  seed,
  version,
  definition,
  existingPlayerScores,
  now = new Date(),
}: {
  leaderboardUri: string;
  score?: number;
  components?: ScoreComponentValMap;
  dimensions?: StringMap;
  seed?: string;
  version?: string;
  definition: LeaderboardDefinitionRecord;
  existingPlayerScores: LeaderboardScoreRecord[];
  now?: Date;
}): ScoreSubmissionDecision {
  const nowIso = now.toISOString();
  if (!isWithinLeaderboardWindow(nowIso, definition)) {
    return {
      validBounds: false,
      shouldWrite: false,
      writeMode: 'none',
      beatenTimeframes: [],
      reason: `Submission timestamp ${nowIso} is outside leaderboard active window (${definition.startsAt ?? '-inf'} .. ${definition.endsAt ?? '+inf'}).`,
    };
  }

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

  const dimErr = validateScoreDimensions(dimensions, definition);
  if (dimErr) {
    return {
      validBounds: false,
      shouldWrite: false,
      writeMode: 'none',
      beatenTimeframes: [],
      reason: dimErr,
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
    dimensions,
    seed,
    version,
    recordedAt: nowIso,
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

  const comparableSuffix = canonicalDimensionSeedSuffix(dimensions, seed);
  const legalExistingScores = existingPlayerScores.filter(
    (s) =>
      isVersionLegal(s.version, definition.rankedVersions) &&
      isWithinLeaderboardWindow(s.recordedAt, definition) &&
      canonicalDimensionSeedSuffix(s.dimensions, s.seed) === comparableSuffix
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

  // Check multi-component personal bests across ALL sortable components (avoids Multi-Component Overwrite Trap)
  const orderedCompIds = getOrderedComponentIds(definition);
  const beatenComponents: string[] = [];
  if (orderedCompIds.length > 0) {
    for (const compId of orderedCompIds) {
      const candCompMetric = getScoreSortMetric(candidateDummy, definition, compId);
      if (!candCompMetric) continue;
      const existingCompMetrics = legalExistingScores
        .map((s) => getScoreSortMetric(s, definition, compId))
        .filter((m): m is ExtractedSortMetric => m !== null);
      const beatsComp =
        existingCompMetrics.length === 0 ||
        existingCompMetrics.every((m) =>
          isBetterScore(candCompMetric.sortableValue, m.sortableValue, candCompMetric.sortOrder)
        );
      if (beatsComp) {
        beatenComponents.push(compId);
      }
    }
  }

  if (definition.recordPolicy === 'everyRun') {
    return {
      validBounds: true,
      shouldWrite: true,
      writeMode: 'createRecord',
      beatenTimeframes,
      ...(beatenComponents.length > 0 ? { beatenComponents } : {}),
    };
  }

  if (definition.recordPolicy === 'overwriteBest' || definition.recordPolicy === 'bestOnly') {
    if (definition.rankingMode === 'latest') {
      return {
        validBounds: true,
        shouldWrite: true,
        writeMode: 'putRecord',
        recommendedRkey: getOverwriteBestScoreRkey(leaderboardUri, dimensions, seed),
        beatenTimeframes,
        ...(beatenComponents.length > 0 ? { beatenComponents } : {}),
      };
    }

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
        reason: 'Does not beat existing All-Time personal best under `overwriteBest` policy.',
      };
    }
    return {
      validBounds: true,
      shouldWrite: true,
      writeMode: 'putRecord',
      recommendedRkey: getOverwriteBestScoreRkey(leaderboardUri, dimensions, seed),
      beatenTimeframes,
      ...(beatenComponents.length > 0 ? { beatenComponents } : {}),
    };
  }

  if (definition.recordPolicy === 'personalBests') {
    const setsAnyPb =
      definition.rankingMode === 'latest' ||
      (orderedCompIds.length > 0 ? beatenComponents.length > 0 : beatenTimeframes.includes('allTime') || legalExistingScores.length === 0);

    if (!setsAnyPb) {
      return {
        validBounds: true,
        shouldWrite: false,
        writeMode: 'none',
        beatenTimeframes,
        beatenComponents: [],
        reason: 'Does not set a new Personal Best on any sortable component.',
      };
    }
    return {
      validBounds: true,
      shouldWrite: true,
      writeMode: 'createRecord',
      beatenTimeframes,
      ...(beatenComponents.length > 0 ? { beatenComponents } : {}),
    };
  }

  // `perWindowBest`
  if (beatenTimeframes.length === 0 && definition.rankingMode !== 'latest') {
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
    ...(beatenComponents.length > 0 ? { beatenComponents } : {}),
  };
}
