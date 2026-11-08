import {
  formatComponentValue,
  formatScore,
  getOrderedComponentIds,
  getOrderedDimensionIds,
  getScoreSortMetric,
  getTimeframeStartMs,
  isBetterScore,
  isVersionLegal,
  isWithinLeaderboardWindow,
  matchesDimensionFilter,
  parseDimensionsFilter,
  resolveActiveLabels,
  sortAchievementDefinitions,
  summarizeActorProfile,
  type AchievementDefinitionRecord,
  type AchievementUnlockRecord,
  type ActorProfileSummary,
  type AtprotoLabel,
  type LeaderboardDefinitionRecord,
  type LeaderboardScoreRecord,
  type LeaderboardSortOrder,
  type MatchParticipant,
  type Participant,
  type RankingMode,
  type ScoreComponentValMap,
  type ScoreFormat,
  type StringMap,
  type Timeframe,
} from '@opengaming/sdk';
import type { AppDatabase } from './db.js';
import type { IdentityService } from './identity.js';

export interface XrpcScoreEntry {
  rank: number;
  player: string;
  handle?: string;
  uri: string;
  attestationCid?: string;
  issuer?: string;
  score: number;
  displayScore?: string;
  components?: ScoreComponentValMap;
  dimensions?: StringMap;
  seed?: string;
  participants?: Participant[];
  runId?: string;
  version?: string;
  hasReplay?: boolean;
  replayCid?: string;
  tag?: string;
  labels?: string[];
  recordedAt: string;
  verified: boolean;
  obsolete?: boolean;
  revoked?: boolean;
}

export class AppViewQueries {
  constructor(
    private db: AppDatabase,
    private identity: IdentityService
  ) {}

  private getActorMeta(did: string): {
    did: string;
    handle?: string;
    displayName?: string;
    avatarUrl?: string;
  } {
    const cached = this.identity.getCachedActor(did);
    return {
      did,
      handle: cached?.handle,
      displayName: cached?.displayName,
      avatarUrl: cached?.avatarUrl,
    };
  }

  private getAllDefinitionEntries() {
    const rows = this.db
      .prepare('SELECT uri, raw_json FROM achievement_definitions')
      .all() as Array<{ uri: string; raw_json: string }>;

    return rows.map((r) => ({
      uri: r.uri,
      record: JSON.parse(r.raw_json) as AchievementDefinitionRecord,
    }));
  }

  /**
   * XRPC `games.opengaming.actor.getProfile`
   */
  async getXrpcActorProfile(actorIdentifier: string): Promise<ActorProfileSummary> {
    const resolved = await this.identity.resolveActor(actorIdentifier);
    const did = resolved?.did ?? (actorIdentifier.startsWith('did:') ? actorIdentifier : '');
    if (!did) {
      throw Object.assign(new Error(`Actor not found: ${actorIdentifier}`), { status: 404 });
    }

    const unlockRows = this.db
      .prepare('SELECT raw_json FROM achievement_unlocks WHERE player_did = ? AND verified = 1 AND revoked = 0')
      .all(did) as Array<{ raw_json: string }>;

    const verifiedUnlocks = unlockRows.map((r) => JSON.parse(r.raw_json) as AchievementUnlockRecord);
    const definitions = this.getAllDefinitionEntries();

    return summarizeActorProfile({
      playerDid: did,
      handle: resolved?.handle,
      verifiedUnlocks,
      definitions,
    });
  }

  /**
   * XRPC `games.opengaming.leaderboard.getScores`
   */
  async getXrpcLeaderboardScores({
    leaderboard,
    timeframe = 'allTime',
    scope = 'public',
    viewer,
    player,
    includeObsolete = false,
    sortBy,
    dimensions,
    seed,
    version,
    verifiedOnly = true,
    limit = 25,
    cursor,
    now = new Date(),
  }: {
    leaderboard: string;
    timeframe?: Timeframe;
    scope?: 'public' | 'social';
    viewer?: string;
    player?: string;
    includeObsolete?: boolean;
    sortBy?: string;
    dimensions?: string;
    seed?: string;
    version?: string;
    verifiedOnly?: boolean;
    limit?: number;
    cursor?: string;
    now?: Date;
  }): Promise<{
    leaderboard: string;
    sortedBy?: string;
    rankingMode?: RankingMode;
    entries: XrpcScoreEntry[];
    viewerEntry?: XrpcScoreEntry;
    cursor?: string;
  }> {
    const lbRow = this.db
      .prepare('SELECT * FROM leaderboard_definitions WHERE uri = ?')
      .get(leaderboard) as Record<string, any> | undefined;

    if (!lbRow) {
      throw Object.assign(new Error(`Leaderboard not found: ${leaderboard}`), { status: 404 });
    }

    const parsedDef = JSON.parse(String(lbRow.raw_json)) as LeaderboardDefinitionRecord;
    const orderedCompIds = getOrderedComponentIds(parsedDef);
    const hasComponents = orderedCompIds.length > 0;
    const rankingMode: RankingMode = parsedDef.rankingMode === 'latest' ? 'latest' : 'best';

    if (sortBy && hasComponents) {
      const requestedComp = parsedDef.components?.[sortBy];
      if (!requestedComp) {
        throw Object.assign(new Error(`Unknown leaderboard component \`sortBy\`: ${sortBy}`), { status: 400 });
      }
      if (requestedComp.$type === 'games.opengaming.leaderboard.definition#text') {
        throw Object.assign(new Error(`Text component \`${sortBy}\` cannot be used for ranking.`), { status: 400 });
      }
    }

    const effectiveSortedBy = hasComponents
      ? sortBy ?? parsedDef.defaultComponent ?? orderedCompIds[0]
      : undefined;

    const allowedTimeframes = JSON.parse(String(lbRow.timeframes_json)) as Timeframe[];
    const effectiveTimeframe: Timeframe = allowedTimeframes.includes(timeframe)
      ? timeframe
      : allowedTimeframes[0] ?? 'allTime';

    const fallbackSortOrder = String(lbRow.sort_order) as LeaderboardSortOrder;
    const scoreFormat = JSON.parse(String(lbRow.score_format_json)) as ScoreFormat;
    const windowStartMs = getTimeframeStartMs(effectiveTimeframe, now);
    const parsedDimFilter = parseDimensionsFilter(dimensions);
    const hasDimFilter = Object.keys(parsedDimFilter).length > 0;

    let resolvedViewerDid: string | undefined;
    if (viewer) {
      const resolvedViewer = await this.identity.resolveActor(viewer);
      resolvedViewerDid = resolvedViewer?.did ?? (viewer.startsWith('did:') ? viewer : undefined);
    }

    let resolvedPlayerDid: string | undefined;
    if (player) {
      const resolvedPlayer = await this.identity.resolveActor(player);
      resolvedPlayerDid = resolvedPlayer?.did ?? (player.startsWith('did:') ? player : undefined);
      if (!resolvedPlayerDid) {
        return {
          leaderboard,
          ...(effectiveSortedBy ? { sortedBy: effectiveSortedBy } : {}),
          rankingMode,
          entries: [],
        };
      }
    }

    let socialDids: Set<string> | null = null;
    if (scope === 'social') {
      if (!resolvedViewerDid) {
        throw Object.assign(new Error('`viewer` parameter is required when `scope` is "social".'), { status: 400 });
      }
      socialDids = await this.identity.getSocialGraphDids(resolvedViewerDid);
    }

    const rawRows = this.db
      .prepare('SELECT * FROM leaderboard_scores WHERE leaderboard_uri = ?')
      .all(leaderboard) as Array<Record<string, any>>;

    interface RowWithMetric {
      row: Record<string, any>;
      sortableValue: number;
      sortOrder: LeaderboardSortOrder;
      displayScore: string;
      components?: ScoreComponentValMap;
      dimensions?: StringMap;
      seed?: string;
      participants?: Participant[];
      runId?: string;
      competitorKey: string;
      obsolete?: boolean;
    }

    const rowIncludesDid = (playerDid: string, participants: Participant[] | undefined, targetDid: string) =>
      playerDid === targetDid || Boolean(participants?.some((p) => p?.did === targetDid));

    // Filter by timeframe, bounded contest window, verification/revocation, version legality, dimensions, seed, and social graph
    const extractedRows: RowWithMetric[] = [];
    for (const r of rawRows) {
      const recordedAt = String(r.recorded_at);
      const ts = Date.parse(recordedAt);
      if (!Number.isNaN(ts) && ts < windowStartMs) continue;
      if (!isWithinLeaderboardWindow(recordedAt, parsedDef)) continue;
      if (verifiedOnly && (Number(r.verified) !== 1 || Number(r.revoked) === 1)) continue;

      const rowDimensions: StringMap | undefined = r.dimensions_json
        ? (JSON.parse(String(r.dimensions_json)) as StringMap)
        : undefined;
      if (hasDimFilter && !matchesDimensionFilter(rowDimensions, parsedDimFilter)) continue;

      const rowSeed = r.seed ? String(r.seed) : undefined;
      if (seed !== undefined && rowSeed !== seed) continue;

      const rowVersion = r.version ? String(r.version) : undefined;
      if (version) {
        if (rowVersion !== version) continue;
      } else if (parsedDef.rankedVersions && parsedDef.rankedVersions.length > 0) {
        if (!isVersionLegal(rowVersion, parsedDef.rankedVersions)) continue;
      }

      const participants: Participant[] | undefined = r.participants_json
        ? (JSON.parse(String(r.participants_json)) as Participant[])
        : undefined;
      const playerDid = String(r.player_did);

      if (socialDids) {
        const inSocial =
          socialDids.has(playerDid) || Boolean(participants?.some((p) => p?.did && socialDids!.has(p.did)));
        if (!inSocial) continue;
      }

      const runId = r.run_id ? String(r.run_id) : undefined;
      const partyKeys =
        participants && participants.length >= 2
          ? [...new Set(participants.map((p) => p.did || p.name || '').filter(Boolean))].sort()
          : [];
      const competitorKey = partyKeys.length >= 2 ? `party:${partyKeys.join('+')}` : `player:${playerDid}`;

      if (hasComponents) {
        const scoreRec = JSON.parse(String(r.raw_json)) as LeaderboardScoreRecord;
        const metric = getScoreSortMetric(scoreRec, parsedDef, effectiveSortedBy);
        if (!metric) continue;
        extractedRows.push({
          row: r,
          sortableValue: Math.trunc(metric.sortableValue),
          sortOrder: metric.sortOrder,
          displayScore: metric.displayValue,
          components: scoreRec.components,
          dimensions: rowDimensions,
          seed: rowSeed,
          participants,
          runId,
          competitorKey,
        });
      } else {
        const rawScore = Math.trunc(Number(r.score));
        const displayScore = r.display_score
          ? String(r.display_score)
          : formatScore(rawScore, scoreFormat);
        extractedRows.push({
          row: r,
          sortableValue: rawScore,
          sortOrder: fallbackSortOrder,
          displayScore,
          components: r.components_json
            ? (JSON.parse(String(r.components_json)) as ScoreComponentValMap)
            : undefined,
          dimensions: rowDimensions,
          seed: rowSeed,
          participants,
          runId,
          competitorKey,
        });
      }
    }

    // 1. Co-op `runId` deduplication: multiple squadmates publishing the same `runId` collapse to 1 shared entry
    const dedupedByRunId: RowWithMetric[] = [];
    const seenRunIds = new Map<string, number>();
    const preferredDid = resolvedPlayerDid ?? resolvedViewerDid;
    for (const item of extractedRows) {
      if (!item.runId) {
        dedupedByRunId.push(item);
        continue;
      }
      const existingIdx = seenRunIds.get(item.runId);
      if (existingIdx === undefined) {
        seenRunIds.set(item.runId, dedupedByRunId.length);
        dedupedByRunId.push(item);
      } else {
        const prev = dedupedByRunId[existingIdx];
        const itemPreferred = preferredDid && String(item.row.player_did) === preferredDid;
        const prevPreferred = preferredDid && String(prev.row.player_did) === preferredDid;
        if (
          (itemPreferred && !prevPreferred) ||
          (!prevPreferred && String(item.row.uri).localeCompare(String(prev.row.uri)) < 0)
        ) {
          dedupedByRunId[existingIdx] = item;
        }
      }
    }

    // 2. Identify each competitor's active entry (`rankingMode: 'best' | 'latest'`) and mark superseded runs `obsolete: true`
    const isSuperseding = (candidate: RowWithMetric, incumbent: RowWithMetric): boolean => {
      const candTs = Date.parse(String(candidate.row.recorded_at));
      const incTs = Date.parse(String(incumbent.row.recorded_at));
      if (rankingMode === 'latest') {
        if (candTs !== incTs) return candTs > incTs;
        if (candidate.sortableValue !== incumbent.sortableValue) {
          return isBetterScore(candidate.sortableValue, incumbent.sortableValue, candidate.sortOrder);
        }
        return String(candidate.row.uri).localeCompare(String(incumbent.row.uri)) < 0;
      }
      if (isBetterScore(candidate.sortableValue, incumbent.sortableValue, candidate.sortOrder)) {
        return true;
      }
      if (candidate.sortableValue === incumbent.sortableValue) {
        if (candTs !== incTs) return candTs < incTs;
        return String(candidate.row.uri).localeCompare(String(incumbent.row.uri)) < 0;
      }
      return false;
    };

    const activeByCompetitor = new Map<string, RowWithMetric>();
    for (const item of dedupedByRunId) {
      const prev = activeByCompetitor.get(item.competitorKey);
      if (!prev || isSuperseding(item, prev)) {
        activeByCompetitor.set(item.competitorKey, item);
      }
    }

    const activeUris = new Set([...activeByCompetitor.values()].map((i) => String(i.row.uri)));
    for (const item of dedupedByRunId) {
      item.obsolete = !activeUris.has(String(item.row.uri));
    }

    const compareEntries = (a: RowWithMetric, b: RowWithMetric): number => {
      if (a.sortableValue !== b.sortableValue) {
        return a.sortOrder === 'smallerIsBetter'
          ? a.sortableValue - b.sortableValue
          : b.sortableValue - a.sortableValue;
      }
      const tsDiff = Date.parse(String(a.row.recorded_at)) - Date.parse(String(b.row.recorded_at));
      if (tsDiff !== 0) return rankingMode === 'latest' ? -tsDiff : tsDiff;
      return String(a.row.uri).localeCompare(String(b.row.uri));
    };

    const toScoreEntry = (item: RowWithMetric, rank: number): XrpcScoreEntry => {
      const { row, sortableValue, displayScore, components, dimensions: dims, seed: rowSeed, participants, runId } = item;
      const actor = this.getActorMeta(String(row.player_did));
      const labels: string[] = row.active_labels_json ? JSON.parse(String(row.active_labels_json)) : [];
      const issuer = row.issuer_did && String(row.issuer_did).startsWith('did:') ? String(row.issuer_did) : undefined;
      const replayCid = row.replay_cid ? String(row.replay_cid) : undefined;

      return {
        rank,
        player: actor.did,
        ...(actor.handle ? { handle: actor.handle } : {}),
        uri: String(row.uri),
        ...(row.attestation_cid ? { attestationCid: String(row.attestation_cid) } : {}),
        ...(issuer ? { issuer } : {}),
        score: sortableValue,
        displayScore,
        ...(components && !Array.isArray(components) && Object.keys(components).length > 0 ? { components } : {}),
        ...(dims && Object.keys(dims).length > 0 ? { dimensions: dims } : {}),
        ...(rowSeed ? { seed: rowSeed } : {}),
        ...(participants && participants.length > 0 ? { participants } : {}),
        ...(runId ? { runId } : {}),
        ...(row.version ? { version: String(row.version) } : {}),
        ...(replayCid ? { hasReplay: true, replayCid } : {}),
        ...(row.tag ? { tag: String(row.tag) } : {}),
        ...(labels.length > 0 ? { labels } : {}),
        recordedAt: String(row.recorded_at),
        verified: Number(row.verified) === 1 && Number(row.revoked) === 0,
        ...(item.obsolete ? { obsolete: true } : {}),
        ...(!verifiedOnly ? { revoked: Number(row.revoked) === 1 } : {}),
      };
    };

    // Compute true competitive standings across all active (`!obsolete`) entries first (for `viewerEntry` & active ranks)
    const sortedActiveAll = [...activeByCompetitor.values()].sort(compareEntries);
    const activeRankByUri = new Map<string, number>();
    sortedActiveAll.forEach((item, idx) => activeRankByUri.set(String(item.row.uri), idx + 1));

    let viewerEntry: XrpcScoreEntry | undefined;
    if (resolvedViewerDid) {
      const viewerActive = sortedActiveAll.find(
        (item) =>
          Number(item.row.revoked) === 0 &&
          rowIncludesDid(String(item.row.player_did), item.participants, resolvedViewerDid!)
      );
      if (viewerActive) {
        viewerEntry = toScoreEntry(viewerActive, activeRankByUri.get(String(viewerActive.row.uri)) ?? 1);
      }
    }

    let pool = includeObsolete ? dedupedByRunId : sortedActiveAll;
    if (resolvedPlayerDid) {
      pool = pool.filter((item) =>
        rowIncludesDid(String(item.row.player_did), item.participants, resolvedPlayerDid!)
      );
    }

    const sortedItems = [...pool].sort(compareEntries);
    const rankedEntries: XrpcScoreEntry[] = sortedItems.map((item, idx) => {
      const standingRank = !includeObsolete && !resolvedPlayerDid
        ? idx + 1
        : activeRankByUri.get(String(item.row.uri)) ?? idx + 1;
      return toScoreEntry(item, standingRank);
    });

    const offset = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
    const boundedLimit = Math.max(1, Math.min(100, limit));
    const page = rankedEntries.slice(offset, offset + boundedLimit);
    const nextCursor = offset + boundedLimit < rankedEntries.length ? String(offset + boundedLimit) : undefined;

    return {
      leaderboard,
      ...(effectiveSortedBy ? { sortedBy: effectiveSortedBy } : {}),
      rankingMode,
      entries: page,
      ...(viewerEntry ? { viewerEntry } : {}),
      ...(nextCursor ? { cursor: nextCursor } : {}),
    };
  }

  /**
   * Rich Leaderboard view for the Web UI (includes actor avatars/displayNames + leaderboard & game metadata).
   */
  async getRichLeaderboard({
    leaderboard,
    timeframe = 'allTime',
    scope = 'public',
    viewer,
    player,
    includeObsolete = false,
    sortBy,
    dimensions,
    seed,
    version,
    limit = 50,
  }: {
    leaderboard: string;
    timeframe?: Timeframe;
    scope?: 'public' | 'social';
    viewer?: string;
    player?: string;
    includeObsolete?: boolean;
    sortBy?: string;
    dimensions?: string;
    seed?: string;
    version?: string;
    limit?: number;
  }) {
    const lbRow = this.db
      .prepare('SELECT * FROM leaderboard_definitions WHERE uri = ?')
      .get(leaderboard) as Record<string, any> | undefined;
    if (!lbRow) {
      throw Object.assign(new Error(`Leaderboard not found: ${leaderboard}`), { status: 404 });
    }

    const parsedDef = JSON.parse(String(lbRow.raw_json)) as LeaderboardDefinitionRecord;
    const orderedCompIds = getOrderedComponentIds(parsedDef);
    const orderedDimIds = getOrderedDimensionIds(parsedDef);

    const gameRow = this.db
      .prepare('SELECT uri, name, icon_url, url, developer_name FROM games WHERE uri = ?')
      .get(String(lbRow.game_uri)) as Record<string, any> | undefined;

    const xrpc = await this.getXrpcLeaderboardScores({
      leaderboard,
      timeframe,
      scope,
      viewer,
      player,
      includeObsolete,
      sortBy,
      dimensions,
      seed,
      version,
      verifiedOnly: true,
      limit,
    });

    const enrich = (entry: XrpcScoreEntry) => {
      const cachedActor = this.identity.getCachedActor(entry.player);
      const actor = this.getActorMeta(entry.player);
      const row = this.db
        .prepare('SELECT issuer_did, key_id, details_json, replay_cid, replay_mime, is_demo FROM leaderboard_scores WHERE uri = ?')
        .get(entry.uri) as
        | {
            issuer_did?: string;
            key_id?: string;
            details_json?: string | null;
            replay_cid?: string | null;
            replay_mime?: string | null;
            is_demo?: number;
          }
        | undefined;

      const formattedComponents =
        orderedCompIds.length > 0 && parsedDef.components
          ? orderedCompIds.map((compId) => {
              const cDef = parsedDef.components![compId];
              const cVal = entry.components?.[compId];
              return {
                id: compId,
                name: cDef.name,
                type: cDef.$type,
                rawValue: cVal?.value ?? null,
                displayValue: cVal ? formatComponentValue(cVal, cDef) : '—',
              };
            })
          : undefined;

      const enrichedParticipants = entry.participants?.map((p) => {
        if (!p.did) return p;
        const pMeta = this.getActorMeta(p.did);
        return {
          ...p,
          handle: pMeta.handle,
          displayName: pMeta.displayName ?? pMeta.handle ?? p.name ?? p.did,
        };
      });

      const replayCid = row?.replay_cid ?? entry.replayCid;
      const pdsBase = cachedActor?.pdsUrl ?? 'https://bsky.social';
      const replayDownloadUrl = replayCid
        ? `${pdsBase}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(entry.player)}&cid=${encodeURIComponent(replayCid)}`
        : undefined;

      return {
        ...entry,
        displayName: actor.displayName ?? actor.handle ?? entry.player,
        avatarUrl: actor.avatarUrl,
        participants: enrichedParticipants,
        issuerDid: row?.issuer_did,
        keyId: row?.key_id,
        verificationMethod: row?.key_id?.startsWith('label:') ? 'community-label' : 'attestation',
        formattedComponents,
        details: row?.details_json ? JSON.parse(row.details_json) : undefined,
        replayMime: row?.replay_mime ?? undefined,
        replayDownloadUrl,
        isDemo: row?.is_demo === 1,
      };
    };

    return {
      sortedBy: xrpc.sortedBy,
      rankingMode: xrpc.rankingMode,
      includeObsolete,
      activePlayerFilter: player,
      activeDimensionsFilter: parseDimensionsFilter(dimensions),
      activeSeedFilter: seed,
      activeVersionFilter: version,
      definition: {
        uri: String(lbRow.uri),
        publisherDid: String(lbRow.publisher_did),
        name: String(lbRow.name),
        description: lbRow.description ? String(lbRow.description) : undefined,
        iconUrl: lbRow.icon_url ? String(lbRow.icon_url) : undefined,
        iconAlt: lbRow.icon_alt ? String(lbRow.icon_alt) : String(lbRow.name),
        sortOrder: String(lbRow.sort_order),
        rankingMode: parsedDef.rankingMode ?? 'best',
        scoreFormat: JSON.parse(String(lbRow.score_format_json)),
        components: parsedDef.components,
        componentOrder: orderedCompIds.length > 0 ? orderedCompIds : undefined,
        defaultComponent: parsedDef.defaultComponent,
        dimensions: parsedDef.dimensions,
        dimensionOrder: orderedDimIds.length > 0 ? orderedDimIds : undefined,
        startsAt: parsedDef.startsAt,
        endsAt: parsedDef.endsAt,
        detailsSchema: parsedDef.detailsSchema,
        rankedVersions: parsedDef.rankedVersions,
        trustedIssuers: parsedDef.trustedIssuers,
        timeframes: JSON.parse(String(lbRow.timeframes_json)) as Timeframe[],
        recordPolicy: String(lbRow.record_policy),
        scoreMin: lbRow.score_min ?? undefined,
        scoreMax: lbRow.score_max ?? undefined,
        isDemo: Number(lbRow.is_demo) === 1,
      },
      game: gameRow
        ? {
            uri: String(gameRow.uri),
            name: String(gameRow.name),
            iconUrl: gameRow.icon_url ? String(gameRow.icon_url) : undefined,
            url: gameRow.url ? String(gameRow.url) : undefined,
            developerName: gameRow.developer_name ? String(gameRow.developer_name) : undefined,
          }
        : undefined,
      entries: xrpc.entries.map(enrich),
      viewerEntry: xrpc.viewerEntry ? enrich(xrpc.viewerEntry) : undefined,
    };
  }

  /**
   * Overview dashboard data (`GET /api/overview`).
   */
  getOverviewData(jetstreamStatus: { connected: boolean; eventsProcessed: number; lastEventAt?: string }) {
    const gamesCount = (this.db.prepare('SELECT COUNT(*) AS c FROM games').get() as { c: number }).c;
    const achDefsCount = (this.db.prepare('SELECT COUNT(*) AS c FROM achievement_definitions').get() as { c: number }).c;
    const verifiedUnlocksCount = (
      this.db
        .prepare('SELECT COUNT(*) AS c FROM achievement_unlocks WHERE verified = 1 AND revoked = 0')
        .get() as { c: number }
    ).c;
    const verifiedScoresCount = (
      this.db
        .prepare('SELECT COUNT(*) AS c FROM leaderboard_scores WHERE verified = 1 AND revoked = 0')
        .get() as { c: number }
    ).c;
    const verifiedMatchesCount = (
      this.db
        .prepare('SELECT COUNT(*) AS c FROM match_results WHERE verified = 1 AND revoked = 0')
        .get() as { c: number }
    ).c;
    const revocationsCount = (this.db.prepare('SELECT COUNT(*) AS c FROM revocations').get() as { c: number }).c;
    const blockedCount = (
      this.db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM achievement_unlocks WHERE verified = 0 OR revoked = 1) +
             (SELECT COUNT(*) FROM leaderboard_scores WHERE verified = 0 OR revoked = 1) +
             (SELECT COUNT(*) FROM match_results WHERE verified = 0 OR revoked = 1) AS c`
        )
        .get() as { c: number }
    ).c;

    const games = this.getGamesCatalog();

    const recentUnlocks = (
      this.db
        .prepare(
          `SELECT u.*, d.title AS ach_title, d.tier AS ach_tier, d.icon_url AS ach_icon_url,
                  d.icon_alt AS ach_icon_alt, g.name AS game_name, g.uri AS resolved_game_uri
           FROM achievement_unlocks u
           JOIN achievement_definitions d ON d.uri = u.achievement_uri
           LEFT JOIN games g ON g.uri = d.game_uri
           WHERE u.verified = 1 AND u.revoked = 0 AND d.hidden = 0
           ORDER BY u.unlocked_at DESC
           LIMIT 8`
        )
        .all() as Array<Record<string, any>>
    ).map((r) => {
      const actor = this.getActorMeta(String(r.player_did));
      return {
        uri: String(r.uri),
        playerDid: actor.did,
        handle: actor.handle,
        displayName: actor.displayName ?? actor.handle ?? actor.did,
        achievementUri: String(r.achievement_uri),
        achievementTitle: String(r.ach_title),
        tier: r.ach_tier ? String(r.ach_tier) : undefined,
        iconUrl: r.ach_icon_url ? String(r.ach_icon_url) : undefined,
        iconAlt: r.ach_icon_alt ? String(r.ach_icon_alt) : String(r.ach_title),
        gameUri: r.resolved_game_uri ? String(r.resolved_game_uri) : undefined,
        gameName: r.game_name ? String(r.game_name) : 'Unknown Game',
        unlockedAt: String(r.unlocked_at),
        attestationCid: r.attestation_cid ? String(r.attestation_cid) : undefined,
        keyId: r.key_id ? String(r.key_id) : undefined,
        isDemo: Number(r.is_demo) === 1,
      };
    });

    const recentScores = (
      this.db
        .prepare(
          `SELECT s.*, l.name AS lb_name, l.score_format_json, l.raw_json AS lb_raw_json, l.icon_url AS lb_icon_url,
                  g.name AS game_name, g.uri AS resolved_game_uri
           FROM leaderboard_scores s
           JOIN leaderboard_definitions l ON l.uri = s.leaderboard_uri
           LEFT JOIN games g ON g.uri = l.game_uri
           WHERE s.verified = 1 AND s.revoked = 0
           ORDER BY s.recorded_at DESC
           LIMIT 8`
        )
        .all() as Array<Record<string, any>>
    ).map((r) => {
      const actor = this.getActorMeta(String(r.player_did));
      const fmt = JSON.parse(String(r.score_format_json)) as ScoreFormat;
      const score = Number(r.score);
      let displayScore = r.display_score ? String(r.display_score) : undefined;
      if (!displayScore && r.lb_raw_json) {
        const lbDef = JSON.parse(String(r.lb_raw_json)) as LeaderboardDefinitionRecord;
        if (getOrderedComponentIds(lbDef).length > 0) {
          displayScore = getScoreSortMetric(JSON.parse(String(r.raw_json)) as LeaderboardScoreRecord, lbDef)?.displayValue;
        }
      }
      return {
        uri: String(r.uri),
        playerDid: actor.did,
        handle: actor.handle,
        displayName: actor.displayName ?? actor.handle ?? actor.did,
        leaderboardUri: String(r.leaderboard_uri),
        leaderboardName: String(r.lb_name),
        iconUrl: r.lb_icon_url ? String(r.lb_icon_url) : undefined,
        gameUri: r.resolved_game_uri ? String(r.resolved_game_uri) : undefined,
        gameName: r.game_name ? String(r.game_name) : 'Unknown Game',
        score,
        displayScore: displayScore ?? formatScore(score, fmt),
        tag: r.tag ? String(r.tag) : undefined,
        recordedAt: String(r.recorded_at),
        attestationCid: r.attestation_cid ? String(r.attestation_cid) : undefined,
        isDemo: Number(r.is_demo) === 1,
      };
    });

    const featuredActors = (
      this.db
        .prepare(
          `SELECT a.did, a.handle, a.display_name, a.is_demo,
                  COUNT(DISTINCT u.achievement_uri) AS unlocks
           FROM actors a
           JOIN achievement_unlocks u ON u.player_did = a.did AND u.verified = 1 AND u.revoked = 0
           GROUP BY a.did
           ORDER BY unlocks DESC
           LIMIT 6`
        )
        .all() as Array<Record<string, any>>
    ).map((r) => ({
      did: String(r.did),
      handle: r.handle ? String(r.handle) : undefined,
      displayName: r.display_name ? String(r.display_name) : r.handle ? String(r.handle) : String(r.did),
      unlocks: Number(r.unlocks),
      isDemo: Number(r.is_demo) === 1,
    }));

    return {
      stats: {
        gamesCount,
        achievementDefinitionsCount: achDefsCount,
        verifiedUnlocksCount,
        verifiedScoresCount,
        verifiedMatchesCount,
        revocationsCount,
        blockedAttemptsCount: blockedCount,
      },
      jetstream: jetstreamStatus,
      games,
      featuredActors,
      recentUnlocks,
      recentScores,
    };
  }

  /**
   * List all indexed games with achievement, leaderboard, and active player counts.
   */
  getGamesCatalog() {
    const rows = this.db
      .prepare('SELECT * FROM games ORDER BY is_demo ASC, name ASC')
      .all() as Array<Record<string, any>>;

    return rows.map((g) => {
      const gameUri = String(g.uri);
      const achCount = (
        this.db.prepare('SELECT COUNT(*) AS c FROM achievement_definitions WHERE game_uri = ?').get(gameUri) as {
          c: number;
        }
      ).c;
      const lbRows = this.db
        .prepare('SELECT uri, name FROM leaderboard_definitions WHERE game_uri = ? ORDER BY COALESCE(list_order, 999), name')
        .all(gameUri) as Array<{ uri: string; name: string }>;

      const playerCount = (
        this.db
          .prepare(
            `SELECT COUNT(DISTINCT player_did) AS c FROM (
               SELECT u.player_did FROM achievement_unlocks u
               JOIN achievement_definitions d ON d.uri = u.achievement_uri
               WHERE d.game_uri = ? AND u.verified = 1 AND u.revoked = 0
               UNION
               SELECT s.player_did FROM leaderboard_scores s
               JOIN leaderboard_definitions l ON l.uri = s.leaderboard_uri
               WHERE l.game_uri = ? AND s.verified = 1 AND s.revoked = 0
             )`
          )
          .get(gameUri, gameUri) as { c: number }
      ).c;

      return {
        uri: gameUri,
        publisherDid: String(g.publisher_did),
        rkey: String(g.rkey),
        name: String(g.name),
        tagline: g.tagline ? String(g.tagline) : undefined,
        description: g.description ? String(g.description) : undefined,
        url: g.url ? String(g.url) : undefined,
        category: g.category ? String(g.category) : undefined,
        status: g.status ? String(g.status) : 'live',
        iconUrl: g.icon_url ? String(g.icon_url) : undefined,
        developerName: g.developer_name ? String(g.developer_name) : undefined,
        developerDid: g.developer_did ? String(g.developer_did) : undefined,
        achievementCount: achCount,
        leaderboardCount: lbRows.length,
        primaryLeaderboardUri: lbRows[0]?.uri,
        playerCount,
        isDemo: Number(g.is_demo) === 1,
      };
    });
  }

  /**
   * Full Game Hub detail (`GET /api/game?uri=<at-uri>&viewer=<did-or-handle>`).
   * Computes global unlock rarity percentages and viewer-specific unlock/progress states.
   */
  async getGameDetail(gameUri: string, viewerIdentifier?: string) {
    const gameRow = this.db.prepare('SELECT * FROM games WHERE uri = ?').get(gameUri) as Record<string, any> | undefined;
    if (!gameRow) {
      throw Object.assign(new Error(`Game not found: ${gameUri}`), { status: 404 });
    }

    let viewerDid: string | undefined;
    if (viewerIdentifier) {
      const resolved = await this.identity.resolveActor(viewerIdentifier);
      viewerDid = resolved?.did ?? (viewerIdentifier.startsWith('did:') ? viewerIdentifier : undefined);
    }

    // Total unique verified players of this game (denominator for rarity %)
    const totalPlayers = Math.max(
      1,
      (
        this.db
          .prepare(
            `SELECT COUNT(DISTINCT player_did) AS c FROM (
               SELECT u.player_did FROM achievement_unlocks u
               JOIN achievement_definitions d ON d.uri = u.achievement_uri
               WHERE d.game_uri = ? AND u.verified = 1 AND u.revoked = 0
               UNION
               SELECT s.player_did FROM leaderboard_scores s
               JOIN leaderboard_definitions l ON l.uri = s.leaderboard_uri
               WHERE l.game_uri = ? AND s.verified = 1 AND s.revoked = 0
             )`
          )
          .get(gameUri, gameUri) as { c: number }
      ).c
    );

    const defRows = this.db
      .prepare('SELECT * FROM achievement_definitions WHERE game_uri = ?')
      .all(gameUri) as Array<Record<string, any>>;

    const sortedEntries = sortAchievementDefinitions(
      defRows.map((r) => ({
        uri: String(r.uri),
        record: JSON.parse(String(r.raw_json)) as AchievementDefinitionRecord,
      }))
    );

    const rowByUri = new Map(defRows.map((r) => [String(r.uri), r]));

    const achievements = sortedEntries.map(({ uri, record }) => {
      const r = rowByUri.get(uri)!;
      const unlockers = (
        this.db
          .prepare(
            'SELECT COUNT(DISTINCT player_did) AS c FROM achievement_unlocks WHERE achievement_uri = ? AND verified = 1 AND revoked = 0'
          )
          .get(uri) as { c: number }
      ).c;

      const rarityPercent = Math.round((unlockers / totalPlayers) * 1000) / 10;

      let viewerUnlock: { uri: string; unlockedAt: string; attestationCid?: string } | undefined;
      let viewerProgress: { currentSteps: number; stepsNeeded: number } | undefined;

      if (viewerDid) {
        const uRow = this.db
          .prepare(
            'SELECT uri, unlocked_at, attestation_cid FROM achievement_unlocks WHERE achievement_uri = ? AND player_did = ? AND verified = 1 AND revoked = 0 ORDER BY unlocked_at ASC LIMIT 1'
          )
          .get(uri, viewerDid) as { uri: string; unlocked_at: string; attestation_cid?: string } | undefined;
        if (uRow) {
          viewerUnlock = {
            uri: uRow.uri,
            unlockedAt: uRow.unlocked_at,
            attestationCid: uRow.attestation_cid ?? undefined,
          };
        } else if (record.stepsNeeded) {
          const pRow = this.db
            .prepare(
              'SELECT current_steps, steps_needed FROM achievement_progress WHERE achievement_uri = ? AND player_did = ? ORDER BY updated_at DESC LIMIT 1'
            )
            .get(uri, viewerDid) as { current_steps: number; steps_needed?: number } | undefined;
          if (pRow) {
            viewerProgress = {
              currentSteps: pRow.current_steps,
              stepsNeeded: pRow.steps_needed ?? record.stepsNeeded,
            };
          }
        }
      }

      const isHidden = Boolean(record.hidden);
      const isRedactedStub =
        Boolean(r.is_redacted_stub) || Boolean(isHidden && (!record.title || !record.description));
      const maskedForViewer = isHidden && !viewerUnlock;

      const safeRevealedTitle = record.title ?? 'Redacted Hidden Achievement';
      const safeRevealedDesc =
        record.description ??
        (record.hiddenSpace
          ? `Spoiler-proof stub on the public PDS. Full metadata is revealed via ATProto Space: ${record.hiddenSpace}`
          : 'Spoiler-proof stub on the public PDS. Full metadata is revealed upon unlock.');

      return {
        uri,
        rkey: String(r.rkey),
        title: maskedForViewer ? 'Hidden Achievement' : safeRevealedTitle,
        description: maskedForViewer
          ? record.hiddenSpace
            ? 'Spoiler-proof hidden stub — full details are gated in an access-controlled ATProto Space until unlocked.'
            : 'Keep playing to discover and unlock this hidden milestone.'
          : safeRevealedDesc,
        requirement: maskedForViewer ? undefined : record.requirement,
        revealedTitle: safeRevealedTitle,
        revealedDescription: safeRevealedDesc,
        iconUrl: r.icon_url ? String(r.icon_url) : undefined,
        iconAlt: maskedForViewer ? 'Locked hidden achievement icon' : record.iconAlt ?? safeRevealedTitle,
        tier: record.tier,
        hidden: isHidden,
        hiddenSpace: record.hiddenSpace,
        isRedactedStub,
        trustedIssuers: record.trustedIssuers,
        countsTowardCompletion: record.countsTowardCompletion !== false,
        repeatable: Boolean(record.repeatable),
        availableFrom: record.availableFrom,
        availableUntil: record.availableUntil,
        retired: Boolean(record.retired),
        masked: maskedForViewer,
        stepsNeeded: record.stepsNeeded,
        group: record.group,
        unlockedPlayersCount: unlockers,
        rarityPercent,
        viewerUnlock,
        viewerProgress,
      };
    });

    const lbRows = this.db
      .prepare('SELECT * FROM leaderboard_definitions WHERE game_uri = ? ORDER BY COALESCE(list_order, 999), name')
      .all(gameUri) as Array<Record<string, any>>;

    const leaderboards = await Promise.all(
      lbRows.map(async (lb) => {
        const rich = await this.getRichLeaderboard({
          leaderboard: String(lb.uri),
          timeframe: 'allTime',
          scope: 'public',
          viewer: viewerDid,
          limit: 10,
        });
        return rich;
      })
    );

    const challengeRows = this.db
      .prepare('SELECT * FROM challenge_definitions WHERE game_uri = ? ORDER BY COALESCE(starts_at, created_at) DESC')
      .all(gameUri) as Array<Record<string, any>>;

    const challenges = challengeRows.map((c) => ({
      uri: String(c.uri),
      title: String(c.title),
      description: c.description ? String(c.description) : undefined,
      iconUrl: c.icon_url ? String(c.icon_url) : undefined,
      cadence: String(c.cadence),
      seed: c.seed ? String(c.seed) : undefined,
      targetSteps: c.target_steps !== null && c.target_steps !== undefined ? Number(c.target_steps) : undefined,
      leaderboardUri: c.leaderboard_uri ? String(c.leaderboard_uri) : undefined,
      rewardAchievementUri: c.reward_achievement_uri ? String(c.reward_achievement_uri) : undefined,
      dimensions: c.dimensions_json ? JSON.parse(String(c.dimensions_json)) : undefined,
      startsAt: c.starts_at ? String(c.starts_at) : undefined,
      endsAt: c.ends_at ? String(c.ends_at) : undefined,
    }));

    const matchRows = this.db
      .prepare(
        'SELECT * FROM match_results WHERE game_uri = ? AND verified = 1 AND revoked = 0 ORDER BY played_at DESC LIMIT 20'
      )
      .all(gameUri) as Array<Record<string, any>>;
    const recentMatches = this.formatVerifiedMatchRows(matchRows);

    return {
      game: {
        uri: String(gameRow.uri),
        publisherDid: String(gameRow.publisher_did),
        rkey: String(gameRow.rkey),
        name: String(gameRow.name),
        tagline: gameRow.tagline ? String(gameRow.tagline) : undefined,
        description: gameRow.description ? String(gameRow.description) : undefined,
        url: gameRow.url ? String(gameRow.url) : undefined,
        category: gameRow.category ? String(gameRow.category) : undefined,
        status: gameRow.status ? String(gameRow.status) : 'live',
        iconUrl: gameRow.icon_url ? String(gameRow.icon_url) : undefined,
        developerName: gameRow.developer_name ? String(gameRow.developer_name) : undefined,
        developerDid: gameRow.developer_did ? String(gameRow.developer_did) : undefined,
        totalPlayers,
        isDemo: Number(gameRow.is_demo) === 1,
      },
      achievements,
      leaderboards,
      challenges,
      recentMatches,
    };
  }

  private formatVerifiedMatchRows(rows: Array<Record<string, any>>) {
    const seenMatchKey = new Set<string>();
    const out: Array<Record<string, any>> = [];
    for (const r of rows) {
      const dedupeKey = r.match_id ? `${r.game_uri}::${r.match_id}` : String(r.uri);
      if (seenMatchKey.has(dedupeKey)) continue;
      seenMatchKey.add(dedupeKey);

      const rawParticipants = JSON.parse(String(r.participants_json)) as MatchParticipant[];
      const participants = rawParticipants.map((p) => {
        if (!p.did) return p;
        const meta = this.getActorMeta(p.did);
        return {
          ...p,
          handle: meta.handle,
          displayName: meta.displayName ?? meta.handle ?? p.name ?? p.did,
        };
      });

      out.push({
        uri: String(r.uri),
        repositoryDid: String(r.repository_did),
        gameUri: String(r.game_uri),
        matchId: r.match_id ? String(r.match_id) : undefined,
        mode: r.mode ? String(r.mode) : undefined,
        leaderboardUri: r.leaderboard_uri ? String(r.leaderboard_uri) : undefined,
        challengeUri: r.challenge_uri ? String(r.challenge_uri) : undefined,
        participants,
        details: r.details_json ? JSON.parse(String(r.details_json)) : undefined,
        playedAt: String(r.played_at),
        verificationMethod: r.verification_method ? String(r.verification_method) : 'attestation',
        coSigners: r.cosigners_json ? (JSON.parse(String(r.cosigners_json)) as string[]) : undefined,
        attestationCid: r.attestation_cid ? String(r.attestation_cid) : undefined,
      });
    }
    return out;
  }

  /**
   * Directory of all leaderboards across indexed games.
   */
  getLeaderboardsDirectory() {
    const rows = this.db
      .prepare(
        `SELECT l.*, g.name AS game_name, g.icon_url AS game_icon_url
         FROM leaderboard_definitions l
         LEFT JOIN games g ON g.uri = l.game_uri
         ORDER BY l.is_demo ASC, g.name ASC, COALESCE(l.list_order, 999) ASC`
      )
      .all() as Array<Record<string, any>>;

    return rows.map((r) => ({
      uri: String(r.uri),
      name: String(r.name),
      description: r.description ? String(r.description) : undefined,
      iconUrl: r.icon_url ? String(r.icon_url) : undefined,
      sortOrder: String(r.sort_order),
      rankingMode: r.ranking_mode ? String(r.ranking_mode) : 'best',
      timeframes: JSON.parse(String(r.timeframes_json)) as Timeframe[],
      recordPolicy: String(r.record_policy),
      gameUri: String(r.game_uri),
      gameName: r.game_name ? String(r.game_name) : 'Unknown Game',
      isDemo: Number(r.is_demo) === 1,
    }));
  }

  /**
   * Full Player Gamercard (`GET /api/actors/:actor`) — per-game completion, Trophy Cabinet,
   * incremental progress bars, and personal-best leaderboard standings.
   */
  async getActorGamercard(actorIdentifier: string) {
    const profile = await this.getXrpcActorProfile(actorIdentifier);
    const actorMeta = this.getActorMeta(profile.did);

    const gamesDetailed = profile.games.map((gSummary) => {
      const gRow = this.db
        .prepare('SELECT name, tagline, icon_url, url, is_demo FROM games WHERE uri = ?')
        .get(gSummary.game) as Record<string, any> | undefined;

      const unlockedRows = this.db
        .prepare(
          `SELECT u.uri, u.unlocked_at, u.attestation_cid, u.key_id,
                  u.participants_json, u.run_id, u.details_json, u.media_url, u.media_alt, u.note,
                  d.uri AS def_uri, d.title, d.description, d.tier, d.icon_url, d.icon_alt,
                  d.counts_toward_completion, d.repeatable
           FROM achievement_unlocks u
           JOIN achievement_definitions d ON d.uri = u.achievement_uri
           WHERE u.player_did = ? AND d.game_uri = ? AND u.verified = 1 AND u.revoked = 0
           ORDER BY u.unlocked_at DESC`
        )
        .all(profile.did, gSummary.game) as Array<Record<string, any>>;

      // Deduplicate non-repeatable definitions; track repeatCount for repeatable definitions
      const seenDef = new Set<string>();
      const repeatCountByDef = new Map<string, number>();
      for (const r of unlockedRows) {
        const id = String(r.def_uri);
        repeatCountByDef.set(id, (repeatCountByDef.get(id) ?? 0) + 1);
      }

      const unlockedBadges = unlockedRows
        .filter((r) => {
          const id = String(r.def_uri);
          if (seenDef.has(id)) return false;
          seenDef.add(id);
          return true;
        })
        .map((r) => {
          const id = String(r.def_uri);
          const rawParticipants: Participant[] | undefined = r.participants_json
            ? JSON.parse(String(r.participants_json))
            : undefined;
          const participants = rawParticipants?.map((p) => {
            if (!p.did) return p;
            const pMeta = this.getActorMeta(p.did);
            return { ...p, handle: pMeta.handle, displayName: pMeta.displayName ?? pMeta.handle ?? p.name ?? p.did };
          });

          return {
            unlockUri: String(r.uri),
            achievementUri: id,
            title: String(r.title),
            description: String(r.description),
            tier: r.tier ? String(r.tier) : undefined,
            countsTowardCompletion: Number(r.counts_toward_completion ?? 1) !== 0,
            repeatable: Number(r.repeatable ?? 0) === 1,
            repeatCount: Number(r.repeatable ?? 0) === 1 ? repeatCountByDef.get(id) ?? 1 : undefined,
            iconUrl: r.icon_url ? String(r.icon_url) : undefined,
            iconAlt: r.icon_alt ? String(r.icon_alt) : String(r.title),
            unlockedAt: String(r.unlocked_at),
            attestationCid: r.attestation_cid ? String(r.attestation_cid) : undefined,
            runId: r.run_id ? String(r.run_id) : undefined,
            participants,
            details: r.details_json ? JSON.parse(String(r.details_json)) : undefined,
            mediaUrl: r.media_url ? String(r.media_url) : undefined,
            mediaAlt: r.media_alt ? String(r.media_alt) : undefined,
            note: r.note ? String(r.note) : undefined,
          };
        });

      // Active incremental progress for locked achievements in this game
      const progressRows = this.db
        .prepare(
          `SELECT p.uri, p.current_steps, p.steps_needed, p.updated_at,
                  d.uri AS def_uri, d.title, d.requirement, d.description, d.icon_url, d.steps_needed AS def_steps
           FROM achievement_progress p
           JOIN achievement_definitions d ON d.uri = p.achievement_uri
           WHERE p.player_did = ? AND d.game_uri = ? AND d.hidden = 0
           ORDER BY p.updated_at DESC`
        )
        .all(profile.did, gSummary.game) as Array<Record<string, any>>;

      const inProgress = progressRows
        .filter((p) => !seenDef.has(String(p.def_uri)))
        .map((p) => {
          const target = Number(p.steps_needed ?? p.def_steps ?? 100);
          const current = Math.min(target, Number(p.current_steps));
          return {
            progressUri: String(p.uri),
            achievementUri: String(p.def_uri),
            title: String(p.title),
            requirement: p.requirement ? String(p.requirement) : String(p.description),
            iconUrl: p.icon_url ? String(p.icon_url) : undefined,
            currentSteps: current,
            stepsNeeded: target,
            percent: Math.floor((current * 100) / Math.max(1, target)),
            updatedAt: String(p.updated_at),
          };
        });

      return {
        ...gSummary,
        gameName: gRow?.name ? String(gRow.name) : gSummary.game,
        tagline: gRow?.tagline ? String(gRow.tagline) : undefined,
        iconUrl: gRow?.icon_url ? String(gRow.icon_url) : undefined,
        gameUrl: gRow?.url ? String(gRow.url) : undefined,
        isDemo: Number(gRow?.is_demo) === 1,
        unlockedBadges,
        inProgress,
      };
    });

    // Personal best standings across all leaderboards where this player has a verified score
    const playerLbUris = this.db
      .prepare(
        'SELECT DISTINCT leaderboard_uri FROM leaderboard_scores WHERE player_did = ? AND verified = 1 AND revoked = 0'
      )
      .all(profile.did) as Array<{ leaderboard_uri: string }>;

    const leaderboardStandings = await Promise.all(
      playerLbUris.map(async ({ leaderboard_uri }) => {
        const lbRow = this.db
          .prepare(
            `SELECT l.name, l.icon_url, l.game_uri, g.name AS game_name
             FROM leaderboard_definitions l
             LEFT JOIN games g ON g.uri = l.game_uri
             WHERE l.uri = ?`
          )
          .get(leaderboard_uri) as Record<string, any> | undefined;

        const scoresRes = await this.getXrpcLeaderboardScores({
          leaderboard: leaderboard_uri,
          timeframe: 'allTime',
          scope: 'public',
          viewer: profile.did,
          limit: 1,
        });

        return {
          leaderboardUri: leaderboard_uri,
          leaderboardName: lbRow?.name ? String(lbRow.name) : leaderboard_uri,
          iconUrl: lbRow?.icon_url ? String(lbRow.icon_url) : undefined,
          gameUri: lbRow?.game_uri ? String(lbRow.game_uri) : undefined,
          gameName: lbRow?.game_name ? String(lbRow.game_name) : 'Unknown Game',
          entry: scoresRes.viewerEntry,
        };
      })
    );

    const matchRows = this.db
      .prepare(
        `SELECT * FROM match_results
         WHERE (repository_did = ? OR participants_json LIKE ?)
           AND verified = 1 AND revoked = 0
         ORDER BY played_at DESC LIMIT 20`
      )
      .all(profile.did, `%${profile.did}%`) as Array<Record<string, any>>;
    const recentMatches = this.formatVerifiedMatchRows(matchRows);

    return {
      actor: {
        did: profile.did,
        handle: profile.handle ?? actorMeta.handle,
        displayName: actorMeta.displayName ?? profile.handle ?? actorMeta.handle ?? profile.did,
        avatarUrl: actorMeta.avatarUrl,
      },
      profile,
      games: gamesDetailed,
      leaderboardStandings: leaderboardStandings.filter((s) => Boolean(s.entry)),
      recentMatches,
    };
  }

  private getActiveLabelsForTargets(targets: string[]): AtprotoLabel[] {
    const clean = [...new Set(targets.filter(Boolean))];
    if (clean.length === 0) return [];
    const rows = this.db
      .prepare(
        `SELECT src, uri, cid, val, neg, cts, exp
         FROM moderation_labels
         WHERE uri IN (${clean.map(() => '?').join(', ')})`
      )
      .all(...clean) as Array<Record<string, any>>;

    return resolveActiveLabels(
      rows.map((l) => ({
        src: String(l.src),
        uri: String(l.uri),
        ...(l.cid ? { cid: String(l.cid) } : {}),
        val: String(l.val),
        neg: Number(l.neg) === 1,
        cts: String(l.cts),
        ...(l.exp ? { exp: String(l.exp) } : {}),
      }))
    );
  }

  /**
   * Cryptographic Proof & Revocation Inspector (`GET /api/proof?uri=<record-at-uri>`).
   */
  getProofDetail(recordUri: string) {
    const unlockRow = this.db
      .prepare('SELECT * FROM achievement_unlocks WHERE uri = ?')
      .get(recordUri) as Record<string, any> | undefined;

    if (unlockRow) {
      const playerDid = String(unlockRow.player_did);
      const matchingRev = unlockRow.attestation_cid
        ? (this.db
            .prepare('SELECT * FROM revocations WHERE attestation_cid = ? OR record_uri = ? LIMIT 1')
            .get(String(unlockRow.attestation_cid), recordUri) as Record<string, any> | undefined)
        : (this.db
            .prepare('SELECT * FROM revocations WHERE record_uri = ? LIMIT 1')
            .get(recordUri) as Record<string, any> | undefined);

      const activeLabels = this.getActiveLabelsForTargets([recordUri, playerDid]);

      return {
        kind: 'achievement.unlock',
        uri: String(unlockRow.uri),
        playerDid,
        subjectUri: String(unlockRow.achievement_uri),
        issuerDid: unlockRow.issuer_did ? String(unlockRow.issuer_did) : undefined,
        keyId: unlockRow.key_id ? String(unlockRow.key_id) : undefined,
        attestationCid: unlockRow.attestation_cid ? String(unlockRow.attestation_cid) : undefined,
        verified: Number(unlockRow.verified) === 1 && Number(unlockRow.revoked) === 0,
        revoked: Number(unlockRow.revoked) === 1,
        labelInvalidated: Number(unlockRow.label_invalidated) === 1,
        activeLabels,
        verificationError: unlockRow.verification_error ? String(unlockRow.verification_error) : undefined,
        verificationMessage: unlockRow.verification_message ? String(unlockRow.verification_message) : undefined,
        record: JSON.parse(String(unlockRow.raw_json)),
        revocation: matchingRev ? JSON.parse(String(matchingRev.raw_json)) : undefined,
        revocationUri: matchingRev ? String(matchingRev.uri) : undefined,
      };
    }

    const scoreRow = this.db
      .prepare('SELECT * FROM leaderboard_scores WHERE uri = ?')
      .get(recordUri) as Record<string, any> | undefined;

    if (scoreRow) {
      const playerDid = String(scoreRow.player_did);
      const matchingRev = scoreRow.attestation_cid
        ? (this.db
            .prepare('SELECT * FROM revocations WHERE attestation_cid = ? OR record_uri = ? LIMIT 1')
            .get(String(scoreRow.attestation_cid), recordUri) as Record<string, any> | undefined)
        : (this.db
            .prepare('SELECT * FROM revocations WHERE record_uri = ? LIMIT 1')
            .get(recordUri) as Record<string, any> | undefined);

      const activeLabels = this.getActiveLabelsForTargets([recordUri, playerDid]);

      return {
        kind: 'leaderboard.score',
        uri: String(scoreRow.uri),
        playerDid,
        subjectUri: String(scoreRow.leaderboard_uri),
        issuerDid: scoreRow.issuer_did ? String(scoreRow.issuer_did) : undefined,
        keyId: scoreRow.key_id ? String(scoreRow.key_id) : undefined,
        attestationCid: scoreRow.attestation_cid ? String(scoreRow.attestation_cid) : undefined,
        version: scoreRow.version ? String(scoreRow.version) : undefined,
        replayCid: scoreRow.replay_cid ? String(scoreRow.replay_cid) : undefined,
        verified: Number(scoreRow.verified) === 1 && Number(scoreRow.revoked) === 0,
        revoked: Number(scoreRow.revoked) === 1,
        labelInvalidated: Number(scoreRow.label_invalidated) === 1,
        activeLabels,
        verificationError: scoreRow.verification_error ? String(scoreRow.verification_error) : undefined,
        verificationMessage: scoreRow.verification_message ? String(scoreRow.verification_message) : undefined,
        record: JSON.parse(String(scoreRow.raw_json)),
        revocation: matchingRev ? JSON.parse(String(matchingRev.raw_json)) : undefined,
        revocationUri: matchingRev ? String(matchingRev.uri) : undefined,
      };
    }

    const matchRow = this.db
      .prepare('SELECT * FROM match_results WHERE uri = ?')
      .get(recordUri) as Record<string, any> | undefined;

    if (matchRow) {
      const repoDid = String(matchRow.repository_did);
      const matchingRev = matchRow.attestation_cid
        ? (this.db
            .prepare('SELECT * FROM revocations WHERE attestation_cid = ? OR record_uri = ? LIMIT 1')
            .get(String(matchRow.attestation_cid), recordUri) as Record<string, any> | undefined)
        : (this.db
            .prepare('SELECT * FROM revocations WHERE record_uri = ? LIMIT 1')
            .get(recordUri) as Record<string, any> | undefined);

      const coSigners: string[] | undefined = matchRow.cosigners_json
        ? JSON.parse(String(matchRow.cosigners_json))
        : undefined;
      const activeLabels = this.getActiveLabelsForTargets([recordUri, repoDid, ...(coSigners ?? [])]);

      return {
        kind: 'match.result',
        uri: String(matchRow.uri),
        playerDid: repoDid,
        subjectUri: String(matchRow.leaderboard_uri ?? matchRow.game_uri),
        issuerDid: matchRow.issuer_did ? String(matchRow.issuer_did) : undefined,
        verificationMethod: matchRow.verification_method ? String(matchRow.verification_method) : undefined,
        coSigners,
        keyId: matchRow.key_id ? String(matchRow.key_id) : undefined,
        attestationCid: matchRow.attestation_cid ? String(matchRow.attestation_cid) : undefined,
        version: matchRow.version ? String(matchRow.version) : undefined,
        replayCid: matchRow.replay_cid ? String(matchRow.replay_cid) : undefined,
        verified: Number(matchRow.verified) === 1 && Number(matchRow.revoked) === 0,
        revoked: Number(matchRow.revoked) === 1,
        labelInvalidated: Number(matchRow.label_invalidated) === 1,
        activeLabels,
        verificationError: matchRow.verification_error ? String(matchRow.verification_error) : undefined,
        verificationMessage: matchRow.verification_message ? String(matchRow.verification_message) : undefined,
        record: JSON.parse(String(matchRow.raw_json)),
        revocation: matchingRev ? JSON.parse(String(matchingRev.raw_json)) : undefined,
        revocationUri: matchingRev ? String(matchingRev.uri) : undefined,
      };
    }

    throw Object.assign(new Error(`Record not found in AppView index: ${recordUri}`), { status: 404 });
  }

  /**
   * Public Verification & Revocation Audit Ledger (`GET /api/audit`).
   */
  getAuditLedger() {
    const revocations = (
      this.db
        .prepare('SELECT * FROM revocations ORDER BY revoked_at DESC LIMIT 50')
        .all() as Array<Record<string, any>>
    ).map((r) => {
      const player = this.getActorMeta(String(r.player_did));
      return {
        uri: String(r.uri),
        publisherDid: String(r.publisher_did),
        scope: String(r.scope),
        attestationCid: r.attestation_cid ? String(r.attestation_cid) : undefined,
        playerDid: player.did,
        playerHandle: player.handle,
        subjectUri: String(r.subject_uri),
        recordUri: r.record_uri ? String(r.record_uri) : undefined,
        before: r.before_ts ? String(r.before_ts) : undefined,
        reason: String(r.reason),
        note: r.note ? String(r.note) : undefined,
        revokedAt: String(r.revoked_at),
        isDemo: Number(r.is_demo) === 1,
      };
    });

    const moderationLabels = (
      this.db
        .prepare('SELECT src, uri, cid, val, neg, cts, exp FROM moderation_labels ORDER BY cts DESC LIMIT 50')
        .all() as Array<Record<string, any>>
    ).map((l) => ({
      src: String(l.src),
      uri: String(l.uri),
      cid: l.cid ? String(l.cid) : undefined,
      val: String(l.val),
      neg: Number(l.neg) === 1,
      cts: String(l.cts),
      exp: l.exp ? String(l.exp) : undefined,
    }));

    const rejectedRecords = [
      ...(
        this.db
          .prepare(
            `SELECT 'leaderboard.score' AS kind, uri, player_did, leaderboard_uri AS subject_uri,
                    verification_error, verification_message, attestation_cid, revoked, revocation_reason, recorded_at AS ts
             FROM leaderboard_scores
             WHERE verified = 0 OR revoked = 1`
          )
          .all() as Array<Record<string, any>>
      ),
      ...(
        this.db
          .prepare(
            `SELECT 'achievement.unlock' AS kind, uri, player_did, achievement_uri AS subject_uri,
                    verification_error, verification_message, attestation_cid, revoked, revocation_reason, unlocked_at AS ts
             FROM achievement_unlocks
             WHERE verified = 0 OR revoked = 1`
          )
          .all() as Array<Record<string, any>>
      ),
      ...(
        this.db
          .prepare(
            `SELECT 'match.result' AS kind, uri, repository_did AS player_did, game_uri AS subject_uri,
                    verification_error, verification_message, attestation_cid, revoked, revocation_reason, played_at AS ts
             FROM match_results
             WHERE verified = 0 OR revoked = 1`
          )
          .all() as Array<Record<string, any>>
      ),
    ]
      .sort((a, b) => Date.parse(String(b.ts)) - Date.parse(String(a.ts)))
      .slice(0, 50)
      .map((r) => {
        const player = this.getActorMeta(String(r.player_did));
        return {
          kind: String(r.kind),
          uri: String(r.uri),
          playerDid: player.did,
          playerHandle: player.handle,
          subjectUri: String(r.subject_uri),
          error: r.verification_error ? String(r.verification_error) : 'unverified',
          message: r.verification_message ? String(r.verification_message) : undefined,
          attestationCid: r.attestation_cid ? String(r.attestation_cid) : undefined,
          revoked: Number(r.revoked) === 1,
          revocationReason: r.revocation_reason ? String(r.revocation_reason) : undefined,
          timestamp: String(r.ts),
        };
      });

    return {
      revocations,
      moderationLabels,
      rejectedRecords,
    };
  }
}
