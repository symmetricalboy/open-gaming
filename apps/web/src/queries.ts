import {
  formatScore,
  getTimeframeStartMs,
  isBetterScore,
  sortAchievementDefinitions,
  summarizeActorProfile,
  type AchievementDefinitionRecord,
  type AchievementUnlockRecord,
  type ActorProfileSummary,
  type LeaderboardSortOrder,
  type ScoreFormat,
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
  score: number;
  displayScore?: string;
  tag?: string;
  recordedAt: string;
  verified: boolean;
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
    verifiedOnly = true,
    limit = 25,
    cursor,
    now = new Date(),
  }: {
    leaderboard: string;
    timeframe?: Timeframe;
    scope?: 'public' | 'social';
    viewer?: string;
    verifiedOnly?: boolean;
    limit?: number;
    cursor?: string;
    now?: Date;
  }): Promise<{
    leaderboard: string;
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

    const allowedTimeframes = JSON.parse(String(lbRow.timeframes_json)) as Timeframe[];
    const effectiveTimeframe: Timeframe = allowedTimeframes.includes(timeframe)
      ? timeframe
      : allowedTimeframes[0] ?? 'allTime';

    const sortOrder = String(lbRow.sort_order) as LeaderboardSortOrder;
    const scoreFormat = JSON.parse(String(lbRow.score_format_json)) as ScoreFormat;
    const windowStartMs = getTimeframeStartMs(effectiveTimeframe, now);

    let resolvedViewerDid: string | undefined;
    if (viewer) {
      const resolvedViewer = await this.identity.resolveActor(viewer);
      resolvedViewerDid = resolvedViewer?.did ?? (viewer.startsWith('did:') ? viewer : undefined);
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

    // Filter by timeframe, verification/revocation, and social graph
    const eligible = rawRows.filter((r) => {
      const ts = Date.parse(String(r.recorded_at));
      if (!Number.isNaN(ts) && ts < windowStartMs) return false;
      if (verifiedOnly && (Number(r.verified) !== 1 || Number(r.revoked) === 1)) return false;
      if (socialDids && !socialDids.has(String(r.player_did))) return false;
      return true;
    });

    // Deduplicate to each player's best score within the timeframe (tie-break by earliest recorded_at)
    const bestByPlayer = new Map<string, Record<string, any>>();
    for (const row of eligible) {
      const playerDid = String(row.player_did);
      const prev = bestByPlayer.get(playerDid);
      if (!prev) {
        bestByPlayer.set(playerDid, row);
        continue;
      }
      const candidateScore = Number(row.score);
      const existingScore = Number(prev.score);
      if (isBetterScore(candidateScore, existingScore, sortOrder)) {
        bestByPlayer.set(playerDid, row);
      } else if (
        candidateScore === existingScore &&
        Date.parse(String(row.recorded_at)) < Date.parse(String(prev.recorded_at))
      ) {
        bestByPlayer.set(playerDid, row);
      }
    }

    const sortedRows = [...bestByPlayer.values()].sort((a, b) => {
      const sa = Number(a.score);
      const sb = Number(b.score);
      if (sa !== sb) {
        return sortOrder === 'smallerIsBetter' ? sa - sb : sb - sa;
      }
      return Date.parse(String(a.recorded_at)) - Date.parse(String(b.recorded_at));
    });

    const rankedEntries: XrpcScoreEntry[] = sortedRows.map((row, idx) => {
      const actor = this.getActorMeta(String(row.player_did));
      const rawScore = Number(row.score);
      const displayScore = row.display_score
        ? String(row.display_score)
        : formatScore(rawScore, scoreFormat);

      return {
        rank: idx + 1,
        player: actor.did,
        ...(actor.handle ? { handle: actor.handle } : {}),
        uri: String(row.uri),
        ...(row.attestation_cid ? { attestationCid: String(row.attestation_cid) } : {}),
        score: rawScore,
        displayScore,
        ...(row.tag ? { tag: String(row.tag) } : {}),
        recordedAt: String(row.recorded_at),
        verified: Number(row.verified) === 1 && Number(row.revoked) === 0,
        ...(!verifiedOnly ? { revoked: Number(row.revoked) === 1 } : {}),
      };
    });

    const offset = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;
    const boundedLimit = Math.max(1, Math.min(100, limit));
    const page = rankedEntries.slice(offset, offset + boundedLimit);
    const nextCursor = offset + boundedLimit < rankedEntries.length ? String(offset + boundedLimit) : undefined;

    const viewerEntry = resolvedViewerDid
      ? rankedEntries.find((e) => e.player === resolvedViewerDid && !e.revoked)
      : undefined;

    return {
      leaderboard,
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
    limit = 50,
  }: {
    leaderboard: string;
    timeframe?: Timeframe;
    scope?: 'public' | 'social';
    viewer?: string;
    limit?: number;
  }) {
    const lbRow = this.db
      .prepare('SELECT * FROM leaderboard_definitions WHERE uri = ?')
      .get(leaderboard) as Record<string, any> | undefined;
    if (!lbRow) {
      throw Object.assign(new Error(`Leaderboard not found: ${leaderboard}`), { status: 404 });
    }

    const gameRow = this.db
      .prepare('SELECT uri, name, icon_url, url, developer_name FROM games WHERE uri = ?')
      .get(String(lbRow.game_uri)) as Record<string, any> | undefined;

    const xrpc = await this.getXrpcLeaderboardScores({
      leaderboard,
      timeframe,
      scope,
      viewer,
      verifiedOnly: true,
      limit,
    });

    const enrich = (entry: XrpcScoreEntry) => {
      const actor = this.getActorMeta(entry.player);
      const row = this.db
        .prepare('SELECT issuer_did, key_id, is_demo FROM leaderboard_scores WHERE uri = ?')
        .get(entry.uri) as { issuer_did?: string; key_id?: string; is_demo?: number } | undefined;
      return {
        ...entry,
        displayName: actor.displayName ?? actor.handle ?? entry.player,
        avatarUrl: actor.avatarUrl,
        issuerDid: row?.issuer_did,
        keyId: row?.key_id,
        isDemo: row?.is_demo === 1,
      };
    };

    return {
      definition: {
        uri: String(lbRow.uri),
        name: String(lbRow.name),
        description: lbRow.description ? String(lbRow.description) : undefined,
        iconUrl: lbRow.icon_url ? String(lbRow.icon_url) : undefined,
        iconAlt: lbRow.icon_alt ? String(lbRow.icon_alt) : String(lbRow.name),
        sortOrder: String(lbRow.sort_order),
        scoreFormat: JSON.parse(String(lbRow.score_format_json)),
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
    const revocationsCount = (this.db.prepare('SELECT COUNT(*) AS c FROM revocations').get() as { c: number }).c;
    const blockedCount = (
      this.db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM achievement_unlocks WHERE verified = 0 OR revoked = 1) +
             (SELECT COUNT(*) FROM leaderboard_scores WHERE verified = 0 OR revoked = 1) AS c`
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
          `SELECT s.*, l.name AS lb_name, l.score_format_json, l.icon_url AS lb_icon_url,
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
        displayScore: r.display_score ? String(r.display_score) : formatScore(score, fmt),
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
      const maskedForViewer = isHidden && !viewerUnlock;

      return {
        uri,
        rkey: String(r.rkey),
        title: maskedForViewer ? 'Hidden Achievement' : record.title,
        description: maskedForViewer ? 'Keep playing to discover and unlock this hidden milestone.' : record.description,
        requirement: maskedForViewer ? undefined : record.requirement,
        revealedTitle: record.title,
        revealedDescription: record.description,
        iconUrl: r.icon_url ? String(r.icon_url) : undefined,
        iconAlt: maskedForViewer ? 'Locked hidden achievement icon' : record.iconAlt ?? record.title,
        tier: record.tier,
        hidden: isHidden,
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
    };
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
                  d.uri AS def_uri, d.title, d.description, d.tier, d.icon_url, d.icon_alt
           FROM achievement_unlocks u
           JOIN achievement_definitions d ON d.uri = u.achievement_uri
           WHERE u.player_did = ? AND d.game_uri = ? AND u.verified = 1 AND u.revoked = 0
           ORDER BY u.unlocked_at DESC`
        )
        .all(profile.did, gSummary.game) as Array<Record<string, any>>;

      // Deduplicate by achievement definition URI
      const seenDef = new Set<string>();
      const unlockedBadges = unlockedRows
        .filter((r) => {
          const id = String(r.def_uri);
          if (seenDef.has(id)) return false;
          seenDef.add(id);
          return true;
        })
        .map((r) => ({
          unlockUri: String(r.uri),
          achievementUri: String(r.def_uri),
          title: String(r.title),
          description: String(r.description),
          tier: r.tier ? String(r.tier) : undefined,
          iconUrl: r.icon_url ? String(r.icon_url) : undefined,
          iconAlt: r.icon_alt ? String(r.icon_alt) : String(r.title),
          unlockedAt: String(r.unlocked_at),
          attestationCid: r.attestation_cid ? String(r.attestation_cid) : undefined,
        }));

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
    };
  }

  /**
   * Cryptographic Proof & Revocation Inspector (`GET /api/proof?uri=<record-at-uri>`).
   */
  getProofDetail(recordUri: string) {
    const unlockRow = this.db
      .prepare('SELECT * FROM achievement_unlocks WHERE uri = ?')
      .get(recordUri) as Record<string, any> | undefined;

    if (unlockRow) {
      const matchingRev = unlockRow.attestation_cid
        ? (this.db
            .prepare('SELECT * FROM revocations WHERE attestation_cid = ? OR record_uri = ? LIMIT 1')
            .get(String(unlockRow.attestation_cid), recordUri) as Record<string, any> | undefined)
        : undefined;

      return {
        kind: 'achievement.unlock',
        uri: String(unlockRow.uri),
        playerDid: String(unlockRow.player_did),
        subjectUri: String(unlockRow.achievement_uri),
        issuerDid: unlockRow.issuer_did ? String(unlockRow.issuer_did) : undefined,
        keyId: unlockRow.key_id ? String(unlockRow.key_id) : undefined,
        attestationCid: unlockRow.attestation_cid ? String(unlockRow.attestation_cid) : undefined,
        verified: Number(unlockRow.verified) === 1 && Number(unlockRow.revoked) === 0,
        revoked: Number(unlockRow.revoked) === 1,
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
      const matchingRev = scoreRow.attestation_cid
        ? (this.db
            .prepare('SELECT * FROM revocations WHERE attestation_cid = ? OR record_uri = ? LIMIT 1')
            .get(String(scoreRow.attestation_cid), recordUri) as Record<string, any> | undefined)
        : undefined;

      return {
        kind: 'leaderboard.score',
        uri: String(scoreRow.uri),
        playerDid: String(scoreRow.player_did),
        subjectUri: String(scoreRow.leaderboard_uri),
        issuerDid: scoreRow.issuer_did ? String(scoreRow.issuer_did) : undefined,
        keyId: scoreRow.key_id ? String(scoreRow.key_id) : undefined,
        attestationCid: scoreRow.attestation_cid ? String(scoreRow.attestation_cid) : undefined,
        verified: Number(scoreRow.verified) === 1 && Number(scoreRow.revoked) === 0,
        revoked: Number(scoreRow.revoked) === 1,
        verificationError: scoreRow.verification_error ? String(scoreRow.verification_error) : undefined,
        verificationMessage: scoreRow.verification_message ? String(scoreRow.verification_message) : undefined,
        record: JSON.parse(String(scoreRow.raw_json)),
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
      rejectedRecords,
    };
  }
}
